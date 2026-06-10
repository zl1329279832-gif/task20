/**
 * Anomaly Detector for the Building Energy Analysis System.
 * Detects various data quality issues and anomalous patterns in energy data.
 */

import { ANOMALY_TYPES } from '../core/constants.js';

/**
 * Create a standardized anomaly record.
 *
 * @param {string} type - Anomaly type key from ANOMALY_TYPES.
 * @param {string} severity - Severity level: 'critical', 'warning', or 'info'.
 * @param {string} entityId - ID of the affected entity.
 * @param {string} message - Human-readable description.
 * @param {Object} [details={}] - Additional context data.
 * @param {string} [timestamp=null] - ISO timestamp of the anomaly occurrence.
 * @returns {Object} Anomaly record.
 */
function createAnomaly(type, severity, entityId, message, details = {}, timestamp = null) {
  return {
    type,
    severity,
    entityId,
    message,
    details,
    timestamp: timestamp || new Date().toISOString()
  };
}

/**
 * Detect reading reversals: cases where a meter reading decreases over time
 * for the same device. Readings are sorted by (device_id, timestamp) and
 * any reading[n] < reading[n-1] is flagged.
 *
 * @param {Object[]} readings - Array of reading records with device_id, timestamp, reading fields.
 * @returns {Object[]} Array of anomaly records.
 */
export function detectReadingReversal(readings) {
  if (!readings || readings.length < 2) return [];

  const anomalies = [];

  // Sort by device_id then timestamp
  const sorted = [...readings].sort((a, b) => {
    const deviceCmp = String(a.device_id || '').localeCompare(String(b.device_id || ''));
    if (deviceCmp !== 0) return deviceCmp;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    // Only compare readings for the same device
    if (String(curr.device_id) !== String(prev.device_id)) continue;

    const prevReading = Number(prev.reading);
    const currReading = Number(curr.reading);

    if (!isNaN(prevReading) && !isNaN(currReading) && currReading < prevReading) {
      anomalies.push(createAnomaly(
        ANOMALY_TYPES.READING_REVERSAL.key,
        ANOMALY_TYPES.READING_REVERSAL.severity,
        String(curr.device_id),
        `Reading decreased from ${prevReading} to ${currReading} for device ${curr.device_id}`,
        {
          previousReading: prevReading,
          currentReading: currReading,
          previousTimestamp: prev.timestamp,
          currentTimestamp: curr.timestamp
        },
        curr.timestamp
      ));
    }
  }

  return anomalies;
}

/**
 * Detect missing timestamps: find gaps in a time series that are larger than
 * 2x the median interval between consecutive readings.
 *
 * @param {Object[]} readings - Array of reading records with device_id and timestamp fields.
 * @param {number} [expectedInterval=null] - Expected interval in milliseconds. If null, computed from median.
 * @returns {Object[]} Array of anomaly records.
 */
export function detectMissingTimestamps(readings, expectedInterval = null) {
  if (!readings || readings.length < 3) return [];

  const anomalies = [];

  // Group by device_id
  const byDevice = new Map();
  for (const r of readings) {
    const key = String(r.device_id || 'unknown');
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key).push(r);
  }

  for (const [deviceId, deviceReadings] of byDevice) {
    // Sort by timestamp
    const sorted = [...deviceReadings].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    if (sorted.length < 3) continue;

    // Compute intervals
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const diff = new Date(sorted[i].timestamp) - new Date(sorted[i - 1].timestamp);
      if (diff > 0) intervals.push(diff);
    }

    if (intervals.length === 0) continue;

    // Determine threshold: 2x the median interval or 2x the expected interval
    let threshold;
    if (expectedInterval && expectedInterval > 0) {
      threshold = expectedInterval * 2;
    } else {
      const sortedIntervals = [...intervals].sort((a, b) => a - b);
      const median = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
      threshold = median * 2;
    }

    // Find gaps exceeding the threshold
    for (let i = 1; i < sorted.length; i++) {
      const gap = new Date(sorted[i].timestamp) - new Date(sorted[i - 1].timestamp);
      if (gap > threshold) {
        const gapMinutes = Math.round(gap / 60000);
        anomalies.push(createAnomaly(
          ANOMALY_TYPES.MISSING_TIMESTAMP.key,
          ANOMALY_TYPES.MISSING_TIMESTAMP.severity,
          deviceId,
          `Missing data gap of ${gapMinutes} minutes for device ${deviceId}`,
          {
            gapMs: gap,
            gapMinutes,
            from: sorted[i - 1].timestamp,
            to: sorted[i].timestamp,
            threshold
          },
          sorted[i - 1].timestamp
        ));
      }
    }
  }

  return anomalies;
}

/**
 * Detect duplicate meter readings: find records with the same device_id and timestamp.
 *
 * @param {Object[]} readings - Array of reading records.
 * @returns {Object[]} Array of anomaly records.
 */
export function detectDuplicateMeters(readings) {
  if (!readings || readings.length < 2) return [];

  const anomalies = [];
  const seen = new Map();

  for (const r of readings) {
    const key = `${r.device_id}|${r.timestamp}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      anomalies.push(createAnomaly(
        ANOMALY_TYPES.DUPLICATE_METER.key,
        ANOMALY_TYPES.DUPLICATE_METER.severity,
        String(r.device_id),
        `Duplicate reading for device ${r.device_id} at ${r.timestamp}`,
        {
          timestamp: r.timestamp,
          existingReading: existing.reading,
          duplicateReading: r.reading
        },
        r.timestamp
      ));
    } else {
      seen.set(key, r);
    }
  }

  return anomalies;
}

/**
 * Detect ownership errors: validate the room -> floor -> building hierarchy.
 * Each device should belong to a room, which belongs to a floor, which belongs to a building.
 *
 * @param {Object[]} devices - Array of device records with room_id.
 * @param {Object[]} rooms - Array of room records with id and floor_id.
 * @param {Object[]} floors - Array of floor records with id and building_id.
 * @param {Object[]} buildings - Array of building records with id.
 * @returns {Object[]} Array of anomaly records.
 */
export function detectOwnershipErrors(devices, rooms, floors, buildings) {
  const anomalies = [];

  const buildingIds = new Set((buildings || []).map(b => String(b.id)));
  const floorMap = new Map();
  for (const f of (floors || [])) {
    floorMap.set(String(f.id), f);
  }
  const roomMap = new Map();
  for (const r of (rooms || [])) {
    roomMap.set(String(r.id), r);
  }

  // Check rooms reference valid floors
  for (const room of (rooms || [])) {
    if (room.floor_id && !floorMap.has(String(room.floor_id))) {
      anomalies.push(createAnomaly(
        ANOMALY_TYPES.OWNERSHIP_ERROR.key,
        ANOMALY_TYPES.OWNERSHIP_ERROR.severity,
        String(room.id),
        `Room ${room.id} references non-existent floor ${room.floor_id}`,
        { roomId: room.id, floorId: room.floor_id }
      ));
    }
  }

  // Check floors reference valid buildings
  for (const floor of (floors || [])) {
    if (floor.building_id && !buildingIds.has(String(floor.building_id))) {
      anomalies.push(createAnomaly(
        ANOMALY_TYPES.OWNERSHIP_ERROR.key,
        ANOMALY_TYPES.OWNERSHIP_ERROR.severity,
        String(floor.id),
        `Floor ${floor.id} references non-existent building ${floor.building_id}`,
        { floorId: floor.id, buildingId: floor.building_id }
      ));
    }
  }

  // Check devices reference valid rooms
  for (const device of (devices || [])) {
    if (device.room_id && !roomMap.has(String(device.room_id))) {
      anomalies.push(createAnomaly(
        ANOMALY_TYPES.OWNERSHIP_ERROR.key,
        ANOMALY_TYPES.OWNERSHIP_ERROR.severity,
        String(device.id),
        `Device ${device.id} references non-existent room ${device.room_id}`,
        { deviceId: device.id, roomId: device.room_id }
      ));
    }
  }

  // Validate complete chain: device -> room -> floor -> building
  for (const device of (devices || [])) {
    const room = roomMap.get(String(device.room_id));
    if (!room) continue;

    const floor = floorMap.get(String(room.floor_id));
    if (!floor) continue;

    if (floor.building_id && !buildingIds.has(String(floor.building_id))) {
      anomalies.push(createAnomaly(
        ANOMALY_TYPES.OWNERSHIP_ERROR.key,
        ANOMALY_TYPES.OWNERSHIP_ERROR.severity,
        String(device.id),
        `Device ${device.id} has broken ownership chain: room ${room.id} -> floor ${floor.id} -> missing building ${floor.building_id}`,
        {
          deviceId: device.id,
          roomId: room.id,
          floorId: floor.id,
          buildingId: floor.building_id
        }
      ));
    }
  }

  return anomalies;
}

/**
 * Detect cross-day billing: find readings that span across midnight,
 * which may cause billing calculation issues with time-of-use pricing.
 *
 * @param {Object[]} readings - Array of reading records with device_id and timestamp.
 * @returns {Object[]} Array of anomaly records.
 */
export function detectCrossDayBilling(readings) {
  if (!readings || readings.length < 2) return [];

  const anomalies = [];

  // Group by device_id
  const byDevice = new Map();
  for (const r of readings) {
    const key = String(r.device_id || 'unknown');
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key).push(r);
  }

  for (const [deviceId, deviceReadings] of byDevice) {
    const sorted = [...deviceReadings].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    for (let i = 1; i < sorted.length; i++) {
      const prevDate = new Date(sorted[i - 1].timestamp);
      const currDate = new Date(sorted[i].timestamp);

      // Check if the two consecutive readings span midnight
      const prevDay = prevDate.toISOString().slice(0, 10);
      const currDay = currDate.toISOString().slice(0, 10);

      if (prevDay !== currDay) {
        // Check if this is an actual measurement interval spanning midnight
        // (not just next-day data). Look for intervals within a reasonable range.
        const intervalMs = currDate - prevDate;
        const intervalHours = intervalMs / 3600000;

        // Flag if the interval is less than 24 hours (i.e., a genuine span across midnight)
        if (intervalHours < 24 && intervalHours > 0) {
          anomalies.push(createAnomaly(
            ANOMALY_TYPES.CROSS_DAY_BILLING.key,
            ANOMALY_TYPES.CROSS_DAY_BILLING.severity,
            deviceId,
            `Reading interval for device ${deviceId} spans midnight (${prevDay} to ${currDay})`,
            {
              fromTimestamp: sorted[i - 1].timestamp,
              toTimestamp: sorted[i].timestamp,
              intervalHours: Math.round(intervalHours * 100) / 100
            },
            sorted[i - 1].timestamp
          ));
        }
      }
    }
  }

  return anomalies;
}

/**
 * Detect false peak anomalies: identify readings that appear abnormally high
 * but are actually within a statistically acceptable range (mean + 2*stddev).
 * Values beyond that threshold are flagged as genuine high consumption.
 *
 * @param {Object[]} readings - Array of reading records with device_id and a numeric consumption field.
 * @returns {Object[]} Array of anomaly records.
 */
export function detectFalsePeakAnomalies(readings) {
  if (!readings || readings.length < 5) return [];

  const anomalies = [];

  // Group by device_id
  const byDevice = new Map();
  for (const r of readings) {
    const key = String(r.device_id || 'unknown');
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key).push(r);
  }

  for (const [deviceId, deviceReadings] of byDevice) {
    // Extract numeric values (power_consumption or reading)
    const values = deviceReadings
      .map(r => Number(r.power_consumption ?? r.reading ?? 0))
      .filter(v => !isNaN(v) && v >= 0);

    if (values.length < 5) continue;

    // Compute mean and standard deviation
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stddev = Math.sqrt(variance);

    const threshold = mean + 2 * stddev;

    for (const r of deviceReadings) {
      const value = Number(r.power_consumption ?? r.reading ?? 0);
      if (isNaN(value)) continue;

      if (value > mean * 1.5 && value <= threshold) {
        // Appears high but within statistical range — false peak
        anomalies.push(createAnomaly(
          ANOMALY_TYPES.FALSE_PEAK.key,
          ANOMALY_TYPES.FALSE_PEAK.severity,
          deviceId,
          `Value ${value.toFixed(2)} for device ${deviceId} appears high but is within normal range (mean=${mean.toFixed(2)}, threshold=${threshold.toFixed(2)})`,
          {
            value,
            mean: Math.round(mean * 100) / 100,
            stddev: Math.round(stddev * 100) / 100,
            threshold: Math.round(threshold * 100) / 100
          },
          r.timestamp
        ));
      } else if (value > threshold) {
        // Genuine high consumption
        anomalies.push(createAnomaly(
          ANOMALY_TYPES.HIGH_CONSUMPTION.key,
          ANOMALY_TYPES.HIGH_CONSUMPTION.severity,
          deviceId,
          `Abnormally high value ${value.toFixed(2)} for device ${deviceId} exceeds threshold ${threshold.toFixed(2)}`,
          {
            value,
            mean: Math.round(mean * 100) / 100,
            stddev: Math.round(stddev * 100) / 100,
            threshold: Math.round(threshold * 100) / 100
          },
          r.timestamp
        ));
      }
    }
  }

  return anomalies;
}

/**
 * Build an anomaly summary grouped by type and severity.
 *
 * @param {Object[]} anomalies - Array of anomaly records.
 * @returns {{ byType: Object, bySeverity: Object }}
 */
function buildSummary(anomalies) {
  const byType = {};
  const bySeverity = {};

  for (const a of anomalies) {
    byType[a.type] = (byType[a.type] || 0) + 1;
    bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
  }

  return { byType, bySeverity };
}

/**
 * Run all applicable anomaly detection routines on the given data set.
 *
 * @param {Object[]|Object} data - Array of validated records, or an object keyed by entity type.
 * @param {string} entityType - Primary entity type being imported.
 * @param {Object} [existingData={}] - Existing data from the store, keyed by entity type.
 * @returns {{ anomalies: Object[], summary: { byType: Object, bySeverity: Object } }}
 */
export function detectAnomalies(data, entityType, existingData = {}) {
  let anomalies = [];
  const records = Array.isArray(data) ? data : [];

  // Apply detection routines based on entity type
  const readingTypes = ['meter_readings', 'ac_energy', 'lighting_energy'];

  if (readingTypes.includes(entityType)) {
    // These detectors apply to time-series reading data
    anomalies = anomalies.concat(detectReadingReversal(records));
    anomalies = anomalies.concat(detectMissingTimestamps(records));
    anomalies = anomalies.concat(detectDuplicateMeters(records));
    anomalies = anomalies.concat(detectCrossDayBilling(records));
    anomalies = anomalies.concat(detectFalsePeakAnomalies(records));
  }

  if (entityType === 'devices') {
    // Check ownership chain using existing data
    const rooms = existingData.rooms || [];
    const floors = existingData.floors || [];
    const buildings = existingData.buildings || [];
    anomalies = anomalies.concat(detectOwnershipErrors(records, rooms, floors, buildings));
  }

  if (entityType === 'rooms') {
    const floors = existingData.floors || [];
    const buildings = existingData.buildings || [];
    anomalies = anomalies.concat(detectOwnershipErrors([], records, floors, buildings));
  }

  if (entityType === 'floors') {
    const buildings = existingData.buildings || [];
    anomalies = anomalies.concat(detectOwnershipErrors([], [], records, buildings));
  }

  const summary = buildSummary(anomalies);

  return { anomalies, summary };
}
