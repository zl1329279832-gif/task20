/* ===== 仪表盘控制器 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.DashboardController = class DashboardController {
    constructor(db, filter, storage, workerManager) {
        this.db = db; this.filter = filter; this.storage = storage;
        this.worker = workerManager || null;
        this.data = {};
        this._lastResults = null;
        this._lastFilter = null;
        this._refreshVersion = 0;
        this._c = {
            overview: document.getElementById('overview-chart'),
            heatmap: document.getElementById('heatmap-chart'),
            ranking: document.getElementById('ranking-chart'),
            trend: document.getElementById('trend-chart'),
            yoy: document.getElementById('yoy-chart'),
            mom: document.getElementById('mom-chart'),
            anomalies: document.getElementById('anomaly-alerts'),
            recommendations: document.getElementById('recommendations')
        };
        // Debounce filter changes — 200ms to collapse rapid switches
        this._debouncedRefresh = EnergyApp.utils.debounce(() => this.refresh(), 200);
        this.filter.onChange(() => this._debouncedRefresh());
    }

    async init() { await this.loadData(); this.refresh(); }

    async loadData() {
        try {
            const [buildings, floors, rooms, devices, readings, ac, lighting, pricing] = await Promise.all([
                this.db.getAll('buildings'), this.db.getAll('floors'), this.db.getAll('rooms'),
                this.db.getAll('devices'), this.db.getAll('meter_readings'), this.db.getAll('ac_energy'),
                this.db.getAll('lighting_energy'), this.db.getAll('pricing')
            ]);
            this.data = { buildings, floors, rooms, devices, readings, ac, lighting, pricing };
            this.filter.populateBuildings(buildings);
            if (readings.length) {
                const ts = readings.map(r => new Date(r.timestamp).getTime()).filter(t => !isNaN(t));
                if (ts.length) this.filter.setDateRange(new Date(Math.min(...ts)), new Date(Math.max(...ts)));
            }
        } catch (err) { console.error('加载数据失败:', err); }
    }

    refresh() {
        const filterSnapshot = this.filter.get();
        const filterVersion = filterSnapshot._version;
        // Bump local refresh version — used to detect if a newer refresh supersedes this one
        const thisRefresh = ++this._refreshVersion;

        const { readings, pricing, floors, devices, buildings } = this.data;
        if (!readings || !readings.length) { this._empty(); this._lastResults = null; this._lastFilter = null; return; }

        // Synchronous calculations
        const overview = EnergyApp.Calculation.getOverview(readings, pricing, filterSnapshot);

        const byBuilding = EnergyApp.Calculation.getByBuilding(readings, filterSnapshot);
        const buildingData = byBuilding.map(b => {
            const info = (buildings||[]).find(bl => bl.building_id === b.building_id);
            return { ...b, building_name: info ? info.building_name : b.building_id };
        });

        const heatmap = EnergyApp.Calculation.getFloorHeatmap(readings, floors, devices, filterSnapshot);
        const ranking = EnergyApp.Calculation.getDeviceRanking(readings, devices, filterSnapshot);
        const trend = EnergyApp.Calculation.getTimeTrend(readings, pricing, filterSnapshot);
        const yoy = EnergyApp.Calculation.getYoY(readings, filterSnapshot);
        const mom = EnergyApp.Calculation.getMoM(readings, filterSnapshot);
        const anomalies = EnergyApp.Calculation.detectAnomalies(readings, filterSnapshot);
        const recommendations = EnergyApp.Calculation.getRecommendations(readings, pricing, filterSnapshot);
        const monthlyYoY = this._monthlyYoY(readings, filterSnapshot);
        const dailyMoM = this._dailyMoM(readings, filterSnapshot);

        // Stale guard: if another refresh was triggered while we computed, discard
        if (this._refreshVersion !== thisRefresh) return;

        // Render
        EnergyApp.Chart.renderOverview(this._c.overview, buildingData, buildings);
        EnergyApp.Chart.renderHeatmap(this._c.heatmap, heatmap);
        EnergyApp.Chart.renderRanking(this._c.ranking, ranking);
        EnergyApp.Chart.renderTrend(this._c.trend, trend);
        EnergyApp.Chart.renderYoY(this._c.yoy, yoy, monthlyYoY);
        EnergyApp.Chart.renderMoM(this._c.mom, mom, dailyMoM);
        EnergyApp.Chart.renderAnomalies(this._c.anomalies, anomalies);
        EnergyApp.Chart.renderRecommendations(this._c.recommendations, recommendations);

        // Cache results for export — same data that's displayed
        this._lastFilter = { ...filterSnapshot };
        delete this._lastFilter._version;
        this._lastResults = { overview, trend, ranking, heatmap, yoy, mom, anomalies, recommendations };

        // If worker is available, also dispatch async anomaly detection
        // and update when it returns (with stale-guard)
        if (this.worker) {
            this.worker.cancelPending();
            this.worker.execute('detectAnomalies', {
                meterReadings: readings, filter: filterSnapshot
            }, filterVersion).then(result => {
                // Only apply if this is still the current refresh
                if (this._refreshVersion !== thisRefresh) return;
                if (result && result.anomalies) {
                    EnergyApp.Chart.renderAnomalies(this._c.anomalies, result.anomalies);
                    this._lastResults.anomalies = result.anomalies;
                }
            }).catch(err => {
                if (err.message !== 'cancelled' && err.message !== '超时') {
                    console.warn('Worker异常检测失败:', err);
                }
            });
        }
    }

    _empty() {
        Object.values(this._c).forEach(c => { if (c) { const body = c.querySelector('.chart-body'); if (body) body.innerHTML = '<div class="empty-state"><p>请先导入数据</p></div>'; } });
    }

    _monthlyYoY(readings, filter) {
        const now = filter.endDate ? new Date(filter.endDate) : new Date();
        const cy = now.getFullYear();
        const base = EnergyApp.Calculation._filterReadingsNoDate(readings, filter);
        const months = [];
        for (let m = 0; m < 12; m++) {
            const cur = EnergyApp.Calculation._sumByMonth(base, cy, m);
            const prev = EnergyApp.Calculation._sumByMonth(base, cy - 1, m);
            if (cur > 0 || prev > 0) months.push({ month: `${m+1}月`, current: cur, previous: prev });
        }
        return months;
    }

    _dailyMoM(readings, filter) {
        const now = filter.endDate ? new Date(filter.endDate) : new Date();
        const y = now.getFullYear(), m = now.getMonth();
        const days = new Date(y, m + 1, 0).getDate();
        const base = EnergyApp.Calculation._filterReadingsNoDate(readings, filter);
        const daily = [];
        for (let d = 1; d <= days; d++) {
            const s = new Date(y, m, d), e = new Date(y, m, d, 23, 59, 59);
            const energy = base.filter(r => { const t = new Date(r.timestamp); return t >= s && t <= e; }).reduce((s, r) => s + (Number(r.reading) || 0), 0);
            if (energy > 0) daily.push({ day: d, energy });
        }
        return daily;
    }

    getReportData() {
        // Use cached results from last refresh — guarantees export matches displayed dashboard
        if (this._lastResults && this._lastFilter) {
            return {
                ...this._lastResults,
                filter: this._lastFilter,
                generatedAt: new Date().toLocaleString('zh-CN')
            };
        }
        // Fallback: compute fresh if never rendered (should not happen in normal flow)
        const filter = this.filter.get();
        delete filter._version;
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
            filter,
            generatedAt: new Date().toLocaleString('zh-CN')
        };
    }
};
