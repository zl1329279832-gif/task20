/* ===== Web Worker 管理器 ===== */
/* 增加: sessionVersion(数据代次) + activeQueryId(筛选代次) 双重防串页 */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.WorkerManager = class WorkerManager {
    constructor(workerPath = './workers/processor.js') {
        this.workerPath = workerPath;
        this.worker = null;
        this.taskId = 0;
        this.callbacks = new Map();      // taskId -> { resolve, reject, sessionVersion, queryId, type }
        this.useWorker = true;

        /* ---------- 数据版本 & 查询版本 ---------- */
        this.sessionVersion = 0;         // 每次导入/清空数据 +1
        this.activeQueryId  = 0;         // 每次发起聚合查询 +1

        this._init();
    }

    _init() {
        try {
            this.worker = new Worker(this.workerPath);
            this.worker.onmessage = (e) => {
                const { taskId, result, error, sessionVersion, queryId } = e.data;
                const cb = this.callbacks.get(taskId);
                if (!cb) return;                           // 已超时或已取消

                /* ---------- 过期回包丢弃 ---------- */
                // 1) 数据代次不匹配: 导入已经发生, 旧 Worker 结果无效
                if (cb.sessionVersion !== this.sessionVersion) {
                    this.callbacks.delete(taskId);
                    cb.reject(new Error(`[WorkerManager] 数据代次过期: 任务session=${cb.sessionVersion}, 当前session=${this.sessionVersion}`));
                    return;
                }
                // 2) 筛选代次不匹配(仅对聚合类任务): 用户已切换筛选, 旧聚合结果无效
                if (cb.queryId > 0 && cb.queryId !== this.activeQueryId) {
                    this.callbacks.delete(taskId);
                    cb.reject(new Error(`[WorkerManager] 筛选代次过期: 任务query=${cb.queryId}, 当前query=${this.activeQueryId}`));
                    return;
                }

                this.callbacks.delete(taskId);
                if (error) cb.reject(new Error(error));
                else cb.resolve(result);
            };
            this.worker.onerror = (e) => {
                console.warn('Worker初始化失败，回退到主线程', e);
                this.useWorker = false;
                this.callbacks.forEach(cb => cb.reject(new Error('Worker不可用')));
                this.callbacks.clear();
            };
        } catch (e) {
            console.warn('无法创建Worker', e);
            this.useWorker = false;
        }
    }

    /* ---- 数据代次推进(导入/清空时调用) ---- */
    bumpSessionVersion() {
        this.sessionVersion++;
        // 取消所有未完成的回调 — 它们基于旧数据
        this.callbacks.forEach((cb, tid) => {
            cb.reject(new Error(`[WorkerManager] 数据已更新, 任务 ${tid} 已取消`));
        });
        this.callbacks.clear();
    }

    /* ---- 筛选代次推进(切换筛选条件时调用) ---- */
    bumpQueryId() {
        this.activeQueryId++;
    }

    /* ---- 获取当前版本号, 供外部做一致性校验 ---- */
    getSessionVersion() { return this.sessionVersion; }
    getQueryId()        { return this.activeQueryId; }

    /**
     * 执行 Worker 任务
     * @param {string} type    - 任务类型: aggregate | detectAnomalies | calculateStats
     * @param {object} payload - 任务参数
     * @param {object} [opts]  - 可选: { queryScoped: true } 标记为筛选敏感任务
     * @returns {Promise}
     */
    execute(type, payload, opts = {}) {
        if (!this.useWorker || !this.worker) return this._mainThread(type, payload);

        return new Promise((resolve, reject) => {
            const taskId = ++this.taskId;
            const sessionVersion = this.sessionVersion;
            const queryId = opts.queryScoped ? this.activeQueryId : 0;

            this.callbacks.set(taskId, { resolve, reject, sessionVersion, queryId, type });
            // 把版本号也发给 Worker, Worker 原样返回, 用于回包校验
            this.worker.postMessage({ type, taskId, payload, sessionVersion, queryId });

            setTimeout(() => {
                if (this.callbacks.has(taskId)) {
                    this.callbacks.delete(taskId);
                    reject(new Error('超时'));
                }
            }, 120000);
        });
    }

    _mainThread(type, payload) {
        // 主线程回退也需要检查版本
        const capturedSession = this.sessionVersion;
        const capturedQuery  = this.activeQueryId;
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (capturedSession !== this.sessionVersion) {
                    reject(new Error('[WorkerManager] 主线程回退: 数据代次过期'));
                    return;
                }
                let result;
                switch (type) {
                    case 'aggregate':
                        result = EnergyApp.Calculation.aggregate(payload);
                        break;
                    case 'detectAnomalies':
                        result = { anomalies: EnergyApp.Calculation.detectAnomalies(payload.meterReadings || [], payload.filter || {}) };
                        break;
                    case 'calculateStats': {
                        const o = EnergyApp.Calculation.getOverview(payload.meterReadings || [], payload.pricing || [], payload.filter || {});
                        result = { totalEnergy: o.totalEnergy, totalCost: o.totalCost };
                        break;
                    }
                    case 'calculateCarbon':
                        result = EnergyApp.CarbonStrategy.calculateBuildingCarbon(
                            payload.meterReadings || [], payload.carbonFactors || [], payload.filter || {});
                        break;
                    case 'calculateDemand':
                        result = EnergyApp.CarbonStrategy.calculateDemandCost(
                            payload.meterReadings || [], payload.demandPricing || [], payload.filter || {});
                        break;
                    case 'simulateStrategy':
                        result = EnergyApp.CarbonStrategy.simulateStrategy(
                            payload.strategy, payload.meterReadings || [], payload.carbonFactors || [],
                            payload.demandPricing || [], payload.shiftableLoads || [], payload.filter || {});
                        break;
                    default: result = {};
                }
                resolve(result);
            }, 0);
        });
    }

    terminate() { if (this.worker) { this.worker.terminate(); this.worker = null; } }
};
