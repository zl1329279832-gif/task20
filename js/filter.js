/* ===== 筛选联动模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Filter = class Filter {
    constructor() {
        this.current = { buildingId: 'all', startDate: '', endDate: '', energyType: 'all', billingType: 'actual', timePeriod: 'month' };
        this.listeners = [];
        this._version = 0;
    }
    get() { return { ...this.current, _version: this._version }; }
    getVersion() { return this._version; }
    set(updates) { Object.assign(this.current, updates); ++this._version; this.listeners.forEach(cb => cb(this.get())); }
    onChange(callback) { this.listeners.push(callback); }

    bindUI() {
        const bind = (id, key) => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => this.set({ [key]: el.value })); };
        bind('filter-building', 'buildingId');
        bind('filter-start-date', 'startDate');
        bind('filter-end-date', 'endDate');
        bind('filter-energy-type', 'energyType');
        bind('filter-billing', 'billingType');
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.set({ timePeriod: btn.dataset.period });
            });
        });
    }

    populateBuildings(buildings) {
        const select = document.getElementById('filter-building');
        if (!select) return;
        select.innerHTML = '<option value="all">全部楼栋</option>';
        (buildings || []).forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.building_id;
            opt.textContent = b.building_name || b.building_id;
            select.appendChild(opt);
        });
    }

    setDateRange(start, end) {
        const s = document.getElementById('filter-start-date');
        const e = document.getElementById('filter-end-date');
        if (s && start) s.value = EnergyApp.utils.formatDate(start);
        if (e && end) e.value = EnergyApp.utils.formatDate(end);
        this.current.startDate = start ? EnergyApp.utils.formatDate(start) : '';
        this.current.endDate = end ? EnergyApp.utils.formatDate(end) : '';
    }

    toJSON() { return { ...this.current }; }

    fromJSON(json) {
        Object.assign(this.current, json);
        ++this._version;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setVal('filter-building', this.current.buildingId);
        setVal('filter-start-date', this.current.startDate);
        setVal('filter-end-date', this.current.endDate);
        setVal('filter-energy-type', this.current.energyType);
        setVal('filter-billing', this.current.billingType);
        document.querySelectorAll('.period-btn').forEach(b => { b.classList.toggle('active', b.dataset.period === this.current.timePeriod); });
        this.listeners.forEach(cb => cb(this.get()));
    }
};
