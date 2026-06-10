/* ===== Web Worker - 数据处理引擎 ===== */
/* 在独立线程中运行，处理大数据量的解析、聚合和异常检测 */
/* 修复: 同比/环比使用 filtered 而非原始 readings; 回包携带 sessionVersion/queryId */

self.onmessage = function(e) {
    const { type, taskId, payload, sessionVersion, queryId } = e.data;
    try {
        let result;
        switch (type) {
            case 'aggregate':            result = aggregateData(payload); break;
            case 'detectAnomalies':      result = detectAnomalies(payload); break;
            case 'calculateStats':       result = calculateStats(payload); break;
            case 'calculateCarbon':      result = calculateCarbon(payload); break;
            case 'calculateDemandCost':  result = calculateDemandCost(payload); break;
            case 'calculateTransferable':result = calculateTransferableLoad(payload); break;
            case 'evaluateStrategy':     result = evaluateStrategy(payload); break;
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

/* ===== 碳排放核算 ===== */
function calculateCarbon(p) {
    const readings = p.meterReadings || [];
    const carbonFactors = p.carbonFactors || [];
    const pricing = p.pricing || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);

    let totalCarbon = 0, totalEnergy = 0;
    const byBuilding = {}, byPeriodType = { sharp_peak: 0, peak: 0, flat: 0, valley: 0 }, byMonth = {}, byDevice = {};

    filtered.forEach(r => {
        const energy = Number(r.energy) || Number(r.reading) || 0;
        const bid = r.building_id || 'unknown';
        const pt = r.period_type || _guessPeriodType(r.timestamp, pricing);
        const factor = _getCarbonFactor(carbonFactors, bid, pt);
        const carbon = energy * factor;

        totalCarbon += carbon;
        totalEnergy += energy;
        byBuilding[bid] = (byBuilding[bid] || 0) + carbon;
        if (byPeriodType[pt] !== undefined) byPeriodType[pt] += carbon;

        const d = new Date(r.timestamp);
        const mk = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        if (!byMonth[mk]) byMonth[mk] = { month: mk, carbon: 0, energy: 0 };
        byMonth[mk].carbon += carbon;
        byMonth[mk].energy += energy;

        byDevice[r.meter_id] = (byDevice[r.meter_id] || 0) + carbon;
    });

    const byMonthArr = Object.values(byMonth).sort((a,b) => a.month.localeCompare(b.month));
    byMonthArr.forEach(m => { m.intensity = m.energy > 0 ? m.carbon / m.energy : 0; });

    const byDeviceArr = Object.entries(byDevice).map(([mid, carbon]) => ({ meter_id: mid, carbon })).sort((a,b) => b.carbon - a.carbon).slice(0, 15);
    const byBuildingArr = Object.entries(byBuilding).map(([bid, carbon]) => ({ building_id: bid, carbon })).sort((a,b) => b.carbon - a.carbon);

    return { totalCarbon, totalEnergy, intensity: totalEnergy > 0 ? totalCarbon / totalEnergy : 0, byBuilding: byBuildingArr, byPeriodType, byMonth: byMonthArr, byDevice: byDeviceArr };
}

/* ===== 需量成本计算 ===== */
function calculateDemandCost(p) {
    const readings = p.meterReadings || [];
    const demandPricing = p.demandPricing || [];
    const pricing = p.pricing || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);

    const dp = demandPricing.length > 0 ? demandPricing[0] : { rate_per_kw: 45, threshold_kw: 0, billing_period: 'month' };
    const ratePerKw = Number(dp.rate_per_kw) || 45;
    const thresholdKw = Number(dp.threshold_kw) || 0;

    const byBuildingMonth = {};
    filtered.forEach(r => {
        const bid = r.building_id || 'unknown';
        const d = new Date(r.timestamp);
        const mk = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        const key = bid + '|' + mk;
        if (!byBuildingMonth[key]) byBuildingMonth[key] = { building_id: bid, month: mk, energy: 0, hours: new Set() };
        const energy = Number(r.energy) || Number(r.reading) || 0;
        byBuildingMonth[key].energy += energy;
        byBuildingMonth[key].hours.add(d.toISOString().substring(0, 13));
    });

    let totalDemandCost = 0;
    const byBuilding = {}, peakDemandByMonth = {};

    Object.values(byBuildingMonth).forEach(bm => {
        const hours = bm.hours.size || 1;
        const peakKw = bm.energy / hours;
        const cost = peakKw >= thresholdKw ? peakKw * ratePerKw : 0;
        totalDemandCost += cost;

        if (!byBuilding[bm.building_id]) byBuilding[bm.building_id] = { building_id: bm.building_id, totalCost: 0, peakKw: 0, months: [] };
        byBuilding[bm.building_id].totalCost += cost;
        byBuilding[bm.building_id].peakKw = Math.max(byBuilding[bm.building_id].peakKw, peakKw);
        byBuilding[bm.building_id].months.push({ month: bm.month, peakKw, cost });

        if (!peakDemandByMonth[bm.month]) peakDemandByMonth[bm.month] = { month: bm.month, peakKw: 0, cost: 0 };
        peakDemandByMonth[bm.month].peakKw += peakKw;
        peakDemandByMonth[bm.month].cost += cost;
    });

    return {
        totalDemandCost,
        byBuilding: Object.values(byBuilding).sort((a,b) => b.totalCost - a.totalCost),
        peakDemandByMonth: Object.values(peakDemandByMonth).sort((a,b) => a.month.localeCompare(b.month)),
        ratePerKw, thresholdKw
    };
}

/* ===== 可转移负荷计算 ===== */
function calculateTransferableLoad(p) {
    const readings = p.meterReadings || [];
    const migratableLoads = p.migratableLoads || [];
    const pricing = p.pricing || [];
    const filter = p.filter || {};
    const filtered = filterReadings(readings, filter);

    let totalTransferable = 0, totalTransferred = 0, totalCostSavings = 0;
    const byLoad = [];

    migratableLoads.forEach(load => {
        const fromReadings = filtered.filter(r =>
            (!load.building_id || load.building_id === 'all' || r.building_id === load.building_id) &&
            (r.period_type || _guessPeriodType(r.timestamp, pricing)) === load.from_period
        );
        const availableKwh = fromReadings.reduce((s, r) => s + (Number(r.energy) || Number(r.reading) || 0), 0);
        const maxCap = Number(load.max_capacity_kwh) || 0;
        const efficiency = Number(load.shift_efficiency) || 0.95;
        const days = new Set(fromReadings.map(r => new Date(r.timestamp).toDateString())).size || 1;
        const transferable = Math.min(availableKwh * 0.3, maxCap * days);
        const transferred = transferable * efficiency;

        const fromPrice = _getPriceFromPricing(pricing, load.from_period);
        const toPrice = _getPriceFromPricing(pricing, load.to_period);
        const savings = transferable * fromPrice - transferred * toPrice;

        totalTransferable += transferable;
        totalTransferred += transferred;
        totalCostSavings += savings;

        byLoad.push({
            load_id: load.load_id, building_id: load.building_id,
            device_type: load.device_type, from_period: load.from_period, to_period: load.to_period,
            availableKwh, transferable, transferred, efficiency, savings
        });
    });

    return { totalTransferable, totalTransferred, totalCostSavings, byLoad };
}

/* ===== 策略评估 ===== */
function evaluateStrategy(p) {
    const readings = p.meterReadings || [];
    const carbonFactors = p.carbonFactors || [];
    const demandPricing = p.demandPricing || [];
    const migratableLoads = p.migratableLoads || [];
    const pricing = p.pricing || [];
    const filter = p.filter || {};
    const params = p.strategyParams || {};

    const filtered = filterReadings(readings, filter);
    const loadShiftPct = Number(params.load_shift_pct) || 0;
    const demandReductionPct = Number(params.demand_reduction_pct) || 0;
    const deviceEfficiencyGain = Number(params.device_efficiency_gain) || 0;
    const weekendShutdownPct = Number(params.weekend_shutdown_pct) || 0;

    /* 基线计算 */
    const baselineCarbon = calculateCarbon({ meterReadings: readings, carbonFactors, pricing, filter });
    const baselineDemand = calculateDemandCost({ meterReadings: readings, demandPricing, pricing, filter });
    const baselineTransfer = calculateTransferableLoad({ meterReadings: readings, migratableLoads, pricing, filter });

    const baseline = {
        totalEnergy: baselineCarbon.totalEnergy,
        totalCost: filtered.reduce((s, r) => s + (Number(r.cost) || 0), 0),
        totalCarbon: baselineCarbon.totalCarbon,
        peakDemand: baselineDemand.byBuilding.reduce((s, b) => s + b.peakKw, 0),
        demandCost: baselineDemand.totalDemandCost
    };

    /* 模拟调整后的读数 */
    const adjusted = filtered.map(r => {
        const clone = Object.assign({}, r);
        let energy = Number(clone.energy) || Number(clone.reading) || 0;
        const pt = clone.period_type || _guessPeriodType(clone.timestamp, pricing);
        const dow = new Date(clone.timestamp).getDay();
        const isWeekend = dow === 0 || dow === 6;

        // 负荷转移: 从尖峰/峰时段移出
        if (loadShiftPct > 0 && (pt === 'sharp_peak' || pt === 'peak')) {
            energy *= (1 - loadShiftPct);
        }
        // 设备效率提升
        if (deviceEfficiencyGain > 0) {
            energy *= (1 - deviceEfficiencyGain);
        }
        // 周末关停
        if (weekendShutdownPct > 0 && isWeekend) {
            energy *= (1 - weekendShutdownPct);
        }

        clone.energy = energy;
        clone.reading = energy;
        clone.cost = energy * _getPriceFromPricing(pricing, pt);
        return clone;
    });

    /* 投影计算 */
    const projectedCarbon = calculateCarbon({ meterReadings: adjusted, carbonFactors, pricing, filter: {} });
    let projectedCost = adjusted.reduce((s, r) => s + (Number(r.cost) || 0), 0);

    // 需量降低
    const projectedDemandBase = baseline.peakDemand * (1 - demandReductionPct);
    const dp = demandPricing.length > 0 ? demandPricing[0] : { rate_per_kw: 45 };
    const projectedDemandCost = projectedDemandBase * (Number(dp.rate_per_kw) || 45);
    projectedCost += projectedDemandCost;

    // 负荷转移节省
    const shiftSavings = baselineTransfer.totalCostSavings * loadShiftPct;
    projectedCost -= shiftSavings;

    const projected = {
        totalEnergy: projectedCarbon.totalEnergy,
        totalCost: projectedCost,
        totalCarbon: projectedCarbon.totalCarbon,
        peakDemand: projectedDemandBase,
        demandCost: projectedDemandCost
    };

    const savings = {
        energy: baseline.totalEnergy - projected.totalEnergy,
        cost: baseline.totalCost - projected.totalCost,
        carbon: baseline.totalCarbon - projected.totalCarbon,
        demandCost: baseline.demandCost - projected.demandCost
    };

    const reductionPct = baseline.totalCarbon > 0 ? (savings.carbon / baseline.totalCarbon * 100) : 0;

    /* 月度投影 */
    const monthlyProjection = (baselineCarbon.byMonth || []).map(bm => {
        const pm = (projectedCarbon.byMonth || []).find(m => m.month === bm.month);
        return {
            month: bm.month,
            baselineCarbon: bm.carbon, baselineEnergy: bm.energy,
            projectedCarbon: pm ? pm.carbon : 0, projectedEnergy: pm ? pm.energy : 0,
            carbonSaved: bm.carbon - (pm ? pm.carbon : 0)
        };
    });

    return { baseline, projected, savings, reductionPct, monthlyProjection, strategyParams: params };
}

/* ===== 辅助函数 ===== */
function _getCarbonFactor(factors, buildingId, periodType) {
    if (!factors || !factors.length) return 0.583;
    const specific = factors.find(f => f.building_id === buildingId && f.period_type === periodType);
    if (specific) return Number(specific.factor) || 0.583;
    const global = factors.find(f => (f.building_id === 'all' || !f.building_id) && f.period_type === periodType);
    if (global) return Number(global.factor) || 0.583;
    const any = factors.find(f => f.building_id === buildingId);
    if (any) return Number(any.factor) || 0.583;
    return 0.583;
}

function _getPriceFromPricing(pricing, periodType) {
    if (!pricing || !pricing.length) return 0.65;
    const match = pricing.find(p => p.period_type === periodType);
    return match ? Number(match.price) || 0.65 : 0.65;
}

function _guessPeriodType(timestamp, pricing) {
    if (!pricing || !pricing.length) return 'flat';
    const d = new Date(timestamp);
    const mins = d.getHours() * 60 + d.getMinutes();
    for (const p of pricing) {
        const sh = parseInt(String(p.start_time).split(':')[0]) || 0;
        const sm = parseInt(String(p.start_time).split(':')[1]) || 0;
        const eh = parseInt(String(p.end_time).split(':')[0]) || 0;
        const em = parseInt(String(p.end_time).split(':')[1]) || 0;
        const start = sh * 60 + sm, end = eh * 60 + em;
        if (end > start) { if (mins >= start && mins < end) return p.period_type || 'flat'; }
        else { if (mins >= start || mins < end) return p.period_type || 'flat'; }
    }
    return 'flat';
}
