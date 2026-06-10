/**
 * yoy-mom-comparator.js
 * Year-over-Year and Month-over-Month comparison utilities.
 * All functions are pure -- no DOM access.
 */

/**
 * Group data items by month key (YYYY-MM) and sum power_consumption.
 * @param {object[]} data
 * @returns {Map<string, number>} monthKey -> total consumption
 */
function groupByMonth(data) {
  const map = new Map();
  for (const item of data) {
    const d = new Date(item.timestamp);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + (Number(item.power_consumption) || 0));
  }
  return map;
}

/**
 * Group data items by day key (YYYY-MM-DD) and sum power_consumption.
 * @param {object[]} data
 * @returns {Map<string, number>} dayKey -> total consumption
 */
function groupByDay(data) {
  const map = new Map();
  for (const item of data) {
    const d = new Date(item.timestamp);
    if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + (Number(item.power_consumption) || 0));
  }
  return map;
}

/**
 * Determine the trend label from a percent change value.
 * @param {number|null} changePercent
 * @returns {'up'|'down'|'flat'}
 */
function determineTrend(changePercent) {
  if (changePercent === null || !Number.isFinite(changePercent)) return 'flat';
  if (changePercent > 0.5) return 'up';    // >0.5% is considered up
  if (changePercent < -0.5) return 'down';  // <-0.5% is considered down
  return 'flat';
}

/**
 * Build a ComparisonResult object.
 * @param {string} period
 * @param {number|null} current
 * @param {number|null} previous
 * @returns {{ period: string, current: number|null, previous: number|null, change: number|null, changePercent: number|null, trend: 'up'|'down'|'flat' }}
 */
function buildResult(period, current, previous) {
  if (current === null || current === undefined) {
    return {
      period,
      current: null,
      previous: previous ?? null,
      change: null,
      changePercent: null,
      trend: 'flat'
    };
  }

  if (previous === null || previous === undefined) {
    return {
      period,
      current,
      previous: null,
      change: null,
      changePercent: null,
      trend: 'flat'
    };
  }

  const change = current - previous;
  const changePercent = previous !== 0
    ? Math.round((change / previous) * 10000) / 100  // two decimal places
    : (current > 0 ? 100 : 0);

  return {
    period,
    current,
    previous,
    change: Math.round(change * 1000) / 1000,
    changePercent,
    trend: determineTrend(changePercent)
  };
}

/**
 * Compare Year-over-Year: for each month in currentYear, compare with the
 * same month in currentYear - 1.
 *
 * @param {object[]} data - Array of data items with timestamp and power_consumption.
 * @param {number} currentYear - The year to treat as "current" (e.g. 2025).
 * @returns {Array<{ period: string, current: number|null, previous: number|null, change: number|null, changePercent: number|null, trend: 'up'|'down'|'flat' }>}
 */
export function compareYoY(data, currentYear) {
  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }

  const year = Number(currentYear);
  if (!Number.isFinite(year)) return [];

  const monthTotals = groupByMonth(data);
  const previousYear = year - 1;
  const results = [];

  for (let m = 1; m <= 12; m++) {
    const monthStr = String(m).padStart(2, '0');
    const currentKey = `${year}-${monthStr}`;
    const previousKey = `${previousYear}-${monthStr}`;

    const currentVal = monthTotals.has(currentKey) ? monthTotals.get(currentKey) : null;
    const previousVal = monthTotals.has(previousKey) ? monthTotals.get(previousKey) : null;

    // Only include months that have at least one data point
    if (currentVal !== null || previousVal !== null) {
      results.push(buildResult(`${year}/${monthStr}`, currentVal, previousVal));
    }
  }

  return results;
}

/**
 * Compare Month-over-Month: compare currentMonth with the immediately
 * preceding month. Groups data by day within each month for granularity.
 *
 * @param {object[]} data - Array of data items with timestamp and power_consumption.
 * @param {string} currentMonth - Month in 'YYYY-MM' format (e.g. '2025-06').
 * @returns {Array<{ period: string, current: number|null, previous: number|null, change: number|null, changePercent: number|null, trend: 'up'|'down'|'flat' }>}
 */
export function compareMoM(data, currentMonth) {
  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }

  if (!currentMonth || typeof currentMonth !== 'string') return [];

  const [yearStr, monthStr] = currentMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return [];
  }

  // Determine previous month
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear = year - 1;
  }
  const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  const monthTotals = groupByMonth(data);
  const currentVal = monthTotals.has(currentMonth) ? monthTotals.get(currentMonth) : null;
  const previousVal = monthTotals.has(prevMonthKey) ? monthTotals.get(prevMonthKey) : null;

  // Build an overall comparison result
  const overallResult = buildResult(
    `${currentMonth} vs ${prevMonthKey}`,
    currentVal,
    previousVal
  );

  // Also provide daily breakdown within the current month for charting
  const dayTotals = groupByDay(data);
  const daysInCurrentMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();

  const dailyResults = [];
  const maxDays = Math.max(daysInCurrentMonth, daysInPrevMonth);

  for (let d = 1; d <= maxDays; d++) {
    const dayStr = String(d).padStart(2, '0');
    const currentDayKey = `${currentMonth}-${dayStr}`;
    const prevDayKey = `${prevMonthKey}-${dayStr}`;

    const curDayVal = dayTotals.has(currentDayKey) ? dayTotals.get(currentDayKey) : null;
    const prevDayVal = dayTotals.has(prevDayKey) ? dayTotals.get(prevDayKey) : null;

    if (curDayVal !== null || prevDayVal !== null) {
      dailyResults.push(buildResult(`Day ${d}`, curDayVal, prevDayVal));
    }
  }

  return [overallResult, ...dailyResults];
}
