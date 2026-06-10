/* ===== Web Worker 管理器 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.WorkerManager = class WorkerManager {
    constructor(workerPath = './workers/processor.js') {
        this.workerPath = workerPath;
        this.worker = null;
        this.taskId = 0;
        this.callbacks = new Map();
        this.useWorker = true;
        this._generation = 0;
        this._init();
    }

    _init() {
        try {
            this.worker = new Worker(this.workerPath);
            this.worker.onmessage = (e) => {
                const { taskId, result, error, filterVersion } = e.data;
                const cb = this.callbacks.get(taskId);
                if (!cb) return; // timed-out or cancelled — silently discard
                this.callbacks.delete(taskId);
                // Stale-result detection: if the response carries a filterVersion
                // older than what was current when the callback was registered, discard
                if (cb.filterVersion !== undefined && filterVersion !== undefined && filterVersion < cb.filterVersion) {
                    return; // stale result — silently discard
                }
                if (error) cb.reject(new Error(error)); else cb.resolve(result);
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

    execute(type, payload, filterVersion) {
        if (!this.useWorker || !this.worker) return this._mainThread(type, payload);
        return new Promise((resolve, reject) => {
            const taskId = ++this.taskId;
            this.callbacks.set(taskId, { resolve, reject, filterVersion });
            this.worker.postMessage({ type, taskId, payload, filterVersion });
            setTimeout(() => {
                if (this.callbacks.has(taskId)) {
                    this.callbacks.delete(taskId);
                    reject(new Error('超时'));
                }
            }, 120000);
        });
    }

    /* Cancel all pending tasks — reject with 'cancelled', bump generation */
    cancelPending() {
        this._generation++;
        this.callbacks.forEach(cb => cb.reject(new Error('cancelled')));
        this.callbacks.clear();
    }

    /* Cancel all tasks except the given taskId */
    cancelAllExcept(keepTaskId) {
        this._generation++;
        for (const [tid, cb] of this.callbacks) {
            if (tid !== keepTaskId) {
                cb.reject(new Error('cancelled'));
                this.callbacks.delete(tid);
            }
        }
    }

    getGeneration() { return this._generation; }

    _mainThread(type, payload) {
        return new Promise((resolve) => {
            setTimeout(() => {
                let result;
                switch (type) {
                    case 'aggregate': result = EnergyApp.Calculation.aggregate(payload); break;
                    case 'detectAnomalies': result = { anomalies: EnergyApp.Calculation.detectAnomalies(payload.meterReadings || [], payload.filter || {}) }; break;
                    case 'calculateStats': {
                        const o = EnergyApp.Calculation.getOverview(payload.meterReadings || [], payload.pricing || [], payload.filter || {});
                        result = { totalEnergy: o.totalEnergy, totalCost: o.totalCost };
                        break;
                    }
                    default: result = {};
                }
                resolve(result);
            }, 0);
        });
    }

    terminate() { if (this.worker) { this.worker.terminate(); this.worker = null; } }
};
