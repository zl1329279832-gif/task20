import dbManager from './db-manager.js';

/**
 * Generic data store operations for any IndexedDB object store.
 */

/**
 * Bulk-insert (put) records into a store using a single transaction.
 * Uses put() so existing records with the same key are overwritten.
 * @param {string} storeName - Name of the object store
 * @param {Array<Object>} records - Array of records to insert
 * @returns {Promise<number>} Number of records successfully written
 */
export async function putBatch(storeName, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeName, 'readwrite');
    } catch (err) {
      reject(new Error(`Failed to create transaction for store "${storeName}": ${err.message}`));
      return;
    }

    const store = transaction.objectStore(storeName);
    let count = 0;

    transaction.oncomplete = () => {
      resolve(count);
    };

    transaction.onerror = () => {
      reject(new Error(
        `Transaction error on putBatch for "${storeName}": ${transaction.error?.message || 'unknown error'}`
      ));
    };

    transaction.onabort = () => {
      reject(new Error(
        `Transaction aborted on putBatch for "${storeName}": ${transaction.error?.message || 'unknown reason'}`
      ));
    };

    for (const record of records) {
      try {
        const request = store.put(record);
        request.onsuccess = () => {
          count++;
        };
      } catch (err) {
        console.error(`Failed to put record in "${storeName}":`, err.message, record);
      }
    }
  });
}

/**
 * Retrieve all records from a store.
 * @param {string} storeName - Name of the object store
 * @returns {Promise<Array<Object>>}
 */
export async function getAll(storeName) {
  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeName, 'readonly');
    } catch (err) {
      reject(new Error(`Failed to create transaction for store "${storeName}": ${err.message}`));
      return;
    }

    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error(
        `getAll error for "${storeName}": ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * Retrieve records matching a specific index key.
 * @param {string} storeName - Name of the object store
 * @param {string} indexName - Name of the index to query
 * @param {*} key - The key value to match
 * @returns {Promise<Array<Object>>}
 */
export async function getByIndex(storeName, indexName, key) {
  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeName, 'readonly');
    } catch (err) {
      reject(new Error(`Failed to create transaction for store "${storeName}": ${err.message}`));
      return;
    }

    let index;
    try {
      const store = transaction.objectStore(storeName);
      index = store.index(indexName);
    } catch (err) {
      reject(new Error(
        `Index "${indexName}" not found on store "${storeName}": ${err.message}`
      ));
      return;
    }

    const request = index.getAll(key);

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error(
        `getByIndex error for "${storeName}.${indexName}" with key "${key}": ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * Retrieve records within a key range on an index.
 * @param {string} storeName - Name of the object store
 * @param {string} indexName - Name of the index to query
 * @param {*} lower - Lower bound of the range (inclusive)
 * @param {*} upper - Upper bound of the range (inclusive)
 * @returns {Promise<Array<Object>>}
 */
export async function getByRange(storeName, indexName, lower, upper) {
  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeName, 'readonly');
    } catch (err) {
      reject(new Error(`Failed to create transaction for store "${storeName}": ${err.message}`));
      return;
    }

    let index;
    try {
      const store = transaction.objectStore(storeName);
      index = store.index(indexName);
    } catch (err) {
      reject(new Error(
        `Index "${indexName}" not found on store "${storeName}": ${err.message}`
      ));
      return;
    }

    let range;
    try {
      range = IDBKeyRange.bound(lower, upper);
    } catch (err) {
      reject(new Error(
        `Invalid key range [${lower}, ${upper}] for "${storeName}.${indexName}": ${err.message}`
      ));
      return;
    }

    const request = index.getAll(range);

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error(
        `getByRange error for "${storeName}.${indexName}" [${lower}, ${upper}]: ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * Clear all records from a store.
 * @param {string} storeName - Name of the object store
 * @returns {Promise<void>}
 */
export async function clear(storeName) {
  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeName, 'readwrite');
    } catch (err) {
      reject(new Error(`Failed to create transaction for store "${storeName}": ${err.message}`));
      return;
    }

    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(
        `clear error for "${storeName}": ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * Count the number of records in a store.
 * @param {string} storeName - Name of the object store
 * @returns {Promise<number>}
 */
export async function count(storeName) {
  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeName, 'readonly');
    } catch (err) {
      reject(new Error(`Failed to create transaction for store "${storeName}": ${err.message}`));
      return;
    }

    const store = transaction.objectStore(storeName);
    const request = store.count();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error(
        `count error for "${storeName}": ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

const dataStore = { putBatch, getAll, getByIndex, getByRange, clear, count };
export default dataStore;
