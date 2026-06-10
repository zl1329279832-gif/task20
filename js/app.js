import { eventBus } from './core/event-bus.js';
import { stateManager } from './core/state-manager.js';
import { filterController } from './filters/filter-controller.js';
import { filterLinker } from './filters/filter-linker.js';

class App {
  constructor() {
    this.charts = {};
    this.importer = null;
  }

  async init() {
    // Initialize storage (default export)
    const dbMod = await import('./storage/db-manager.js');
    const dbManager = dbMod.default;
    await dbManager.open();

    // Initialize charts
    const [
      { BuildingOverview },
      { FloorHeatmap },
      { DeviceRanking },
      { TOUTrend },
      { YoyMomChart },
      { AnomalyPanel },
      { SuggestionPanel }
    ] = await Promise.all([
      import('./charts/building-overview.js'),
      import('./charts/floor-heatmap.js'),
      import('./charts/device-ranking.js'),
      import('./charts/tou-trend.js'),
      import('./charts/yoy-mom-chart.js'),
      import('./charts/anomaly-panel.js'),
      import('./charts/suggestion-panel.js')
    ]);

    this.charts = {
      buildingOverview: new BuildingOverview(),
      floorHeatmap: new FloorHeatmap(),
      deviceRanking: new DeviceRanking(),
      touTrend: new TOUTrend(),
      yoyMom: new YoyMomChart(),
      anomalyPanel: new AnomalyPanel(),
      suggestionPanel: new SuggestionPanel()
    };

    this.charts.buildingOverview.init('chart-building-overview');
    this.charts.floorHeatmap.init('chart-floor-heatmap');
    this.charts.deviceRanking.init('chart-device-ranking');
    this.charts.touTrend.init('chart-tou-trend');
    this.charts.yoyMom.init('chart-yoy-mom');
    this.charts.anomalyPanel.init('chart-anomaly');
    this.charts.suggestionPanel.init('chart-suggestions');

    // Initialize filters
    filterController.init();
    filterLinker.init(this.charts);

    // Initialize import dialog
    this._initImportDialog();

    // Initialize scheme management
    this._initSchemeDialog();

    // Initialize export
    this._initExport();

    // Show empty state initially
    Object.values(this.charts).forEach(c => { if (c.showEmpty) c.showEmpty(); });

    // Check if there's existing data
    const dsMod = await import('./storage/data-store.js');
    const dataStore = dsMod.default;
    const count = await dataStore.count('buildings');
    if (count > 0) {
      filterLinker.refreshAll();
      filterController._refreshBuildingList();
    }
  }

  _initImportDialog() {
    const modal = document.getElementById('import-modal');
    const btnOpen = document.getElementById('btn-import');
    const btnClose = document.getElementById('import-modal-close');
    const btnCancel = document.getElementById('btn-import-cancel');
    const btnConfirm = document.getElementById('btn-import-confirm');
    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file-input');
    const progressEl = document.getElementById('import-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const preview = document.getElementById('import-preview');
    const errorSection = document.getElementById('import-errors');
    const errorList = document.getElementById('error-list');
    const mappingTable = document.getElementById('field-mapping-table');

    let selectedEntityType = 'buildings';
    let pendingResult = null;

    btnOpen.addEventListener('click', () => modal.classList.add('active'));
    btnClose.addEventListener('click', () => this._closeImportModal());
    btnCancel.addEventListener('click', () => this._closeImportModal());

    // Tab selection
    modal.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedEntityType = btn.dataset.type;
      });
    });

    // Dropzone
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) this._handleFiles(e.dataTransfer.files, selectedEntityType);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) this._handleFiles(fileInput.files, selectedEntityType);
    });

    // Import progress from worker
    eventBus.on('import:progress', ({ phase, percent }) => {
      progressEl.hidden = false;
      progressFill.style.width = (percent || 0) + '%';
      const phaseLabels = {
        parsing: '解析中', recognizing: '字段识别', validating: '数据校验',
        detecting: '异常检测', storing: '存储数据', 'Reading file': '读取文件'
      };
      progressText.textContent = `${phaseLabels[phase] || phase}... ${percent || 0}%`;
    });

    // Worker import done — show preview, wait for user confirm
    eventBus.on('import:preview', (result) => {
      pendingResult = result;
      progressFill.style.width = '100%';
      progressText.textContent = `解析完成! 有效记录: ${result.validRows}/${result.totalRows}`;

      // Show field mappings
      if (result.mappings && Object.keys(result.mappings).length) {
        let html = '<table class="field-mapping-table"><tr><th>CSV列</th><th>映射字段</th><th>置信度</th></tr>';
        for (const [csv, field] of Object.entries(result.mappings)) {
          html += `<tr><td>${csv}</td><td>${field}</td><td class="confidence-high">✓</td></tr>`;
        }
        html += '</table>';
        mappingTable.innerHTML = html;
        preview.hidden = false;
      }

      // Show errors
      if (result.errors && result.errors.length) {
        errorSection.hidden = false;
        errorList.innerHTML = result.errors.slice(0, 20).map(e =>
          `<div class="error-item">行 ${e.row}: [${e.field}] ${e.message}</div>`
        ).join('') + (result.errors.length > 20 ? `<div class="warning-item">...还有 ${result.errors.length - 20} 条错误</div>` : '');
      }

      if (result.warnings && result.warnings.length) {
        const warnHtml = result.warnings.slice(0, 10).map(w =>
          `<div class="warning-item">行 ${w.row}: [${w.field}] ${w.message}</div>`
        ).join('');
        errorList.innerHTML += warnHtml;
        if (!result.errors?.length) errorSection.hidden = false;
      }

      btnConfirm.disabled = false;
    });

    // Confirm: store to IndexedDB
    btnConfirm.addEventListener('click', async () => {
      if (!pendingResult || !pendingResult.validRecords?.length) return;
      btnConfirm.disabled = true;
      try {
        const dsMod = await import('./storage/data-store.js');
        const dataStore = dsMod.default;
        await dataStore.putBatch(pendingResult.entityType, pendingResult.validRecords);
        eventBus.emit('data:imported', { entityType: pendingResult.entityType });
        this._closeImportModal();
      } catch (e) {
        console.error('Store error:', e);
        progressText.textContent = `存储失败: ${e.message}`;
        btnConfirm.disabled = false;
      }
    });
  }

  async _handleFiles(files, entityType) {
    const progressEl = document.getElementById('import-progress');
    const progressFill = document.getElementById('progress-fill');
    const preview = document.getElementById('import-preview');
    const errorSection = document.getElementById('import-errors');
    const btnConfirm = document.getElementById('btn-import-confirm');

    progressEl.hidden = false;
    preview.hidden = true;
    errorSection.hidden = true;
    btnConfirm.disabled = true;
    progressFill.style.width = '0%';
    progressFill.style.background = '';

    try {
      const { DataImporter } = await import('./data/data-importer.js');
      if (!this.importer) this.importer = new DataImporter(null); // no auto-store

      for (const file of files) {
        const result = await this.importer.importFile(file, entityType);
        // Emit preview event with parsed data for user review
        eventBus.emit('import:preview', {
          entityType: result.entityType || entityType,
          totalRows: result.totalRows || 0,
          validRows: result.validRows || 0,
          validRecords: result.validRecords || result.records || [],
          mappings: result.mappings || {},
          errors: result.errors || [],
          warnings: result.warnings || []
        });
      }
    } catch (e) {
      console.error('Import error:', e);
      progressFill.style.width = '100%';
      progressFill.style.background = 'var(--color-danger)';
      document.getElementById('progress-text').textContent = `导入失败: ${e.message || e}`;
    }
  }

  _closeImportModal() {
    const modal = document.getElementById('import-modal');
    modal.classList.remove('active');
    document.getElementById('import-progress').hidden = true;
    document.getElementById('import-preview').hidden = true;
    document.getElementById('import-errors').hidden = true;
    document.getElementById('btn-import-confirm').disabled = true;
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-fill').style.background = '';
    document.getElementById('import-file-input').value = '';
  }

  _initSchemeDialog() {
    const modal = document.getElementById('scheme-modal');
    const btnSave = document.getElementById('btn-save-scheme');
    const btnLoad = document.getElementById('btn-load-scheme');
    const btnClose = document.getElementById('scheme-modal-close');
    const btnCancel = document.getElementById('btn-scheme-cancel');
    const btnConfirm = document.getElementById('btn-scheme-confirm');
    const title = document.getElementById('scheme-modal-title');
    const saveForm = document.getElementById('scheme-save-form');
    const listEl = document.getElementById('scheme-list');
    const nameInput = document.getElementById('scheme-name');

    let mode = 'save';

    btnSave.addEventListener('click', () => {
      mode = 'save';
      title.textContent = '保存分析方案';
      saveForm.hidden = false;
      listEl.hidden = true;
      btnConfirm.textContent = '保存';
      modal.classList.add('active');
    });

    btnLoad.addEventListener('click', async () => {
      mode = 'load';
      title.textContent = '加载分析方案';
      saveForm.hidden = true;
      listEl.hidden = false;
      btnConfirm.textContent = '加载';
      modal.classList.add('active');
      await this._refreshSchemeList();
    });

    btnClose.addEventListener('click', () => modal.classList.remove('active'));
    btnCancel.addEventListener('click', () => modal.classList.remove('active'));

    btnConfirm.addEventListener('click', async () => {
      const ssMod = await import('./storage/scheme-store.js');
      const schemeStore = ssMod.default;
      if (mode === 'save') {
        const name = nameInput.value.trim();
        if (!name) return;
        const snapshot = stateManager.getSnapshot();
        await schemeStore.saveScheme(name, snapshot);
        nameInput.value = '';
        modal.classList.remove('active');
      } else {
        const selected = listEl.querySelector('.scheme-item.selected');
        if (!selected) return;
        const scheme = await schemeStore.loadScheme(selected.dataset.id);
        if (scheme && scheme.stateSnapshot) {
          stateManager.restoreSnapshot(scheme.stateSnapshot);
        }
        modal.classList.remove('active');
      }
    });
  }

  async _refreshSchemeList() {
    const listEl = document.getElementById('scheme-list');
    try {
      const ssMod = await import('./storage/scheme-store.js');
      const schemeStore = ssMod.default;
      const schemes = await schemeStore.listSchemes();
      if (schemes.length === 0) {
        listEl.innerHTML = '<div class="scheme-empty">暂无保存的方案</div>';
        return;
      }
      listEl.innerHTML = schemes.map(s => `
        <div class="scheme-item" data-id="${s.id}">
          <div class="scheme-info">
            <div class="scheme-name">${s.name}</div>
            <div class="scheme-date">${new Date(s.created_at).toLocaleString('zh-CN')}</div>
          </div>
          <div class="scheme-actions">
            <button class="scheme-delete" data-id="${s.id}" title="删除">&times;</button>
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('.scheme-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('scheme-delete')) return;
          listEl.querySelectorAll('.scheme-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
        });
      });

      listEl.querySelectorAll('.scheme-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ssMod2 = await import('./storage/scheme-store.js');
          await ssMod2.default.deleteScheme(btn.dataset.id);
          await this._refreshSchemeList();
        });
      });
    } catch (e) {
      listEl.innerHTML = '<div class="scheme-empty">加载失败</div>';
    }
  }

  _initExport() {
    document.getElementById('btn-export').addEventListener('click', async () => {
      try {
        const { ReportExporter } = await import('./export/report-exporter.js');
        const exporter = new ReportExporter();
        const state = stateManager.getState();

        const chartImages = {};
        for (const [key, chart] of Object.entries(this.charts)) {
          if (chart.toDataURL) {
            chartImages[key] = chart.toDataURL();
          }
        }

        const dsMod = await import('./storage/data-store.js');
        const dataStore = dsMod.default;
        const summaryData = {
          buildings: await dataStore.count('buildings'),
          devices: await dataStore.count('devices'),
          readings: await dataStore.count('meter_readings')
        };

        const html = exporter.generateReport(state, chartImages, summaryData);
        exporter.downloadReport(html, `能耗分析报告_${new Date().toISOString().slice(0, 10)}.html`);
      } catch (e) {
        console.error('Export error:', e);
        alert('导出失败: ' + e.message);
      }
    });
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(e => console.error('App init failed:', e));
});
