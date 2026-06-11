/* ===== 策略管理器模块 ===== */
/* 碳排放核算与削峰填谷策略沙盘的 CRUD、评估、对比、过期检测 */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.StrategyManager = class StrategyManager {
    constructor(db, workerManager, storage) {
        this.db = db;
        this.worker = workerManager;
        this.storage = storage;
        this.strategies = [];
        this.activeComparison = [];
        this.listeners = [];
        this.selectedStrategyId = null;
    }

    onChange(callback) { this.listeners.push(callback); }
    _notify() { this.listeners.forEach(fn => { try { fn(); } catch (e) { console.error('StrategyManager listener error:', e); } }); }

    async loadAll() {
        try {
            this.strategies = await this.db.getAll('strategies');
            this.strategies.sort((a, b) => new Date(b.updated_at || b.createdAt) - new Date(a.updated_at || a.createdAt));
        } catch (e) {
            console.error('加载策略失败:', e);
            this.strategies = [];
        }
        this._notify();
    }

    async create(name, description, params, isBaseline) {
        const strategy = {
            strategy_id: 'ST-' + EnergyApp.utils.generateId(),
            name: name || '未命名策略',
            description: description || '',
            parameters: Object.assign({
                load_shift_pct: 0,
                demand_reduction_pct: 0,
                device_efficiency_gain: 0,
                weekend_shutdown_pct: 0
            }, params || {}),
            results: null,
            filter_snapshot: null,
            data_fingerprint: null,
            is_baseline: !!isBaseline,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await this.db.put('strategies', strategy);
        this.strategies.unshift(strategy);
        this._notify();
        return strategy;
    }

    async update(strategyId, updates) {
        const idx = this.strategies.findIndex(s => s.strategy_id === strategyId);
        if (idx < 0) return null;
        const strategy = Object.assign({}, this.strategies[idx], updates, { updated_at: new Date().toISOString() });
        await this.db.put('strategies', strategy);
        this.strategies[idx] = strategy;
        this._notify();
        return strategy;
    }

    async delete(strategyId) {
        await this.db.delete('strategies', strategyId);
        this.strategies = this.strategies.filter(s => s.strategy_id !== strategyId);
        this.activeComparison = this.activeComparison.filter(id => id !== strategyId);
        if (this.selectedStrategyId === strategyId) this.selectedStrategyId = null;
        this._notify();
    }

    async evaluate(strategyId, data, filter) {
        const strategy = this.strategies.find(s => s.strategy_id === strategyId);
        if (!strategy) throw new Error('策略不存在: ' + strategyId);

        const fingerprint = await this.storage.computeDataFingerprint();
        const payload = {
            meterReadings: data.readings || [],
            carbonFactors: data.carbonFactors || [],
            demandPricing: data.demandPricing || [],
            migratableLoads: data.migratableLoads || [],
            pricing: data.pricing || [],
            filter: filter || {},
            strategyParams: strategy.parameters
        };

        let result;
        try {
            result = await this.worker.execute('evaluateStrategy', payload, { queryScoped: true });
        } catch (e) {
            /* 修复: 版本过期(数据/筛选代次不匹配)时不应回退到主线程,
               否则会用旧数据产生过期结果并写入策略 */
            if (e.message && (e.message.includes('代次过期') || e.message.includes('数据已更新'))) {
                throw e;
            }
            // 仅在 Worker 不可用/超时等非版本问题时回退到主线程
            result = EnergyApp.Calculation.evaluateStrategy(
                payload.meterReadings, payload.carbonFactors, payload.demandPricing,
                payload.migratableLoads, payload.pricing, payload.filter, payload.strategyParams
            );
        }

        const updates = {
            results: result,
            filter_snapshot: JSON.parse(JSON.stringify(filter)),
            data_fingerprint: fingerprint,
            updated_at: new Date().toISOString()
        };

        return await this.update(strategyId, updates);
    }

    async evaluateAll(data, filter) {
        const results = [];
        for (const strategy of this.strategies) {
            try {
                const r = await this.evaluate(strategy.strategy_id, data, filter);
                results.push(r);
            } catch (e) {
                console.warn('策略评估失败:', strategy.name, e);
            }
        }
        return results;
    }

    setComparison(ids) {
        this.activeComparison = ids.filter(id => this.strategies.find(s => s.strategy_id === id && s.results));
        this._notify();
    }

    toggleComparison(strategyId) {
        const idx = this.activeComparison.indexOf(strategyId);
        if (idx >= 0) {
            this.activeComparison.splice(idx, 1);
        } else {
            const s = this.strategies.find(st => st.strategy_id === strategyId);
            if (s && s.results) this.activeComparison.push(strategyId);
        }
        this._notify();
    }

    getComparisonData() {
        return this.activeComparison
            .map(id => this.strategies.find(s => s.strategy_id === id))
            .filter(s => s && s.results);
    }

    checkStaleness(strategy, currentFingerprint) {
        if (!strategy || !strategy.data_fingerprint || !currentFingerprint) return { stale: true, reason: '未评估或缺少指纹' };
        const cmp = this.storage.compareFingerprint(strategy.data_fingerprint, currentFingerprint);
        return { stale: !cmp.match, reason: cmp.reason };
    }

    getStrategy(strategyId) {
        return this.strategies.find(s => s.strategy_id === strategyId) || null;
    }

    getSelected() {
        return this.selectedStrategyId ? this.getStrategy(this.selectedStrategyId) : null;
    }

    select(strategyId) {
        this.selectedStrategyId = strategyId;
        this._notify();
    }
};
