/* ===== 本地存储模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Storage = class Storage {
    constructor(db) { this.db = db; }

    async saveScheme(name, filterState, description = '') {
        const scheme = { scheme_id: EnergyApp.utils.generateId(), name: name || '未命名方案', description, filter: filterState, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
