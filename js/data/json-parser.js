/**
 * JSON Parser for the Building Energy Analysis System.
 * Handles array format, {data:[...]} wrapper, and nested-object flattening.
 */

/**
 * Flatten a nested object into a single-level object using dot-separated keys.
 * Example: { a: { b: 1 } } -> { 'a.b': 1 }
 *
 * @param {Object} obj - The object to flatten.
 * @param {string} [prefix=''] - Current key prefix for recursion.
 * @returns {Object} Flat key-value map.
 */
function flattenObject(obj, prefix = '') {
  const result = {};

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Extract the data array from parsed JSON. Supports:
 * - Direct array: [...]
 * - Wrapper object with data property: { data: [...] }
 * - Wrapper object with records property: { records: [...] }
 * - Wrapper object with items property: { items: [...] }
 * - Single object (wrapped in array)
 *
 * @param {*} parsed - Parsed JSON value.
 * @returns {Object[]} Array of record objects.
 */
function extractRecords(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed !== null && typeof parsed === 'object') {
    // Try common wrapper property names
    for (const prop of ['data', 'records', 'items', 'results', 'rows']) {
      if (Array.isArray(parsed[prop])) {
        return parsed[prop];
      }
    }
    // Single object — wrap in array
    return [parsed];
  }

  return [];
}

/**
 * Collect all unique keys across a set of flattened records.
 *
 * @param {Object[]} records - Array of flat record objects.
 * @returns {string[]} Ordered array of unique keys.
 */
function collectHeaders(records) {
  const keySet = new Set();
  const orderedKeys = [];

  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!keySet.has(key)) {
        keySet.add(key);
        orderedKeys.push(key);
      }
    }
  }

  return orderedKeys;
}

/**
 * Parse JSON text into structured tabular data.
 *
 * @param {string} text - Raw JSON text.
 * @param {string} [entityType] - Optional entity type hint (currently unused, reserved for future schema validation).
 * @returns {{ headers: string[], rows: any[][], rowCount: number }}
 */
export function parseJSON(text, entityType) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }

  const rawRecords = extractRecords(parsed);

  if (rawRecords.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  // Flatten nested objects
  const flatRecords = rawRecords.map(record => {
    if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
      return flattenObject(record);
    }
    // Primitive values — wrap with index key
    return { value: record };
  });

  // Collect all headers from the flattened records
  const headers = collectHeaders(flatRecords);

  // Convert each record into a row array aligned with headers
  const rows = flatRecords.map(record => {
    return headers.map(header => {
      const val = record[header];
      return val !== undefined ? val : null;
    });
  });

  return {
    headers,
    rows,
    rowCount: rows.length
  };
}
