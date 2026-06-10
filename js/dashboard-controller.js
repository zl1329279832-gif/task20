/* ===== 仪表盘控制器 ===== */
/* 修复: queryId 防串页; 缓存报告数据保证导出一致性; 防抖快速切换; 接受 workerManager 引用 */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.DashboardController = class DashboardController {
    constructor(db, filter, storage, workerManager) {
        this.db = db; this.filter = filter; this.storage = storage;
        this.workerManager = workerManager || null;
        this.data = {};
        this._c = {
            overview: document.getElementById('overview-chart'),
            heatmap: document.getElementById('heatmap-chart'),
            ranking: document.getElementById('ranking-chart'),
            trend: document.getElementById('trend-chart'),
            yoy: document.getElementById('yoy-chart'),
            mom: document.getElementById('mom-chart'),
            anomalies: document.getElementById('anomaly-alerts'),
            recommendations: document.getElementById('recommendations'),
            carbonTrend: document.getElementById('carbon-trend-chart'),
            demandCost: document.getElementById('demand-cost-chart'),
            loadShift: document.getElementById('load-shift-chart'),
            strategyPanel: document.getElementById('strategy-panel')
        };

        /* ---------- 防串页状态 ---------- */
        this._queryId = 0;                      // 每次 refresh() 递增
        this._activeFilterSnapshot = null;       // 当前正在显示的数据对应的筛选快照
        this._cachedReportData = null;           // 缓存: 供导出使用, 保证与看板一致
        this._dataSessionVersion = 0;            // 数据加载时的 sessionVersion
        this._refreshTimer = null;               // 防抖定时器

        this.filter.onChange(() => this._debouncedRefresh());
    }

    /* ---- 防抖: 快速连续切换筛选时, 只在最后一次稳定后刷新 ---- */
    _debouncedRefresh() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refresh(), 150);
    }

    async init() {
        await this.loadData();
        this.refresh();
    }

    async loadData() {
        try {
            const [buildings, floors, rooms, devices, readings, ac, lighting, pricing, carbonFactors, demandPricing, shiftableLoads] = await Promise.all([
                this.db.getAll('buildings'), this.db.getAll('floors'), this.db.getAll('rooms'),
                this.db.getAll('devices'), this.db.getAll('meter_readings'), this.db.getAll('ac_energy'),
                this.db.getAll('lighting_energy'), this.db.getAll('pricing'),
                this.db.getAll('carbon_factors'), this.db.getAll('demand_pricing'), this.db.getAll('shiftable_loads')
            ]);
            this.data = { buildings, floors, rooms, devices, readings, ac, lighting, pricing, carbonFactors, demandPricing, shiftableLoads };
            this.filter.populateBuildings(buildings);
            if (readings.length) {
                const ts = readings.map(r => new Date(r.timestamp).getTime()).filter(t => !isNaN(t));
                if (ts.length) this.filter.setDateRange(new Date(Math.min(...ts)), new Date(Math.max(...ts)));
            }
            /* 记录数据加载时的 session 版本 */
            this._dataSessionVersion = this.workerManager ? this.workerManager.getSessionVersion() : Date.now();
            /* 数据变了, 旧缓存无效 */
            this._cachedReportData = null;
        } catch (err) { console.error('加载数据失败:', err); }
    }

    /* ---- 标记数据已过期(外部导入后调用) ---- */
    invalidateData() {
        this._cachedReportData = null;
        this._activeFilterSnapshot = null;
    }

    refresh() {
        const queryId = ++this._queryId;
        const filter = this.filter.get();

        /* 快照当前筛选条件, 用于后续一致性校验 */
        this._activeFilterSnapshot = JSON.parse(JSON.stringify(filter));

        const { readings, pricing, floors, devices, buildings } = this.data;
        if (!readings || !readings.length) { this._empty(); this._cachedReportData = null; return; }

        /* ===== 全部基于同一 filter 快照计算 ===== */
        const byBuilding = EnergyApp.Calculation.getByBuilding(readings, filter);
        const buildingData = byBuilding.map(b => {
            const info = (buildings||[]).find(bl => bl.building_id === b.building_id);
            return { ...b, building_name: info ? info.building_name : b.building_id };
        });
        EnergyApp.Chart.renderOverview(this._c.overview, buildingData, buildings);

        const heatmap = EnergyApp.Calculation.getFloorHeatmap(readings, floors, devices, filter);
        EnergyApp.Chart.renderHeatmap(this._c.heatmap, heatmap);

        const ranking = EnergyApp.Calculation.getDeviceRanking(readings, devices, filter);
        EnergyApp.Chart.renderRanking(this._c.ranking, ranking);

        const trend = EnergyApp.Calculation.getTimeTrend(readings, pricing, filter);
        EnergyApp.Chart.renderTrend(this._c.trend, trend);

        const yoy = EnergyApp.Calculation.getYoY(readings, filter);
        const monthlyDetail = this._monthlyYoY(readings, filter);
        EnergyApp.Chart.renderYoY(this._c.yoy, yoy, monthlyDetail);

        const mom = EnergyApp.Calculation.getMoM(readings, filter);
        const dailyDetail = this._dailyMoM(readings, filter);
        EnergyApp.Chart.renderMoM(this._c.mom, mom, dailyDetail);

        const anomalies = EnergyApp.Calculation.detectAnomalies(readings, filter);
        EnergyApp.Chart.renderAnomalies(this._c.anomalies, anomalies);

        const recommendations = EnergyApp.Calculation.getRecommendations(readings, pricing, filter);
        EnergyApp.Chart.renderRecommendations(this._c.recommendations, recommendations);

        /* ===== 碳排放 & 需量电费 ===== */
        const { carbonFactors, demandPricing, shiftableLoads } = this.data;
        let carbonData = null, demandData = null, shiftableData = null, strategyResult = null;

        if (carbonFactors && carbonFactors.length) {
            carbonData = EnergyApp.CarbonStrategy.calculateBuildingCarbon(readings, carbonFactors, filter);
            EnergyApp.Chart.renderCarbonTrend(this._c.carbonTrend, carbonData, carbonFactors);
        } else if (this._c.carbonTrend) {
            const cb = this._c.carbonTrend.querySelector('.chart-body');
            if (cb) cb.innerHTML = '<div class="empty-state"><p>暂无碳排数据（请导入碳排因子）</p></div>';
        }

        if (demandPricing && demandPricing.length) {
            demandData = EnergyApp.CarbonStrategy.calculateDemandCost(readings, demandPricing, filter);
            EnergyApp.Chart.renderDemandCost(this._c.demandCost, demandData);
        } else if (this._c.demandCost) {
            const cb = this._c.demandCost.querySelector('.chart-body');
            if (cb) cb.innerHTML = '<div class="empty-state"><p>暂无需量电费数据（请导入需量电价）</p></div>';
        }

        if (shiftableLoads && shiftableLoads.length) {
            shiftableData = EnergyApp.CarbonStrategy.calculateShiftableLoad(readings, shiftableLoads, devices, filter);
        }

        /* ===== 策略叠加 ===== */
        if (this._strategyController && this._strategyController.getActiveStrategy()) {
            strategyResult = this._strategyController.getActiveResult();
            if (strategyResult) {
                /* 负荷转移图 */
                EnergyApp.Chart.renderLoadShift(this._c.loadShift, strategyResult);

                /* 策略对比面板 — 显示当前策略 vs 基线 */
                const compData = {
                    baseline: strategyResult.baseline,
                    strategies: [{
                        name: this._strategyController.getActiveStrategy().name,
                        strategy_id: this._strategyController.getActiveStrategy().strategy_id,
                        delta: strategyResult.delta,
                        simulated: strategyResult.simulated,
                        rank: 1
                    }],
                    fingerprintConsistent: true
                };
                EnergyApp.Chart.renderStrategyComparison(this._c.strategyPanel, compData);
            }
        } else {
            if (this._c.loadShift) {
                const cb = this._c.loadShift.querySelector('.chart-body');
                if (cb) cb.innerHTML = '<div class="empty-state"><p>请激活策略查看负荷转移效果</p></div>';
            }
        }

        /* ===== 缓存完整的计算结果, 供导出报告使用 ===== */
        /* 只有在 queryId 仍然匹配时才缓存(防串页) */
        if (queryId === this._queryId) {
            const overview = EnergyApp.Calculation.getOverview(readings, pricing, filter);
            this._cachedReportData = {
                overview, trend, ranking, heatmap, yoy, mom, anomalies, recommendations,
                carbonData, demandData, strategyResult,
                filter: JSON.parse(JSON.stringify(filter)),
                generatedAt: new Date().toLocaleString('zh-CN'),
                _queryId: queryId,
                _dataSessionVersion: this._dataSessionVersion
            };
        }
    }

    _empty() {
        Object.values(this._c).forEach(c => {
            if (c) { const body = c.querySelector('.chart-body'); if (body) body.innerHTML = '<div class="empty-state"><p>请先导入数据</p></div>'; }
        });
    }

    _monthlyYoY(readings, filter) {
        const now = filter.endDate ? new Date(filter.endDate) : new Date();
        const cy = now.getFullYear();
        const months = [];
        for (let m = 0; m < 12; m++) {
            const cur = EnergyApp.Calculation._sumByMonth(readings, cy, m);
            const prev = EnergyApp.Calculation._sumByMonth(readings, cy - 1, m);
            if (cur > 0 || prev > 0) months.push({ month: `${m+1}月`, current: cur, previous: prev });
        }
        return months;
    }

    _dailyMoM(readings, filter) {
        const now = filter.endDate ? new Date(filter.endDate) : new Date();
        const y = now.getFullYear(), m = now.getMonth();
        const days = new Date(y, m + 1, 0).getDate();
        const daily = [];
        for (let d = 1; d <= days; d++) {
            const s = new Date(y, m, d), e = new Date(y, m, d, 23, 59, 59);
            const energy = readings.filter(r => { const t = new Date(r.timestamp); return t >= s && t <= e; }).reduce((s, r) => s + (Number(r.reading) || 0), 0);
            if (energy > 0) daily.push({ day: d, energy });
        }
        return daily;
    }

    /**
     * 获取报告数据 — 优先返回缓存, 保证与看板显示一致
     * 如果缓存不存在(首次或数据刚变更), 则重新计算
     */
    getReportData() {
        if (this._cachedReportData) {
            /* 校验缓存的 filter 是否与当前 filter 一致 */
            const currentFilter = JSON.stringify(this.filter.get());
            const cachedFilter = JSON.stringify(this._cachedReportData.filter);
            if (currentFilter === cachedFilter) {
                return { ...this._cachedReportData, generatedAt: new Date().toLocaleString('zh-CN') };
            }
        }
        /* 缓存不可用, 实时计算并缓存 */
        this.refresh();
        return this._cachedReportData || this._buildReportData();
    }

    /* 强制从当前数据构建报告(兜底) */
    _buildReportData() {
        const filter = this.filter.get();
        const { readings, pricing, floors, devices, carbonFactors, demandPricing, shiftableLoads } = this.data;
        let carbonData = null, demandData = null;
        if (carbonFactors && carbonFactors.length) carbonData = EnergyApp.CarbonStrategy.calculateBuildingCarbon(readings, carbonFactors, filter);
        if (demandPricing && demandPricing.length) demandData = EnergyApp.CarbonStrategy.calculateDemandCost(readings, demandPricing, filter);
        return {
            overview: EnergyApp.Calculation.getOverview(readings, pricing, filter),
            trend: EnergyApp.Calculation.getTimeTrend(readings, pricing, filter),
            ranking: EnergyApp.Calculation.getDeviceRanking(readings, devices, filter),
            heatmap: EnergyApp.Calculation.getFloorHeatmap(readings, floors, devices, filter),
            yoy: EnergyApp.Calculation.getYoY(readings, filter),
            mom: EnergyApp.Calculation.getMoM(readings, filter),
            anomalies: EnergyApp.Calculation.detectAnomalies(readings, filter),
            recommendations: EnergyApp.Calculation.getRecommendations(readings, pricing, filter),
            carbonData, demandData,
            filter: JSON.parse(JSON.stringify(filter)),
            generatedAt: new Date().toLocaleString('zh-CN')
        };
    }

    /* 设置策略控制器 */
    setStrategyController(sc) {
        this._strategyController = sc;
        sc.onStrategyChange(() => this.refresh());
    }
};
