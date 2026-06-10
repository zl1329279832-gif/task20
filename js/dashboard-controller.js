/* ===== 仪表盘控制器 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.DashboardController = class DashboardController {
    constructor(db, filter, storage) {
        this.db = db; this.filter = filter; this.storage = storage;
        this.data = {};
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
        this.filter.onChange(() => this.refresh());
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
        const filter = this.filter.get();
        const { readings, pricing, floors, devices, buildings } = this.data;
        if (!readings || !readings.length) { this._empty(); return; }

        const byBuilding = EnergyApp.Calculation.getByBuilding(readings, filter);
        const buildingData = byBuilding.map(b => { const info = (buildings||[]).find(bl => bl.building_id === b.building_id); return { ...b, building_name: info ? info.building_name : b.building_id }; });
        EnergyApp.Chart.renderOverview(this._c.overview, buildingData, buildings);

        EnergyApp.Chart.renderHeatmap(this._c.heatmap, EnergyApp.Calculation.getFloorHeatmap(readings, floors, devices, filter));
        EnergyApp.Chart.renderRanking(this._c.ranking, EnergyApp.Calculation.getDeviceRanking(readings, devices, filter));
        EnergyApp.Chart.renderTrend(this._c.trend, EnergyApp.Calculation.getTimeTrend(readings, pricing, filter));

        const yoy = EnergyApp.Calculation.getYoY(readings, filter);
        EnergyApp.Chart.renderYoY(this._c.yoy, yoy, this._monthlyYoY(readings, filter));

        const mom = EnergyApp.Calculation.getMoM(readings, filter);
        EnergyApp.Chart.renderMoM(this._c.mom, mom, this._dailyMoM(readings, filter));

        EnergyApp.Chart.renderAnomalies(this._c.anomalies, EnergyApp.Calculation.detectAnomalies(readings, filter));
        EnergyApp.Chart.renderRecommendations(this._c.recommendations, EnergyApp.Calculation.getRecommendations(readings, pricing, filter));
    }

    _empty() {
        Object.values(this._c).forEach(c => { if (c) { const body = c.querySelector('.chart-body'); if (body) body.innerHTML = '<div class="empty-state"><p>请先导入数据</p></div>'; } });
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

    getReportData() {
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
            filter,
            generatedAt: new Date().toLocaleString('zh-CN')
        };
    }
};
