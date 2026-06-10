/* ===== Web Worker - 数据处理引擎 ===== */
/* 在独立线程中运行，处理大数据量的解析、聚合和异常检测 */

self.onmessage = function(e) {
    const { type, taskId, payload } = e.data;
    try {
        let result;
        switch (type) {
            case 'aggregate':       result = aggregateData(payload); break;
            case 'detectAnomalies': result = detectAnomalies(payload); break;
            case 'calculateStats':  result = calculateStats(payload); break;
            default: throw new Error('未知任务类型: ' + type);
        }
        self.postMessage({ taskId, result, error: null });
    } catch (err) {
        self.postMessage({ taskId, result: null, error: err.message });
    }
};

function aggregateData(p) {
    const readings = p.meterReadings || [];
    const pricing = p.pricing || [];
    const floors = p.floors || [];
    const devices = p.devices || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);

    // 楼栋聚合
    const buildingTotals = {};
    filtered.forEach(r => {
        const bid = r.building_id || 'unknown';
        buildingTotals[bid] = (buildingTotals[bid] || 0) + (Number(r.reading) || 0);
    });

    // 楼层热力图
    const d2f = new Map();
    devices.forEach(d => { if (d.meter_id && d.floor_id) d2f.set(d.meter_id, d.floor_id); });
    const floorMap = {};
    floors.forEach(f => { floorMap[f.floor_id] = { floor_id: f.floor_id, floor_name: f.floor_name || ('F' + f.floor_number), building_id: f.building_id, energy: 0 }; });
    filtered.forEach(r => { const fid = d2f.get(r.meter_id); if (fid && floorMap[fid]) floorMap[fid].energy += Number(r.reading) || 0; });
    const floorHeatmap = Object.values(floorMap);

    // 设备排行
    const meterTotals = {};
    filtered.forEach(r => { meterTotals[r.meter_id] = (meterTotals[r.meter_id] || 0) + (Number(r.reading) || 0); });
    const devMap = new Map();
    devices.forEach(d => { if (d.meter_id) devMap.set(d.meter_id, d); });
    const deviceRanking = Object.entries(meterTotals).map(([mid, energy]) => {
        const d = devMap.get(mid);
        return { meter_id: mid, device_name: d ? d.device_name : mid, device_type: d ? d.device_type : '', energy };
    }).sort((a, b) => b.energy - a.energy).slice(0, 15);

    // 时间趋势
    const period = filter.timePeriod || 'month';
    const byPeriod = {};
    filtered.forEach(r => {
        const d = new Date(r.timestamp);
        let key;
        if (period === 'day') key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        else if (period === 'quarter') key = d.getFullYear() + '-Q' + (Math.floor(d.getMonth()/3)+1);
        else if (period === 'year') key = String(d.getFullYear());
        else key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');

        if (!byPeriod[key]) byPeriod[key] = { period: key, energy: 0, cost: 0, sharp_peak: 0, peak: 0, flat: 0, valley: 0 };
        const energy = Number(r.reading) || 0;
        byPeriod[key].energy += energy;
        byPeriod[key].cost += Number(r.cost) || 0;
        const pt = r.period_type || 'flat';
        if (byPeriod[key][pt] !== undefined) byPeriod[key][pt] += energy;
    });
    const timeTrend = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period));

    // 同比
    const now = filter.endDate ? new Date(filter.endDate) : new Date();
    const cy = now.getFullYear();
    const curYear = readings.filter(r => new Date(r.timestamp).getFullYear() === cy).reduce((s, r) => s + (Number(r.reading) || 0), 0);
    const prevYear = readings.filter(r => new Date(r.timestamp).getFullYear() === cy - 1).reduce((s, r) => s + (Number(r.reading) || 0), 0);
    const yoy = { current: curYear, previous: prevYear, change: prevYear > 0 ? ((curYear - prevYear) / prevYear * 100) : 0, currentYear: cy, previousYear: cy - 1 };

    // 环比
    const cm = now.getMonth();
    const curMonth = readings.filter(r => { const d = new Date(r.timestamp); return d.getFullYear() === cy && d.getMonth() === cm; }).reduce((s, r) => s + (Number(r.reading) || 0), 0);
    const pm = new Date(cy, cm - 1, 1);
    const prevMonth = readings.filter(r => { const d = new Date(r.timestamp); return d.getFullYear() === pm.getFullYear() && d.getMonth() === pm.getMonth(); }).reduce((s, r) => s + (Number(r.reading) || 0), 0);
    const mom = { current: curMonth, previous: prevMonth, change: prevMonth > 0 ? ((curMonth - prevMonth) / prevMonth * 100) : 0, currentMonth: cm + 1, previousMonth: pm.getMonth() + 1 };

    return { buildingTotals, floorHeatmap, deviceRanking, timeTrend, yoy, mom };
}

function detectAnomalies(p) {
    const readings = p.meterReadings || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);
    const anomalies = [];
    const byMeter = new Map();
    filtered.forEach(r => { if (!byMeter.has(r.meter_id)) byMeter.set(r.meter_id, []); byMeter.get(r.meter_id).push(r); });

    byMeter.forEach((meterReadings, meterId) => {
        const sorted = meterReadings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const diffs = [];
        for (let i = 1; i < sorted.length; i++) {
            const d = (Number(sorted[i].reading) || 0) - (Number(sorted[i-1].reading) || 0);
            if (d > 0) diffs.push(d);
        }
        if (diffs.length < 3) return;
        const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const std = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length);
        const threshold = mean + 2.5 * std;
        for (let i = 1; i < sorted.length; i++) {
            const d = (Number(sorted[i].reading) || 0) - (Number(sorted[i-1].reading) || 0);
            if (d > threshold && d > mean * 3) {
                const timeDiff = new Date(sorted[i].timestamp) - new Date(sorted[i-1].timestamp);
                if (timeDiff > 12 * 3600 * 1000 && d < mean * 10) continue;
                anomalies.push({ meter_id: meterId, timestamp: sorted[i].timestamp, energy: d, expected: mean, deviation: (d - mean) / (std || 1), severity: d > mean * 5 ? 'error' : 'warning' });
            }
        }
    });
    return { anomalies: anomalies.sort((a, b) => b.deviation - a.deviation) };
}

function calculateStats(p) {
    const readings = p.meterReadings || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);
    const totalEnergy = filtered.reduce((s, r) => s + (Number(r.reading) || 0), 0);
    const totalCost = filtered.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    return { totalEnergy, totalCost };
}

function filterReadings(readings, filter) {
    if (!readings) return [];
    let f = readings;
    if (filter.buildingId && filter.buildingId !== 'all') f = f.filter(r => r.building_id === filter.buildingId);
    if (filter.startDate) { const s = new Date(filter.startDate); f = f.filter(r => new Date(r.timestamp) >= s); }
    if (filter.endDate) { const e = new Date(filter.endDate); e.setHours(23,59,59,999); f = f.filter(r => new Date(r.timestamp) <= e); }
    if (filter.energyType && filter.energyType !== 'all') f = f.filter(r => (r.energy_type || 'electricity') === filter.energyType);
    return f;
}
