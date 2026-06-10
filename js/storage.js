/* ===== 本地存储模块 ===== */
/* 修复: 方案保存时附带数据指纹(dataFingerprint), 加载时校验指纹一致性 */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Storage = class Storage {
    constructor(db) { this.db = db; }

    /* ---- 生成数据指纹: 各 store 的记录数 + 采样哈希 ---- */
    async computeDataFingerprint() {
        const stores = ['buildings','floors','rooms','devices','meter_readings','ac_energy','lighting_energy','pricing'];
        const fp = {};
        for (const store of stores) {
            try {
                const all = await this.db.getAll(store);
                fp[store] = { count: all.length };
                // 对 meter_readings 取首末条的 meter_id + timestamp 做简易指纹
                if (store === 'meter_readings' && all.length > 0) {
                    const first = all[0];
                    const last = all[all.length - 1];
                    fp[store].sampleHash = `${first.meter_id||''}:${first.timestamp||''}..${last.meter_id||''}:${last.timestamp||''}`;
                }
                // 对 buildings 取 ID 列表
                if (store === 'buildings' && all.length > 0) {
                    fp[store].ids = all.map(b => b.building_id).sort().join(',');
                }
            } catch (_) { fp[store] = { count: 0 }; }
        }
        fp._sessionVersion = Date.now(); // 粗略时间戳作为附加标识
        return fp;
    }

    /* ---- 指纹比对 ---- */
    compareFingerprint(savedFp, currentFp) {
        if (!savedFp || !currentFp) return { match: false, reason: '缺少指纹数据' };
        const stores = ['buildings','floors','rooms','devices','meter_readings','ac_energy','lighting_energy','pricing'];
        for (const store of stores) {
            const s = savedFp[store] || { count: 0 };
            const c = currentFp[store] || { count: 0 };
            if (s.count !== c.count) {
                return { match: false, reason: `${store} 记录数不一致: 保存时 ${s.count}, 当前 ${c.count}` };
            }
        }
        if (savedFp.meter_readings?.sampleHash && currentFp.meter_readings?.sampleHash) {
            if (savedFp.meter_readings.sampleHash !== currentFp.meter_readings.sampleHash) {
                return { match: false, reason: '电表读数数据已变更' };
            }
        }
        if (savedFp.buildings?.ids && currentFp.buildings?.ids) {
            if (savedFp.buildings.ids !== currentFp.buildings.ids) {
                return { match: false, reason: '楼栋列表已变更' };
            }
        }
        return { match: true, reason: '' };
    }

    /* ---- 方案保存(附带数据指纹) ---- */
    async saveScheme(name, filterState, description = '', dataFingerprint = null) {
        const fp = dataFingerprint || await this.computeDataFingerprint();
        const scheme = {
            scheme_id: EnergyApp.utils.generateId(),
            name: name || '未命名方案',
            description,
            filter: filterState,
            dataFingerprint: fp,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        await this.db.put('schemes', scheme);
        return scheme;
    }

    async getAllSchemes() {
        const all = await this.db.getAll('schemes');
        return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    async getScheme(schemeId) { return await this.db.get('schemes', schemeId); }

    async deleteScheme(schemeId) { await this.db.delete('schemes', schemeId); }

    async savePreference(key, value) {
        await this.db.put('preferences', { key, value, updatedAt: new Date().toISOString() });
    }

    async getPreference(key) {
        const pref = await this.db.get('preferences', key);
        return pref ? pref.value : null;
    }
};
