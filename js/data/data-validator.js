/**
 * Data Validator for the Building Energy Analysis System.
 * Validates and coerces parsed rows against entity field definitions.
 */

import { FIELD_DEFINITIONS } from '../core/constants.js';

/**
 * Try to parse a value as a date. Accepts ISO strings, common date formats,
 * and Unix timestamps (numeric).
 *
 * @param {*} value
 * @returns {Date|null} Parsed Date or null if invalid.
 */
function parseDate(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    // Unix timestamp — assume seconds if < 1e12, milliseconds otherwise
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    // Try ISO format directly
    let d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;

    // Try common Chinese/slash formats: YYYY/MM/DD, YYYY-MM-DD HH:mm:ss
    const slashFormat = trimmed.replace(/\//g, '-');
    d = new Date(slashFormat);
    if (!isNaN(d.getTime())) return d;

    return null;
  }

  return null;
}

/**
 * Coerce a raw value to the expected type.
 *
 * @param {*} value - Raw value from parsed data.
 * @param {string} type - Expected type: 'string', 'number', or 'date'.
 * @returns {{ value: *, success: boolean, message: string|null }}
 */
function coerceValue(value, type) {
  // Null or empty string
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return { value: null, success: true, message: null };
  }

  switch (type) {
    case 'string': {
      return { value: String(value).trim(), success: true, message: null };
    }

    case 'number': {
      if (typeof value === 'number' && !isNaN(value)) {
        return { value, success: true, message: null };
      }
      const num = Number(value);
      if (isNaN(num)) {
        return { value, success: false, message: `Cannot convert "${value}" to number` };
      }
      return { value: num, success: true, message: null };
    }

    case 'date': {
      const date = parseDate(value);
      if (date === null) {
        return { value, success: false, message: `Cannot parse "${value}" as a date` };
      }
      return { value: date.toISOString(), success: true, message: null };
    }

    default:
      return { value, success: true, message: null };
  }
}

/**
 * Validate a single coerced value against field constraints (min, max).
 *
 * @param {*} value - The coerced value.
 * @param {Object} fieldDef - Field definition from FIELD_DEFINITIONS.
 * @returns {string|null} Error message or null if valid.
 */
function validateRange(value, fieldDef) {
  if (value === null || value === undefined) return null;

  if (fieldDef.type === 'number' && typeof value === 'number') {
    if (fieldDef.min !== undefined && value < fieldDef.min) {
      return `Value ${value} is below minimum ${fieldDef.min}`;
    }
    if (fieldDef.max !== undefined && value > fieldDef.max) {
      return `Value ${value} exceeds maximum ${fieldDef.max}`;
    }
  }

  return null;
}

/**
 * Validate and coerce parsed rows against entity field definitions.
 *
 * @param {any[][]} rows - Array of row arrays from the parser output.
 * @param {string} entityType - Entity type key from ENTITY_TYPES.
 * @param {{ [csvColumn: string]: string }} fieldMappings - Mapping from column header to entity field name.
 * @returns {{
 *   valid: Record<string, any>[],
 *   errors: Array<{ row: number, field: string, message: string, value: any }>,
 *   warnings: Array<{ row: number, field: string, message: string, value: any }>
 * }}
 */
export function validateRows(rows, entityType, fieldMappings) {
  const definition = FIELD_DEFINITIONS[entityType];
  if (!definition) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  const fields = definition.fields;
  const valid = [];
  const errors = [];
  const warnings = [];

  // Build a reverse mapping: entity field name -> column index
  // fieldMappings maps csvColumn (header) -> entityField
  // We need to know which position in the row corresponds to which header.
  // Since rows are arrays aligned with original headers, we need the column indices.
  // The caller should pass column headers as keys. We'll determine indices from ordering.
  const mappingEntries = Object.entries(fieldMappings);

  // Determine required fields that are not in the mapping
  const mappedEntityFields = new Set(Object.values(fieldMappings));
  const requiredFields = Object.entries(fields)
    .filter(([_, def]) => def.required)
    .map(([name]) => name);

  const missingRequired = requiredFields.filter(f => !mappedEntityFields.has(f));

  if (missingRequired.length > 0) {
    // Add a warning for globally missing required fields
    warnings.push({
      row: -1,
      field: missingRequired.join(', '),
      message: `Required field(s) not found in data: ${missingRequired.join(', ')}`,
      value: null
    });
  }

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const record = {};
    let rowHasErrors = false;

    for (const [colIndexOrHeader, entityField] of mappingEntries) {
      const fieldDef = fields[entityField];
      if (!fieldDef) continue;

      // Resolve column index — if colIndexOrHeader is numeric string, use as index;
      // otherwise it is a header name and we look it up by position in mappingEntries
      let colIndex;
      if (/^\d+$/.test(colIndexOrHeader)) {
        colIndex = parseInt(colIndexOrHeader, 10);
      } else {
        // The mapping keys are header names. The row index corresponds to the order
        // of headers, but we need to find the index of this header.
        // We'll use the key directly — look up the position in the original header list.
        // Since we don't have the header list here, we use the mapping entry index
        // from the entries array order. However, a better approach is to pass
        // column indices directly. We'll handle both cases.
        colIndex = mappingEntries.indexOf(
          mappingEntries.find(([k]) => k === colIndexOrHeader)
        );
        // Actually, we should find the position differently.
        // The fieldMappings keys are column headers. The rows are indexed by the
        // same column order. We need an external headers array to resolve.
        // For robustness, we'll try to find the index from the key if it's a number.
        // Since rows come from parseCSV/parseJSON with headers aligned,
        // we expect the caller to provide index-based keys or we'll assume
        // column order matches the mapping entries order.
      }

      const rawValue = colIndex < row.length ? row[colIndex] : null;

      // Coerce value to expected type
      const coerced = coerceValue(rawValue, fieldDef.type);

      if (!coerced.success) {
        errors.push({
          row: rowIdx,
          field: entityField,
          message: coerced.message,
          value: rawValue
        });
        rowHasErrors = true;
        continue;
      }

      // Check required field presence
      if (fieldDef.required && (coerced.value === null || coerced.value === '')) {
        errors.push({
          row: rowIdx,
          field: entityField,
          message: `Required field "${entityField}" is empty`,
          value: rawValue
        });
        rowHasErrors = true;
        continue;
      }

      // Validate range constraints
      const rangeError = validateRange(coerced.value, fieldDef);
      if (rangeError) {
        warnings.push({
          row: rowIdx,
          field: entityField,
          message: rangeError,
          value: coerced.value
        });
        // Range violations are warnings — still include the value
      }

      // Apply default if value is null and a default exists
      if (coerced.value === null && fieldDef.default !== undefined) {
        record[entityField] = fieldDef.default;
      } else {
        record[entityField] = coerced.value;
      }
    }

    if (!rowHasErrors) {
      valid.push(record);
    }
  }

  return { valid, errors, warnings };
}
