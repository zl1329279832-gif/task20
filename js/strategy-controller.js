/* ===== 策略控制器 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.StrategyController = class StrategyController {
    constructor(db, filter, storage, workerManager) {
        this.db = db;
        this.filter = filter;
        this.storage = storage;
        this.workerManager = workerManager;
        this.activeStrategy = null;
        this.activeResult = null;
        this.strategies = [];
        this._onStrategyChange = null;
    }

    /* ---- 初始化: 绑定UI事件 ---- */
    init() {
        const createBtn = document.getElementById('btn-create-strategy');
        const compareBtn = document.getElementById('btn-compare-strategies');
        const deactBtn = document.getElementById('btn-deactivate-strategy');
        const selector = document.getElementById('strategy-select');

        if (createBtn) createBtn.addEventListener('click', () => this.showCreateModal());
        if (compareBtn) compareBtn.addEventListener('click', () => this.showCompareModal());
        if (deactBtn) deactBtn.addEventListener('click', () => this.deactivateStrategy());
        if (selector) selector.addEventListener('change', (e) => {
            const id = e.target.value;
            if (id) this.activateStrategy(id);
            else this.deactivateStrategy();
        });
    }

    /* ---- 设置策略变化回调 ---- */
    onStrategyChange(cb) { this._onStrategyChange = cb; }

    /* ---- 加载所有策略 ---- */
    async loadStrategies() {
        try {
            this.strategies = await this.db.getAll('strategies');
            this.strategies.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        } catch (_) { this.strategies = []; }
        this._populateSelector();
    }

    _populateSelector() {
        const sel = document.getElementById('strategy-select');
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">基线（无策略）</option>';
        this.strategies.forEach(s => {
            sel.innerHTML += `<option value="${s.strategy_id}">${s.name}</option>`;
        });
        sel.value = currentVal;
    }

    /* ---- 创建策略 ---- */
    async createStrategy(params) {
        const fp = await this.storage.computeDataFingerprint();
        const strategy = {
            strategy_id: EnergyApp.utils.generateId(),
            name: params.name || '未命名策略',
            description: params.description || '',
            target_type: params.target_type || 'both',
            target_value: Number(params.target_value) || 10,
            rules: params.rules || [],
            results_snapshot: null,
            dataFingerprint: fp,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        /* 模拟计算 */
        try {
            const result = await this._simulate(strategy);
            strategy.results_snapshot = {
                baseline: result.baseline,
                simulated: result.simulated,
                delta: result.delta,
                shiftDetails: result.shiftDetails
            };
        } catch (err) {
            console.warn('策略模拟失败:', err);
        }

        await this.db.put('strategies', strategy);
        this.strategies.unshift(strategy);
        this._populateSelector();
        return strategy;
    }

    /* ---- 删除策略 ---- */
    async deleteStrategy(strategyId) {
        await this.db.delete('strategies', strategyId);
        this.strategies = this.strategies.filter(s => s.strategy_id !== strategyId);
        if (this.activeStrategy && this.activeStrategy.strategy_id === strategyId) {
            this.deactivateStrategy();
        }
        this._populateSelector();
    }

    /* ---- 激活策略 ---- */
    async activateStrategy(strategyId) {
        const strategy = this.strategies.find(s => s.strategy_id === strategyId);
        if (!strategy) return;

        /* 指纹校验 */
        const currentFp = await this.storage.computeDataFingerprint();
        const cmp = this.storage.compareFingerprint(strategy.dataFingerprint, currentFp);
        if (!cmp.match) {
            this._toast(`策略 "${strategy.name}" 数据已变更: ${cmp.reason}`, 'warning');
        }

        this.activeStrategy = strategy;

        /* 重新模拟 */
        try {
            this.activeResult = await this._simulate(strategy);
        } catch (err) {
            console.warn('策略模拟失败:', err);
            this.activeResult = strategy.results_snapshot ? { ...strategy.results_snapshot } : null;
        }

        /* 显示策略指示器 */
        const indicator = document.getElementById('strategy-indicator');
        if (indicator) indicator.style.display = 'flex';

        const sel = document.getElementById('strategy-select');
        if (sel) sel.value = strategyId;

        if (this._onStrategyChange) this._onStrategyChange();
    }

    /* ---- 停用策略 ---- */
    deactivateStrategy() {
        this.activeStrategy = null;
        this.activeResult = null;

        const indicator = document.getElementById('strategy-indicator');
        if (indicator) indicator.style.display = 'none';

        const sel = document.getElementById('strategy-select');
        if (sel) sel.value = '';

        if (this._onStrategyChange) this._onStrategyChange();
    }

    /* ---- 获取当前激活策略 ---- */
    getActiveStrategy() { return this.activeStrategy; }
    getActiveResult() { return this.activeResult; }

    /* ---- 多策略对比 ---- */
    async compareStrategies(strategyIds) {
        const selected = this.strategies.filter(s => strategyIds.includes(s.strategy_id));
        if (!selected.length) return null;

        const results = [];
        for (const s of selected) {
            let res;
            try {
                res = await this._simulate(s);
            } catch (_) {
                res = s.results_snapshot || { baseline: {}, simulated: {}, delta: {} };
            }
            results.push({
                ...res,
                name: s.name,
                strategy_id: s.strategy_id,
                dataFingerprint: s.dataFingerprint
            });
        }
        return EnergyApp.CarbonStrategy.compareStrategies(results);
    }

    /* ---- 数据变更通知 ---- */
    onDataChanged() {
        if (this.activeStrategy) {
            this._toast('数据已变更，策略结果可能需要重新计算', 'warning');
        }
    }

    /* ---- 内部: 执行模拟 ---- */
    async _simulate(strategy) {
        const data = this._getDashboardData();
        if (!data || !data.readings || !data.readings.length) {
            throw new Error('无可用数据');
        }

        const filter = this.filter.get();
        const payload = {
            strategy,
            meterReadings: data.readings,
            carbonFactors: data.carbonFactors || [],
            demandPricing: data.demandPricing || [],
            shiftableLoads: data.shiftableLoads || [],
            filter
        };

        if (this.workerManager && this.workerManager.useWorker) {
            return await this.workerManager.execute('simulateStrategy', payload, { queryScoped: true });
        }
        return EnergyApp.CarbonStrategy.simulateStrategy(
            strategy, data.readings, data.carbonFactors || [],
            data.demandPricing || [], data.shiftableLoads || [], filter);
    }

    _getDashboardData() {
        return this._dashboardData || {};
    }

    setDashboardData(data) {
        this._dashboardData = data;
    }

    /* ---- 新建策略模态框 ---- */
    showCreateModal() {
        const modal = document.getElementById('scheme-modal');
        document.getElementById('modal-title').textContent = '新建削峰填谷策略';

        const data = this._getDashboardData();
        const devices = data.devices || [];
        const shiftableLoads = data.shiftableLoads || [];

        let deviceOpts = '<option value="all">全部设备</option>';
        const devSet = new Set();
        shiftableLoads.forEach(sl => devSet.add(sl.device_id));
        devices.forEach(d => devSet.add(d.meter_id || d.device_id));
        devSet.forEach(did => {
            const dev = devices.find(d => d.device_id === did || d.meter_id === did);
            const label = dev ? `${dev.device_name} (${did})` : did;
            deviceOpts += `<option value="${did}">${label}</option>`;
        });

        let hourOpts = '';
        for (let h = 0; h < 24; h++) hourOpts += `<option value="${h}">${h}:00</option>`;

        document.getElementById('modal-body').innerHTML = `
            <div style="max-height:60vh;overflow-y:auto;padding:4px">
                <div style="margin-bottom:12px">
                    <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">策略名称</label>
                    <input type="text" id="strat-name" placeholder="例: 空调夜间迁移" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px">
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">说明</label>
                    <input type="text" id="strat-desc" placeholder="策略描述(可选)" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px">
                </div>
                <div style="margin-bottom:16px;display:flex;gap:12px">
                    <div style="flex:1">
                        <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">优化目标</label>
                        <select id="strat-target-type" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px">
                            <option value="both">碳排+费用</option><option value="carbon">碳排放</option><option value="cost">需量电费</option>
                        </select>
                    </div>
                    <div style="flex:1">
                        <label style="display:block;font-size:13px;color:#374151;margin-bottom:4px">目标降幅 (%)</label>
                        <input type="number" id="strat-target-val" value="15" min="1" max="100" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px">
                    </div>
                </div>
                <h4 style="font-size:14px;margin-bottom:8px;color:#374151">负荷迁移规则</h4>
                <div id="strat-rules">
                    <div class="rule-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 80px 40px;gap:6px;margin-bottom:8px;align-items:end">
                        <div><label style="font-size:11px;color:#6b7280">设备</label><select class="rule-device" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px">${deviceOpts}</select></div>
                        <div><label style="font-size:11px;color:#6b7280">源时段(峰)</label><select class="rule-from" multiple style="width:100%;padding:4px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;height:60px">${hourOpts}</select></div>
                        <div><label style="font-size:11px;color:#6b7280">目标时段(谷)</label><select class="rule-to" multiple style="width:100%;padding:4px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;height:60px">${hourOpts}</select></div>
                        <div><label style="font-size:11px;color:#6b7280">迁移%</label><input type="number" class="rule-pct" value="30" min="1" max="100" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px"></div>
                        <div style="padding-bottom:2px"><button class="rule-del" style="padding:6px 8px;border:1px solid #fca5a5;background:#fef2f2;border-radius:4px;cursor:pointer;color:#dc2626;font-size:12px">&times;</button></div>
                    </div>
                </div>
                <button id="strat-add-rule" style="font-size:12px;color:#2563eb;background:none;border:none;cursor:pointer;margin-bottom:16px">+ 添加规则</button>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
                    <button class="btn-secondary" id="strat-cancel">取消</button>
                    <button class="btn-primary" id="strat-confirm">创建并模拟</button>
                </div>
            </div>`;

        modal.style.display = 'flex';

        /* 添加规则行 */
        document.getElementById('strat-add-rule').onclick = () => {
            const rules = document.getElementById('strat-rules');
            const row = rules.querySelector('.rule-row').cloneNode(true);
            row.querySelector('.rule-pct').value = 30;
            rules.appendChild(row);
            this._bindRuleDelete();
        };
        this._bindRuleDelete();

        document.getElementById('strat-cancel').onclick = () => this._hideModal();
        document.getElementById('strat-confirm').onclick = async () => {
            const name = document.getElementById('strat-name').value.trim();
            if (!name) { this._toast('请输入策略名称', 'warning'); return; }

            const rules = [];
            document.querySelectorAll('#strat-rules .rule-row').forEach((row, i) => {
                const device = row.querySelector('.rule-device').value;
                const fromSel = row.querySelector('.rule-from');
                const toSel = row.querySelector('.rule-to');
                const fromH = Array.from(fromSel.selectedOptions).map(o => Number(o.value));
                const toH = Array.from(toSel.selectedOptions).map(o => Number(o.value));
                const pct = Number(row.querySelector('.rule-pct').value) / 100;
                if (fromH.length && toH.length && pct > 0) {
                    rules.push({ rule_id: 'R' + (i + 1), device_id: device, from_hours: fromH, to_hours: toH, shift_percentage: pct, priority: i + 1 });
                }
            });

            if (!rules.length) { this._toast('请至少配置一条有效规则', 'warning'); return; }

            try {
                this._showLoading('正在模拟策略...');
                const strategy = await this.createStrategy({
                    name,
                    description: document.getElementById('strat-desc').value.trim(),
                    target_type: document.getElementById('strat-target-type').value,
                    target_value: Number(document.getElementById('strat-target-val').value),
                    rules
                });
                this._hideModal();
                this._toast(`策略 "${name}" 已创建`, 'success');
                await this.activateStrategy(strategy.strategy_id);
            } catch (err) {
                this._toast('创建失败: ' + err.message, 'error');
            } finally { this._hideLoading(); }
        };
    }

    _bindRuleDelete() {
        document.querySelectorAll('.rule-del').forEach(btn => {
            btn.onclick = (e) => {
                const rows = document.querySelectorAll('#strat-rules .rule-row');
                if (rows.length > 1) e.target.closest('.rule-row').remove();
            };
        });
    }

    /* ---- 对比模态框 ---- */
    showCompareModal() {
        if (this.strategies.length < 1) { this._toast('请先创建策略', 'warning'); return; }

        const modal = document.getElementById('scheme-modal');
        document.getElementById('modal-title').textContent = '策略对比';

        let html = '<div style="max-height:50vh;overflow-y:auto">';
        this.strategies.forEach(s => {
            html += `<label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6;cursor:pointer">
                <input type="checkbox" class="cmp-check" value="${s.strategy_id}">
                <span style="font-weight:500">${s.name}</span>
                <span style="font-size:12px;color:#9ca3af">${new Date(s.updatedAt).toLocaleString('zh-CN')}</span>
                ${s.results_snapshot?.delta ? `<span style="font-size:12px;color:#10b981">碳减 ${s.results_snapshot.delta.carbonReductionPct?.toFixed(1)||0}%</span>` : ''}
            </label>`;
        });
        html += '</div>';
        html += `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button class="btn-secondary" id="cmp-cancel">取消</button>
            <button class="btn-primary" id="cmp-confirm">开始对比</button>
        </div>`;
        document.getElementById('modal-body').innerHTML = html;
        modal.style.display = 'flex';

        document.getElementById('cmp-cancel').onclick = () => this._hideModal();
        document.getElementById('cmp-confirm').onclick = async () => {
            const ids = Array.from(document.querySelectorAll('.cmp-check:checked')).map(cb => cb.value);
            if (ids.length < 1) { this._toast('请至少选择一个策略', 'warning'); return; }

            try {
                this._showLoading('正在对比策略...');
                const result = await this.compareStrategies(ids);
                this._hideModal();
                const panel = document.getElementById('strategy-comparison-body') || document.querySelector('#strategy-panel .chart-body');
                if (panel && result) EnergyApp.Chart.renderStrategyComparison({ querySelector: () => panel }, result);
            } catch (err) {
                this._toast('对比失败: ' + err.message, 'error');
            } finally { this._hideLoading(); }
        };
    }

    _hideModal() { document.getElementById('scheme-modal').style.display = 'none'; }
    _showLoading(text) { document.getElementById('loading-text').textContent = text || '处理中...'; document.getElementById('loading-overlay').style.display = 'flex'; }
    _hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
    _toast(msg, type = 'info') {
        const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
        document.getElementById('toast-container').appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 4500);
    }
};
