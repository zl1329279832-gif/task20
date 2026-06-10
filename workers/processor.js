/* ===== Web Worker - 数据处理引擎 ===== */
/* 在独立线程中运行，处理大数据量的解析、聚合和异常检测 */
/* 修复: 同比/环比使用 filtered 而非原始 readings; 回包携带 sessionVersion/queryId */

self.onmessage = function(e) {
    const { type, taskId, payload, sessionVersion, queryId } = e.data;
    try {
        let result;
        switch (type) {
            case 'aggregate':       result = aggregateData(payload); break;
            case 'detectAnomalies': result = detectAnomalies(payload); break;
            case 'calculateStats':  result = calculateStats(payload); break;
            case 'calculateCarbon':  result = calculateCarbon(payload); break;
            case 'calculateDemand':  result = calculateDemand(payload); break;
            case 'simulateStrategy': result = simulateStrategyWorker(payload); break;
            default: throw new Error('未知任务类型: ' + type);
        }
        self.postMessage({ taskId, result, error: null, sessionVersion, queryId });
    } catch (err) {
        self.postMessage({ taskId, result: null, error: err.message, sessionVersion, queryId });
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

    // ========== 修复: 同比/环比使用 filtered(已筛选数据) ==========
    // 同比 — 基于 filtered
    const now = filter.endDate ? new Date(filter.endDate) : new Date();
    const cy = now.getFullYear();
    const curYear = filtered.filter(r => new Date(r.timestamp).getFullYear() === cy)
                            .reduce((s, r) => s + (Number(r.reading) || 0), 0);
    const prevYear = filtered.filter(r => new Date(r.timestamp).getFullYear() === cy - 1)
                             .reduce((s, r) => s + (Number(r.reading) || 0), 0);
    const yoy = {
        current: curYear, previous: prevYear,
        change: prevYear > 0 ? ((curYear - prevYear) / prevYear * 100) : 0,
        currentYear: cy, previousYear: cy - 1
    };

    // 环比 — 基于 filtered
    const cm = now.getMonth();
    const curMonth = filtered.filter(r => {
        const d = new Date(r.timestamp);
        return d.getFullYear() === cy && d.getMonth() === cm;
    }).reduce((s, r) => s + (Number(r.reading) || 0), 0);

    const pm = new Date(cy, cm - 1, 1);
    const prevMonth = filtered.filter(r => {
        const d = new Date(r.timestamp);
        return d.getFullYear() === pm.getFullYear() && d.getMonth() === pm.getMonth();
    }).reduce((s, r) => s + (Number(r.reading) || 0), 0);

    const mom = {
        current: curMonth, previous: prevMonth,
        change: prevMonth > 0 ? ((curMonth - prevMonth) / prevMonth * 100) : 0,
        currentMonth: cm + 1, previousMonth: pm.getMonth() + 1
    };

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

/* ===== 碳排放计算 (Worker 侧) ===== */
function matchCarbonFactor(hour, region, factors) {
    let m = factors.find(f => Number(f.time_period) === hour && f.region === region);
    if (!m) m = factors.find(f => Number(f.time_period) === hour);
    if (!m && factors.length > 0) return factors.reduce((s, f) => s + (Number(f.emission_factor) || 0), 0) / factors.length;
    return m ? (Number(m.emission_factor) || 0) : 0;
}

function getPeriodKey(date, period) {
    const y = date.getFullYear(), mo = date.getMonth();
    if (period === 'day') return y + '-' + String(mo+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
    if (period === 'quarter') return y + '-Q' + (Math.floor(mo/3)+1);
    if (period === 'year') return String(y);
    return y + '-' + String(mo+1).padStart(2,'0');
}

function calculateCarbon(p) {
    const readings = p.meterReadings || [];
    const carbonFactors = p.carbonFactors || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);
    if (!filtered.length || !carbonFactors.length) return { totalCarbon: 0, byBuilding: {}, byPeriod: [], byHour: [] };

    const byBuilding = {};
    const byPeriodMap = {};
    const byHour = new Array(24).fill(null).map((_, h) => ({ hour: h, carbon: 0, energy: 0, factor: 0, count: 0 }));

    filtered.forEach(r => {
        const ts = new Date(r.timestamp);
        const hour = ts.getHours();
        const energy = Number(r.energy) || 0;
        const factor = matchCarbonFactor(hour, r.region, carbonFactors);
        const carbon = energy * factor;
        const bid = r.building_id || 'unknown';
        byBuilding[bid] = (byBuilding[bid] || 0) + carbon;
        const pk = getPeriodKey(ts, filter.timePeriod || 'month');
        if (!byPeriodMap[pk]) byPeriodMap[pk] = { period: pk, carbon: 0, energy: 0 };
        byPeriodMap[pk].carbon += carbon;
        byPeriodMap[pk].energy += energy;
        byHour[hour].carbon += carbon;
        byHour[hour].energy += energy;
        byHour[hour].factor += factor;
        byHour[hour].count++;
    });
    byHour.forEach(h => { if (h.count > 0) h.factor = h.factor / h.count; });
    return { totalCarbon: Object.values(byBuilding).reduce((s,v)=>s+v,0), byBuilding, byPeriod: Object.values(byPeriodMap).sort((a,b)=>a.period.localeCompare(b.period)), byHour };
}

function applyDemandTiers(peakKw, tiers) {
    const breakdown = [];
    let remaining = peakKw;
    for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i], threshold = Number(t.threshold_kw) || Infinity, price = Number(t.price_per_kw) || 0;
        const prev = i > 0 ? (Number(tiers[i-1].threshold_kw) || 0) : 0;
        const bracket = Math.min(remaining, threshold - prev);
        if (bracket > 0) { breakdown.push({ tier: t.demand_tier, kw: bracket, price, cost: bracket * price }); remaining -= bracket; }
        if (remaining <= 0) break;
    }
    if (remaining > 0 && tiers.length > 0) {
        const lt = tiers[tiers.length-1];
        breakdown.push({ tier: lt.demand_tier+'+', kw: remaining, price: Number(lt.price_per_kw)||0, cost: remaining*(Number(lt.price_per_kw)||0) });
    }
    return breakdown;
}

function calculateDemand(p) {
    const readings = p.meterReadings || [];
    const demandPricing = p.demandPricing || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);
    if (!filtered.length || !demandPricing.length) return { totalDemandCost: 0, byPeriod: [] };

    const sortedTiers = [...demandPricing].sort((a,b) => Number(a.demand_tier) - Number(b.demand_tier));
    const byMonth = {};
    filtered.forEach(r => {
        const ts = new Date(r.timestamp);
        const key = ts.getFullYear() + '-' + String(ts.getMonth()+1).padStart(2,'0');
        if (!byMonth[key]) byMonth[key] = { period: key, readings: [] };
        byMonth[key].readings.push(r);
    });
    let totalDemandCost = 0;
    const byPeriod = [];
    Object.values(byMonth).forEach(md => {
        const dailyPeaks = {};
        md.readings.forEach(r => {
            const day = new Date(r.timestamp).toISOString().slice(0,10);
            const power = Number(r.energy) || 0;
            if (!dailyPeaks[day] || power > dailyPeaks[day]) dailyPeaks[day] = power;
        });
        const peakDemand = Math.max(...Object.values(dailyPeaks), 0);
        const tierBreakdown = applyDemandTiers(peakDemand, sortedTiers);
        const cost = tierBreakdown.reduce((s,t)=>s+t.cost, 0);
        totalDemandCost += cost;
        byPeriod.push({ period: md.period, peakDemand, cost, tierBreakdown });
    });
    byPeriod.sort((a,b) => a.period.localeCompare(b.period));
    return { totalDemandCost, byPeriod };
}

function simulateStrategyWorker(p) {
    const strategy = p.strategy || {};
    const readings = p.meterReadings || [];
    const carbonFactors = p.carbonFactors || [];
    const demandPricing = p.demandPricing || [];
    const shiftableLoads = p.shiftableLoads || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);
    if (!filtered.length) return { shiftedReadings: [], baseline: {}, simulated: {}, delta: {}, shiftDetails: [] };

    const baseCarbon = calculateCarbon({ meterReadings: filtered, carbonFactors, filter: {} });
    const baseDemand = calculateDemand({ meterReadings: filtered, demandPricing, filter: {} });
    const baseTotalE = filtered.reduce((s,r) => s + (Number(r.energy)||0), 0);

    const shifted = filtered.map(r => ({ ...r }));
    const shiftDetails = [];

    (strategy.rules || []).forEach(rule => {
        const fromH = new Set(rule.from_hours || []);
        const toH = rule.to_hours || [];
        const pct = Math.min(1, Math.max(0, Number(rule.shift_percentage) || 0));
        if (!fromH.size || !toH.length || pct === 0) return;
        let totalShifted = 0;
        shifted.forEach(r => {
            if (rule.device_id && rule.device_id !== 'all' && r.meter_id !== rule.device_id && r.device_id !== rule.device_id) return;
            const hour = new Date(r.timestamp).getHours();
            if (!fromH.has(hour)) return;
            const energy = Number(r.energy) || 0;
            const sa = energy * pct;
            r.energy = energy - sa;
            totalShifted += sa;
        });
        const targets = shifted.filter(r => {
            if (rule.device_id && rule.device_id !== 'all' && r.meter_id !== rule.device_id && r.device_id !== rule.device_id) return false;
            return toH.includes(new Date(r.timestamp).getHours());
        });
        if (targets.length > 0) {
            const per = totalShifted / targets.length;
            targets.forEach(r => { r.energy = (Number(r.energy)||0) + per; });
        }
        shiftDetails.push({ rule_id: rule.rule_id, device_id: rule.device_id, fromHours: Array.from(fromH), toHours: toH, shiftedKwh: totalShifted });
    });

    const simCarbon = calculateCarbon({ meterReadings: shifted, carbonFactors, filter: {} });
    const simDemand = calculateDemand({ meterReadings: shifted, demandPricing, filter: {} });
    const simTotalE = shifted.reduce((s,r) => s + (Number(r.energy)||0), 0);

    const baseline = { carbon: baseCarbon.totalCarbon, demandCost: baseDemand.totalDemandCost, totalEnergy: baseTotalE };
    const simulated = { carbon: simCarbon.totalCarbon, demandCost: simDemand.totalDemandCost, totalEnergy: simTotalE };
    const delta = {
        carbonReduction: baseline.carbon - simulated.carbon,
        carbonReductionPct: baseline.carbon > 0 ? ((baseline.carbon - simulated.carbon) / baseline.carbon * 100) : 0,
        costReduction: baseline.demandCost - simulated.demandCost,
        costReductionPct: baseline.demandCost > 0 ? ((baseline.demandCost - simulated.demandCost) / baseline.demandCost * 100) : 0
    };

    const origP = new Array(24).fill(0), shiftP = new Array(24).fill(0);
    const origC = new Array(24).fill(0), shiftC = new Array(24).fill(0);
    filtered.forEach(r => { const h = new Date(r.timestamp).getHours(); origP[h] += Number(r.energy)||0; origC[h]++; });
    shifted.forEach(r => { const h = new Date(r.timestamp).getHours(); shiftP[h] += Number(r.energy)||0; shiftC[h]++; });
    for (let h = 0; h < 24; h++) { if (origC[h]>0) origP[h]/=origC[h]; if (shiftC[h]>0) shiftP[h]/=shiftC[h]; }

    return { shiftedReadings: shifted, baseline, simulated, delta, shiftDetails, carbonDetail: simCarbon, demandDetail: simDemand, loadProfile: { original: origP, shifted: shiftP } };
}
