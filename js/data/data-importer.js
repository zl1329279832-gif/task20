/**
 * Data Importer for the Building Energy Analysis System.
 * Orchestrates file reading, Web Worker processing, and data storage.
 */

import { eventBus } from '../core/event-bus.js';

/**
 * Generate a unique message ID for worker communication.
 * @returns {string}
 */
function generateId() {
  return 'import_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

/**
 * Determine file type from a File object's name or MIME type.
 * @param {File} file
 * @returns {'csv'|'json'}
 */
function detectFileType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return 'json';
  if (file.type === 'application/json') return 'json';
  return 'csv';
}

/**
 * Read a File object as text using FileReader.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file, 'UTF-8');
  });
}

/**
 * DataImporter class.
 *
 * Manages the full import pipeline: reading files, delegating parsing/validation
 * to a Web Worker, storing results to IndexedDB, and emitting progress events.
 */
export class DataImporter {
  /**
   * @param {Object} dataStore - Data store instance with putBatch(entityType, records) method.
   * @param {string} [workerPath='js/workers/import-worker.js'] - Path to the worker script.
   */
  constructor(dataStore, workerPath) {
    this._dataStore = dataStore;
    this._workerPath = workerPath || 'js/workers/import-worker.js';
  }

  /**
   * Create a worker and send a message, resolving with the success payload.
   * Emits progress events via the event bus.
   *
   * @param {string} action - Worker action name.
   * @param {Object} payload - Action payload.
   * @returns {Promise<Object>} Resolved worker payload.
   * @private
   */
  _runWorker(action, payload) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(this._workerPath);
      } catch (err) {
        reject(new Error(`Failed to create import worker: ${err.message}`));
        return;
      }

      const id = generateId();

      worker.onmessage = (event) => {
        const msg = event.data;
        if (msg.id !== id) return;

        if (msg.status === 'progress') {
          eventBus.emit('import:progress', {
            id,
            phase: msg.payload.phase,
            percent: msg.payload.percent
          });
        } else if (msg.status === 'success') {
          worker.terminate();
          resolve(msg.payload);
        } else if (msg.status === 'error') {
          worker.terminate();
          reject(new Error(msg.payload.message || 'Worker error'));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error(`Worker runtime error: ${err.message || 'Unknown error'}`));
      };

      worker.postMessage({ id, action, payload });
    });
  }

  /**
   * Import a single file through the full pipeline.
   *
   * Steps:
   *   1. Read the file as text
   *   2. Send to worker for parsing, field recognition, validation, and anomaly detection
   *   3. Store valid records to IndexedDB
   *   4. Emit completion event
   *
   * @param {File} file - The file to import.
   * @param {string|null} [entityType=null] - Optional entity type hint. Auto-detected if null.
   * @returns {Promise<{
   *   entityType: string,
   *   totalRows: number,
   *   validRows: number,
   *   errors: Object[],
   *   warnings: Object[],
   *   anomalies: Object
   * }>}
   */
  async importFile(file, entityType = null) {
    // Step 1: Read file
    eventBus.emit('import:progress', { phase: 'Reading file', percent: 0 });

    let text;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      eventBus.emit('import:error', { message: err.message, file: file.name });
      throw err;
    }

    const fileType = detectFileType(file);

    // Step 2: Run the full import pipeline in the worker
    let result;
    try {
      result = await this._runWorker('full-import', {
        text,
        entityType,
        fileType,
        options: {}
      });
    } catch (err) {
      eventBus.emit('import:error', { message: err.message, file: file.name });
      throw err;
    }

    // Step 3: Store valid records to IndexedDB
    if (result.records && result.records.length > 0 && this._dataStore) {
      try {
        await this._dataStore.putBatch(result.entityType, result.records);
      } catch (err) {
        // Storage failure is not fatal — we still return results
        console.error('Failed to store imported records:', err);
        result.warnings = result.warnings || [];
        result.warnings.push({
          row: -1,
          field: '',
          message: `Data storage failed: ${err.message}. Records were validated but not persisted.`,
          value: null
        });
      }
    }

    // Step 4: Build result
    const importResult = {
      entityType: result.entityType,
      totalRows: result.totalRows,
      validRows: result.validRows,
      records: result.records || [],
      validRecords: result.records || [],
      mappings: result.fieldMappings || {},
      confidence: result.confidence || 0,
      errors: result.errors || [],
      warnings: result.warnings || [],
      anomalies: result.anomalies || { anomalies: [], summary: { byType: {}, bySeverity: {} } }
    };

    return importResult;
  }

  /**
   * Import multiple files sequentially.
   *
   * @param {FileList|File[]} fileList - List of files to import.
   * @param {string|null} [entityType=null] - Optional entity type hint applied to all files.
   * @returns {Promise<Array<{
   *   entityType: string,
   *   totalRows: number,
   *   validRows: number,
   *   errors: Object[],
   *   warnings: Object[],
   *   anomalies: Object,
   *   fileName: string
   * }>>}
   */
  async importMultiple(fileList, entityType = null) {
    const files = Array.from(fileList);
    const results = [];

    for (let i = 0; i < files.length; i++) {
      eventBus.emit('import:progress', {
        phase: `Importing file ${i + 1} of ${files.length}: ${files[i].name}`,
        percent: Math.round((i / files.length) * 100),
        fileIndex: i,
        fileCount: files.length
      });

      try {
        const result = await this.importFile(files[i], entityType);
        results.push({ ...result, fileName: files[i].name });
      } catch (err) {
        results.push({
          entityType: entityType || 'unknown',
          totalRows: 0,
          validRows: 0,
          errors: [{ row: -1, field: '', message: err.message, value: null }],
          warnings: [],
          anomalies: { anomalies: [], summary: { byType: {}, bySeverity: {} } },
          fileName: files[i].name
        });
      }
    }

    eventBus.emit('import:complete', {
      fileCount: files.length,
      results
    });

    return results;
  }
}
