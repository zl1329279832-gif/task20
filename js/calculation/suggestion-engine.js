/**
 * suggestion-engine.js
 * Rule-based suggestion generation for building energy analysis.
 * All functions are pure -- no DOM access.
 */

/**
 * Default energy intensity threshold in kWh/m2 per month.
 * Commercial buildings above this should consider efficiency upgrades.
 */
const DEFAULT_INTENSITY_THRESHOLD = 25;

/**
 * Check if a month number falls in summer (Jun-Sep).
 * @param {number} month 1-12
 * @returns {boolean}
 */
function isSummer(month) {
  return month >= 6 && month <= 9;
}

/**
 * Check if a month number falls in winter (Dec-Feb).
 * @param {number} month 1-12
 * @returns {boolean}
 */
function isWinter(month) {
  return month === 12 || month === 1 || month === 2;
}

/**
 * Check if a given date is a weekend.
 * @param {Date} date
 * @returns {boolean}
 */
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a given hour is outside business hours.
 * Non-business hours: before 7am or after 9pm.
 * @param {number} hour 0-23
 * @returns {boolean}
 */
function isNonBusinessHour(hour) {
  return hour < 7 || hour >= 21;
}

/**
 * Rule 1: Device consumption > 2x building average -> suggest inspection.
 * @param {object} analysisData
 * @returns {object[]}
 */
function ruleHighConsumptionDevices(analysisData) {
  const suggestions = [];
  const { deviceRanking, buildingAvg } = analysisData;

  if (!Array.isArray(deviceRanking) || !Number.isFinite(buildingAvg) || buildingAvg <= 0) {
    return suggestions;
  }

  const threshold = buildingAvg * 2;

  for (const device of deviceRanking) {
    const consumption = Number(device.total ?? device.consumption ?? device.value ?? 0);
    if (consumption > threshold) {
      suggestions.push({
        category: 'equipment',
        title: 'High consumption device detected',
        message: `Device "${device.device_id || device.name || 'Unknown'}" consumed ${consumption.toFixed(1)} kWh, which is more than 2x the building average (${buildingAvg.toFixed(1)} kWh). Schedule an inspection to check for malfunctions or inefficiencies.`,
        priority: consumption > threshold * 1.5 ? 'high' : 'medium',
        estimatedSaving: Math.round((consumption - buildingAvg) * 0.3 * 100) / 100,
        affectedDevices: [device.device_id || device.name],
        icon: 'warning'
      });
    }
  }

  return suggestions;
}

/**
 * Rule 2: AC temp < 24C in summer or > 28C in winter -> suggest adjustment.
 * @param {object} analysisData
 * @returns {object[]}
 */
function ruleACTemperature(analysisData) {
  const suggestions = [];
  const { deviceRanking, timePatterns } = analysisData;

  if (!Array.isArray(deviceRanking)) return suggestions;

  // Determine current season from timePatterns or current date
  let currentMonth;
  if (timePatterns && timePatterns.currentMonth) {
    currentMonth = Number(timePatterns.currentMonth);
  } else if (timePatterns && timePatterns.latestTimestamp) {
    currentMonth = new Date(timePatterns.latestTimestamp).getMonth() + 1;
  } else {
    currentMonth = new Date().getMonth() + 1;
  }

  for (const device of deviceRanking) {
    const deviceType = String(device.device_type || device.type || '').toLowerCase();
    if (!deviceType.includes('ac') && !deviceType.includes('air_condition') && !deviceType.includes('hvac')) {
      continue;
    }

    const temp = Number(device.temperature ?? device.temp ?? device.set_temp);
    if (!Number.isFinite(temp)) continue;

    if (isSummer(currentMonth) && temp < 24) {
      suggestions.push({
        category: 'hvac',
        title: 'AC temperature too low in summer',
        message: `AC unit "${device.device_id || device.name || 'Unknown'}" is set to ${temp}°C during summer. Recommend raising to at least 24°C to reduce energy consumption while maintaining comfort.`,
        priority: temp < 20 ? 'high' : 'medium',
        estimatedSaving: Math.round((24 - temp) * 3 * 100) / 100, // ~3% per degree
        affectedDevices: [device.device_id || device.name],
        icon: 'thermometer'
      });
    }

    if (isWinter(currentMonth) && temp > 28) {
      suggestions.push({
        category: 'hvac',
        title: 'AC temperature too high in winter',
        message: `AC unit "${device.device_id || device.name || 'Unknown'}" is set to ${temp}°C during winter. Recommend lowering to no more than 28°C to save energy.`,
        priority: temp > 30 ? 'high' : 'medium',
        estimatedSaving: Math.round((temp - 28) * 3 * 100) / 100,
        affectedDevices: [device.device_id || device.name],
        icon: 'thermometer'
      });
    }
  }

  return suggestions;
}

/**
 * Rule 3: Lighting on during non-business hours -> suggest scheduling.
 * @param {object} analysisData
 * @returns {object[]}
 */
function ruleLightingSchedule(analysisData) {
  const suggestions = [];
  const { timePatterns } = analysisData;

  if (!timePatterns || !Array.isArray(timePatterns.offHoursUsage)) {
    return suggestions;
  }

  const offHoursDevices = new Map();

  for (const entry of timePatterns.offHoursUsage) {
    const deviceType = String(entry.device_type || entry.type || '').toLowerCase();
    if (!deviceType.includes('light') && !deviceType.includes('lighting')) {
      continue;
    }

    const ts = new Date(entry.timestamp);
    if (isNaN(ts.getTime())) continue;

    const hour = ts.getHours();
    const weekend = isWeekend(ts);

    if (weekend || isNonBusinessHour(hour)) {
      const deviceId = entry.device_id || 'unknown';
      const existing = offHoursDevices.get(deviceId) || { count: 0, totalKwh: 0 };
      existing.count += 1;
      existing.totalKwh += Number(entry.power_consumption || 0);
      offHoursDevices.set(deviceId, existing);
    }
  }

  for (const [deviceId, info] of offHoursDevices) {
    if (info.count > 0) {
      suggestions.push({
        category: 'scheduling',
        title: 'Lighting active during non-business hours',
        message: `Lighting device "${deviceId}" was active ${info.count} time(s) outside business hours (before 7am, after 9pm, or on weekends), consuming approximately ${info.totalKwh.toFixed(1)} kWh. Consider implementing automated scheduling or occupancy sensors.`,
        priority: info.count > 10 ? 'high' : (info.count > 3 ? 'medium' : 'low'),
        estimatedSaving: Math.round(info.totalKwh * 0.8 * 100) / 100,
        affectedDevices: [deviceId],
        icon: 'schedule'
      });
    }
  }

  return suggestions;
}

/**
 * Rule 4: TOU peak usage > 40% of total -> suggest load shifting to valley.
 * @param {object} analysisData
 * @returns {object[]}
 */
function ruleTOULoadShifting(analysisData) {
  const suggestions = [];
  const { touBreakdown } = analysisData;

  if (!touBreakdown) return suggestions;

  const sharp = Number(touBreakdown.sharp?.kwh ?? 0);
  const peak = Number(touBreakdown.peak?.kwh ?? 0);
  const flat = Number(touBreakdown.flat?.kwh ?? 0);
  const valley = Number(touBreakdown.valley?.kwh ?? 0);
  const total = sharp + peak + flat + valley;

  if (total <= 0) return suggestions;

  const peakRatio = (sharp + peak) / total;

  if (peakRatio > 0.4) {
    const peakPercent = (peakRatio * 100).toFixed(1);
    const shiftableKwh = (sharp + peak) * 0.2; // assume 20% could be shifted
    const peakAvgPrice = touBreakdown.peak?.kwh > 0
      ? (touBreakdown.peak.cost / touBreakdown.peak.kwh)
      : 1.15;
    const valleyAvgPrice = touBreakdown.valley?.kwh > 0
      ? (touBreakdown.valley.cost / touBreakdown.valley.kwh)
      : 0.38;
    const estimatedSaving = Math.round(shiftableKwh * (peakAvgPrice - valleyAvgPrice) * 100) / 100;

    suggestions.push({
      category: 'cost-optimization',
      title: 'High peak-period energy usage',
      message: `Peak and sharp period usage accounts for ${peakPercent}% of total consumption (threshold: 40%). Consider shifting non-critical loads (e.g., EV charging, water heating, batch processing) to valley hours (0:00-7:00) to reduce electricity costs.`,
      priority: peakRatio > 0.6 ? 'high' : 'medium',
      estimatedSaving,
      affectedDevices: [],
      icon: 'trending_down'
    });
  }

  return suggestions;
}

/**
 * Rule 5: Rising consumption trend (3+ consecutive months increasing).
 * @param {object} analysisData
 * @returns {object[]}
 */
function ruleRisingTrend(analysisData) {
  const suggestions = [];
  const { timePatterns } = analysisData;

  if (!timePatterns || !Array.isArray(timePatterns.monthlyTotals)) {
    return suggestions;
  }

  const monthly = timePatterns.monthlyTotals
    .filter(m => m && Number.isFinite(Number(m.value)))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));

  if (monthly.length < 3) return suggestions;

  // Find consecutive increasing runs
  let consecutiveIncreasing = 1;
  let runStart = 0;

  for (let i = 1; i < monthly.length; i++) {
    if (Number(monthly[i].value) > Number(monthly[i - 1].value)) {
      consecutiveIncreasing++;
    } else {
      if (consecutiveIncreasing >= 3) {
        const startMonth = monthly[runStart].month;
        const endMonth = monthly[i - 1].month;
        const increasePercent = Number(monthly[runStart].value) > 0
          ? ((Number(monthly[i - 1].value) - Number(monthly[runStart].value)) / Number(monthly[runStart].value) * 100).toFixed(1)
          : 'N/A';

        suggestions.push({
          category: 'maintenance',
          title: 'Rising energy consumption trend',
          message: `Energy consumption has been increasing for ${consecutiveIncreasing} consecutive months (${startMonth} to ${endMonth}), up ${increasePercent}% overall. This may indicate aging equipment, refrigerant leaks, or changing usage patterns. Schedule a maintenance check.`,
          priority: consecutiveIncreasing >= 5 ? 'high' : 'medium',
          estimatedSaving: null,
          affectedDevices: [],
          icon: 'trending_up'
        });
      }
      consecutiveIncreasing = 1;
      runStart = i;
    }
  }

  // Check trailing run
  if (consecutiveIncreasing >= 3) {
    const startMonth = monthly[runStart].month;
    const endMonth = monthly[monthly.length - 1].month;
    const increasePercent = Number(monthly[runStart].value) > 0
      ? ((Number(monthly[monthly.length - 1].value) - Number(monthly[runStart].value)) / Number(monthly[runStart].value) * 100).toFixed(1)
      : 'N/A';

    suggestions.push({
      category: 'maintenance',
      title: 'Rising energy consumption trend',
      message: `Energy consumption has been increasing for ${consecutiveIncreasing} consecutive months (${startMonth} to ${endMonth}), up ${increasePercent}% overall. This may indicate aging equipment, refrigerant leaks, or changing usage patterns. Schedule a maintenance check.`,
      priority: consecutiveIncreasing >= 5 ? 'high' : 'medium',
      estimatedSaving: null,
      affectedDevices: [],
      icon: 'trending_up'
    });
  }

  return suggestions;
}

/**
 * Rule 6: High energy intensity (kWh/m2 > threshold).
 * @param {object} analysisData
 * @returns {object[]}
 */
function ruleHighEnergyIntensity(analysisData) {
  const suggestions = [];
  const { buildingAvg, timePatterns } = analysisData;

  // Look for building-level intensity data
  const buildings = timePatterns?.buildings || [];

  for (const building of buildings) {
    const area = Number(building.area ?? building.floor_area ?? 0);
    const consumption = Number(building.total ?? building.consumption ?? 0);

    if (area <= 0 || consumption <= 0) continue;

    const intensity = consumption / area;
    const threshold = Number(building.intensityThreshold ?? DEFAULT_INTENSITY_THRESHOLD);

    if (intensity > threshold) {
      suggestions.push({
        category: 'efficiency',
        title: 'High energy intensity',
        message: `Building "${building.building_id || building.name || 'Unknown'}" has an energy intensity of ${intensity.toFixed(2)} kWh/m², exceeding the threshold of ${threshold} kWh/m². Consider upgrading insulation, windows, lighting fixtures, or HVAC systems for better efficiency.`,
        priority: intensity > threshold * 1.5 ? 'high' : 'medium',
        estimatedSaving: Math.round((intensity - threshold) * area * 0.5 * 100) / 100,
        affectedDevices: [],
        icon: 'bolt'
      });
    }
  }

  // Fallback: if no per-building data, check aggregate
  if (buildings.length === 0 && timePatterns?.totalArea && Number.isFinite(buildingAvg)) {
    const area = Number(timePatterns.totalArea);
    if (area > 0 && buildingAvg > 0) {
      const intensity = buildingAvg / area;
      if (intensity > DEFAULT_INTENSITY_THRESHOLD) {
        suggestions.push({
          category: 'efficiency',
          title: 'High energy intensity',
          message: `Overall building energy intensity is ${intensity.toFixed(2)} kWh/m², exceeding the standard threshold of ${DEFAULT_INTENSITY_THRESHOLD} kWh/m². Consider a comprehensive energy audit.`,
          priority: intensity > DEFAULT_INTENSITY_THRESHOLD * 1.5 ? 'high' : 'medium',
          estimatedSaving: Math.round((intensity - DEFAULT_INTENSITY_THRESHOLD) * area * 0.5 * 100) / 100,
          affectedDevices: [],
          icon: 'bolt'
        });
      }
    }
  }

  return suggestions;
}

/**
 * Generate energy-saving suggestions from analysis data.
 *
 * @param {{
 *   deviceRanking: Array<{ device_id: string, device_type: string, total: number, temperature?: number }>,
 *   touBreakdown: { sharp: { kwh: number, cost: number }, peak: { kwh: number, cost: number }, flat: { kwh: number, cost: number }, valley: { kwh: number, cost: number } },
 *   anomalies: object[],
 *   buildingAvg: number,
 *   timePatterns: {
 *     currentMonth?: number,
 *     latestTimestamp?: string,
 *     offHoursUsage?: object[],
 *     monthlyTotals?: Array<{ month: string, value: number }>,
 *     buildings?: Array<{ building_id: string, area: number, total: number }>,
 *     totalArea?: number
 *   }
 * }} analysisData
 * @returns {Array<{
 *   category: string,
 *   title: string,
 *   message: string,
 *   priority: 'high'|'medium'|'low',
 *   estimatedSaving: number|null,
 *   affectedDevices: string[],
 *   icon: string
 * }>}
 */
export function generateSuggestions(analysisData) {
  if (!analysisData) return [];

  const data = {
    deviceRanking: analysisData.deviceRanking || [],
    touBreakdown: analysisData.touBreakdown || null,
    anomalies: analysisData.anomalies || [],
    buildingAvg: Number(analysisData.buildingAvg) || 0,
    timePatterns: analysisData.timePatterns || {}
  };

  const suggestions = [
    ...ruleHighConsumptionDevices(data),
    ...ruleACTemperature(data),
    ...ruleLightingSchedule(data),
    ...ruleTOULoadShifting(data),
    ...ruleRisingTrend(data),
    ...ruleHighEnergyIntensity(data)
  ];

  // Sort by priority: high > medium > low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
  });

  return suggestions;
}
