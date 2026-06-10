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
        this.currentView = 'import';
    }

    async init() {
        await this.db.open();
        this.storage = new EnergyApp.Storage(this.db);
        this.workerManager = new EnergyApp.WorkerManager('./workers/processor.js');
        this.importController = new EnergyApp.ImportController(this.db, this.workerManager);
        this.importController.onImportComplete = () => this._onImported();
        this.dashboardController = new EnergyApp.DashboardController(this.db, this.filter, this.storage, this.workerManager);
        this.strategyController = new EnergyApp.StrategyController(this.db, this.filter, this.storage, this.workerManager);
        this.dashboardController.setStrategyController(this.strategyController);

        this._bindNav();
        this._bindActions();
        this.filter.bindUI();

        const readings = await this.db.getAll('meter_readings');
        if (readings.length > 0) {
            this._switchView('dashboard');
            await this.dashboardController.init();
            this.strategyController.setDashboardData(this.dashboardController.data);
            this.strategyController.init();
            await this.strategyController.loadStrategies();
        } else {
            await this._loadSampleData();
            this._toast('已加载演示数据，可点击「分析仪表盘」查看', 'info');
        }
    }

    _bindNav() {
        document.getElementById('btn-import').addEventListener('click', () => this._switchView('import'));
        document.getElementById('btn-dashboard').addEventListener('click', async () => {
            this._switchView('dashboard');
            await this.dashboardController.init();
            this.strategyController.setDashboardData(this.dashboardController.data);
            this.strategyController.init();
            await this.strategyController.loadStrategies();
        });
    }

    _switchView(view) {
        this.currentView = view;
        document.getElementById('import-section').classList.toggle('active', view === 'import');
        document.getElementById('dashboard-section').classList.toggle('active', view === 'dashboard');
        document.getElementById('btn-import').classList.toggle('active', view === 'import');
        document.getElementById('btn-dashboard').classList.toggle('active', view === 'dashboard');
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

    /* ---- 导入完成回调: 推进 sessionVersion, 刷新看板 ---- */
    async _onImported() {
        /* 1. 推进数据代次 — 使所有未完成的 Worker 任务失效 */
        this.workerManager.bumpSessionVersion();

        /* 2. 通知看板缓存失效 */
        this.dashboardController.invalidateData();

        /* 3. 通知策略控制器数据变更 */
        this.strategyController.onDataChanged();

        this._toast('数据导入完成', 'info');
        this._switchView('dashboard');

        /* 4. 重新加载数据并渲染 */
        await this.dashboardController.init();
        this.strategyController.setDashboardData(this.dashboardController.data);
        await this.strategyController.loadStrategies();
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

        /* ---- 碳排因子(24h) ---- */
        const carbonFactors = [];
        const hourlyFactors = [0.42,0.40,0.38,0.37,0.36,0.38,0.45,0.55,0.72,0.82,0.88,0.85,0.78,0.75,0.70,0.68,0.72,0.80,0.90,0.92,0.88,0.78,0.60,0.48];
        for (let h = 0; h < 24; h++) {
            carbonFactors.push({ time_period: h, emission_factor: hourlyFactors[h], region: '华东电网', effective_date: '2025-01-01' });
        }

        /* ---- 需量电价(3级阶梯) ---- */
        const demandPricingData = [
            { demand_tier: 1, price_per_kw: 28, threshold_kw: 500, billing_period: '月', effective_date: '2025-01-01' },
            { demand_tier: 2, price_per_kw: 32, threshold_kw: 1000, billing_period: '月', effective_date: '2025-01-01' },
            { demand_tier: 3, price_per_kw: 38, threshold_kw: 99999, billing_period: '月', effective_date: '2025-01-01' }
        ];

        /* ---- 可迁移负荷 ---- */
        const shiftableLoadData = [
            { device_id: 'M-B001-F1-R1-ac', shiftable_power_kw: 2.5, earliest_start: '22:00', latest_end: '06:00', min_duration_hours: 2, priority: 1 },
            { device_id: 'M-B001-F2-R1-ac', shiftable_power_kw: 2.5, earliest_start: '22:00', latest_end: '06:00', min_duration_hours: 2, priority: 2 },
            { device_id: 'M-B002-F1-R1-ac', shiftable_power_kw: 3.0, earliest_start: '23:00', latest_end: '05:00', min_duration_hours: 1, priority: 1 },
            { device_id: 'M-B003-F1-R1-electricity', shiftable_power_kw: 8.0, earliest_start: '00:00', latest_end: '06:00', min_duration_hours: 3, priority: 1 },
            { device_id: 'M-B003-F2-R1-electricity', shiftable_power_kw: 8.0, earliest_start: '00:00', latest_end: '06:00', min_duration_hours: 3, priority: 2 },
            { device_id: 'M-B004-F1-R1-ac', shiftable_power_kw: 1.5, earliest_start: '21:00', latest_end: '07:00', min_duration_hours: 2, priority: 3 }
        ];

        await Promise.all([
            this.db.bulkAdd('buildings', buildings),
            this.db.bulkAdd('floors', floors),
            this.db.bulkAdd('rooms', rooms),
            this.db.bulkAdd('devices', devices),
            this.db.bulkAdd('pricing', pricing),
            this.db.bulkAdd('carbon_factors', carbonFactors),
            this.db.bulkAdd('demand_pricing', demandPricingData),
            this.db.bulkAdd('shiftable_loads', shiftableLoadData)
        ]);
        const chunk = 5000;
        for (let i = 0; i < readings.length; i += chunk) await this.db.bulkAdd('meter_readings', readings.slice(i, i + chunk));
    }

    _toast(msg, type = 'info') {
        const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
        document.getElementById('toast-container').appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 4500);
    }
};
