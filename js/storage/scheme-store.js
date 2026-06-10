import dbManager from './db-manager.js';

/**
 * Scheme storage — save, load, list, delete, and update analysis schemes.
 * Each scheme captures a named snapshot of the application state.
 */

const STORE_NAME = 'schemes';

/**
 * Generate a UUID v4 identifier.
 * Uses crypto.randomUUID() when available, with a fallback implementation.
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Save a new scheme with a generated UUID and timestamp.
 * @param {string} name - Human-readable name for the scheme
 * @param {Object} stateSnapshot - The application state to persist
 * @returns {Promise<string>} The generated scheme ID
 */
export async function saveScheme(name, stateSnapshot) {
  if (!name || typeof name !== 'string') {
    throw new Error('Scheme name is required and must be a non-empty string.');
  }
  if (!stateSnapshot || typeof stateSnapshot !== 'object') {
    throw new Error('State snapshot is required and must be an object.');
  }

  const db = await dbManager.open();
  const id = generateId();
  const record = {
    id,
    name,
    stateSnapshot,
    created_at: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, 'readwrite');
    } catch (err) {
      reject(new Error(`Failed to create transaction for saving scheme: ${err.message}`));
      return;
    }

    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => {
      resolve(id);
    };

    request.onerror = () => {
      reject(new Error(
        `Failed to save scheme "${name}": ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * Load a single scheme by its ID.
 * @param {string} id - The scheme UUID
 * @returns {Promise<Object>} The scheme record
 */
export async function loadScheme(id) {
  if (!id) {
    throw new Error('Scheme ID is required.');
  }

  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, 'readonly');
    } catch (err) {
      reject(new Error(`Failed to create transaction for loading scheme: ${err.message}`));
      return;
    }

    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (!request.result) {
        reject(new Error(`Scheme with ID "${id}" not found.`));
        return;
      }
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error(
        `Failed to load scheme "${id}": ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * List all saved schemes, sorted by created_at descending (newest first).
 * @returns {Promise<Array<Object>>}
 */
export async function listSchemes() {
  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, 'readonly');
    } catch (err) {
      reject(new Error(`Failed to create transaction for listing schemes: ${err.message}`));
      return;
    }

    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const schemes = request.result || [];
      schemes.sort((a, b) => {
        const dateA = a.created_at || '';
        const dateB = b.created_at || '';
        return dateB.localeCompare(dateA);
      });
      resolve(schemes);
    };

    request.onerror = () => {
      reject(new Error(
        `Failed to list schemes: ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * Delete a scheme by its ID.
 * @param {string} id - The scheme UUID to delete
 * @returns {Promise<void>}
 */
export async function deleteScheme(id) {
  if (!id) {
    throw new Error('Scheme ID is required.');
  }

  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, 'readwrite');
    } catch (err) {
      reject(new Error(`Failed to create transaction for deleting scheme: ${err.message}`));
      return;
    }

    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(
        `Failed to delete scheme "${id}": ${request.error?.message || 'unknown error'}`
      ));
    };
  });
}

/**
 * Update an existing scheme by merging partial data into the stored record.
 * @param {string} id - The scheme UUID to update
 * @param {Object} partial - Fields to merge into the existing record
 * @returns {Promise<void>}
 */
export async function updateScheme(id, partial) {
  if (!id) {
    throw new Error('Scheme ID is required.');
  }
  if (!partial || typeof partial !== 'object') {
    throw new Error('Partial update data is required and must be an object.');
  }

  const db = await dbManager.open();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE_NAME, 'readwrite');
    } catch (err) {
      reject(new Error(`Failed to create transaction for updating scheme: ${err.message}`));
      return;
    }

    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      if (!existing) {
        reject(new Error(`Scheme with ID "${id}" not found. Cannot update.`));
        return;
      }

      const updated = { ...existing, ...partial, id };
      const putRequest = store.put(updated);

      putRequest.onsuccess = () => {
        resolve();
      };

      putRequest.onerror = () => {
        reject(new Error(
          `Failed to update scheme "${id}": ${putRequest.error?.message || 'unknown error'}`
        ));
      };
    };

    getRequest.onerror = () => {
      reject(new Error(
        `Failed to read scheme "${id}" for update: ${getRequest.error?.message || 'unknown error'}`
      ));
    };
  });
}

const schemeStore = { saveScheme, loadScheme, listSchemes, deleteScheme, updateScheme };
export default schemeStore;
