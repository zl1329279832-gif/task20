/* ===== 碳排放核算与削峰填谷策略计算模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.CarbonStrategy = {

    /* ---- 各楼栋碳排放计算 ---- */
    calculateBuildingCarbon(readings, carbonFactors, filter) {
        const filtered = this._filterReadings(readings, filter);
        if (!filtered.length || !carbonFactors.length) {
            return { totalCarbon: 0, byBuilding: {}, byPeriod: [], byHour: [] };
        }

        const byBuilding = {};
        const byPeriodMap = {};
        const byHour = new Array(24).fill(null).map((_, h) => ({ hour: h, carbon: 0, energy: 0, factor: 0, count: 0 }));

        filtered.forEach(r => {
            const ts = new Date(r.timestamp);
            const hour = ts.getHours();
            const energy = Number(r.energy) || 0;
            const factor = this._matchCarbonFactor(hour, r.region, carbonFactors);
            const carbon = energy * factor;

            const bid = r.building_id || 'unknown';
            byBuilding[bid] = (byBuilding[bid] || 0) + carbon;

            const periodKey = this._getPeriodKey(ts, filter.timePeriod || 'month');
            if (!byPeriodMap[periodKey]) byPeriodMap[periodKey] = { period: periodKey, carbon: 0, energy: 0 };
            byPeriodMap[periodKey].carbon += carbon;
            byPeriodMap[periodKey].energy += energy;

            byHour[hour].carbon += carbon;
            byHour[hour].energy += energy;
            byHour[hour].factor += factor;
            byHour[hour].count++;
        });

        byHour.forEach(h => { if (h.count > 0) h.factor = h.factor / h.count; });

        const totalCarbon = Object.values(byBuilding).reduce((s, v) => s + v, 0);
        const byPeriod = Object.values(byPeriodMap).sort((a, b) => a.period.localeCompare(b.period));

        return { totalCarbon, byBuilding, byPeriod, byHour };
    },

    /* ---- 尖峰需量成本计算 ---- */
    calculateDemandCost(readings, demandPricing, filter) {
        const filtered = this._filterReadings(readings, filter);
        if (!filtered.length || !demandPricing.length) {
            return { totalDemandCost: 0, byPeriod: [] };
        }

        const sortedTiers = [...demandPricing].sort((a, b) => Number(a.demand_tier) - Number(b.demand_tier));

        /* 按月分组找峰值需量 */
        const byMonth = {};
        filtered.forEach(r => {
            const ts = new Date(r.timestamp);
            const key = ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0');
            if (!byMonth[key]) byMonth[key] = { period: key, readings: [] };
            byMonth[key].readings.push(r);
        });

        let totalDemandCost = 0;
        const byPeriod = [];

        Object.values(byMonth).forEach(monthData => {
            /* 按日分组取每日峰值功率, 再取月内最大值 */
            const dailyPeaks = {};
            monthData.readings.forEach(r => {
                const day = new Date(r.timestamp).toISOString().slice(0, 10);
                const power = Number(r.energy) || 0;
                if (!dailyPeaks[day] || power > dailyPeaks[day]) dailyPeaks[day] = power;
            });
            const peakDemand = Math.max(...Object.values(dailyPeaks), 0);
            const tierBreakdown = this._applyDemandTiers(peakDemand, sortedTiers);
            const cost = tierBreakdown.reduce((s, t) => s + t.cost, 0);
            totalDemandCost += cost;
            byPeriod.push({ period: monthData.period, peakDemand, cost, tierBreakdown });
        });

        byPeriod.sort((a, b) => a.period.localeCompare(b.period));
        return { totalDemandCost, byPeriod };
    },

    /* ---- 可迁移负荷汇总 ---- */
    calculateShiftableLoad(readings, shiftableLoads, devices, filter) {
        const filtered = this._filterReadings(readings, filter);
        if (!shiftableLoads.length) {
            return { totalShiftableKw: 0, byDevice: [] };
        }

        const deviceReadings = {};
        filtered.forEach(r => {
            const did = r.meter_id || r.device_id;
            if (!deviceReadings[did]) deviceReadings[did] = { energy: 0, count: 0 };
            deviceReadings[did].energy += Number(r.energy) || 0;
            deviceReadings[did].count++;
        });

        const devMap = new Map();
        (devices || []).forEach(d => { if (d.device_id) devMap.set(d.device_id, d); if (d.meter_id) devMap.set(d.meter_id, d); });

        let totalShiftableKw = 0;
        const byDevice = shiftableLoads.map(sl => {
            const did = sl.device_id;
            const power = Number(sl.shiftable_power_kw) || 0;
            totalShiftableKw += power;
            const dev = devMap.get(did);
            const dr = deviceReadings[did] || { energy: 0, count: 0 };
            return {
                device_id: did,
                device_name: dev ? dev.device_name : did,
                shiftable_power_kw: power,
                earliest_start: sl.earliest_start,
                latest_end: sl.latest_end,
                min_duration_hours: Number(sl.min_duration_hours) || 0,
                priority: Number(sl.priority) || 1,
                currentEnergy: dr.energy
            };
        }).sort((a, b) => a.priority - b.priority);

        return { totalShiftableKw, byDevice };
    },

    /* ---- 策略模拟 ---- */
    simulateStrategy(strategy, readings, carbonFactors, demandPricing, shiftableLoads, filter) {
        const filtered = this._filterReadings(readings, filter);
        if (!filtered.length) {
            return { shiftedReadings: [], baseline: {}, simulated: {}, delta: {}, shiftDetails: [] };
        }

        /* 基线计算 */
        const baselineCarbon = this.calculateBuildingCarbon(filtered, carbonFactors, {});
        const baselineDemand = this.calculateDemandCost(filtered, demandPricing, {});
        const baselineTotalEnergy = filtered.reduce((s, r) => s + (Number(r.energy) || 0), 0);

        /* 深拷贝 readings 用于模拟 */
        const shifted = filtered.map(r => ({ ...r }));
        const shiftDetails = [];

        /* 构建可迁移设备集合 */
        const shiftableSet = new Map();
        (shiftableLoads || []).forEach(sl => {
            shiftableSet.set(sl.device_id, {
                maxPower: Number(sl.shiftable_power_kw) || Infinity,
                earliest: sl.earliest_start,
                latest: sl.latest_end
            });
        });

        /* 按规则迁移负荷 */
        (strategy.rules || []).forEach(rule => {
            const fromHours = new Set(rule.from_hours || []);
            const toHours = rule.to_hours || [];
            const pct = Math.min(1, Math.max(0, Number(rule.shift_percentage) || 0));
            if (!fromHours.size || !toHours.length || pct === 0) return;

            let totalShifted = 0;

            /* 找匹配的readings: 在from_hours时段内 */
            shifted.forEach(r => {
                if (rule.device_id && rule.device_id !== 'all' && r.meter_id !== rule.device_id && r.device_id !== rule.device_id) return;
                const hour = new Date(r.timestamp).getHours();
                if (!fromHours.has(hour)) return;

                const energy = Number(r.energy) || 0;
                const shiftAmount = energy * pct;
                r.energy = energy - shiftAmount;
                r._shifted_out = (r._shifted_out || 0) + shiftAmount;
                totalShifted += shiftAmount;
            });

            /* 将迁移的能量分配到目标时段的readings */
            const targetReadings = shifted.filter(r => {
                if (rule.device_id && rule.device_id !== 'all' && r.meter_id !== rule.device_id && r.device_id !== rule.device_id) return false;
                return toHours.includes(new Date(r.timestamp).getHours());
            });

            if (targetReadings.length > 0) {
                const perReading = totalShifted / targetReadings.length;
                targetReadings.forEach(r => {
                    r.energy = (Number(r.energy) || 0) + perReading;
                    r._shifted_in = (r._shifted_in || 0) + perReading;
                });
            }

            shiftDetails.push({
                rule_id: rule.rule_id,
                device_id: rule.device_id,
                fromHours: Array.from(fromHours),
                toHours,
                shiftedKwh: totalShifted
            });
        });

        /* 模拟后的碳排和需量成本 */
        const simCarbon = this.calculateBuildingCarbon(shifted, carbonFactors, {});
        const simDemand = this.calculateDemandCost(shifted, demandPricing, {});
        const simTotalEnergy = shifted.reduce((s, r) => s + (Number(r.energy) || 0), 0);

        const baseline = { carbon: baselineCarbon.totalCarbon, demandCost: baselineDemand.totalDemandCost, totalEnergy: baselineTotalEnergy };
        const simulated = { carbon: simCarbon.totalCarbon, demandCost: simDemand.totalDemandCost, totalEnergy: simTotalEnergy };

        const delta = {
            carbonReduction: baseline.carbon - simulated.carbon,
            carbonReductionPct: baseline.carbon > 0 ? ((baseline.carbon - simulated.carbon) / baseline.carbon * 100) : 0,
            costReduction: baseline.demandCost - simulated.demandCost,
            costReductionPct: baseline.demandCost > 0 ? ((baseline.demandCost - simulated.demandCost) / baseline.demandCost * 100) : 0
        };

        /* 生成24h负荷曲线用于可视化 */
        const originalProfile = new Array(24).fill(0);
        const shiftedProfile = new Array(24).fill(0);
        const originalCount = new Array(24).fill(0);
        const shiftedCount = new Array(24).fill(0);

        filtered.forEach(r => {
            const h = new Date(r.timestamp).getHours();
            originalProfile[h] += Number(r.energy) || 0;
            originalCount[h]++;
        });
        shifted.forEach(r => {
            const h = new Date(r.timestamp).getHours();
            shiftedProfile[h] += Number(r.energy) || 0;
            shiftedCount[h]++;
        });

        /* 转为平均值 */
        for (let h = 0; h < 24; h++) {
            if (originalCount[h] > 0) originalProfile[h] /= originalCount[h];
            if (shiftedCount[h] > 0) shiftedProfile[h] /= shiftedCount[h];
        }

        return {
            shiftedReadings: shifted,
            baseline, simulated, delta, shiftDetails,
            carbonDetail: simCarbon,
            demandDetail: simDemand,
            loadProfile: { original: originalProfile, shifted: shiftedProfile }
        };
    },

    /* ---- 多策略对比 ---- */
    compareStrategies(strategyResults) {
        if (!strategyResults.length) return { baseline: null, strategies: [], fingerprintConsistent: true };

        const baseline = strategyResults[0].baseline;
        let fingerprintConsistent = true;
        const fps = strategyResults.map(sr => sr.dataFingerprint ? JSON.stringify(sr.dataFingerprint) : null).filter(Boolean);
        if (fps.length > 1) {
            for (let i = 1; i < fps.length; i++) {
                if (fps[i] !== fps[0]) { fingerprintConsistent = false; break; }
            }
        }

        const strategies = strategyResults.map((sr, i) => ({
            name: sr.name || `策略 ${i + 1}`,
            strategy_id: sr.strategy_id,
            delta: sr.delta,
            simulated: sr.simulated,
            rank: 0
        }));

        /* 按碳减排量排名 */
        strategies.sort((a, b) => (b.delta?.carbonReduction || 0) - (a.delta?.carbonReduction || 0));
        strategies.forEach((s, i) => { s.rank = i + 1; });

        return { baseline, strategies, fingerprintConsistent };
    },

    /* ---- 内部: 匹配碳排因子 ---- */
    _matchCarbonFactor(hour, region, factors) {
        let match = factors.find(f => Number(f.time_period) === hour && f.region === region);
        if (!match) match = factors.find(f => Number(f.time_period) === hour);
        if (!match && factors.length > 0) {
            const avg = factors.reduce((s, f) => s + (Number(f.emission_factor) || 0), 0) / factors.length;
            return avg;
        }
        return match ? (Number(match.emission_factor) || 0) : 0;
    },

    /* ---- 内部: 阶梯需量计费 ---- */
    _applyDemandTiers(peakKw, tiers) {
        if (!tiers.length) return [];
        const breakdown = [];
        let remaining = peakKw;

        for (let i = 0; i < tiers.length; i++) {
            const tier = tiers[i];
            const threshold = Number(tier.threshold_kw) || Infinity;
            const price = Number(tier.price_per_kw) || 0;
            const prevThreshold = i > 0 ? (Number(tiers[i-1].threshold_kw) || 0) : 0;
            const bracket = Math.min(remaining, threshold - prevThreshold);

            if (bracket > 0) {
                breakdown.push({
                    tier: tier.demand_tier,
                    kw: bracket,
                    price,
                    cost: bracket * price
                });
                remaining -= bracket;
            }
            if (remaining <= 0) break;
        }

        /* 如果还有剩余量, 用最高档计费 */
        if (remaining > 0 && tiers.length > 0) {
            const lastTier = tiers[tiers.length - 1];
            breakdown.push({
                tier: lastTier.demand_tier + '+',
                kw: remaining,
                price: Number(lastTier.price_per_kw) || 0,
                cost: remaining * (Number(lastTier.price_per_kw) || 0)
            });
        }

        return breakdown;
    },

    /* ---- 内部: readings 过滤 (复用 Calculation 逻辑) ---- */
    _filterReadings(readings, filter) {
        if (!readings) return [];
        let f = readings;
        if (filter.buildingId && filter.buildingId !== 'all') f = f.filter(r => r.building_id === filter.buildingId);
        if (filter.startDate) { const s = new Date(filter.startDate); f = f.filter(r => new Date(r.timestamp) >= s); }
        if (filter.endDate) { const e = new Date(filter.endDate); e.setHours(23, 59, 59, 999); f = f.filter(r => new Date(r.timestamp) <= e); }
        if (filter.energyType && filter.energyType !== 'all') f = f.filter(r => (r.energy_type || 'electricity') === filter.energyType);
        return f;
    },

    /* ---- 内部: 时段键生成 ---- */
    _getPeriodKey(date, period) {
        const y = date.getFullYear(), m = date.getMonth();
        if (period === 'day') return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
        if (period === 'quarter') return y + '-Q' + (Math.floor(m / 3) + 1);
        if (period === 'year') return String(y);
        return y + '-' + String(m + 1).padStart(2, '0');
    }
};
