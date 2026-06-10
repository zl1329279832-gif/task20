/**
 * aggregator.js
 * Aggregation utilities for building energy analysis data.
 * All functions are pure -- no DOM access.
 */

/**
 * Extract a grouping key from a data item.
 * @param {object} item - Data item with device_id, building_id, floor_id, timestamp, etc.
 * @param {string} groupBy - One of 'building','floor','device','hour','day','month','year'.
 * @returns {string} The grouping key.
 */
function extractGroupKey(item, groupBy) {
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
      return d.toISOString().slice(0, 10); // YYYY-MM-DD
    }
    case 'month': {
      const d = new Date(item.timestamp);
      if (isNaN(d.getTime())) return 'invalid';
      return d.toISOString().slice(0, 7); // YYYY-MM
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

/**
 * Compute a metric value from an array of numbers.
 * @param {number[]} values
 * @param {string} metric - 'sum' | 'avg' | 'max' | 'min' | 'count'
 * @returns {number}
 */
function computeMetric(values, metric) {
  if (!values || values.length === 0) {
    return 0;
  }

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

/**
 * Aggregate data by a single dimension.
 * @param {object[]} data - Array of data items.
 * @param {string} groupBy - Grouping dimension.
 * @param {string} metric - Aggregation metric.
 * @returns {{ groups: Array<{ key: string, value: number, count: number, items: object[] }> }}
 */
export function aggregate(data, groupBy, metric) {
  if (!Array.isArray(data) || data.length === 0) {
    return { groups: [] };
  }

  const groupMap = new Map();

  for (const item of data) {
    const key = extractGroupKey(item, groupBy);
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key).push(item);
  }

  const groups = [];
  for (const [key, items] of groupMap) {
    const values = items.map(it => {
      const v = Number(it.power_consumption);
      return isNaN(v) ? 0 : v;
    });
    groups.push({
      key,
      value: computeMetric(values, metric),
      count: items.length,
      items
    });
  }

  return { groups };
}

/**
 * Perform nested (multi-dimensional) aggregation.
 * The first element in groupByList is the outermost grouping,
 * each subsequent element groups within the previous level.
 *
 * @param {object[]} data - Array of data items.
 * @param {string[]} groupByList - Ordered list of grouping dimensions.
 * @param {string} metric - Aggregation metric applied at the leaf level.
 * @returns {{ groups: Array<{ key: string, value: number, count: number, items: object[], children: object }> }}
 */
export function aggregateMulti(data, groupByList, metric) {
  if (!Array.isArray(data) || data.length === 0) {
    return { groups: [] };
  }

  if (!Array.isArray(groupByList) || groupByList.length === 0) {
    // No grouping -- aggregate everything into a single bucket
    const values = data.map(it => {
      const v = Number(it.power_consumption);
      return isNaN(v) ? 0 : v;
    });
    return {
      groups: [{
        key: 'all',
        value: computeMetric(values, metric),
        count: data.length,
        items: data,
        children: null
      }]
    };
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
    return {
      key: group.key,
      value: group.value,
      count: group.count,
      items: group.items,
      children
    };
  });

  return topLevel;
}
