/* ===== 数据校验器模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Validator = {
    validateAll(data) {
        const results = { errors: [], warnings: [], info: [] };
        this._validateMeterReadings(data.meter_readings || data.meter_reading || [], results);
        this._validateCrossReferences(data, results);
        this._validatePricing(data.pricing || [], results);
        this._validateDevices(data.devices || data.device || [], results);
        this._validateCarbonFactors(data.carbon_factor || [], results);
        this._validateDemandPricing(data.demand_pricing || [], results);
        this._validateShiftableLoads(data.shiftable_load || [], results);
        return results;
    },

    _validateMeterReadings(readings, results) {
        if (!readings.length) return;
        const byMeter = new Map();
        readings.forEach(r => { if (!byMeter.has(r.meter_id)) byMeter.set(r.meter_id, []); byMeter.get(r.meter_id).push(r); });

        if (byMeter.size < readings.length / 10)
            results.warnings.push({ type: 'duplicate_meter', message: `仅有 ${byMeter.size} 个电表ID，可能存在重复电表` });

        byMeter.forEach((meterReadings, meterId) => {
            const sorted = [...meterReadings].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            for (let i = 1; i < sorted.length; i++) {
                if (Number(sorted[i].reading) < Number(sorted[i-1].reading))
                    results.warnings.push({ type: 'reading_inversion', message: `电表 ${meterId} 在 ${this._fmt(sorted[i].timestamp)} 出现读数倒挂 (${sorted[i-1].reading} → ${sorted[i].reading})` });
            }

            const timestamps = new Set();
            sorted.forEach(r => {
                const ts = new Date(r.timestamp).getTime();
                if (timestamps.has(ts))
                    results.warnings.push({ type: 'duplicate_timestamp', message: `电表 ${meterId} 在 ${this._fmt(r.timestamp)} 存在重复记录` });
                timestamps.add(ts);
            });

            if (sorted.length >= 3) {
                const intervals = [];
                for (let i = 1; i < sorted.length; i++) intervals.push(new Date(sorted[i].timestamp) - new Date(sorted[i-1].timestamp));
                const median = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
                for (let i = 1; i < sorted.length; i++) {
                    const gap = new Date(sorted[i].timestamp) - new Date(sorted[i-1].timestamp);
                    if (gap > median * 2.5)
                        results.warnings.push({ type: 'missing_timepoint', message: `电表 ${meterId} 在 ${this._fmt(sorted[i-1].timestamp)} 至 ${this._fmt(sorted[i].timestamp)} 间数据缺失` });
                }
            }

            for (let i = 1; i < sorted.length; i++) {
                const diff = Number(sorted[i].reading) - Number(sorted[i-1].reading);
                if (diff > 0) {
                    const avgDiffs = [];
                    for (let j = Math.max(1, i - 5); j < i; j++) avgDiffs.push(Number(sorted[j].reading) - Number(sorted[j-1].reading));
                    if (avgDiffs.length > 0) {
                        const avgDiff = avgDiffs.reduce((a, b) => a + b, 0) / avgDiffs.length;
                        if (avgDiff > 0 && diff > avgDiff * 5)
                            results.warnings.push({ type: 'abnormal_spike', message: `电表 ${meterId} 在 ${this._fmt(sorted[i].timestamp)} 读数跳变异常 (差值 ${diff.toFixed(2)}，均值 ${avgDiff.toFixed(2)})` });
                    }
                }
            }
        });
    },

    _validateCrossReferences(data, results) {
        const buildingIds = new Set((data.buildings || []).map(b => b.building_id));
        const floorIds = new Set((data.floors || []).map(f => f.floor_id));
        const roomIds = new Set((data.rooms || []).map(r => r.room_id));

        (data.floors || []).forEach(f => {
            if (buildingIds.size > 0 && !buildingIds.has(f.building_id))
                results.errors.push({ type: 'invalid_building_ref', message: `楼层 ${f.floor_id} 引用的楼栋 ${f.building_id} 不存在` });
        });
        (data.rooms || []).forEach(r => {
            if (floorIds.size > 0 && !floorIds.has(r.floor_id))
                results.errors.push({ type: 'invalid_floor_ref', message: `房间 ${r.room_id} 引用的楼层 ${r.floor_id} 不存在` });
        });
        (data.devices || []).forEach(d => {
            if (d.room_id && roomIds.size > 0 && !roomIds.has(d.room_id))
                results.errors.push({ type: 'invalid_room_ref', message: `设备 ${d.device_id} (${d.device_name||''}) 引用的房间 ${d.room_id} 不存在 (设备归属错误)` });
        });
    },

    _validatePricing(pricing, results) {
        if (!pricing.length) return;
        const prices = pricing.map(p => Number(p.price)).filter(p => !isNaN(p) && p > 0);
        if (prices.length) {
            const max = Math.max(...prices), min = Math.min(...prices);
            if (max > min * 5)
                results.warnings.push({ type: 'price_anomaly', message: `电价差异过大 (最高 ${max}，最低 ${min})，请检查时段类型` });
        }
    },

    _validateDevices(devices, results) {
        if (!devices.length) return;
        const ids = new Set(devices.map(d => d.device_id));
        if (ids.size < devices.length)
            results.errors.push({ type: 'duplicate_device', message: `发现 ${devices.length - ids.size} 个重复的设备ID` });
    },

    _validateCarbonFactors(factors, results) {
        if (!factors.length) return;
        factors.forEach((f, i) => {
            const ef = Number(f.emission_factor);
            if (isNaN(ef) || ef <= 0) results.errors.push({ type: 'invalid_emission_factor', message: `碳排因子第 ${i+1} 行排放因子无效 (${f.emission_factor})` });
            else if (ef < 0.1 || ef > 2.0) results.warnings.push({ type: 'emission_factor_range', message: `碳排因子第 ${i+1} 行排放因子 ${ef} 超出常见范围 (0.1-2.0 kgCO2/kWh)` });
        });
        const periods = factors.map(f => Number(f.time_period)).filter(p => !isNaN(p));
        const covered = new Set(periods);
        if (covered.size > 0 && covered.size < 24) {
            const missing = [];
            for (let h = 0; h < 24; h++) { if (!covered.has(h)) missing.push(h); }
            if (missing.length) results.warnings.push({ type: 'missing_time_period', message: `碳排因子未覆盖时段: ${missing.join(', ')}` });
        }
        const keys = new Set();
        factors.forEach(f => {
            const k = `${f.time_period}_${f.region||''}_${f.effective_date||''}`;
            if (keys.has(k)) results.warnings.push({ type: 'duplicate_carbon_factor', message: `碳排因子存在重复: 时段=${f.time_period}, 区域=${f.region||'-'}` });
            keys.add(k);
        });
    },

    _validateDemandPricing(pricing, results) {
        if (!pricing.length) return;
        pricing.forEach((p, i) => {
            if (isNaN(Number(p.price_per_kw)) || Number(p.price_per_kw) <= 0)
                results.errors.push({ type: 'invalid_demand_price', message: `需量电价第 ${i+1} 行单价无效 (${p.price_per_kw})` });
        });
        const sorted = [...pricing].sort((a, b) => Number(a.demand_tier) - Number(b.demand_tier));
        for (let i = 1; i < sorted.length; i++) {
            const prev = Number(sorted[i-1].threshold_kw), curr = Number(sorted[i].threshold_kw);
            if (!isNaN(prev) && !isNaN(curr) && curr <= prev)
                results.warnings.push({ type: 'demand_tier_order', message: `需量电价阈值未单调递增: 档位${sorted[i-1].demand_tier}(${prev}kW) ≥ 档位${sorted[i].demand_tier}(${curr}kW)` });
        }
    },

    _validateShiftableLoads(loads, results) {
        if (!loads.length) return;
        loads.forEach((l, i) => {
            if (!l.device_id) results.errors.push({ type: 'missing_device_id', message: `可迁移负荷第 ${i+1} 行缺少设备ID` });
            const power = Number(l.shiftable_power_kw);
            if (isNaN(power) || power <= 0) results.errors.push({ type: 'invalid_shiftable_power', message: `可迁移负荷第 ${i+1} 行功率无效 (${l.shiftable_power_kw})` });
            else if (power > 500) results.warnings.push({ type: 'high_shiftable_power', message: `可迁移负荷第 ${i+1} 行功率异常高 (${power} kW)` });
            const dur = Number(l.min_duration_hours);
            if (!isNaN(dur) && dur <= 0) results.warnings.push({ type: 'invalid_duration', message: `可迁移负荷第 ${i+1} 行最短时长无效 (${dur})` });
        });
    },

    _fmt(ts) {
        if (!ts) return '?';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return ts;
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
};
