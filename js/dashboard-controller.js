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
            carbonHeatmap: document.getElementById('carbon-heatmap'),
            carbonRanking: document.getElementById('carbon-ranking'),
            projectedTrend: document.getElementById('projected-trend'),
            strategyComparison: document.getElementById('strategy-comparison')
        };
        this.strategyManager = null;

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
            const [buildings, floors, rooms, devices, readings, ac, lighting, pricing, carbonFactors, demandPricing, migratableLoads] = await Promise.all([
                this.db.getAll('buildings'), this.db.getAll('floors'), this.db.getAll('rooms'),
                this.db.getAll('devices'), this.db.getAll('meter_readings'), this.db.getAll('ac_energy'),
                this.db.getAll('lighting_energy'), this.db.getAll('pricing'),
                this.db.getAll('carbon_factors'), this.db.getAll('demand_pricing'), this.db.getAll('migratable_loads')
            ]);
            this.data = { buildings, floors, rooms, devices, readings, ac, lighting, pricing, carbonFactors, demandPricing, migratableLoads };
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

        const { readings, pricing, floors, devices, buildings, carbonFactors, demandPricing, migratableLoads } = this.data;
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

        /* ===== 碳排放核算 ===== */
        const carbonData = EnergyApp.Calculation.calculateCarbon(readings, carbonFactors, pricing, filter);
        if (this._c.carbonHeatmap) EnergyApp.Chart.renderCarbonHeatmap(this._c.carbonHeatmap, carbonData);
        if (this._c.carbonRanking) EnergyApp.Chart.renderCarbonRanking(this._c.carbonRanking, carbonData);

        /* ===== 需量成本 + 可转移负荷 (更新策略沙盘卡片) ===== */
        const demandCost = EnergyApp.Calculation.calculateDemandCost(readings, demandPricing, pricing, filter);
        const transferable = EnergyApp.Calculation.calculateTransferableLoad(readings, migratableLoads, pricing, filter);
        this._updateStrategySummaryCards(carbonData, demandCost, transferable);

        /* ===== 策略对比 ===== */
        let strategyComparison = null;
        if (this.strategyManager) {
            const compData = this.strategyManager.getComparisonData();
            if (compData.length > 0 && this._c.strategyComparison) {
                EnergyApp.Chart.renderStrategyComparison(this._c.strategyComparison, compData);
                strategyComparison = compData;
            }
            if (compData.length > 0 && this._c.projectedTrend) {
                EnergyApp.Chart.renderProjectedTrend(this._c.projectedTrend, trend, compData[0].results);
            } else if (this._c.projectedTrend) {
                EnergyApp.Chart.renderProjectedTrend(this._c.projectedTrend, trend, null);
            }
        } else if (this._c.projectedTrend) {
            EnergyApp.Chart.renderProjectedTrend(this._c.projectedTrend, trend, null);
        }

        /* ===== 缓存完整的计算结果, 供导出报告使用 ===== */
        /* 只有在 queryId 仍然匹配时才缓存(防串页) */
        if (queryId === this._queryId) {
            const overview = EnergyApp.Calculation.getOverview(readings, pricing, filter);
            this._cachedReportData = {
                overview, trend, ranking, heatmap, yoy, mom, anomalies, recommendations,
                carbonData, demandCost, transferable, strategyComparison,
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

    _updateStrategySummaryCards(carbonData, demandCost, transferable) {
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setVal('total-carbon-value', carbonData ? EnergyApp.utils.formatNumber(carbonData.totalCarbon, 0) : '-');
        setVal('demand-cost-value', demandCost ? EnergyApp.utils.formatNumber(demandCost.totalDemandCost, 0) : '-');
        setVal('transferable-value', transferable ? EnergyApp.utils.formatNumber(transferable.totalTransferable, 0) : '-');
        setVal('carbon-intensity-value', carbonData ? carbonData.intensity.toFixed(3) : '-');
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
        const { readings, pricing, floors, devices } = this.data;
        return {
            overview: EnergyApp.Calculation.getOverview(readings, pricing, filter),
            trend: EnergyApp.Calculation.getTimeTrend(readings, pricing, filter),
            ranking: EnergyApp.Calculation.getDeviceRanking(readings, devices, filter),
            heatmap: EnergyApp.Calculation.getFloorHeatmap(readings, floors, devices, filter),
            yoy: EnergyApp.Calculation.getYoY(readings, filter),
            mom: EnergyApp.Calculation.getMoM(readings, filter),
            anomalies: EnergyApp.Calculation.detectAnomalies(readings, filter),
            recommendations: EnergyApp.Calculation.getRecommendations(readings, pricing, filter),
            filter: JSON.parse(JSON.stringify(filter)),
            generatedAt: new Date().toLocaleString('zh-CN')
        };
    }
};
