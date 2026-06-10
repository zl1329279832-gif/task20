/* ===== 导入控制器 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.ImportController = class ImportController {
    constructor(db, workerManager) {
        this.db = db;
        this.worker = workerManager;
        this.currentType = 'building';
        this.parsedData = null;
        this.currentMapping = null;
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-input');
        this.importBtn = document.getElementById('btn-do-import');
        this._bindEvents();
    }

    _bindEvents() {
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); this.dropZone.classList.add('dragover'); });
        this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('dragover'));
        this.dropZone.addEventListener('drop', (e) => { e.preventDefault(); this.dropZone.classList.remove('dragover'); if (e.dataTransfer.files.length) this._handleFiles(e.dataTransfer.files); });
        this.fileInput.addEventListener('change', (e) => { if (e.target.files.length) this._handleFiles(e.target.files); });
        this.importBtn.addEventListener('click', () => this._doImport());
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => { document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); this.currentType = btn.dataset.type; });
        });
    }

    async _handleFiles(files) {
        this._showLoading('解析文件中...');
        try {
            const results = [];
            for (const file of files) {
                const parsed = await EnergyApp.Parser.parseFile(file);
                const mapping = EnergyApp.Parser.mapFields(parsed.headers, this.currentType);
                results.push({ file: file.name, parsed, mapping, dataType: this.currentType });
            }
            this._showFieldMapping(results[0].mapping, results[0].parsed.headers);
            this._showPreview(results[0].parsed);
            const converted = this._convertRows(results[0].parsed.rows, results[0].mapping.mapping);
            const validation = EnergyApp.Validator.validateAll({ [this.currentType]: converted });
            this._showValidation(validation);
            this.parsedData = results;
        } catch (err) {
            this._toast('解析失败: ' + err.message, 'error');
        } finally { this._hideLoading(); }
    }

    _showFieldMapping(mapping, headers) {
        const section = document.getElementById('field-mapping');
        const content = document.getElementById('mapping-content');
        section.style.display = 'block';
        let html = '';
        Object.entries(mapping.mapping).forEach(([field, info]) => {
            const cls = info.confidence >= 0.9 ? 'confidence-high' : info.confidence >= 0.7 ? 'confidence-medium' : 'confidence-low';
            const label = info.confidence >= 0.9 ? '高' : info.confidence >= 0.7 ? '中' : '低';
            html += `<div class="mapping-item"><span class="field-name">${field}</span><span class="arrow">←</span><span class="header-name">${info.header}</span><span class="${cls}">(${label} ${(info.confidence*100).toFixed(0)}%)</span></div>`;
        });
        if (mapping.unmapped && mapping.unmapped.length) html += `<div style="margin-top:12px;color:#9ca3af;font-size:12px">未映射列: ${mapping.unmapped.join(', ')}</div>`;
        content.innerHTML = html;
        this.currentMapping = mapping;
    }

    _showPreview(parsed) {
        const section = document.getElementById('import-summary');
        const content = document.getElementById('summary-content');
        section.style.display = 'block';
        if (!parsed.rows.length) { content.innerHTML = '<p style="color:#9ca3af">无数据</p>'; return; }
        const headers = parsed.headers;
        const previewRows = parsed.rows.slice(0, 5);
        let html = `<p style="font-size:13px;color:#6b7280;margin-bottom:8px">共 ${parsed.rows.length} 条记录</p>`;
        html += '<div style="overflow-x:auto"><table class="summary-table"><thead><tr>';
        headers.forEach(h => { html += `<th>${h}</th>`; });
        html += '</tr></thead><tbody>';
        previewRows.forEach(row => { html += '<tr>'; headers.forEach(h => { html += `<td>${row[h] != null ? row[h] : '-'}</td>`; }); html += '</tr>'; });
        html += '</tbody></table></div>';
        content.innerHTML = html;
    }

    _showValidation(validation) {
        const section = document.getElementById('validation-result');
        const content = document.getElementById('validation-content');
        section.style.display = 'block';
        if (!validation.errors.length && !validation.warnings.length && !validation.info.length) {
            content.innerHTML = '<div class="validation-item info">数据校验通过 ✓</div>'; return;
        }
        let html = '';
        validation.errors.forEach(e => { html += `<div class="validation-item error"><span>❌</span><span>${e.message}</span></div>`; });
        validation.warnings.forEach(w => { html += `<div class="validation-item warning"><span>⚠️</span><span>${w.message}</span></div>`; });
        validation.info.forEach(i => { html += `<div class="validation-item info"><span>ℹ️</span><span>${i.message}</span></div>`; });
        content.innerHTML = html;
    }

    _convertRows(rows, mapping) {
        return rows.map(row => {
            const out = {};
            Object.entries(mapping).forEach(([field, info]) => {
                let val = row[info.header];
                if (['reading','energy','power','price','area','rated_power','temperature','runtime','brightness'].includes(field))
                    val = Number(String(val || '').replace(/,/g, '')) || 0;
                else if (['timestamp','effective_date','install_date'].includes(field)) {
                    const d = new Date(val); if (!isNaN(d.getTime())) val = d.toISOString();
                } else if (['floors','floor_number'].includes(field))
                    val = parseInt(val, 10) || 0;
                out[field] = val != null ? val : '';
            });
            return out;
        });
    }

    async _doImport() {
        if (!this.parsedData || !this.parsedData.length) { this._toast('请先选择文件', 'warning'); return; }
        this._showLoading('正在导入...');
        try {
            for (const r of this.parsedData) {
                const storeMap = { building: 'buildings', floor: 'floors', room: 'rooms', device: 'devices', meter_reading: 'meter_readings', ac_energy: 'ac_energy', lighting_energy: 'lighting_energy', pricing: 'pricing' };
                const storeName = storeMap[r.dataType] || r.dataType;
                const converted = this._convertRows(r.parsed.rows, r.mapping.mapping);
                if (converted.length > 0) { await this.db.clear(storeName); await this.db.bulkAdd(storeName, converted); }
            }
            this._toast('导入成功', 'success');
            this.parsedData = null;
            document.getElementById('field-mapping').style.display = 'none';
            document.getElementById('validation-result').style.display = 'none';
            document.getElementById('import-summary').style.display = 'none';
            if (this.onImportComplete) this.onImportComplete();
        } catch (err) { this._toast('导入失败: ' + err.message, 'error'); }
        finally { this._hideLoading(); }
    }

    _showLoading(text) { document.getElementById('loading-text').textContent = text || '处理中...'; document.getElementById('loading-overlay').style.display = 'flex'; }
    _hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
    _toast(msg, type = 'info') {
        const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
        document.getElementById('toast-container').appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 4000);
    }
};
