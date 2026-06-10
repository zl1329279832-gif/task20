/**
 * Import Worker for the Building Energy Analysis System.
 *
 * Self-contained Web Worker file — all parsing, validation, and detection logic
 * is inlined. No ES module imports or importScripts calls.
 *
 * Message protocol:
 *   Receive: { id, action, payload }
 *   Respond: { id, status: 'success'|'error'|'progress', payload }
 */

/* eslint-disable no-restricted-globals */

// =====================================================================
// INLINED CONSTANTS
// =====================================================================

var ENTITY_TYPES = {
  BUILDING: 'buildings',
  FLOOR: 'floors',
  ROOM: 'rooms',
  DEVICE: 'devices',
  METER_READING: 'meter_readings',
  AC_ENERGY: 'ac_energy',
  LIGHTING_ENERGY: 'lighting_energy',
  TOU_PRICING: 'tou_pricing'
};

var ANOMALY_TYPES = {
  READING_REVERSAL:   { key: 'reading_reversal',   label: '读数倒挂',     severity: 'critical' },
  MISSING_TIMESTAMP:  { key: 'missing_timestamp',  label: '缺失时间点',   severity: 'warning' },
  DUPLICATE_METER:    { key: 'duplicate_meter',     label: '重复电表',     severity: 'warning' },
  OWNERSHIP_ERROR:    { key: 'ownership_error',     label: '设备归属错误', severity: 'critical' },
  CROSS_DAY_BILLING:  { key: 'cross_day_billing',   label: '跨日计费',     severity: 'info' },
  FALSE_PEAK:         { key: 'false_peak',          label: '异常高峰误判', severity: 'info' },
  HIGH_CONSUMPTION:   { key: 'high_consumption',    label: '异常高能耗',   severity: 'warning' }
};

var FIELD_DEFINITIONS = {};
FIELD_DEFINITIONS[ENTITY_TYPES.BUILDING] = {
  fields: {
    id:          { type: 'string', required: true,  aliases: ['building_id', '楼栋ID', '楼栋编号', 'bldg_id'] },
    name:        { type: 'string', required: true,  aliases: ['building_name', '楼栋名称', '楼栋名', 'bldg_name'] },
    area:        { type: 'number', required: false, aliases: ['building_area', '面积', '建筑面积'], min: 0 },
    floors_count:{ type: 'number', required: false, aliases: ['floor_count', '楼层数', '层数'], min: 1, max: 200 },
    build_year:  { type: 'number', required: false, aliases: ['year', '建成年份', '建筑年份'], min: 1900, max: 2030 }
  }
};
FIELD_DEFINITIONS[ENTITY_TYPES.FLOOR] = {
  fields: {
    id:          { type: 'string', required: true,  aliases: ['floor_id', '楼层ID', '楼层编号'] },
    building_id: { type: 'string', required: true,  aliases: ['bldg_id', '楼栋ID', '所属楼栋'] },
    floor_number:{ type: 'number', required: true,  aliases: ['floor_no', '楼层号', '层号'], min: -5, max: 200 },
    area:        { type: 'number', required: false, aliases: ['floor_area', '面积', '楼层面积'], min: 0 }
  }
};
FIELD_DEFINITIONS[ENTITY_TYPES.ROOM] = {
  fields: {
    id:          { type: 'string', required: true,  aliases: ['room_id', '房间ID', '房间编号'] },
    floor_id:    { type: 'string', required: true,  aliases: ['楼层ID', '所属楼层'] },
    room_number: { type: 'string', required: false, aliases: ['room_no', '房间号'] },
    area:        { type: 'number', required: false, aliases: ['room_area', '面积', '房间面积'], min: 0 },
    type:        { type: 'string', required: false, aliases: ['room_type', '房间类型', '用途'] }
  }
};
FIELD_DEFINITIONS[ENTITY_TYPES.DEVICE] = {
  fields: {
    id:           { type: 'string', required: true,  aliases: ['device_id', '设备ID', '设备编号'] },
    room_id:      { type: 'string', required: true,  aliases: ['房间ID', '所属房间'] },
    device_type:  { type: 'string', required: true,  aliases: ['type', '设备类型', '类型'] },
    rated_power:  { type: 'number', required: false, aliases: ['power', '额定功率', '功率'], min: 0 },
    install_date: { type: 'date',   required: false, aliases: ['安装日期', '安装时间'] }
  }
};
FIELD_DEFINITIONS[ENTITY_TYPES.METER_READING] = {
  fields: {
    meter_id:  { type: 'string',  required: true,  aliases: ['电表ID', '表号', '表计编号'] },
    device_id: { type: 'string',  required: true,  aliases: ['设备ID', '设备编号'] },
    timestamp: { type: 'date',    required: true,  aliases: ['time', '时间', '记录时间', '读数时间', '日期'] },
    reading:   { type: 'number',  required: true,  aliases: ['value', '读数', '表读数', '电表读数'], min: 0 },
    unit:      { type: 'string',  required: false, aliases: ['单位'], default: 'kWh' }
  }
};
FIELD_DEFINITIONS[ENTITY_TYPES.AC_ENERGY] = {
  fields: {
    device_id:           { type: 'string', required: true,  aliases: ['设备ID', '空调ID'] },
    timestamp:           { type: 'date',   required: true,  aliases: ['time', '时间', '记录时间'] },
    power_consumption:   { type: 'number', required: true,  aliases: ['consumption', '能耗', '用电量', '功耗'], min: 0 },
    temperature_setting: { type: 'number', required: false, aliases: ['temp', '温度设定', '设定温度'], min: 10, max: 35 },
    mode:                { type: 'string', required: false, aliases: ['运行模式', '模式'] }
  }
};
FIELD_DEFINITIONS[ENTITY_TYPES.LIGHTING_ENERGY] = {
  fields: {
    device_id:         { type: 'string', required: true,  aliases: ['设备ID', '照明ID'] },
    timestamp:         { type: 'date',   required: true,  aliases: ['time', '时间', '记录时间'] },
    power_consumption: { type: 'number', required: true,  aliases: ['consumption', '能耗', '用电量', '功耗'], min: 0 },
    duration:          { type: 'number', required: false, aliases: ['运行时长', '时长', '持续时间'], min: 0 },
    brightness:        { type: 'number', required: false, aliases: ['亮度', '亮度级别'], min: 0, max: 100 }
  }
};
FIELD_DEFINITIONS[ENTITY_TYPES.TOU_PRICING] = {
  fields: {
    time_period:   { type: 'string', required: true,  aliases: ['period', '时段', '时间段', '电价类型'] },
    start_time:    { type: 'string', required: true,  aliases: ['start', '开始时间', '起始时间'] },
    end_time:      { type: 'string', required: true,  aliases: ['end', '结束时间', '截止时间'] },
    price_per_kwh: { type: 'number', required: true,  aliases: ['price', '电价', '单价', '每度电价'], min: 0 }
  }
};

// =====================================================================
// INLINED CSV PARSER
// =====================================================================

function _stripBOM(text) {
  if (text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1);
  }
  return text;
}

function _splitLines(text) {
  var lines = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if (!inQuotes && (ch === '\r' || ch === '\n')) {
      if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++;
      }
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function _parseLine(line, delimiter) {
  var fields = [];
  var current = '';
  var inQuotes = false;
  var i = 0;

  while (i < line.length) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(text, options) {
  options = options || {};
  var delimiter = options.delimiter || ',';
  var hasHeader = options.hasHeader !== undefined ? options.hasHeader : true;

  var cleaned = _stripBOM(text);
  var lines = _splitLines(cleaned);
  var nonEmptyLines = lines.filter(function(line) { return line.trim().length > 0; });

  if (nonEmptyLines.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  var parsedLines = nonEmptyLines.map(function(line) { return _parseLine(line, delimiter); });

  var headers, rows;
  if (hasHeader) {
    headers = parsedLines[0];
    rows = parsedLines.slice(1);
  } else {
    var maxCols = parsedLines.reduce(function(max, row) { return Math.max(max, row.length); }, 0);
    headers = [];
    for (var c = 0; c < maxCols; c++) { headers.push('col_' + c); }
    rows = parsedLines;
  }

  var headerCount = headers.length;
  var normalizedRows = rows.map(function(row) {
    if (row.length < headerCount) {
      var padded = row.slice();
      for (var p = row.length; p < headerCount; p++) { padded.push(''); }
      return padded;
    }
    if (row.length > headerCount) {
      return row.slice(0, headerCount);
    }
    return row;
  });

  return { headers: headers, rows: normalizedRows, rowCount: normalizedRows.length };
}

// =====================================================================
// INLINED JSON PARSER
// =====================================================================

function _flattenObject(obj, prefix) {
  prefix = prefix || '';
  var result = {};
  var keys = Object.keys(obj);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var fullKey = prefix ? prefix + '.' + key : key;
    var value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      var nested = _flattenObject(value, fullKey);
      var nk = Object.keys(nested);
      for (var n = 0; n < nk.length; n++) { result[nk[n]] = nested[nk[n]]; }
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function _extractRecords(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') {
    var props = ['data', 'records', 'items', 'results', 'rows'];
    for (var i = 0; i < props.length; i++) {
      if (Array.isArray(parsed[props[i]])) return parsed[props[i]];
    }
    return [parsed];
  }
  return [];
}

function parseJSON(text) {
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Invalid JSON: ' + err.message);
  }

  var rawRecords = _extractRecords(parsed);
  if (rawRecords.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  var flatRecords = rawRecords.map(function(record) {
    if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
      return _flattenObject(record);
    }
    return { value: record };
  });

  var keySet = {};
  var orderedKeys = [];
  for (var r = 0; r < flatRecords.length; r++) {
    var rkeys = Object.keys(flatRecords[r]);
    for (var j = 0; j < rkeys.length; j++) {
      if (!keySet[rkeys[j]]) {
        keySet[rkeys[j]] = true;
        orderedKeys.push(rkeys[j]);
      }
    }
  }

  var rows = flatRecords.map(function(record) {
    return orderedKeys.map(function(header) {
      var val = record[header];
      return val !== undefined ? val : null;
    });
  });

  return { headers: orderedKeys, rows: rows, rowCount: rows.length };
}

// =====================================================================
// INLINED FIELD RECOGNIZER
// =====================================================================

function _normalize(str) {
  return str.toLowerCase().trim().replace(/[\s_\-]+/g, '');
}

function _scoreMatch(header, fieldName, fieldDef) {
  var aliases = fieldDef.aliases || [];

  if (header === fieldName) return 1.0;
  for (var a = 0; a < aliases.length; a++) {
    if (header === aliases[a]) return 0.95;
  }

  var normHeader = _normalize(header);
  var normField = _normalize(fieldName);
  if (normHeader === normField) return 0.85;

  for (var b = 0; b < aliases.length; b++) {
    if (normHeader === _normalize(aliases[b])) return 0.80;
  }

  if (normHeader.length >= 2 && normField.length >= 2) {
    if (normField.indexOf(normHeader) !== -1 || normHeader.indexOf(normField) !== -1) return 0.60;
  }

  for (var c = 0; c < aliases.length; c++) {
    var normAlias = _normalize(aliases[c]);
    if (normAlias.length >= 2 && normHeader.length >= 2) {
      if (normAlias.indexOf(normHeader) !== -1 || normHeader.indexOf(normAlias) !== -1) return 0.50;
    }
  }

  return 0.0;
}

function _matchAgainstType(headers, entityType) {
  var definition = FIELD_DEFINITIONS[entityType];
  if (!definition) {
    return { mappings: {}, confidence: 0, matchCount: 0, requiredMatched: 0, requiredTotal: 0 };
  }

  var fields = definition.fields;
  var fieldNames = Object.keys(fields);
  var mappings = {};
  var scores = [];
  var usedFields = {};

  for (var h = 0; h < headers.length; h++) {
    var header = headers[h];
    var bestField = null;
    var bestScore = 0;

    for (var f = 0; f < fieldNames.length; f++) {
      var fn = fieldNames[f];
      if (usedFields[fn]) continue;
      var score = _scoreMatch(header, fn, fields[fn]);
      if (score > bestScore) {
        bestScore = score;
        bestField = fn;
      }
    }

    if (bestField && bestScore > 0.3) {
      mappings[header] = bestField;
      usedFields[bestField] = true;
      scores.push(bestScore);
    }
  }

  var requiredFields = fieldNames.filter(function(f) { return fields[f].required; });
  var requiredMatched = requiredFields.filter(function(f) { return usedFields[f]; }).length;
  var requiredTotal = requiredFields.length;
  var matchCount = scores.length;
  var totalFields = fieldNames.length;

  var confidence = 0;
  if (matchCount > 0) {
    var avgScore = scores.reduce(function(sum, s) { return sum + s; }, 0) / scores.length;
    var coverageRatio = matchCount / totalFields;
    var requiredRatio = requiredTotal > 0 ? requiredMatched / requiredTotal : 1;
    confidence = avgScore * 0.4 + coverageRatio * 0.2 + requiredRatio * 0.4;
  }

  return { mappings: mappings, confidence: confidence, matchCount: matchCount, requiredMatched: requiredMatched, requiredTotal: requiredTotal };
}

function recognizeFields(headers, entityType) {
  if (!headers || headers.length === 0) {
    return { mappings: {}, confidence: 0, detectedType: '' };
  }

  if (entityType) {
    var result = _matchAgainstType(headers, entityType);
    return { mappings: result.mappings, confidence: result.confidence, detectedType: entityType };
  }

  var bestResult = null;
  var bestType = '';
  var bestConfidence = 0;

  var allTypes = [
    ENTITY_TYPES.BUILDING, ENTITY_TYPES.FLOOR, ENTITY_TYPES.ROOM,
    ENTITY_TYPES.DEVICE, ENTITY_TYPES.METER_READING, ENTITY_TYPES.AC_ENERGY,
    ENTITY_TYPES.LIGHTING_ENERGY, ENTITY_TYPES.TOU_PRICING
  ];

  for (var t = 0; t < allTypes.length; t++) {
    var res = _matchAgainstType(headers, allTypes[t]);
    if (res.confidence > bestConfidence) {
      bestConfidence = res.confidence;
      bestResult = res;
      bestType = allTypes[t];
    }
  }

  if (!bestResult) {
    return { mappings: {}, confidence: 0, detectedType: '' };
  }

  return { mappings: bestResult.mappings, confidence: bestResult.confidence, detectedType: bestType };
}

// =====================================================================
// INLINED DATA VALIDATOR
// =====================================================================

function _parseDate(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    var ms = value < 1e12 ? value * 1000 : value;
    var d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    var trimmed = value.trim();
    if (trimmed === '') return null;
    var d1 = new Date(trimmed);
    if (!isNaN(d1.getTime())) return d1;
    var slashFormat = trimmed.replace(/\//g, '-');
    d1 = new Date(slashFormat);
    if (!isNaN(d1.getTime())) return d1;
    return null;
  }
  return null;
}

function _coerceValue(value, type) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return { value: null, success: true, message: null };
  }
  switch (type) {
    case 'string':
      return { value: String(value).trim(), success: true, message: null };
    case 'number':
      if (typeof value === 'number' && !isNaN(value)) return { value: value, success: true, message: null };
      var num = Number(value);
      if (isNaN(num)) return { value: value, success: false, message: 'Cannot convert "' + value + '" to number' };
      return { value: num, success: true, message: null };
    case 'date':
      var date = _parseDate(value);
      if (date === null) return { value: value, success: false, message: 'Cannot parse "' + value + '" as a date' };
      return { value: date.toISOString(), success: true, message: null };
    default:
      return { value: value, success: true, message: null };
  }
}

function _validateRange(value, fieldDef) {
  if (value === null || value === undefined) return null;
  if (fieldDef.type === 'number' && typeof value === 'number') {
    if (fieldDef.min !== undefined && value < fieldDef.min) return 'Value ' + value + ' is below minimum ' + fieldDef.min;
    if (fieldDef.max !== undefined && value > fieldDef.max) return 'Value ' + value + ' exceeds maximum ' + fieldDef.max;
  }
  return null;
}

function validateRows(rows, entityType, fieldMappings) {
  var definition = FIELD_DEFINITIONS[entityType];
  if (!definition) {
    throw new Error('Unknown entity type: ' + entityType);
  }

  var fields = definition.fields;
  var valid = [];
  var errors = [];
  var warnings = [];

  var mappingEntries = [];
  var mappingKeys = Object.keys(fieldMappings);
  for (var m = 0; m < mappingKeys.length; m++) {
    mappingEntries.push([mappingKeys[m], fieldMappings[mappingKeys[m]]]);
  }

  var mappedEntityFields = {};
  for (var v = 0; v < mappingEntries.length; v++) {
    mappedEntityFields[mappingEntries[v][1]] = true;
  }

  var fieldNames = Object.keys(fields);
  var requiredFields = fieldNames.filter(function(f) { return fields[f].required; });
  var missingRequired = requiredFields.filter(function(f) { return !mappedEntityFields[f]; });

  if (missingRequired.length > 0) {
    warnings.push({
      row: -1,
      field: missingRequired.join(', '),
      message: 'Required field(s) not found in data: ' + missingRequired.join(', '),
      value: null
    });
  }

  for (var rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    var row = rows[rowIdx];
    var record = {};
    var rowHasErrors = false;

    for (var e = 0; e < mappingEntries.length; e++) {
      var colIndexOrHeader = mappingEntries[e][0];
      var entityField = mappingEntries[e][1];
      var fieldDef = fields[entityField];
      if (!fieldDef) continue;

      var colIndex;
      if (/^\d+$/.test(colIndexOrHeader)) {
        colIndex = parseInt(colIndexOrHeader, 10);
      } else {
        colIndex = e;
      }

      var rawValue = colIndex < row.length ? row[colIndex] : null;
      var coerced = _coerceValue(rawValue, fieldDef.type);

      if (!coerced.success) {
        errors.push({ row: rowIdx, field: entityField, message: coerced.message, value: rawValue });
        rowHasErrors = true;
        continue;
      }

      if (fieldDef.required && (coerced.value === null || coerced.value === '')) {
        errors.push({ row: rowIdx, field: entityField, message: 'Required field "' + entityField + '" is empty', value: rawValue });
        rowHasErrors = true;
        continue;
      }

      var rangeError = _validateRange(coerced.value, fieldDef);
      if (rangeError) {
        warnings.push({ row: rowIdx, field: entityField, message: rangeError, value: coerced.value });
      }

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

  return { valid: valid, errors: errors, warnings: warnings };
}

// =====================================================================
// INLINED ANOMALY DETECTOR
// =====================================================================

function _createAnomaly(type, severity, entityId, message, details, timestamp) {
  return {
    type: type,
    severity: severity,
    entityId: entityId,
    message: message,
    details: details || {},
    timestamp: timestamp || new Date().toISOString()
  };
}

function detectReadingReversal(readings) {
  if (!readings || readings.length < 2) return [];
  var anomalies = [];
  var sorted = readings.slice().sort(function(a, b) {
    var deviceCmp = String(a.device_id || '').localeCompare(String(b.device_id || ''));
    if (deviceCmp !== 0) return deviceCmp;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  for (var i = 1; i < sorted.length; i++) {
    var prev = sorted[i - 1];
    var curr = sorted[i];
    if (String(curr.device_id) !== String(prev.device_id)) continue;
    var prevReading = Number(prev.reading);
    var currReading = Number(curr.reading);
    if (!isNaN(prevReading) && !isNaN(currReading) && currReading < prevReading) {
      anomalies.push(_createAnomaly(
        ANOMALY_TYPES.READING_REVERSAL.key, ANOMALY_TYPES.READING_REVERSAL.severity,
        String(curr.device_id),
        'Reading decreased from ' + prevReading + ' to ' + currReading + ' for device ' + curr.device_id,
        { previousReading: prevReading, currentReading: currReading, previousTimestamp: prev.timestamp, currentTimestamp: curr.timestamp },
        curr.timestamp
      ));
    }
  }
  return anomalies;
}

function detectMissingTimestamps(readings, expectedInterval) {
  if (!readings || readings.length < 3) return [];
  var anomalies = [];

  var byDevice = {};
  for (var r = 0; r < readings.length; r++) {
    var key = String(readings[r].device_id || 'unknown');
    if (!byDevice[key]) byDevice[key] = [];
    byDevice[key].push(readings[r]);
  }

  var deviceIds = Object.keys(byDevice);
  for (var d = 0; d < deviceIds.length; d++) {
    var deviceId = deviceIds[d];
    var deviceReadings = byDevice[deviceId].slice().sort(function(a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
    if (deviceReadings.length < 3) continue;

    var intervals = [];
    for (var i = 1; i < deviceReadings.length; i++) {
      var diff = new Date(deviceReadings[i].timestamp) - new Date(deviceReadings[i - 1].timestamp);
      if (diff > 0) intervals.push(diff);
    }
    if (intervals.length === 0) continue;

    var threshold;
    if (expectedInterval && expectedInterval > 0) {
      threshold = expectedInterval * 2;
    } else {
      var sortedIntervals = intervals.slice().sort(function(a, b) { return a - b; });
      var median = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
      threshold = median * 2;
    }

    for (var j = 1; j < deviceReadings.length; j++) {
      var gap = new Date(deviceReadings[j].timestamp) - new Date(deviceReadings[j - 1].timestamp);
      if (gap > threshold) {
        var gapMinutes = Math.round(gap / 60000);
        anomalies.push(_createAnomaly(
          ANOMALY_TYPES.MISSING_TIMESTAMP.key, ANOMALY_TYPES.MISSING_TIMESTAMP.severity,
          deviceId,
          'Missing data gap of ' + gapMinutes + ' minutes for device ' + deviceId,
          { gapMs: gap, gapMinutes: gapMinutes, from: deviceReadings[j - 1].timestamp, to: deviceReadings[j].timestamp, threshold: threshold },
          deviceReadings[j - 1].timestamp
        ));
      }
    }
  }
  return anomalies;
}

function detectDuplicateMeters(readings) {
  if (!readings || readings.length < 2) return [];
  var anomalies = [];
  var seen = {};

  for (var i = 0; i < readings.length; i++) {
    var r = readings[i];
    var key = r.device_id + '|' + r.timestamp;
    if (seen[key]) {
      anomalies.push(_createAnomaly(
        ANOMALY_TYPES.DUPLICATE_METER.key, ANOMALY_TYPES.DUPLICATE_METER.severity,
        String(r.device_id),
        'Duplicate reading for device ' + r.device_id + ' at ' + r.timestamp,
        { timestamp: r.timestamp, existingReading: seen[key].reading, duplicateReading: r.reading },
        r.timestamp
      ));
    } else {
      seen[key] = r;
    }
  }
  return anomalies;
}

function detectOwnershipErrors(devices, rooms, floors, buildings) {
  var anomalies = [];
  var buildingIds = {};
  (buildings || []).forEach(function(b) { buildingIds[String(b.id)] = true; });

  var floorMap = {};
  (floors || []).forEach(function(f) { floorMap[String(f.id)] = f; });

  var roomMap = {};
  (rooms || []).forEach(function(r) { roomMap[String(r.id)] = r; });

  (rooms || []).forEach(function(room) {
    if (room.floor_id && !floorMap[String(room.floor_id)]) {
      anomalies.push(_createAnomaly(ANOMALY_TYPES.OWNERSHIP_ERROR.key, ANOMALY_TYPES.OWNERSHIP_ERROR.severity,
        String(room.id), 'Room ' + room.id + ' references non-existent floor ' + room.floor_id,
        { roomId: room.id, floorId: room.floor_id }));
    }
  });

  (floors || []).forEach(function(floor) {
    if (floor.building_id && !buildingIds[String(floor.building_id)]) {
      anomalies.push(_createAnomaly(ANOMALY_TYPES.OWNERSHIP_ERROR.key, ANOMALY_TYPES.OWNERSHIP_ERROR.severity,
        String(floor.id), 'Floor ' + floor.id + ' references non-existent building ' + floor.building_id,
        { floorId: floor.id, buildingId: floor.building_id }));
    }
  });

  (devices || []).forEach(function(device) {
    if (device.room_id && !roomMap[String(device.room_id)]) {
      anomalies.push(_createAnomaly(ANOMALY_TYPES.OWNERSHIP_ERROR.key, ANOMALY_TYPES.OWNERSHIP_ERROR.severity,
        String(device.id), 'Device ' + device.id + ' references non-existent room ' + device.room_id,
        { deviceId: device.id, roomId: device.room_id }));
    }
  });

  return anomalies;
}

function detectCrossDayBilling(readings) {
  if (!readings || readings.length < 2) return [];
  var anomalies = [];

  var byDevice = {};
  for (var i = 0; i < readings.length; i++) {
    var key = String(readings[i].device_id || 'unknown');
    if (!byDevice[key]) byDevice[key] = [];
    byDevice[key].push(readings[i]);
  }

  var deviceIds = Object.keys(byDevice);
  for (var d = 0; d < deviceIds.length; d++) {
    var deviceId = deviceIds[d];
    var sorted = byDevice[deviceId].slice().sort(function(a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });

    for (var j = 1; j < sorted.length; j++) {
      var prevDate = new Date(sorted[j - 1].timestamp);
      var currDate = new Date(sorted[j].timestamp);
      var prevDay = prevDate.toISOString().slice(0, 10);
      var currDay = currDate.toISOString().slice(0, 10);

      if (prevDay !== currDay) {
        var intervalMs = currDate - prevDate;
        var intervalHours = intervalMs / 3600000;
        if (intervalHours < 24 && intervalHours > 0) {
          anomalies.push(_createAnomaly(
            ANOMALY_TYPES.CROSS_DAY_BILLING.key, ANOMALY_TYPES.CROSS_DAY_BILLING.severity,
            deviceId, 'Reading interval for device ' + deviceId + ' spans midnight (' + prevDay + ' to ' + currDay + ')',
            { fromTimestamp: sorted[j - 1].timestamp, toTimestamp: sorted[j].timestamp, intervalHours: Math.round(intervalHours * 100) / 100 },
            sorted[j - 1].timestamp
          ));
        }
      }
    }
  }
  return anomalies;
}

function detectFalsePeakAnomalies(readings) {
  if (!readings || readings.length < 5) return [];
  var anomalies = [];

  var byDevice = {};
  for (var i = 0; i < readings.length; i++) {
    var key = String(readings[i].device_id || 'unknown');
    if (!byDevice[key]) byDevice[key] = [];
    byDevice[key].push(readings[i]);
  }

  var deviceIds = Object.keys(byDevice);
  for (var d = 0; d < deviceIds.length; d++) {
    var deviceId = deviceIds[d];
    var deviceReadings = byDevice[deviceId];

    var values = [];
    for (var v = 0; v < deviceReadings.length; v++) {
      var val = Number(deviceReadings[v].power_consumption != null ? deviceReadings[v].power_consumption : (deviceReadings[v].reading || 0));
      if (!isNaN(val) && val >= 0) values.push(val);
    }
    if (values.length < 5) continue;

    var mean = values.reduce(function(s, x) { return s + x; }, 0) / values.length;
    var variance = values.reduce(function(s, x) { return s + Math.pow(x - mean, 2); }, 0) / values.length;
    var stddev = Math.sqrt(variance);
    var threshold = mean + 2 * stddev;

    for (var r = 0; r < deviceReadings.length; r++) {
      var value = Number(deviceReadings[r].power_consumption != null ? deviceReadings[r].power_consumption : (deviceReadings[r].reading || 0));
      if (isNaN(value)) continue;

      if (value > mean * 1.5 && value <= threshold) {
        anomalies.push(_createAnomaly(
          ANOMALY_TYPES.FALSE_PEAK.key, ANOMALY_TYPES.FALSE_PEAK.severity,
          deviceId, 'Value ' + value.toFixed(2) + ' for device ' + deviceId + ' appears high but is within normal range',
          { value: value, mean: Math.round(mean * 100) / 100, stddev: Math.round(stddev * 100) / 100, threshold: Math.round(threshold * 100) / 100 },
          deviceReadings[r].timestamp
        ));
      } else if (value > threshold) {
        anomalies.push(_createAnomaly(
          ANOMALY_TYPES.HIGH_CONSUMPTION.key, ANOMALY_TYPES.HIGH_CONSUMPTION.severity,
          deviceId, 'Abnormally high value ' + value.toFixed(2) + ' for device ' + deviceId + ' exceeds threshold ' + threshold.toFixed(2),
          { value: value, mean: Math.round(mean * 100) / 100, stddev: Math.round(stddev * 100) / 100, threshold: Math.round(threshold * 100) / 100 },
          deviceReadings[r].timestamp
        ));
      }
    }
  }
  return anomalies;
}

function detectAnomalies(data, entityType, existingData) {
  existingData = existingData || {};
  var anomalies = [];
  var records = Array.isArray(data) ? data : [];
  var readingTypes = ['meter_readings', 'ac_energy', 'lighting_energy'];

  if (readingTypes.indexOf(entityType) !== -1) {
    anomalies = anomalies.concat(detectReadingReversal(records));
    anomalies = anomalies.concat(detectMissingTimestamps(records));
    anomalies = anomalies.concat(detectDuplicateMeters(records));
    anomalies = anomalies.concat(detectCrossDayBilling(records));
    anomalies = anomalies.concat(detectFalsePeakAnomalies(records));
  }

  if (entityType === 'devices') {
    anomalies = anomalies.concat(detectOwnershipErrors(records, existingData.rooms || [], existingData.floors || [], existingData.buildings || []));
  }
  if (entityType === 'rooms') {
    anomalies = anomalies.concat(detectOwnershipErrors([], records, existingData.floors || [], existingData.buildings || []));
  }
  if (entityType === 'floors') {
    anomalies = anomalies.concat(detectOwnershipErrors([], [], records, existingData.buildings || []));
  }

  var byType = {};
  var bySeverity = {};
  for (var i = 0; i < anomalies.length; i++) {
    byType[anomalies[i].type] = (byType[anomalies[i].type] || 0) + 1;
    bySeverity[anomalies[i].severity] = (bySeverity[anomalies[i].severity] || 0) + 1;
  }

  return { anomalies: anomalies, summary: { byType: byType, bySeverity: bySeverity } };
}

// =====================================================================
// WORKER MESSAGE HANDLER
// =====================================================================

/**
 * Post a progress update back to the main thread.
 * @param {string} id - Message ID for correlation.
 * @param {string} phase - Current phase name.
 * @param {number} percent - Progress percentage (0-100).
 */
function postProgress(id, phase, percent) {
  self.postMessage({ id: id, status: 'progress', payload: { phase: phase, percent: percent } });
}

/**
 * Post a success result back to the main thread.
 * @param {string} id - Message ID for correlation.
 * @param {*} payload - Result data.
 */
function postSuccess(id, payload) {
  self.postMessage({ id: id, status: 'success', payload: payload });
}

/**
 * Post an error back to the main thread.
 * @param {string} id - Message ID for correlation.
 * @param {string} message - Error message.
 */
function postError(id, message) {
  self.postMessage({ id: id, status: 'error', payload: { message: message } });
}

self.onmessage = function(event) {
  var msg = event.data;
  var id = msg.id;
  var action = msg.action;
  var payload = msg.payload || {};

  try {
    switch (action) {

      case 'parse-csv': {
        postProgress(id, 'Parsing CSV', 0);
        var csvResult = parseCSV(payload.text, payload.options);
        postProgress(id, 'Parsing CSV', 100);
        postSuccess(id, csvResult);
        break;
      }

      case 'parse-json': {
        postProgress(id, 'Parsing JSON', 0);
        var jsonResult = parseJSON(payload.text, payload.entityType);
        postProgress(id, 'Parsing JSON', 100);
        postSuccess(id, jsonResult);
        break;
      }

      case 'recognize-fields': {
        postProgress(id, 'Recognizing fields', 0);
        var fieldResult = recognizeFields(payload.headers, payload.entityType || null);
        postProgress(id, 'Recognizing fields', 100);
        postSuccess(id, fieldResult);
        break;
      }

      case 'validate': {
        postProgress(id, 'Validating data', 0);
        var validateResult = validateRows(payload.rows, payload.entityType, payload.fieldMappings);
        postProgress(id, 'Validating data', 100);
        postSuccess(id, validateResult);
        break;
      }

      case 'detect-anomalies': {
        postProgress(id, 'Detecting anomalies', 0);
        var anomalyResult = detectAnomalies(payload.data, payload.entityType, payload.existingData);
        postProgress(id, 'Detecting anomalies', 100);
        postSuccess(id, anomalyResult);
        break;
      }

      case 'full-import': {
        var text = payload.text;
        var entityType = payload.entityType || null;
        var fileType = payload.fileType || 'csv';
        var existingData = payload.existingData || {};

        // Phase 1: Parse
        postProgress(id, 'Parsing file', 10);
        var parsed;
        if (fileType === 'json') {
          parsed = parseJSON(text, entityType);
        } else {
          parsed = parseCSV(text, payload.options);
        }
        postProgress(id, 'Parsing file', 25);

        if (parsed.rows.length === 0) {
          postSuccess(id, {
            entityType: entityType || '',
            totalRows: 0,
            validRows: 0,
            errors: [],
            warnings: [],
            anomalies: { anomalies: [], summary: { byType: {}, bySeverity: {} } },
            records: [],
            fieldMappings: {}
          });
          break;
        }

        // Phase 2: Recognize fields
        postProgress(id, 'Recognizing fields', 35);
        var recognition = recognizeFields(parsed.headers, entityType);
        var detectedType = recognition.detectedType || entityType;
        postProgress(id, 'Recognizing fields', 50);

        if (!detectedType) {
          postError(id, 'Could not determine entity type from the data');
          break;
        }

        // Phase 3: Validate
        postProgress(id, 'Validating data', 55);

        // Build column-index-based mappings for the validator
        var indexMappings = {};
        var headerKeys = Object.keys(recognition.mappings);
        for (var h = 0; h < headerKeys.length; h++) {
          var headerName = headerKeys[h];
          var headerIndex = parsed.headers.indexOf(headerName);
          if (headerIndex !== -1) {
            indexMappings[String(headerIndex)] = recognition.mappings[headerName];
          }
        }

        var validation = validateRows(parsed.rows, detectedType, indexMappings);
        postProgress(id, 'Validating data', 75);

        // Phase 4: Detect anomalies
        postProgress(id, 'Detecting anomalies', 80);
        var anomalyResults = detectAnomalies(validation.valid, detectedType, existingData);
        postProgress(id, 'Detecting anomalies', 95);

        // Complete
        postProgress(id, 'Complete', 100);
        postSuccess(id, {
          entityType: detectedType,
          totalRows: parsed.rowCount,
          validRows: validation.valid.length,
          errors: validation.errors,
          warnings: validation.warnings,
          anomalies: anomalyResults,
          records: validation.valid,
          fieldMappings: recognition.mappings,
          confidence: recognition.confidence
        });
        break;
      }

      default:
        postError(id, 'Unknown action: ' + action);
    }

  } catch (err) {
    postError(id, err.message || String(err));
  }
};
