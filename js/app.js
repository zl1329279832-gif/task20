/* ===== 主应用控制器 ===== */
/* 修复: 导入后推进 sessionVersion 并通知 dashboard; 方案保存附带数据指纹; 方案加载校验指纹 */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.App = class App {
    constructor() {
        this.db = new EnergyApp.DB();
        this.filter = new EnergyApp.Filter();
        this.storage = null;
        this.workerManager = null;
        this.importController = null;
        this.dashboardController = null;
        this.strategyManager = null;
        this.currentView = 'import';
    }

    async init() {
        await this.db.open();
        this.storage = new EnergyApp.Storage(this.db);
        this.workerManager = new EnergyApp.WorkerManager('./workers/processor.js');
        this.strategyManager = new EnergyApp.StrategyManager(this.db, this.workerManager, this.storage);
        this.importController = new EnergyApp.ImportController(this.db, this.workerManager);
        this.importController.onImportComplete = () => this._onImported();
        this.dashboardController = new EnergyApp.DashboardController(this.db, this.filter, this.storage, this.workerManager);
        this.dashboardController.strategyManager = this.strategyManager;

        this._bindNav();
        this._bindActions();
        this._bindStrategyUI();
        this.filter.bindUI();

        const readings = await this.db.getAll('meter_readings');
        if (readings.length > 0) {
            this._switchView('dashboard');
            await this.dashboardController.init();
        } else {
            await this._loadSampleData();
            this._toast('已加载演示数据，可点击「分析仪表盘」查看', 'info');
        }
    }

    _bindNav() {
        document.getElementById('btn-import').addEventListener('click', () => this._switchView('import'));
        document.getElementById('btn-dashboard').addEventListener('click', async () => { this._switchView('dashboard'); await this.dashboardController.init(); });
        document.getElementById('btn-strategy').addEventListener('click', async () => { this._switchView('strategy'); await this.strategyManager.loadAll(); });
    }

    _switchView(view) {
        this.currentView = view;
        document.getElementById('import-section').classList.toggle('active', view === 'import');
        document.getElementById('dashboard-section').classList.toggle('active', view === 'dashboard');
        document.getElementById('strategy-section').classList.toggle('active', view === 'strategy');
        document.getElementById('btn-import').classList.toggle('active', view === 'import');
        document.getElementById('btn-dashboard').classList.toggle('active', view === 'dashboard');
        document.getElementById('btn-strategy').classList.toggle('active', view === 'strategy');
    }

    _bindActions() {
        document.getElementById('btn-save-scheme').addEventListener('click', () => this._showSaveModal());
        document.getElementById('btn-load-scheme').addEventListener('click', () => this._showLoadModal());
        document.getElementById('btn-export').addEventListener('click', () => this._exportReport());
        document.querySelector('.modal-close')?.addEventListener('click', () => this._hideModal());
        document.querySelector('.modal-overlay')?.addEventListener('click', () => this._hideModal());
    }

    /* ---- 保存方案: 附带数据指纹 ---- */
    async _showSaveModal() {
        const modal = document.getElementById('scheme-modal');
        document.getElementById('modal-title').textContent = '保存分析方案';
        document.getElementById('modal-body').innerHTML = `<input type="text" id="scheme-name" placeholder="请输入方案名称"><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn-secondary" id="modal-cancel">取消</button><button class="btn-primary" id="modal-confirm">保存</button></div>`;
        modal.style.display = 'flex';
        document.getElementById('modal-cancel').onclick = () => this._hideModal();
        document.getElementById('modal-confirm').onclick = async () => {
            const name = document.getElementById('scheme-name').value.trim();
            if (!name) { this._toast('请输入名称', 'warning'); return; }
            const fingerprint = await this.storage.computeDataFingerprint();
            await this.storage.saveScheme(name, this.filter.toJSON(), '', fingerprint);
            this._toast(`方案 "${name}" 已保存（含数据指纹）`, 'success');
            this._hideModal();
        };
    }

    /* ---- 加载方案: 校验数据指纹 ---- */
    async _showLoadModal() {
        const modal = document.getElementById('scheme-modal');
        document.getElementById('modal-title').textContent = '加载分析方案';
        const schemes = await this.storage.getAllSchemes();
        const currentFp = await this.storage.computeDataFingerprint();
        let html = '';
        if (!schemes.length) html = '<p style="text-align:center;color:#9ca3af;padding:20px">暂无已保存的方案</p>';
        else schemes.forEach(s => {
            const cmp = this.storage.compareFingerprint(s.dataFingerprint, currentFp);
            const warnBadge = cmp.match ? '' : `<span style="color:#f59e0b;font-size:11px;margin-left:8px" title="${cmp.reason}">⚠ 数据已变更</span>`;
            html += `<div class="scheme-item" data-id="${s.scheme_id}"><div><div class="scheme-name">${s.name}${warnBadge}</div><div class="scheme-date">${new Date(s.updatedAt).toLocaleString('zh-CN')}</div></div><button class="scheme-delete" data-id="${s.scheme_id}">&times;</button></div>`;
        });
        document.getElementById('modal-body').innerHTML = html;
        modal.style.display = 'flex';
        document.querySelectorAll('.scheme-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.classList.contains('scheme-delete')) return;
                const scheme = await this.storage.getScheme(item.dataset.id);
                if (scheme) {
                    /* 指纹校验 */
                    if (scheme.dataFingerprint) {
                        const cmp = this.storage.compareFingerprint(scheme.dataFingerprint, currentFp);
                        if (!cmp.match) {
                            this._toast(`方案 "${scheme.name}" 的数据已变更: ${cmp.reason}，筛选条件可能不适用`, 'warning');
                        }
                    }
                    this.filter.fromJSON(scheme.filter);
                    this._toast(`已加载 "${scheme.name}"`, 'success');
                    this._hideModal();
                    await this.dashboardController.init();
                }
            });
        });
        document.querySelectorAll('.scheme-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => { e.stopPropagation(); await this.storage.deleteScheme(btn.dataset.id); btn.closest('.scheme-item').remove(); this._toast('已删除', 'info'); });
        });
    }

    _hideModal() { document.getElementById('scheme-modal').style.display = 'none'; }

    /* ---- 导出报告: 使用缓存的看板数据, 保证一致性 ---- */
    _exportReport() {
        try {
            const data = this.dashboardController.getReportData();
            if (!data || !data.overview) {
                this._toast('无可用数据，请先导入数据并等待看板渲染完成', 'warning');
                return;
            }
            const html = EnergyApp.Export.generateReport(data);
            EnergyApp.Export.download(html);
            this._toast('报告已导出', 'success');
        } catch (err) { this._toast('导出失败: ' + err.message, 'error'); }
    }

    _exportStrategyReport() {
        try {
            const comparison = this.strategyManager.getComparisonData();
            if (!comparison.length) {
                this._toast('请先创建并评估策略，选择至少一个策略进行对比', 'warning');
                return;
            }
            const html = EnergyApp.Export.generateStrategyReport(comparison);
            EnergyApp.Export.download(html, `策略对比报告_${EnergyApp.utils.formatDate(new Date())}.html`);
            this._toast('策略对比报告已导出', 'success');
        } catch (err) { this._toast('导出失败: ' + err.message, 'error'); }
    }

    /* ---- 策略沙盘 UI 绑定 ---- */
    _bindStrategyUI() {
        document.getElementById('btn-create-strategy')?.addEventListener('click', () => this._showCreateStrategyModal());
        document.getElementById('btn-evaluate-all')?.addEventListener('click', () => this._evaluateAllStrategies());
        document.getElementById('btn-export-strategy')?.addEventListener('click', () => this._exportStrategyReport());

        this.strategyManager.onChange(() => this._renderStrategyList());
    }

    _showCreateStrategyModal() {
        const modal = document.getElementById('scheme-modal');
        document.getElementById('modal-title').textContent = '新建节能策略';
        document.getElementById('modal-body').innerHTML = `
            <input type="text" id="strategy-name" placeholder="策略名称">
            <div style="margin-bottom:8px"><label style="font-size:13px;font-weight:600">负荷转移比例</label>
                <div style="display:flex;align-items:center;gap:8px"><input type="range" id="param-load-shift" min="0" max="100" value="0" style="flex:1"><span id="val-load-shift">0%</span></div></div>
            <div style="margin-bottom:8px"><label style="font-size:13px;font-weight:600">需量削减比例</label>
                <div style="display:flex;align-items:center;gap:8px"><input type="range" id="param-demand-reduction" min="0" max="100" value="0" style="flex:1"><span id="val-demand-reduction">0%</span></div></div>
            <div style="margin-bottom:8px"><label style="font-size:13px;font-weight:600">设备效率提升</label>
                <div style="display:flex;align-items:center;gap:8px"><input type="range" id="param-efficiency" min="0" max="50" value="0" style="flex:1"><span id="val-efficiency">0%</span></div></div>
            <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600">周末关停比例</label>
                <div style="display:flex;align-items:center;gap:8px"><input type="range" id="param-weekend" min="0" max="100" value="0" style="flex:1"><span id="val-weekend">0%</span></div></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button class="btn-secondary" id="modal-cancel">取消</button>
                <button class="btn-primary" id="modal-confirm">创建</button>
            </div>`;
        modal.style.display = 'flex';

        // Slider value display
        ['load-shift','demand-reduction','efficiency','weekend'].forEach(k => {
            const slider = document.getElementById('param-' + k);
            const valEl = document.getElementById('val-' + k);
            if (slider && valEl) slider.addEventListener('input', () => { valEl.textContent = slider.value + '%'; });
        });

        document.getElementById('modal-cancel').onclick = () => this._hideModal();
        document.getElementById('modal-confirm').onclick = async () => {
            const name = document.getElementById('strategy-name').value.trim();
            if (!name) { this._toast('请输入策略名称', 'warning'); return; }
            const params = {
                load_shift_pct: (document.getElementById('param-load-shift').value || 0) / 100,
                demand_reduction_pct: (document.getElementById('param-demand-reduction').value || 0) / 100,
                device_efficiency_gain: (document.getElementById('param-efficiency').value || 0) / 100,
                weekend_shutdown_pct: (document.getElementById('param-weekend').value || 0) / 100
            };
            await this.strategyManager.create(name, '', params, false);
            this._toast(`策略 "${name}" 已创建`, 'success');
            this._hideModal();
        };
    }

    async _evaluateAllStrategies() {
        if (!this.strategyManager.strategies.length) {
            this._toast('暂无策略可评估', 'warning'); return;
        }
        this._showLoading('正在评估策略...');
        try {
            await this.dashboardController.loadData();
            const data = this.dashboardController.data;
            const filter = this.filter.get();
            await this.strategyManager.evaluateAll(data, filter);
            this._toast('所有策略已评估完成', 'success');
            // 自动把所有已评估策略加入对比
            const ids = this.strategyManager.strategies.filter(s => s.results).map(s => s.strategy_id);
            this.strategyManager.setComparison(ids);
        } catch (err) { this._toast('评估失败: ' + err.message, 'error'); }
        finally { this._hideLoading(); }
    }

    _renderStrategyList() {
        const listEl = document.getElementById('strategy-list');
        if (!listEl) return;
        const strategies = this.strategyManager.strategies;
        if (!strategies.length) {
            listEl.innerHTML = '<div class="empty-state"><p>暂无策略，点击"新建策略"开始</p></div>';
            return;
        }
        const currentFp = null; // 简化: 不实时计算指纹
        let html = '';
        strategies.forEach(s => {
            const selected = this.strategyManager.selectedStrategyId === s.strategy_id;
            const inComparison = this.strategyManager.activeComparison.includes(s.strategy_id);
            const hasResults = !!s.results;
            html += `<div class="strategy-card ${selected ? 'selected' : ''}" data-id="${s.strategy_id}">
                <div class="strategy-card-header">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                        <input type="checkbox" class="comparison-check" data-id="${s.strategy_id}" ${inComparison ? 'checked' : ''} ${!hasResults ? 'disabled' : ''}>
                        <span class="strategy-name">${s.name}</span>
                    </label>
                    ${s.is_baseline ? '<span class="baseline-badge">基线</span>' : ''}
                    <button class="strategy-delete" data-id="${s.strategy_id}">&times;</button>
                </div>
                <div class="strategy-card-params">
                    <span>负荷转移: ${(s.parameters.load_shift_pct * 100).toFixed(0)}%</span>
                    <span>需量削减: ${(s.parameters.demand_reduction_pct * 100).toFixed(0)}%</span>
                    <span>效率: ${(s.parameters.device_efficiency_gain * 100).toFixed(0)}%</span>
                    <span>周末: ${(s.parameters.weekend_shutdown_pct * 100).toFixed(0)}%</span>
                </div>
                ${hasResults ? `<div class="strategy-card-results">
                    <span>碳减排: ${s.results.reductionPct.toFixed(1)}%</span>
                    <span>节省: ¥${EnergyApp.utils.formatNumber(s.results.savings.cost, 0)}</span>
                </div>` : '<div class="strategy-card-results" style="color:#9ca3af">未评估</div>'}
            </div>`;
        });
        listEl.innerHTML = html;

        // 事件绑定
        listEl.querySelectorAll('.strategy-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('comparison-check') || e.target.classList.contains('strategy-delete')) return;
                this.strategyManager.select(card.dataset.id);
                this._renderStrategyDetail(card.dataset.id);
            });
        });
        listEl.querySelectorAll('.comparison-check').forEach(cb => {
            cb.addEventListener('change', () => { this.strategyManager.toggleComparison(cb.dataset.id); });
        });
        listEl.querySelectorAll('.strategy-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.strategyManager.delete(btn.dataset.id);
                this._toast('策略已删除', 'info');
            });
        });
    }

    _renderStrategyDetail(strategyId) {
        const detailEl = document.getElementById('strategy-detail');
        if (!detailEl) return;
        const s = this.strategyManager.getStrategy(strategyId);
        if (!s) { detailEl.innerHTML = '<div class="empty-state"><p>选择或创建一个策略</p></div>'; return; }

        let html = `<h4>${s.name}${s.is_baseline ? ' <span class="baseline-badge">基线</span>' : ''}</h4>`;
        html += '<div class="param-grid">';
        html += `<div class="param-row"><label>负荷转移比例</label><input type="range" id="detail-load-shift" min="0" max="100" value="${s.parameters.load_shift_pct * 100}"><span>${(s.parameters.load_shift_pct * 100).toFixed(0)}%</span></div>`;
        html += `<div class="param-row"><label>需量削减比例</label><input type="range" id="detail-demand-reduction" min="0" max="100" value="${s.parameters.demand_reduction_pct * 100}"><span>${(s.parameters.demand_reduction_pct * 100).toFixed(0)}%</span></div>`;
        html += `<div class="param-row"><label>设备效率提升</label><input type="range" id="detail-efficiency" min="0" max="50" value="${s.parameters.device_efficiency_gain * 100}"><span>${(s.parameters.device_efficiency_gain * 100).toFixed(0)}%</span></div>`;
        html += `<div class="param-row"><label>周末关停比例</label><input type="range" id="detail-weekend" min="0" max="100" value="${s.parameters.weekend_shutdown_pct * 100}"><span>${(s.parameters.weekend_shutdown_pct * 100).toFixed(0)}%</span></div>`;
        html += '</div>';
        html += '<button class="btn-primary" id="btn-save-params" style="margin-top:12px">保存参数</button>';

        if (s.results) {
            html += '<div class="results-section" style="margin-top:16px">';
            html += `<h4>评估结果</h4>
                <div class="result-grid">
                    <div><label>基线碳排</label><div>${EnergyApp.utils.formatNumber(s.results.baseline.totalCarbon, 0)} kg</div></div>
                    <div><label>预测碳排</label><div>${EnergyApp.utils.formatNumber(s.results.projected.totalCarbon, 0)} kg</div></div>
                    <div><label>碳减排率</label><div style="color:#10b981;font-weight:700">${s.results.reductionPct.toFixed(1)}%</div></div>
                    <div><label>节省成本</label><div style="color:#10b981;font-weight:700">¥${EnergyApp.utils.formatNumber(s.results.savings.cost, 0)}</div></div>
                </div>`;
            html += '</div>';
        }
        detailEl.innerHTML = html;

        // Slider value display
        ['load-shift','demand-reduction','efficiency','weekend'].forEach(k => {
            const slider = detailEl.querySelector('#detail-' + k);
            if (slider) slider.addEventListener('input', () => { slider.nextElementSibling.textContent = slider.value + '%'; });
        });

        // Save params
        detailEl.querySelector('#btn-save-params')?.addEventListener('click', async () => {
            const params = {
                load_shift_pct: (detailEl.querySelector('#detail-load-shift').value || 0) / 100,
                demand_reduction_pct: (detailEl.querySelector('#detail-demand-reduction').value || 0) / 100,
                device_efficiency_gain: (detailEl.querySelector('#detail-efficiency').value || 0) / 100,
                weekend_shutdown_pct: (detailEl.querySelector('#detail-weekend').value || 0) / 100
            };
            await this.strategyManager.update(strategyId, { parameters: params, results: null });
            this._toast('参数已保存，请点击"全部评估"重新评估', 'info');
        });
    }

    /* ---- 导入完成回调: 推进 sessionVersion, 刷新看板 ---- */
    async _onImported() {
        /* 1. 推进数据代次 — 使所有未完成的 Worker 任务失效 */
        this.workerManager.bumpSessionVersion();

        /* 2. 通知看板缓存失效 */
        this.dashboardController.invalidateData();

        this._toast('数据导入完成', 'info');
        this._switchView('dashboard');

        /* 3. 重新加载数据并渲染 */
        await this.dashboardController.init();
    }

    async _loadSampleData() {
        const buildings = [
            { building_id: 'B001', building_name: 'A栋-研发中心', location: '园区东侧', floors: 8, area: 12000 },
            { building_id: 'B002', building_name: 'B栋-办公楼', location: '园区中央', floors: 6, area: 8000 },
            { building_id: 'B003', building_name: 'C栋-数据中心', location: '园区西侧', floors: 4, area: 5000 },
            { building_id: 'B004', building_name: 'D栋-会议中心', location: '园区南侧', floors: 3, area: 3500 }
        ];
        const floors = [], rooms = [], devices = [], readings = [];
        const pricing = [
            { pricing_id: 'P1', period_type: 'sharp_peak', start_time: '19:00', end_time: '22:00', price: 1.45, effective_date: '2025-01-01' },
            { pricing_id: 'P2', period_type: 'peak', start_time: '08:00', end_time: '11:00', price: 1.05, effective_date: '2025-01-01' },
            { pricing_id: 'P3', period_type: 'flat', start_time: '06:00', end_time: '08:00', price: 0.65, effective_date: '2025-01-01' },
            { pricing_id: 'P4', period_type: 'valley', start_time: '22:00', end_time: '06:00', price: 0.35, effective_date: '2025-01-01' }
        ];

        const now = new Date();
        const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);

        buildings.forEach(b => {
            for (let f = 1; f <= b.floors; f++) {
                const fid = `${b.building_id}-F${f}`;
                floors.push({ floor_id: fid, building_id: b.building_id, floor_number: f, floor_name: `${f}F` });
                for (let r = 1; r <= 2; r++) {
                    const rid = `${fid}-R${r}`;
                    rooms.push({ room_id: rid, floor_id: fid, room_name: `${f}${r}室`, room_type: r === 1 ? '办公' : '机房', area: 60 + Math.random() * 40 });
                    ['electricity', 'ac', 'lighting'].forEach(dt => {
                        const did = `${rid}-${dt}`, mid = `M-${did}`;
                        devices.push({ device_id: did, device_name: `${dt==='electricity'?'总表':dt==='ac'?'空调':'照明'}-${f}${r}室`, room_id: rid, device_type: dt, meter_id: mid, rated_power: dt==='ac'?3.5:dt==='lighting'?0.5:10, building_id: b.building_id, floor_id: fid });
                        let baseReading = 1000 + Math.random() * 5000;
                        for (let day = 0; day < 400; day++) {
                            const ts = new Date(start.getTime() + day * 86400000);
                            if (ts > now) break;
                            const dow = ts.getDay(), mo = ts.getMonth();
                            const isWeekend = dow === 0 || dow === 6;
                            const isSummer = mo >= 5 && mo <= 8, isWinter = mo >= 11 || mo <= 1;
                            let daily;
                            if (dt === 'ac') daily = isSummer ? 25+Math.random()*15 : isWinter ? 15+Math.random()*10 : 3+Math.random()*5;
                            else if (dt === 'lighting') daily = isWeekend ? 1.5+Math.random() : 4+Math.random()*2;
                            else daily = isWeekend ? 8+Math.random()*4 : 18+Math.random()*8;
                            if (b.building_id === 'B003') daily *= 2.5;
                            if (b.building_id === 'B001') daily *= 1.3;
                            if (b.building_id === 'B004') daily *= 0.6;
                            daily *= (1 + f * 0.02) * (0.85 + Math.random() * 0.3);
                            if (Math.random() < 0.008) daily *= (4 + Math.random() * 3);
                            baseReading += daily;
                            const h = 8;
                            let pt = 'flat';
                            if (h >= 19 && h < 22) pt = 'sharp_peak';
                            else if (h >= 8 && h < 11) pt = 'peak';
                            else if (h >= 22 || h < 6) pt = 'valley';
                            const priceObj = pricing.find(p => p.period_type === pt);
                            readings.push({ meter_id: mid, timestamp: ts.toISOString(), reading: Math.round(baseReading*100)/100, energy: Math.round(daily*100)/100, cost: Math.round(daily*(priceObj?priceObj.price:0.65)*100)/100, period_type: pt, energy_type: dt, building_id: b.building_id, floor_id: fid });
                        }
                    });
                }
            }
        });

        await Promise.all([
            this.db.bulkAdd('buildings', buildings),
            this.db.bulkAdd('floors', floors),
            this.db.bulkAdd('rooms', rooms),
            this.db.bulkAdd('devices', devices),
            this.db.bulkAdd('pricing', pricing)
        ]);
        const chunk = 5000;
        for (let i = 0; i < readings.length; i += chunk) await this.db.bulkAdd('meter_readings', readings.slice(i, i + chunk));

        /* ===== 碳排因子 ===== */
        const carbonFactors = [
            { factor_id: 'CF-all-sharp_peak', building_id: 'all', period_type: 'sharp_peak', factor: 1.102, effective_date: '2025-01-01', source: 'regional_grid' },
            { factor_id: 'CF-all-peak', building_id: 'all', period_type: 'peak', factor: 0.997, effective_date: '2025-01-01', source: 'regional_grid' },
            { factor_id: 'CF-all-flat', building_id: 'all', period_type: 'flat', factor: 0.725, effective_date: '2025-01-01', source: 'regional_grid' },
            { factor_id: 'CF-all-valley', building_id: 'all', period_type: 'valley', factor: 0.483, effective_date: '2025-01-01', source: 'regional_grid' }
        ];
        await this.db.bulkAdd('carbon_factors', carbonFactors);

        /* ===== 需量电价 ===== */
        const demandPricing = [
            { demand_pricing_id: 'DP-2025', building_id: 'all', rate_per_kw: 45.00, billing_period: 'month', threshold_kw: 0, effective_date: '2025-01-01' }
        ];
        await this.db.bulkAdd('demand_pricing', demandPricing);

        /* ===== 可迁移负荷 ===== */
        const migratableLoads = [
            { load_id: 'ML-B001-AC', building_id: 'B001', device_type: 'ac', device_id: null, from_period: 'sharp_peak', to_period: 'valley', max_capacity_kwh: 500, shift_efficiency: 0.95, description: 'A栋中央空调可迁移负荷' },
            { load_id: 'ML-B003-DC', building_id: 'B003', device_type: 'electricity', device_id: null, from_period: 'peak', to_period: 'valley', max_capacity_kwh: 800, shift_efficiency: 0.90, description: 'C栋数据中心可迁移负荷' }
        ];
        await this.db.bulkAdd('migratable_loads', migratableLoads);

        /* ===== 基线策略 + 优化策略 ===== */
        const strategies = [
            {
                strategy_id: 'ST-baseline', name: '基线方案（当前状态）', description: '不做任何调整',
                parameters: { load_shift_pct: 0, demand_reduction_pct: 0, device_efficiency_gain: 0, weekend_shutdown_pct: 0 },
                results: null, filter_snapshot: null, data_fingerprint: null, is_baseline: true,
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            },
            {
                strategy_id: 'ST-optimized', name: '综合优化方案', description: '负荷转移30%+需量削减10%+效率提升5%+周末关停40%',
                parameters: { load_shift_pct: 0.3, demand_reduction_pct: 0.1, device_efficiency_gain: 0.05, weekend_shutdown_pct: 0.4 },
                results: null, filter_snapshot: null, data_fingerprint: null, is_baseline: false,
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            }
        ];
        await this.db.bulkAdd('strategies', strategies);
    }

    _toast(msg, type = 'info') {
        const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
        document.getElementById('toast-container').appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 4500);
    }
};
