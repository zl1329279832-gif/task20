/* ===== IndexedDB 数据库模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.DB = class DB {
    constructor(dbName = 'EnergyAnalysisDB', version = 2) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = [
                    { name: 'buildings', keyPath: 'building_id' },
                    { name: 'floors', keyPath: 'floor_id' },
                    { name: 'rooms', keyPath: 'room_id' },
                    { name: 'devices', keyPath: 'device_id' },
                    { name: 'meter_readings', keyPath: 'reading_id', autoIncrement: true },
                    { name: 'ac_energy', keyPath: 'record_id', autoIncrement: true },
                    { name: 'lighting_energy', keyPath: 'record_id', autoIncrement: true },
                    { name: 'pricing', keyPath: 'pricing_id' },
                    { name: 'schemes', keyPath: 'scheme_id' },
                    { name: 'preferences', keyPath: 'key' },
                    { name: 'carbon_factors', keyPath: 'factor_id' },
                    { name: 'demand_pricing', keyPath: 'demand_pricing_id' },
                    { name: 'migratable_loads', keyPath: 'load_id' },
                    { name: 'strategies', keyPath: 'strategy_id' }
                ];
                stores.forEach(s => {
                    if (!db.objectStoreNames.contains(s.name)) {
                        const store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement || false });
                        if (s.name === 'meter_readings') {
                            store.createIndex('meter_id', 'meter_id', { unique: false });
                            store.createIndex('timestamp', 'timestamp', { unique: false });
                        }
                        if (s.name === 'devices') store.createIndex('building_id', 'building_id', { unique: false });
                        if (s.name === 'floors') store.createIndex('building_id', 'building_id', { unique: false });
                        if (s.name === 'rooms') store.createIndex('floor_id', 'floor_id', { unique: false });
                        if (s.name === 'carbon_factors') store.createIndex('building_id', 'building_id', { unique: false });
                        if (s.name === 'migratable_loads') store.createIndex('building_id', 'building_id', { unique: false });
                    }
                });
            };
            request.onsuccess = (event) => { this.db = event.target.result; resolve(this.db); };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async add(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).add(data);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async bulkAdd(storeName, dataArray) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            let count = 0;
            dataArray.forEach(item => {
                const req = store.add(item);
                req.onsuccess = () => count++;
                req.onerror = () => {};
            });
            tx.oncomplete = () => resolve(count);
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(data);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const request = this.db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const request = this.db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            request.onsuccess = (e) => resolve(e.target.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const request = this.db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async clearAllData() {
        await Promise.all(['buildings','floors','rooms','devices','meter_readings','ac_energy','lighting_energy','pricing','carbon_factors','demand_pricing','migratable_loads'].map(s => this.clear(s)));
    }
};
