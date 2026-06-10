/**
 * Field Recognizer for the Building Energy Analysis System.
 * Fuzzy-matches CSV/JSON headers to entity field definitions using aliases.
 */

import { FIELD_DEFINITIONS, ENTITY_TYPES } from '../core/constants.js';

/**
 * Normalize a string for comparison: lowercase, trim, remove extra whitespace,
 * strip underscores and hyphens.
 *
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[\s_\-]+/g, '');
}

/**
 * Compute the match score for a single CSV header against a single entity field.
 *
 * Scoring tiers:
 *   1.0  - exact match (case-sensitive)
 *   0.95 - exact alias match (case-sensitive)
 *   0.85 - normalized match (lowercase, no separators) against field name
 *   0.80 - normalized match against an alias
 *   0.60 - partial substring match against field name
 *   0.50 - partial substring match against an alias
 *   0.0  - no match
 *
 * @param {string} header - The CSV/JSON column header.
 * @param {string} fieldName - The canonical entity field name.
 * @param {Object} fieldDef - The field definition (with aliases array).
 * @returns {number} Confidence score between 0 and 1.
 */
function scoreMatch(header, fieldName, fieldDef) {
  const aliases = fieldDef.aliases || [];

  // Tier 1: Exact match on field name
  if (header === fieldName) {
    return 1.0;
  }

  // Tier 2: Exact match on an alias
  for (const alias of aliases) {
    if (header === alias) {
      return 0.95;
    }
  }

  // Tier 3: Normalized match on field name
  const normHeader = normalize(header);
  const normField = normalize(fieldName);

  if (normHeader === normField) {
    return 0.85;
  }

  // Tier 4: Normalized match on an alias
  for (const alias of aliases) {
    if (normHeader === normalize(alias)) {
      return 0.80;
    }
  }

  // Tier 5: Partial substring match on field name
  if (normHeader.length >= 2 && normField.length >= 2) {
    if (normField.includes(normHeader) || normHeader.includes(normField)) {
      return 0.60;
    }
  }

  // Tier 6: Partial substring match on an alias
  for (const alias of aliases) {
    const normAlias = normalize(alias);
    if (normAlias.length >= 2 && normHeader.length >= 2) {
      if (normAlias.includes(normHeader) || normHeader.includes(normAlias)) {
        return 0.50;
      }
    }
  }

  return 0.0;
}

/**
 * Attempt to match headers against a specific entity type's field definitions.
 *
 * @param {string[]} headers - CSV/JSON column headers.
 * @param {string} entityType - Entity type key (e.g. 'buildings').
 * @returns {{ mappings: Object, confidence: number, matchCount: number, requiredMatched: number, requiredTotal: number }}
 */
function matchAgainstType(headers, entityType) {
  const definition = FIELD_DEFINITIONS[entityType];
  if (!definition) {
    return { mappings: {}, confidence: 0, matchCount: 0, requiredMatched: 0, requiredTotal: 0 };
  }

  const fields = definition.fields;
  const fieldNames = Object.keys(fields);
  const mappings = {};
  const scores = [];
  const usedFields = new Set();

  // For each header, find the best matching field
  for (const header of headers) {
    let bestField = null;
    let bestScore = 0;

    for (const fieldName of fieldNames) {
      if (usedFields.has(fieldName)) continue;

      const score = scoreMatch(header, fieldName, fields[fieldName]);
      if (score > bestScore) {
        bestScore = score;
        bestField = fieldName;
      }
    }

    if (bestField && bestScore > 0.3) {
      mappings[header] = bestField;
      usedFields.add(bestField);
      scores.push(bestScore);
    }
  }

  // Calculate how many required fields were matched
  const requiredFields = fieldNames.filter(f => fields[f].required);
  const requiredMatched = requiredFields.filter(f => usedFields.has(f)).length;
  const requiredTotal = requiredFields.length;

  // Aggregate confidence
  const matchCount = scores.length;
  const totalFields = fieldNames.length;

  let confidence = 0;
  if (matchCount > 0) {
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const coverageRatio = matchCount / totalFields;
    const requiredRatio = requiredTotal > 0 ? requiredMatched / requiredTotal : 1;

    // Weight: average match quality (40%), coverage (20%), required field coverage (40%)
    confidence = avgScore * 0.4 + coverageRatio * 0.2 + requiredRatio * 0.4;
  }

  return {
    mappings,
    confidence,
    matchCount,
    requiredMatched,
    requiredTotal
  };
}

/**
 * Recognize fields by matching CSV/JSON headers against entity field definitions.
 *
 * If entityType is provided, matches only against that type.
 * If entityType is null/undefined, tries all entity types and picks the best match.
 *
 * @param {string[]} headers - Array of column header strings.
 * @param {string|null} [entityType=null] - Optional entity type to match against.
 * @returns {{ mappings: { [csvColumn: string]: string }, confidence: number, detectedType: string }}
 */
export function recognizeFields(headers, entityType = null) {
  if (!headers || headers.length === 0) {
    return { mappings: {}, confidence: 0, detectedType: '' };
  }

  if (entityType) {
    const result = matchAgainstType(headers, entityType);
    return {
      mappings: result.mappings,
      confidence: result.confidence,
      detectedType: entityType
    };
  }

  // Try all entity types and pick the best
  let bestResult = null;
  let bestType = '';
  let bestConfidence = 0;

  const allTypes = Object.values(ENTITY_TYPES);

  for (const type of allTypes) {
    const result = matchAgainstType(headers, type);

    if (result.confidence > bestConfidence) {
      bestConfidence = result.confidence;
      bestResult = result;
      bestType = type;
    }
  }

  if (!bestResult) {
    return { mappings: {}, confidence: 0, detectedType: '' };
  }

  return {
    mappings: bestResult.mappings,
    confidence: bestResult.confidence,
    detectedType: bestType
  };
}
