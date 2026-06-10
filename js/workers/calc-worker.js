/**
 * calc-worker.js
 * Web Worker for building energy analysis calculations.
 * All calculation logic is inlined -- no imports or importScripts.
 *
 * Message protocol:
 *   Receive: { id: string, action: string, payload: object }
 *   Respond: { id: string, status: 'success'|'error', payload: object }
 *   Progress: { id: string, status: 'progress', payload: { percent: number, message: string } }
 */

/* ========================================================================
 * INLINED: aggregator
 * ======================================================================== */

function _extractGroupKey(item, groupBy) {
  switch (groupBy) {
    case 'building':
      return String(item.building_id ?? 'unknown');
    case 'floor':
      return String(item.floor_id ?? 'unknown');
    case 'device':
      return String(item.device_id ?? 'unknown');
    case 'hour': {
      const d = new Date(item.timestamp);
      if (isNaN(d.getTime())) return 'invalid';
      return String(d.getHours());
    }
    case 'day': {
      const d = new Date(item.timestamp);
      if (isNaN(d.getTime())) return 'invalid';
      return d.toISOString().slice(0, 10);
    }
    case 'month': {
      const d = new Date(item.timestamp);
      if (isNaN(d.getTime())) return 'invalid';
      return d.toISOString().slice(0, 7);
    }
    case 'year': {
      const d = new Date(item.timestamp);
      if (isNaN(d.getTime())) return 'invalid';
      return String(d.getFullYear());
    }
    default:
      return 'all';
  }
}

function _computeMetric(values, metric) {
  if (!values || values.length === 0) return 0;
  switch (metric) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg': {
      const sum = values.reduce((a, b) => a + b, 0);
      return values.length > 0 ? sum / values.length : 0;
    }
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'count':
      return values.length;
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

function aggregate(data, groupBy, metric) {
  if (!Array.isArray(data) || data.length === 0) {
    return { groups: [] };
  }
  const groupMap = new Map();
  for (const item of data) {
    const key = _extractGroupKey(item, groupBy);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(item);
  }
  const groups = [];
  for (const [key, items] of groupMap) {
    const values = items.map(it => {
      const v = Number(it.power_consumption);
      return isNaN(v) ? 0 : v;
    });
    groups.push({ key, value: _computeMetric(values, metric), count: items.length, items });
  }
  return { groups };
}

function aggregateMulti(data, groupByList, metric) {
  if (!Array.isArray(data) || data.length === 0) return { groups: [] };
  if (!Array.isArray(groupByList) || groupByList.length === 0) {
    const values = data.map(it => { const v = Number(it.power_consumption); return isNaN(v) ? 0 : v; });
    return { groups: [{ key: 'all', value: _computeMetric(values, metric), count: data.length, items: data, children: null }] };
  }
  if (groupByList.length === 1) {
    const result = aggregate(data, groupByList[0], metric);
    result.groups = result.groups.map(g => ({ ...g, children: null }));
    return result;
  }
  const [currentGroupBy, ...rest] = groupByList;
  const topLevel = aggregate(data, currentGroupBy, metric);
  topLevel.groups = topLevel.groups.map(group => {
    const children = aggregateMulti(group.items, rest, metric);
    return { key: group.key, value: group.value, count: group.count, items: group.items, children };
  });
  return topLevel;
}

/* ========================================================================
 * INLINED: tou-billing
 * ======================================================================== */

function getDefaultTOUPricing() {
  return [
    { time_period: 'sharp', start_time: 10, end_time: 12, price_per_kwh: 1.42 },
    { time_period: 'sharp', start_time: 19, end_time: 21, price_per_kwh: 1.42 },
    { time_period: 'peak', start_time: 8, end_time: 10, price_per_kwh: 1.15 },
    { time_period: 'peak', start_time: 12, end_time: 17, price_per_kwh: 1.15 },
    { time_period: 'peak', start_time: 21, end_time: 23, price_per_kwh: 1.15 },
    { time_period: 'flat', start_time: 7, end_time: 8, price_per_kwh: 0.78 },
    { time_period: 'flat', start_time: 17, end_time: 19, price_per_kwh: 0.78 },
    { time_period: 'flat', start_time: 23, end_time: 24, price_per_kwh: 0.78 },
    { time_period: 'valley', start_time: 0, end_time: 7, price_per_kwh: 0.38 }
  ];
}

function classifyHourToPeriod(hour, touPricing) {
  if (hour < 0 || hour > 23 || !Number.isFinite(hour)) return 'flat';
  const pricing = touPricing || getDefaultTOUPricing();
  for (const slot of pricing) {
    if (slot.start_time <= hour && hour < slot.end_time) return slot.time_period;
  }
  return 'flat';
}

function _getPriceForPeriod(periodKey, touPricing) {
  const slot = touPricing.find(s => s.time_period === periodKey);
  return slot ? slot.price_per_kwh : 0;
}

function calculateTOUBilling(readings, touPricing) {
  const pricing = touPricing || getDefaultTOUPricing();
  const breakdown = {
    sharp: { kwh: 0, cost: 0 }, peak: { kwh: 0, cost: 0 },
    flat: { kwh: 0, cost: 0 }, valley: { kwh: 0, cost: 0 }
  };
  const details = [];
  let totalCost = 0;
  let totalConsumption = 0;

  if (!Array.isArray(readings) || readings.length === 0) {
    return { totalCost, totalConsumption, breakdown, details };
  }

  const sorted = [...readings].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (let i = 0; i < sorted.length; i++) {
    const reading = sorted[i];
    const consumption = Number(reading.power_consumption);
    if (!Number.isFinite(consumption) || consumption < 0) continue;

    const ts = new Date(reading.timestamp);
    if (isNaN(ts.getTime())) continue;

    const hour = ts.getHours();
    const minutes = ts.getMinutes();

    let intervalHours = 1;
    if (i + 1 < sorted.length) {
      const nextTs = new Date(sorted[i + 1].timestamp);
      if (!isNaN(nextTs.getTime())) {
        intervalHours = (nextTs.getTime() - ts.getTime()) / (1000 * 60 * 60);
        if (intervalHours <= 0 || intervalHours > 24) intervalHours = 1;
      }
    }

    const startMinuteOfDay = hour * 60 + minutes;
    const endMinuteOfDay = startMinuteOfDay + intervalHours * 60;

    if (endMinuteOfDay > 24 * 60) {
      const minutesBeforeMidnight = 24 * 60 - startMinuteOfDay;
      const totalMinutes = minutesBeforeMidnight + (endMinuteOfDay - 24 * 60);
      const fractionBefore = minutesBeforeMidnight / totalMinutes;
      const consumptionBefore = consumption * fractionBefore;
      const consumptionAfter = consumption * (1 - fractionBefore);

      const periodBefore = classifyHourToPeriod(hour, pricing);
      const priceBefore = _getPriceForPeriod(periodBefore, pricing);
      const costBefore = consumptionBefore * priceBefore;
      breakdown[periodBefore].kwh += consumptionBefore;
      breakdown[periodBefore].cost += costBefore;
      totalCost += costBefore;
      totalConsumption += consumptionBefore;
      details.push({ timestamp: reading.timestamp, device_id: reading.device_id, power_consumption: consumptionBefore, period: periodBefore, price: priceBefore, cost: costBefore });

      const periodAfter = classifyHourToPeriod(0, pricing);
      const priceAfter = _getPriceForPeriod(periodAfter, pricing);
      const costAfter = consumptionAfter * priceAfter;
      breakdown[periodAfter].kwh += consumptionAfter;
      breakdown[periodAfter].cost += costAfter;
      totalCost += costAfter;
      totalConsumption += consumptionAfter;
      details.push({ timestamp: reading.timestamp, device_id: reading.device_id, power_consumption: consumptionAfter, period: periodAfter, price: priceAfter, cost: costAfter });
    } else {
      const period = classifyHourToPeriod(hour, pricing);
      const price = _getPriceForPeriod(period, pricing);
      const cost = consumption * price;
      breakdown[period].kwh += consumption;
      breakdown[period].cost += cost;
      totalCost += cost;
      totalConsumption += consumption;
      details.push({ timestamp: reading.timestamp, device_id: reading.device_id, power_consumption: consumption, period, price, cost });
    }
  }

  totalCost = Math.round(totalCost * 100) / 100;
  for (const key of Object.keys(breakdown)) {
    breakdown[key].kwh = Math.round(breakdown[key].kwh * 1000) / 1000;
    breakdown[key].cost = Math.round(breakdown[key].cost * 100) / 100;
  }

  return { totalCost, totalConsumption, breakdown, details };
}

/* ========================================================================
 * INLINED: yoy-mom-comparator
 * ======================================================================== */

function _groupByMonth(data) {
  const map = new Map();
  for (const item of data) {
    const d = new Date(item.timestamp);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + (Number(item.power_consumption) || 0));
  }
  return map;
}

function _groupByDay(data) {
  const map = new Map();
  for (const item of data) {
    const d = new Date(item.timestamp);
    if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + (Number(item.power_consumption) || 0));
  }
  return map;
}

function _determineTrend(changePercent) {
  if (changePercent === null || !Number.isFinite(changePercent)) return 'flat';
  if (changePercent > 0.5) return 'up';
  if (changePercent < -0.5) return 'down';
  return 'flat';
}

function _buildComparisonResult(period, current, previous) {
  if (current === null || current === undefined) {
    return { period, current: null, previous: previous ?? null, change: null, changePercent: null, trend: 'flat' };
  }
  if (previous === null || previous === undefined) {
    return { period, current, previous: null, change: null, changePercent: null, trend: 'flat' };
  }
  const change = current - previous;
  const changePercent = previous !== 0
    ? Math.round((change / previous) * 10000) / 100
    : (current > 0 ? 100 : 0);
  return {
    period, current, previous,
    change: Math.round(change * 1000) / 1000,
    changePercent,
    trend: _determineTrend(changePercent)
  };
}

function compareYoY(data, currentYear) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const year = Number(currentYear);
  if (!Number.isFinite(year)) return [];
  const monthTotals = _groupByMonth(data);
  const previousYear = year - 1;
  const results = [];
  for (let m = 1; m <= 12; m++) {
    const monthStr = String(m).padStart(2, '0');
    const currentKey = `${year}-${monthStr}`;
    const previousKey = `${previousYear}-${monthStr}`;
    const currentVal = monthTotals.has(currentKey) ? monthTotals.get(currentKey) : null;
    const previousVal = monthTotals.has(previousKey) ? monthTotals.get(previousKey) : null;
    if (currentVal !== null || previousVal !== null) {
      results.push(_buildComparisonResult(`${year}/${monthStr}`, currentVal, previousVal));
    }
  }
  return results;
}

function compareMoM(data, currentMonth) {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (!currentMonth || typeof currentMonth !== 'string') return [];
  const [yearStr, monthStr] = currentMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return [];

  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear = year - 1; }
  const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  const monthTotals = _groupByMonth(data);
  const currentVal = monthTotals.has(currentMonth) ? monthTotals.get(currentMonth) : null;
  const previousVal = monthTotals.has(prevMonthKey) ? monthTotals.get(prevMonthKey) : null;
  const overallResult = _buildComparisonResult(`${currentMonth} vs ${prevMonthKey}`, currentVal, previousVal);

  const dayTotals = _groupByDay(data);
  const daysInCurrentMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
  const maxDays = Math.max(daysInCurrentMonth, daysInPrevMonth);
  const dailyResults = [];
  for (let d = 1; d <= maxDays; d++) {
    const dayStr = String(d).padStart(2, '0');
    const currentDayKey = `${currentMonth}-${dayStr}`;
    const prevDayKey = `${prevMonthKey}-${dayStr}`;
    const curDayVal = dayTotals.has(currentDayKey) ? dayTotals.get(currentDayKey) : null;
    const prevDayVal = dayTotals.has(prevDayKey) ? dayTotals.get(prevDayKey) : null;
    if (curDayVal !== null || prevDayVal !== null) {
      dailyResults.push(_buildComparisonResult(`Day ${d}`, curDayVal, prevDayVal));
    }
  }
  return [overallResult, ...dailyResults];
}

/* ========================================================================
 * INLINED: anomaly-scorer
 * ======================================================================== */

function _severityBaseScore(severity) {
  switch (String(severity).toLowerCase()) {
    case 'critical': return 90;
    case 'high':     return 70;
    case 'medium':   return 50;
    case 'low':      return 30;
    case 'info':     return 10;
    default:         return 40;
  }
}

function _computeDeviationFactor(anomaly, context) {
  const value = Number(anomaly.details?.value ?? anomaly.details?.consumption ?? 0);
  const avg = Number(context.historicalAvg ?? 0);
  const stddev = Number(context.historicalStddev ?? 1);
  if (stddev === 0 || !Number.isFinite(stddev)) return value > avg ? 5 : 0;
  return Math.min(Math.abs(value - avg) / stddev, 10);
}

function _matchesSeasonalPattern(anomaly, context) {
  if (!context.seasonalBaseline) return false;
  const timestamp = anomaly.details?.timestamp ?? anomaly.timestamp;
  if (!timestamp) return false;
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return false;
  const month = d.getMonth() + 1;
  let season;
  if (month >= 6 && month <= 8) season = 'summer';
  else if (month >= 12 || month <= 2) season = 'winter';
  else if (month >= 3 && month <= 5) season = 'spring';
  else season = 'autumn';
  const baseline = context.seasonalBaseline[season];
  if (baseline === undefined || baseline === null) return false;
  const value = Number(anomaly.details?.value ?? anomaly.details?.consumption ?? 0);
  if (baseline === 0) return value === 0;
  return Math.abs(value - baseline) / baseline < 0.3;
}

function _generateRecommendation(anomaly, score, isFalsePositive) {
  if (isFalsePositive) {
    return 'Seasonal pattern detected. No immediate action required; continue monitoring.';
  }
  const type = String(anomaly.type).toLowerCase();
  if (score >= 80) {
    if (type.includes('consumption') || type.includes('energy')) return 'Critical energy anomaly detected. Immediate inspection of equipment and wiring recommended.';
    if (type.includes('temperature') || type.includes('temp')) return 'Severe temperature anomaly. Check HVAC system immediately and verify sensor calibration.';
    return 'High-severity anomaly requires immediate investigation and corrective action.';
  }
  if (score >= 50) {
    if (type.includes('consumption') || type.includes('energy')) return 'Elevated energy usage detected. Schedule equipment inspection within one week.';
    if (type.includes('off-hours') || type.includes('schedule')) return 'Off-hours operation detected. Review scheduling policies and timer settings.';
    return 'Moderate anomaly detected. Schedule investigation within the current maintenance cycle.';
  }
  return 'Minor anomaly noted. Include in next routine maintenance review.';
}

function scoreAnomalies(anomalies, context) {
  if (!Array.isArray(anomalies) || anomalies.length === 0) return [];
  const ctx = context || {};
  return anomalies.map(anomaly => {
    let score = _severityBaseScore(anomaly.severity);
    const deviationFactor = _computeDeviationFactor(anomaly, ctx);
    score += Math.min(deviationFactor * 3, 30);
    if (ctx.buildingType) {
      const bt = String(ctx.buildingType).toLowerCase();
      if (bt === 'datacenter' || bt === 'data_center' || bt === 'hospital') score -= 10;
      else if (bt === 'warehouse' || bt === 'parking') score += 5;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const isFalsePositive = deviationFactor < 2 && _matchesSeasonalPattern(anomaly, ctx);
    if (isFalsePositive) score = Math.max(0, Math.min(score, 20));
    const recommendation = _generateRecommendation(anomaly, score, isFalsePositive);
    return { ...anomaly, score, isFalsePositive, recommendation };
  });
}

/* ========================================================================
 * INLINED: suggestion-engine
 * ======================================================================== */

const _DEFAULT_INTENSITY_THRESHOLD = 25;

function _isSummer(month) { return month >= 6 && month <= 9; }
function _isWinter(month) { return month === 12 || month === 1 || month === 2; }
function _isWeekend(date) { const day = date.getDay(); return day === 0 || day === 6; }
function _isNonBusinessHour(hour) { return hour < 7 || hour >= 21; }

function _ruleHighConsumptionDevices(data) {
  const suggestions = [];
  const { deviceRanking, buildingAvg } = data;
  if (!Array.isArray(deviceRanking) || !Number.isFinite(buildingAvg) || buildingAvg <= 0) return suggestions;
  const threshold = buildingAvg * 2;
  for (const device of deviceRanking) {
    const consumption = Number(device.total ?? device.consumption ?? device.value ?? 0);
    if (consumption > threshold) {
      suggestions.push({
        category: 'equipment', title: 'High consumption device detected',
        message: `Device "${device.device_id || device.name || 'Unknown'}" consumed ${consumption.toFixed(1)} kWh, which is more than 2x the building average (${buildingAvg.toFixed(1)} kWh). Schedule an inspection to check for malfunctions or inefficiencies.`,
        priority: consumption > threshold * 1.5 ? 'high' : 'medium',
        estimatedSaving: Math.round((consumption - buildingAvg) * 0.3 * 100) / 100,
        affectedDevices: [device.device_id || device.name], icon: 'warning'
      });
    }
  }
  return suggestions;
}

function _ruleACTemperature(data) {
  const suggestions = [];
  const { deviceRanking, timePatterns } = data;
  if (!Array.isArray(deviceRanking)) return suggestions;
  let currentMonth;
  if (timePatterns && timePatterns.currentMonth) currentMonth = Number(timePatterns.currentMonth);
  else if (timePatterns && timePatterns.latestTimestamp) currentMonth = new Date(timePatterns.latestTimestamp).getMonth() + 1;
  else currentMonth = new Date().getMonth() + 1;

  for (const device of deviceRanking) {
    const deviceType = String(device.device_type || device.type || '').toLowerCase();
    if (!deviceType.includes('ac') && !deviceType.includes('air_condition') && !deviceType.includes('hvac')) continue;
    const temp = Number(device.temperature ?? device.temp ?? device.set_temp);
    if (!Number.isFinite(temp)) continue;
    if (_isSummer(currentMonth) && temp < 24) {
      suggestions.push({
        category: 'hvac', title: 'AC temperature too low in summer',
        message: `AC unit "${device.device_id || device.name || 'Unknown'}" is set to ${temp}\u00B0C during summer. Recommend raising to at least 24\u00B0C to reduce energy consumption while maintaining comfort.`,
        priority: temp < 20 ? 'high' : 'medium',
        estimatedSaving: Math.round((24 - temp) * 3 * 100) / 100,
        affectedDevices: [device.device_id || device.name], icon: 'thermometer'
      });
    }
    if (_isWinter(currentMonth) && temp > 28) {
      suggestions.push({
        category: 'hvac', title: 'AC temperature too high in winter',
        message: `AC unit "${device.device_id || device.name || 'Unknown'}" is set to ${temp}\u00B0C during winter. Recommend lowering to no more than 28\u00B0C to save energy.`,
        priority: temp > 30 ? 'high' : 'medium',
        estimatedSaving: Math.round((temp - 28) * 3 * 100) / 100,
        affectedDevices: [device.device_id || device.name], icon: 'thermometer'
      });
    }
  }
  return suggestions;
}

function _ruleLightingSchedule(data) {
  const suggestions = [];
  const { timePatterns } = data;
  if (!timePatterns || !Array.isArray(timePatterns.offHoursUsage)) return suggestions;
  const offHoursDevices = new Map();
  for (const entry of timePatterns.offHoursUsage) {
    const deviceType = String(entry.device_type || entry.type || '').toLowerCase();
    if (!deviceType.includes('light') && !deviceType.includes('lighting')) continue;
    const ts = new Date(entry.timestamp);
    if (isNaN(ts.getTime())) continue;
    const hour = ts.getHours();
    const weekend = _isWeekend(ts);
    if (weekend || _isNonBusinessHour(hour)) {
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
        category: 'scheduling', title: 'Lighting active during non-business hours',
        message: `Lighting device "${deviceId}" was active ${info.count} time(s) outside business hours (before 7am, after 9pm, or on weekends), consuming approximately ${info.totalKwh.toFixed(1)} kWh. Consider implementing automated scheduling or occupancy sensors.`,
        priority: info.count > 10 ? 'high' : (info.count > 3 ? 'medium' : 'low'),
        estimatedSaving: Math.round(info.totalKwh * 0.8 * 100) / 100,
        affectedDevices: [deviceId], icon: 'schedule'
      });
    }
  }
  return suggestions;
}

function _ruleTOULoadShifting(data) {
  const suggestions = [];
  const { touBreakdown } = data;
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
    const shiftableKwh = (sharp + peak) * 0.2;
    const peakAvgPrice = touBreakdown.peak?.kwh > 0 ? (touBreakdown.peak.cost / touBreakdown.peak.kwh) : 1.15;
    const valleyAvgPrice = touBreakdown.valley?.kwh > 0 ? (touBreakdown.valley.cost / touBreakdown.valley.kwh) : 0.38;
    const estimatedSaving = Math.round(shiftableKwh * (peakAvgPrice - valleyAvgPrice) * 100) / 100;
    suggestions.push({
      category: 'cost-optimization', title: 'High peak-period energy usage',
      message: `Peak and sharp period usage accounts for ${peakPercent}% of total consumption (threshold: 40%). Consider shifting non-critical loads (e.g., EV charging, water heating, batch processing) to valley hours (0:00-7:00) to reduce electricity costs.`,
      priority: peakRatio > 0.6 ? 'high' : 'medium',
      estimatedSaving, affectedDevices: [], icon: 'trending_down'
    });
  }
  return suggestions;
}

function _ruleRisingTrend(data) {
  const suggestions = [];
  const { timePatterns } = data;
  if (!timePatterns || !Array.isArray(timePatterns.monthlyTotals)) return suggestions;
  const monthly = timePatterns.monthlyTotals
    .filter(m => m && Number.isFinite(Number(m.value)))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  if (monthly.length < 3) return suggestions;
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
          category: 'maintenance', title: 'Rising energy consumption trend',
          message: `Energy consumption has been increasing for ${consecutiveIncreasing} consecutive months (${startMonth} to ${endMonth}), up ${increasePercent}% overall. This may indicate aging equipment, refrigerant leaks, or changing usage patterns. Schedule a maintenance check.`,
          priority: consecutiveIncreasing >= 5 ? 'high' : 'medium',
          estimatedSaving: null, affectedDevices: [], icon: 'trending_up'
        });
      }
      consecutiveIncreasing = 1;
      runStart = i;
    }
  }
  if (consecutiveIncreasing >= 3) {
    const startMonth = monthly[runStart].month;
    const endMonth = monthly[monthly.length - 1].month;
    const increasePercent = Number(monthly[runStart].value) > 0
      ? ((Number(monthly[monthly.length - 1].value) - Number(monthly[runStart].value)) / Number(monthly[runStart].value) * 100).toFixed(1)
      : 'N/A';
    suggestions.push({
      category: 'maintenance', title: 'Rising energy consumption trend',
      message: `Energy consumption has been increasing for ${consecutiveIncreasing} consecutive months (${startMonth} to ${endMonth}), up ${increasePercent}% overall. This may indicate aging equipment, refrigerant leaks, or changing usage patterns. Schedule a maintenance check.`,
      priority: consecutiveIncreasing >= 5 ? 'high' : 'medium',
      estimatedSaving: null, affectedDevices: [], icon: 'trending_up'
    });
  }
  return suggestions;
}

function _ruleHighEnergyIntensity(data) {
  const suggestions = [];
  const { timePatterns } = data;
  const buildings = timePatterns?.buildings || [];
  for (const building of buildings) {
    const area = Number(building.area ?? building.floor_area ?? 0);
    const consumption = Number(building.total ?? building.consumption ?? 0);
    if (area <= 0 || consumption <= 0) continue;
    const intensity = consumption / area;
    const threshold = Number(building.intensityThreshold ?? _DEFAULT_INTENSITY_THRESHOLD);
    if (intensity > threshold) {
      suggestions.push({
        category: 'efficiency', title: 'High energy intensity',
        message: `Building "${building.building_id || building.name || 'Unknown'}" has an energy intensity of ${intensity.toFixed(2)} kWh/m\u00B2, exceeding the threshold of ${threshold} kWh/m\u00B2. Consider upgrading insulation, windows, lighting fixtures, or HVAC systems for better efficiency.`,
        priority: intensity > threshold * 1.5 ? 'high' : 'medium',
        estimatedSaving: Math.round((intensity - threshold) * area * 0.5 * 100) / 100,
        affectedDevices: [], icon: 'bolt'
      });
    }
  }
  if (buildings.length === 0 && timePatterns?.totalArea && Number.isFinite(data.buildingAvg)) {
    const area = Number(timePatterns.totalArea);
    if (area > 0 && data.buildingAvg > 0) {
      const intensity = data.buildingAvg / area;
      if (intensity > _DEFAULT_INTENSITY_THRESHOLD) {
        suggestions.push({
          category: 'efficiency', title: 'High energy intensity',
          message: `Overall building energy intensity is ${intensity.toFixed(2)} kWh/m\u00B2, exceeding the standard threshold of ${_DEFAULT_INTENSITY_THRESHOLD} kWh/m\u00B2. Consider a comprehensive energy audit.`,
          priority: intensity > _DEFAULT_INTENSITY_THRESHOLD * 1.5 ? 'high' : 'medium',
          estimatedSaving: Math.round((intensity - _DEFAULT_INTENSITY_THRESHOLD) * area * 0.5 * 100) / 100,
          affectedDevices: [], icon: 'bolt'
        });
      }
    }
  }
  return suggestions;
}

function generateSuggestions(analysisData) {
  if (!analysisData) return [];
  const data = {
    deviceRanking: analysisData.deviceRanking || [],
    touBreakdown: analysisData.touBreakdown || null,
    anomalies: analysisData.anomalies || [],
    buildingAvg: Number(analysisData.buildingAvg) || 0,
    timePatterns: analysisData.timePatterns || {}
  };
  const suggestions = [
    ..._ruleHighConsumptionDevices(data),
    ..._ruleACTemperature(data),
    ..._ruleLightingSchedule(data),
    ..._ruleTOULoadShifting(data),
    ..._ruleRisingTrend(data),
    ..._ruleHighEnergyIntensity(data)
  ];
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
  return suggestions;
}

/* ========================================================================
 * WORKER MESSAGE HANDLER
 * ======================================================================== */

/**
 * Post a progress update back to the main thread.
 * @param {string} id - Message ID.
 * @param {number} percent - Progress percentage (0-100).
 * @param {string} message - Human-readable progress message.
 */
function postProgress(id, percent, message) {
  self.postMessage({ id, status: 'progress', payload: { percent, message } });
}

/**
 * Post a success response.
 * @param {string} id
 * @param {object} payload
 */
function postSuccess(id, payload) {
  self.postMessage({ id, status: 'success', payload });
}

/**
 * Post an error response.
 * @param {string} id
 * @param {string} errorMessage
 */
function postError(id, errorMessage) {
  self.postMessage({ id, status: 'error', payload: { error: errorMessage } });
}

/**
 * Run the full analysis pipeline.
 * Input:
 *   data: { meterReadings, acEnergy, lightingEnergy, devices, buildings, floors }
 *   state: { selectedBuildingId, timeRange, energyType, billingMethod, topN, comparisonMode }
 *   touPricing: pricing array (optional)
 * Output:
 *   { buildingOverview, floorHeatmap, deviceRanking, touTrend, yoyMom, anomalies, suggestions }
 */
function runFullAnalysis(id, payload) {
  const { data, state, touPricing } = payload;
  if (!data) {
    postError(id, 'Missing data for full analysis');
    return;
  }

  const meterReadings = data.meterReadings || [];
  const devices = data.devices || [];
  const buildings = data.buildings || [];
  const floors = data.floors || [];
  const stateObj = state || {};
  const topN = Number(stateObj.topN) || 10;

  postProgress(id, 10, 'Filtering data...');

  // 1. Filter by selected building if applicable
  let filteredReadings = meterReadings;
  if (stateObj.selectedBuildingId && stateObj.selectedBuildingId !== 'all') {
    filteredReadings = meterReadings.filter(r => String(r.building_id) === String(stateObj.selectedBuildingId));
  }

  // 2. Filter by time range
  if (stateObj.timeRange) {
    const { start, end } = stateObj.timeRange;
    if (start) {
      const startTs = new Date(start).getTime();
      filteredReadings = filteredReadings.filter(r => new Date(r.timestamp).getTime() >= startTs);
    }
    if (end) {
      const endTs = new Date(end).getTime();
      filteredReadings = filteredReadings.filter(r => new Date(r.timestamp).getTime() <= endTs);
    }
  }

  postProgress(id, 20, 'Aggregating building overview...');

  // 3. Building overview: aggregate by building
  const buildingOverview = aggregate(filteredReadings, 'building', 'sum');

  postProgress(id, 30, 'Generating floor heatmap data...');

  // 4. Floor heatmap: aggregate by floor
  const floorHeatmap = aggregate(filteredReadings, 'floor', 'sum');

  postProgress(id, 40, 'Ranking devices...');

  // 5. Device ranking: aggregate by device, sort descending, take topN
  const deviceAgg = aggregate(filteredReadings, 'device', 'sum');
  deviceAgg.groups.sort((a, b) => b.value - a.value);
  const deviceRanking = deviceAgg.groups.slice(0, topN).map(g => {
    const deviceInfo = devices.find(d => String(d.device_id) === g.key) || {};
    return {
      device_id: g.key,
      device_type: deviceInfo.device_type || deviceInfo.type || 'unknown',
      total: g.value,
      count: g.count,
      temperature: deviceInfo.temperature ?? deviceInfo.temp ?? deviceInfo.set_temp ?? null,
      name: deviceInfo.name || g.key
    };
  });

  postProgress(id, 55, 'Calculating TOU billing...');

  // 6. TOU billing
  const touResult = calculateTOUBilling(filteredReadings, touPricing || null);
  const touTrend = {
    billing: touResult,
    monthlyBreakdown: []
  };
  // Monthly TOU breakdown for trend chart
  const monthlyAgg = aggregate(filteredReadings, 'month', 'sum');
  for (const monthGroup of monthlyAgg.groups) {
    const monthBilling = calculateTOUBilling(monthGroup.items, touPricing || null);
    touTrend.monthlyBreakdown.push({
      month: monthGroup.key,
      ...monthBilling.breakdown,
      totalCost: monthBilling.totalCost,
      totalConsumption: monthBilling.totalConsumption
    });
  }
  touTrend.monthlyBreakdown.sort((a, b) => String(a.month).localeCompare(String(b.month)));

  postProgress(id, 70, 'Computing comparisons...');

  // 7. YoY / MoM comparison
  let yoyMom = {};
  if (stateObj.comparisonMode === 'yoy' || !stateObj.comparisonMode) {
    const latestDate = filteredReadings.length > 0
      ? new Date(Math.max(...filteredReadings.map(r => new Date(r.timestamp).getTime())))
      : new Date();
    yoyMom.yoy = compareYoY(filteredReadings, latestDate.getFullYear());
  }
  if (stateObj.comparisonMode === 'mom' || !stateObj.comparisonMode) {
    const latestDate = filteredReadings.length > 0
      ? new Date(Math.max(...filteredReadings.map(r => new Date(r.timestamp).getTime())))
      : new Date();
    const currentMonthKey = `${latestDate.getFullYear()}-${String(latestDate.getMonth() + 1).padStart(2, '0')}`;
    yoyMom.mom = compareMoM(filteredReadings, currentMonthKey);
  }

  postProgress(id, 80, 'Scoring anomalies...');

  // 8. Anomalies -- detect basic anomalies from device data
  const allValues = filteredReadings.map(r => Number(r.power_consumption) || 0);
  const historicalAvg = allValues.length > 0 ? allValues.reduce((a, b) => a + b, 0) / allValues.length : 0;
  const variance = allValues.length > 0
    ? allValues.reduce((sum, v) => sum + Math.pow(v - historicalAvg, 2), 0) / allValues.length
    : 0;
  const historicalStddev = Math.sqrt(variance);

  // Build raw anomalies from device ranking (devices significantly above average)
  const rawAnomalies = [];
  for (const device of deviceRanking) {
    if (device.total > historicalAvg * deviceRanking.length + 2 * historicalStddev * Math.sqrt(device.count || 1)) {
      rawAnomalies.push({
        type: 'high-consumption',
        severity: device.total > historicalAvg * deviceRanking.length * 2 ? 'high' : 'medium',
        entityId: device.device_id,
        message: `Device ${device.device_id} has unusually high consumption`,
        details: { value: device.total, consumption: device.total, timestamp: null }
      });
    }
  }

  const anomalyContext = {
    historicalAvg: historicalAvg * (deviceRanking.length || 1),
    historicalStddev: historicalStddev * Math.sqrt(deviceRanking.length || 1),
    buildingType: null,
    seasonalBaseline: null
  };
  const anomalies = scoreAnomalies(rawAnomalies, anomalyContext);

  postProgress(id, 90, 'Generating suggestions...');

  // 9. Suggestions
  const buildingAvgPerDevice = deviceRanking.length > 0
    ? deviceRanking.reduce((sum, d) => sum + d.total, 0) / deviceRanking.length
    : 0;

  // Build monthly totals for trend analysis
  const monthlyTotals = monthlyAgg.groups.map(g => ({ month: g.key, value: g.value }));
  monthlyTotals.sort((a, b) => String(a.month).localeCompare(String(b.month)));

  // Detect off-hours usage for lighting rule
  const offHoursUsage = filteredReadings.filter(r => {
    const d = new Date(r.timestamp);
    if (isNaN(d.getTime())) return false;
    return _isWeekend(d) || _isNonBusinessHour(d.getHours());
  });

  const suggestions = generateSuggestions({
    deviceRanking,
    touBreakdown: touResult.breakdown,
    anomalies,
    buildingAvg: buildingAvgPerDevice,
    timePatterns: {
      monthlyTotals,
      offHoursUsage,
      buildings: buildings.map(b => ({
        building_id: b.building_id || b.id,
        name: b.name,
        area: b.area || b.floor_area,
        total: (buildingOverview.groups.find(g => String(g.key) === String(b.building_id || b.id)) || {}).value || 0
      })),
      latestTimestamp: filteredReadings.length > 0
        ? new Date(Math.max(...filteredReadings.map(r => new Date(r.timestamp).getTime()))).toISOString()
        : null
    }
  });

  postProgress(id, 100, 'Analysis complete.');

  postSuccess(id, {
    buildingOverview,
    floorHeatmap,
    deviceRanking,
    touTrend,
    touBilling: touResult,
    yoyMom,
    anomalies,
    suggestions
  });
}

/* ========================================================================
 * MESSAGE DISPATCHER
 * ======================================================================== */

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  const { id, action, payload } = msg;

  if (!id || !action) {
    postError(id || 'unknown', 'Message must include id and action fields.');
    return;
  }

  try {
    switch (action) {
      case 'aggregate': {
        const { data, groupBy, metric } = payload || {};
        const result = aggregate(data, groupBy, metric);
        postSuccess(id, result);
        break;
      }

      case 'aggregate-multi': {
        const { data, groupByList, metric } = payload || {};
        const result = aggregateMulti(data, groupByList, metric);
        postSuccess(id, result);
        break;
      }

      case 'tou-billing': {
        const { readings, touPricing: tp } = payload || {};
        const result = calculateTOUBilling(readings, tp);
        postSuccess(id, result);
        break;
      }

      case 'compare-yoy': {
        const { data, currentYear } = payload || {};
        const result = compareYoY(data, currentYear);
        postSuccess(id, result);
        break;
      }

      case 'compare-mom': {
        const { data, currentMonth } = payload || {};
        const result = compareMoM(data, currentMonth);
        postSuccess(id, result);
        break;
      }

      case 'score-anomalies': {
        const { anomalies: anoms, context } = payload || {};
        const result = scoreAnomalies(anoms, context);
        postSuccess(id, result);
        break;
      }

      case 'suggest': {
        const result = generateSuggestions(payload);
        postSuccess(id, result);
        break;
      }

      case 'full-analysis': {
        runFullAnalysis(id, payload || {});
        break;
      }

      default:
        postError(id, `Unknown action: ${action}`);
    }
  } catch (err) {
    postError(id, err.message || String(err));
  }
};
