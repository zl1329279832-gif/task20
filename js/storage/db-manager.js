import { DB_CONFIG } from '../core/constants.js';

/**
 * IndexedDB Database Manager
 * Singleton pattern — caches the DB connection once opened.
 */

let dbInstance = null;

/**
 * Opens (or returns the cached) IndexedDB database.
 * On version upgrade, creates all object stores and indexes defined in DB_CONFIG.
 * @returns {Promise<IDBDatabase>}
 */
function open() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
    } catch (err) {
      reject(new Error(`Failed to open IndexedDB "${DB_CONFIG.name}": ${err.message}`));
      return;
    }

    request.onerror = () => {
      reject(new Error(
        `IndexedDB open error for "${DB_CONFIG.name}": ${request.error?.message || 'unknown error'}`
      ));
    };

    request.onblocked = () => {
      reject(new Error(
        `IndexedDB open blocked for "${DB_CONFIG.name}". Close other tabs using this database.`
      ));
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      for (const [storeName, storeConfig] of Object.entries(DB_CONFIG.stores)) {
        // Skip if the store already exists (e.g. partial prior upgrade)
        if (db.objectStoreNames.contains(storeName)) {
          continue;
        }

        const storeOptions = {};
        if (storeConfig.keyPath) {
          storeOptions.keyPath = storeConfig.keyPath;
        }
        if (storeConfig.autoIncrement) {
          storeOptions.autoIncrement = true;
        }

        const objectStore = db.createObjectStore(storeName, storeOptions);

        if (Array.isArray(storeConfig.indexes)) {
          for (const indexDef of storeConfig.indexes) {
            try {
              const isCompound = Array.isArray(indexDef.keyPath);
              objectStore.createIndex(indexDef.name, indexDef.keyPath, {
                unique: indexDef.unique || false,
                multiEntry: isCompound ? false : (indexDef.multiEntry || false)
              });
            } catch (indexErr) {
              console.error(
                `Failed to create index "${indexDef.name}" on store "${storeName}":`,
                indexErr.message
              );
            }
          }
        }
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;

      // Clear the cached instance if the connection is unexpectedly closed
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };
  });
}

/**
 * Deletes the entire database and clears the cached connection.
 * @returns {Promise<void>}
 */
function deleteDatabase() {
  return new Promise((resolve, reject) => {
    // Close the current connection if open
    if (dbInstance) {
      try {
        dbInstance.close();
      } catch (_) {
        // Ignore close errors
      }
      dbInstance = null;
    }

    let request;
    try {
      request = indexedDB.deleteDatabase(DB_CONFIG.name);
    } catch (err) {
      reject(new Error(`Failed to delete IndexedDB "${DB_CONFIG.name}": ${err.message}`));
      return;
    }

    request.onerror = () => {
      reject(new Error(
        `IndexedDB delete error for "${DB_CONFIG.name}": ${request.error?.message || 'unknown error'}`
      ));
    };

    request.onblocked = () => {
      reject(new Error(
        `IndexedDB delete blocked for "${DB_CONFIG.name}". Close other tabs using this database.`
      ));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

const dbManager = { open, deleteDatabase };
export default dbManager;
