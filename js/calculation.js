/* ===== 计算引擎模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Calculation = {
    getOverview(meterReadings, pricing, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        let totalEnergy = 0, totalCost = 0;
        const byType = {}, byBuilding = {}, byMonth = {};
        filtered.forEach(r => {
            const energy = Number(r.reading) || 0;
            const cost = this._calcCost(r, pricing);
            totalEnergy += energy;
            totalCost += cost;
            const type = r.energy_type || 'electricity';
            byType[type] = (byType[type] || 0) + energy;
            const bid = r.building_id || 'unknown';
            byBuilding[bid] = (byBuilding[bid] || 0) + energy;
            const mk = EnergyApp.utils.getMonthKey(r.timestamp);
            if (!byMonth[mk]) byMonth[mk] = { energy: 0, cost: 0 };
            byMonth[mk].energy += energy;
            byMonth[mk].cost += cost;
        });
        return { totalEnergy, totalCost, byType, byBuilding, byMonth: this._sortObj(byMonth) };
    },

    getTimeTrend(meterReadings, pricing, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        const period = filter.timePeriod || 'month';
        const byPeriod = {};
        filtered.forEach(r => {
            const d = new Date(r.timestamp);
            let key;
            switch (period) {
                case 'day': key = EnergyApp.utils.formatDate(d); break;
                case 'month': key = EnergyApp.utils.getMonthKey(d); break;
                case 'quarter': key = EnergyApp.utils.getQuarterKey(d); break;
                case 'year': key = EnergyApp.utils.getYearKey(d); break;
                default: key = EnergyApp.utils.getMonthKey(d);
            }
            if (!byPeriod[key]) byPeriod[key] = { period: key, energy: 0, cost: 0, sharp_peak: 0, peak: 0, flat: 0, valley: 0 };
            const energy = Number(r.reading) || 0;
            const pt = this._getPeriodType(r.timestamp, pricing);
            byPeriod[key].energy += energy;
            byPeriod[key].cost += this._calcCost(r, pricing);
            byPeriod[key][pt] = (byPeriod[key][pt] || 0) + energy;
        });
        return this._sortObj(byPeriod);
    },

    getYoY(meterReadings, filter) {
        /* 修复: 同比必须先按 buildingId/energyType 等筛选, 与 processor.js 保持一致 */
        const filtered = this._filterReadings(meterReadings, filter);
        const now = filter.endDate ? new Date(filter.endDate) : new Date();
        const cy = now.getFullYear();
        const current = filtered.filter(r => new Date(r.timestamp).getFullYear() === cy)
                                .reduce((s, r) => s + (Number(r.reading) || 0), 0);
        const previous = filtered.filter(r => new Date(r.timestamp).getFullYear() === cy - 1)
                                 .reduce((s, r) => s + (Number(r.reading) || 0), 0);
        return { current, previous, change: previous > 0 ? ((current - previous) / previous * 100) : 0, currentYear: cy, previousYear: cy - 1 };
    },

    getMoM(meterReadings, filter) {
        /* 修复: 环比必须先按 buildingId/energyType 等筛选, 与 processor.js 保持一致 */
        const filtered = this._filterReadings(meterReadings, filter);
        const now = filter.endDate ? new Date(filter.endDate) : new Date();
        const cm = now.getMonth(), cy = now.getFullYear();
        const current = filtered.filter(r => { const d = new Date(r.timestamp); return d.getFullYear() === cy && d.getMonth() === cm; })
                                .reduce((s, r) => s + (Number(r.reading) || 0), 0);
        const pd = new Date(cy, cm - 1, 1);
        const previous = filtered.filter(r => { const d = new Date(r.timestamp); return d.getFullYear() === pd.getFullYear() && d.getMonth() === pd.getMonth(); })
                                 .reduce((s, r) => s + (Number(r.reading) || 0), 0);
        return { current, previous, change: previous > 0 ? ((current - previous) / previous * 100) : 0, currentMonth: cm + 1, previousMonth: pd.getMonth() + 1 };
    },

    getByBuilding(meterReadings, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        const totals = {};
        filtered.forEach(r => { const bid = r.building_id || 'unknown'; totals[bid] = (totals[bid] || 0) + (Number(r.reading) || 0); });
        return Object.entries(totals).map(([id, energy]) => ({ building_id: id, energy })).sort((a, b) => b.energy - a.energy);
    },

    getFloorHeatmap(meterReadings, floors, devices, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        const deviceToFloor = new Map();
        devices.forEach(d => { if (d.meter_id && d.floor_id) deviceToFloor.set(d.meter_id, d.floor_id); });
        const byFloor = {};
        (floors || []).forEach(f => { byFloor[f.floor_id] = { floor_id: f.floor_id, floor_name: f.floor_name || `F${f.floor_number}`, building_id: f.building_id, energy: 0 }; });
        filtered.forEach(r => { const fid = deviceToFloor.get(r.meter_id); if (fid && byFloor[fid]) byFloor[fid].energy += Number(r.reading) || 0; });
        const values = Object.values(byFloor);
        const max = Math.max(...values.map(v => v.energy), 1);
        values.forEach(v => { v.intensity = v.energy / max; });
        return values.sort((a, b) => String(a.floor_name).localeCompare(String(b.floor_name)));
    },

    getDeviceRanking(meterReadings, devices, filter, limit = 15) {
        const filtered = this._filterReadings(meterReadings, filter);
        const byMeter = {};
        filtered.forEach(r => { byMeter[r.meter_id] = (byMeter[r.meter_id] || 0) + (Number(r.reading) || 0); });
        const meterDev = new Map();
        (devices || []).forEach(d => { if (d.meter_id) meterDev.set(d.meter_id, d); });
        return Object.entries(byMeter)
            .map(([meterId, energy]) => { const dev = meterDev.get(meterId); return { meter_id: meterId, device_name: dev ? dev.device_name : meterId, device_type: dev ? dev.device_type : '', energy }; })
            .sort((a, b) => b.energy - a.energy).slice(0, limit);
    },

    detectAnomalies(meterReadings, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        const anomalies = [];
        EnergyApp.utils.groupBy(filtered, r => r.meter_id).forEach((readings, meterId) => {
            const sorted = [...readings].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const diffs = [];
            for (let i = 1; i < sorted.length; i++) { const d = (Number(sorted[i].reading) || 0) - (Number(sorted[i-1].reading) || 0); if (d > 0) diffs.push(d); }
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
        return anomalies.sort((a, b) => b.deviation - a.deviation);
    },

    getRecommendations(meterReadings, pricing, filter) {
        const recs = [];
        const filtered = this._filterReadings(meterReadings, filter);
        if (!filtered.length) return recs;
        let peakEnergy = 0, totalEnergy = 0;
        filtered.forEach(r => { const e = Number(r.reading) || 0; totalEnergy += e; const pt = this._getPeriodType(r.timestamp, pricing); if (pt === 'sharp_peak' || pt === 'peak') peakEnergy += e; });
        if (totalEnergy > 0 && peakEnergy / totalEnergy > 0.4) {
            const peakP = this._getPrice(pricing, 'sharp_peak') || this._getPrice(pricing, 'peak');
            const valleyP = this._getPrice(pricing, 'valley');
            recs.push({ title: '优化用电时段分布', description: `尖峰时段用电占比 ${(peakEnergy/totalEnergy*100).toFixed(1)}%，建议将可转移负荷移至谷时段`, saving: (peakEnergy * 0.2 * (peakP - valleyP)).toFixed(2), priority: 'high' });
        }
        let weE = 0, weC = 0, wdE = 0, wdC = 0;
        filtered.forEach(r => { const dow = new Date(r.timestamp).getDay(); const e = Number(r.reading) || 0; if (dow === 0 || dow === 6) { weE += e; weC++; } else { wdE += e; wdC++; } });
        if (weC > 0 && wdC > 0 && (weE/weC) > (wdE/wdC) * 0.6) {
            recs.push({ title: '降低周末待机能耗', description: `周末日均用电为工作日的 ${((weE/weC)/(wdE/wdC)*100).toFixed(0)}%，建议关闭非必要设备`, saving: ((weE/weC - wdE/wdC * 0.3) * weC * 0.65).toFixed(2), priority: 'medium' });
        }
        const yoy = this.getYoY(meterReadings, filter);
        if (yoy.change > 10) recs.push({ title: '用电量同比增长显著', description: `同比增长 ${yoy.change.toFixed(1)}%，建议排查设备老化或新增负荷`, saving: ((yoy.current - yoy.previous) * 0.3).toFixed(0), priority: 'high' });
        const ranking = this.getDeviceRanking(meterReadings, [], filter, 5);
        if (ranking.length > 0 && totalEnergy > 0) { const top5 = ranking.reduce((s, d) => s + d.energy, 0); if (top5 / totalEnergy > 0.6) recs.push({ title: '关注高耗能设备', description: `前5台设备占总用电 ${(top5/totalEnergy*100).toFixed(0)}%，建议重点监控`, saving: (top5 * 0.05).toFixed(0), priority: 'medium' }); }
        return recs;
    },

    aggregate(payload) {
        const { meterReadings, pricing, floors, devices, filter } = payload;
        return {
            buildingTotals: this.getByBuilding(meterReadings, filter),
            floorHeatmap: this.getFloorHeatmap(meterReadings, floors, devices, filter),
            deviceRanking: this.getDeviceRanking(meterReadings, devices, filter),
            timeTrend: this.getTimeTrend(meterReadings, pricing, filter),
            yoy: this.getYoY(meterReadings, filter),
            mom: this.getMoM(meterReadings, filter)
        };
    },

    _filterReadings(readings, filter) {
        if (!readings) return [];
        let f = readings;
        if (filter.buildingId && filter.buildingId !== 'all') f = f.filter(r => r.building_id === filter.buildingId);
        if (filter.startDate) { const s = new Date(filter.startDate); f = f.filter(r => new Date(r.timestamp) >= s); }
        if (filter.endDate) { const e = new Date(filter.endDate); e.setHours(23,59,59,999); f = f.filter(r => new Date(r.timestamp) <= e); }
        if (filter.energyType && filter.energyType !== 'all') f = f.filter(r => (r.energy_type || 'electricity') === filter.energyType);
        return f;
    },

    _getPeriodType(timestamp, pricing) {
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
    },

    _calcCost(reading, pricing) {
        if (reading.cost) return Number(reading.cost) || 0;
        const pt = this._getPeriodType(reading.timestamp, pricing);
        return (Number(reading.reading) || 0) * this._getPrice(pricing, pt);
    },

    _getPrice(pricing, periodType) {
        if (!pricing || !pricing.length) return 0.65;
        const match = pricing.find(p => p.period_type === periodType);
        return match ? Number(match.price) || 0.65 : 0.65;
    },

    _sumByYear(readings, year) { return readings.filter(r => new Date(r.timestamp).getFullYear() === year).reduce((s, r) => s + (Number(r.reading) || 0), 0); },
    _sumByMonth(readings, year, month) { return readings.filter(r => { const d = new Date(r.timestamp); return d.getFullYear() === year && d.getMonth() === month; }).reduce((s, r) => s + (Number(r.reading) || 0), 0); },
    _sortObj(obj) { return Object.entries(obj).sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v); },

    /* ===== 碳排放核算 ===== */
    calculateCarbon(meterReadings, carbonFactors, pricing, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        let totalCarbon = 0, totalEnergy = 0;
        const byBuilding = {}, byPeriodType = { sharp_peak: 0, peak: 0, flat: 0, valley: 0 }, byMonth = {}, byDevice = {};

        filtered.forEach(r => {
            const energy = Number(r.energy) || Number(r.reading) || 0;
            const bid = r.building_id || 'unknown';
            const pt = r.period_type || this._getPeriodType(r.timestamp, pricing);
            const factor = this._getCarbonFactor(carbonFactors, bid, pt);
            const carbon = energy * factor;

            totalCarbon += carbon;
            totalEnergy += energy;
            byBuilding[bid] = (byBuilding[bid] || 0) + carbon;
            if (byPeriodType[pt] !== undefined) byPeriodType[pt] += carbon;

            const mk = EnergyApp.utils.getMonthKey(r.timestamp);
            if (!byMonth[mk]) byMonth[mk] = { month: mk, carbon: 0, energy: 0 };
            byMonth[mk].carbon += carbon;
            byMonth[mk].energy += energy;

            byDevice[r.meter_id] = (byDevice[r.meter_id] || 0) + carbon;
        });

        const byMonthArr = this._sortObj(byMonth);
        byMonthArr.forEach(m => { m.intensity = m.energy > 0 ? m.carbon / m.energy : 0; });
        const byDeviceArr = Object.entries(byDevice).map(([mid, carbon]) => ({ meter_id: mid, carbon })).sort((a,b) => b.carbon - a.carbon).slice(0, 15);
        const byBuildingArr = Object.entries(byBuilding).map(([bid, carbon]) => ({ building_id: bid, carbon })).sort((a,b) => b.carbon - a.carbon);

        return { totalCarbon, totalEnergy, intensity: totalEnergy > 0 ? totalCarbon / totalEnergy : 0, byBuilding: byBuildingArr, byPeriodType, byMonth: byMonthArr, byDevice: byDeviceArr };
    },

    /* ===== 需量成本计算 ===== */
    calculateDemandCost(meterReadings, demandPricing, pricing, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        const dp = demandPricing && demandPricing.length > 0 ? demandPricing[0] : { rate_per_kw: 45, threshold_kw: 0 };
        const ratePerKw = Number(dp.rate_per_kw) || 45;
        const thresholdKw = Number(dp.threshold_kw) || 0;

        const byBuildingMonth = {};
        filtered.forEach(r => {
            const bid = r.building_id || 'unknown';
            const d = new Date(r.timestamp);
            const mk = EnergyApp.utils.getMonthKey(d);
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

        return { totalDemandCost, byBuilding: Object.values(byBuilding).sort((a,b) => b.totalCost - a.totalCost), peakDemandByMonth: Object.values(peakDemandByMonth).sort((a,b) => a.month.localeCompare(b.month)), ratePerKw, thresholdKw };
    },

    /* ===== 可转移负荷计算 ===== */
    calculateTransferableLoad(meterReadings, migratableLoads, pricing, filter) {
        const filtered = this._filterReadings(meterReadings, filter);
        let totalTransferable = 0, totalTransferred = 0, totalCostSavings = 0;
        const byLoad = [];

        (migratableLoads || []).forEach(load => {
            const fromReadings = filtered.filter(r =>
                (!load.building_id || load.building_id === 'all' || r.building_id === load.building_id) &&
                (r.period_type || this._getPeriodType(r.timestamp, pricing)) === load.from_period
            );
            const availableKwh = fromReadings.reduce((s, r) => s + (Number(r.energy) || Number(r.reading) || 0), 0);
            const maxCap = Number(load.max_capacity_kwh) || 0;
            const efficiency = Number(load.shift_efficiency) || 0.95;
            const days = new Set(fromReadings.map(r => new Date(r.timestamp).toDateString())).size || 1;
            const transferable = Math.min(availableKwh * 0.3, maxCap * days);
            const transferred = transferable * efficiency;

            const fromPrice = this._getPrice(pricing, load.from_period);
            const toPrice = this._getPrice(pricing, load.to_period);
            const savings = transferable * fromPrice - transferred * toPrice;

            totalTransferable += transferable;
            totalTransferred += transferred;
            totalCostSavings += savings;

            byLoad.push({ load_id: load.load_id, building_id: load.building_id, device_type: load.device_type, from_period: load.from_period, to_period: load.to_period, availableKwh, transferable, transferred, efficiency, savings });
        });

        return { totalTransferable, totalTransferred, totalCostSavings, byLoad };
    },

    /* ===== 策略评估 ===== */
    evaluateStrategy(meterReadings, carbonFactors, demandPricing, migratableLoads, pricing, filter, params) {
        const filtered = this._filterReadings(meterReadings, filter);
        const p = params || {};
        const loadShiftPct = Number(p.load_shift_pct) || 0;
        const demandReductionPct = Number(p.demand_reduction_pct) || 0;
        const deviceEfficiencyGain = Number(p.device_efficiency_gain) || 0;
        const weekendShutdownPct = Number(p.weekend_shutdown_pct) || 0;

        /* 基线 */
        const baselineCarbon = this.calculateCarbon(meterReadings, carbonFactors, pricing, filter);
        const baselineDemand = this.calculateDemandCost(meterReadings, demandPricing, pricing, filter);
        const baselineTransfer = this.calculateTransferableLoad(meterReadings, migratableLoads, pricing, filter);

        const baseline = {
            totalEnergy: baselineCarbon.totalEnergy,
            totalCost: filtered.reduce((s, r) => s + (Number(r.cost) || 0), 0),
            totalCarbon: baselineCarbon.totalCarbon,
            peakDemand: baselineDemand.byBuilding.reduce((s, b) => s + b.peakKw, 0),
            demandCost: baselineDemand.totalDemandCost
        };

        /* 调整后读数 */
        const adjusted = filtered.map(r => {
            const clone = Object.assign({}, r);
            let energy = Number(clone.energy) || Number(clone.reading) || 0;
            const pt = clone.period_type || this._getPeriodType(clone.timestamp, pricing);
            const dow = new Date(clone.timestamp).getDay();
            const isWeekend = dow === 0 || dow === 6;

            if (loadShiftPct > 0 && (pt === 'sharp_peak' || pt === 'peak')) energy *= (1 - loadShiftPct);
            if (deviceEfficiencyGain > 0) energy *= (1 - deviceEfficiencyGain);
            if (weekendShutdownPct > 0 && isWeekend) energy *= (1 - weekendShutdownPct);

            clone.energy = energy;
            clone.reading = energy;
            clone.cost = energy * this._getPrice(pricing, pt);
            return clone;
        });

        const projectedCarbon = this.calculateCarbon(adjusted, carbonFactors, pricing, {});
        let projectedCost = adjusted.reduce((s, r) => s + (Number(r.cost) || 0), 0);

        const projectedDemandBase = baseline.peakDemand * (1 - demandReductionPct);
        const dpRate = demandPricing && demandPricing.length > 0 ? (Number(demandPricing[0].rate_per_kw) || 45) : 45;
        const projectedDemandCost = projectedDemandBase * dpRate;
        projectedCost += projectedDemandCost;

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

        const monthlyProjection = (baselineCarbon.byMonth || []).map(bm => {
            const pm = (projectedCarbon.byMonth || []).find(m => m.month === bm.month);
            return { month: bm.month, baselineCarbon: bm.carbon, baselineEnergy: bm.energy, projectedCarbon: pm ? pm.carbon : 0, projectedEnergy: pm ? pm.energy : 0, carbonSaved: bm.carbon - (pm ? pm.carbon : 0) };
        });

        return { baseline, projected, savings, reductionPct, monthlyProjection, strategyParams: p };
    },

    /* ===== 碳排因子查找 ===== */
    _getCarbonFactor(carbonFactors, buildingId, periodType) {
        if (!carbonFactors || !carbonFactors.length) return 0.583;
        const specific = carbonFactors.find(f => f.building_id === buildingId && f.period_type === periodType);
        if (specific) return Number(specific.factor) || 0.583;
        const global = carbonFactors.find(f => (f.building_id === 'all' || !f.building_id) && f.period_type === periodType);
        if (global) return Number(global.factor) || 0.583;
        const any = carbonFactors.find(f => f.building_id === buildingId);
        if (any) return Number(any.factor) || 0.583;
        return 0.583;
    }
};
