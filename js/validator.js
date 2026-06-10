/* ===== 数据校验器模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Validator = {
    validateAll(data) {
        const results = { errors: [], warnings: [], info: [] };
        this._validateMeterReadings(data.meter_readings || [], results);
        this._validateCrossReferences(data, results);
        this._validatePricing(data.pricing || [], results);
        this._validateDevices(data.devices || [], results);
        this._validateCarbonFactors(data.carbon_factors || [], results);
        this._validateMigratableLoads(data.migratable_loads || [], data.pricing || [], results);
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
        const ids = new Set(devices.map(d => d.device_id));
        if (ids.size < devices.length)
            results.errors.push({ type: 'duplicate_device', message: `发现 ${devices.length - ids.size} 个重复的设备ID` });
    },

    _validateCarbonFactors(factors, results) {
        if (!factors.length) return;
        const validPeriods = ['sharp_peak', 'peak', 'flat', 'valley'];
        factors.forEach(f => {
            const val = Number(f.factor);
            if (isNaN(val) || val <= 0)
                results.errors.push({ type: 'invalid_carbon_factor', message: `碳排因子 ${f.factor_id || ''} 的值无效 (${f.factor})，必须大于0` });
            else if (val > 2.0)
                results.warnings.push({ type: 'high_carbon_factor', message: `碳排因子 ${f.factor_id || ''} 值偏高 (${val} kg CO2/kWh)，请确认是否为电网排放因子` });
            if (f.period_type && !validPeriods.includes(f.period_type))
                results.warnings.push({ type: 'unknown_period', message: `碳排因子 ${f.factor_id || ''} 的时段类型 ${f.period_type} 不在标准枚举中` });
        });
        const byPeriod = {};
        factors.forEach(f => { byPeriod[f.period_type || 'unknown'] = (byPeriod[f.period_type || 'unknown'] || 0) + 1; });
        const summary = Object.entries(byPeriod).map(([k, v]) => `${k}:${v}`).join(', ');
        results.info.push({ type: 'carbon_factor_summary', message: `碳排因子共 ${factors.length} 条 (${summary})` });
    },

    _validateMigratableLoads(loads, pricing, results) {
        if (!loads.length) return;
        const validPeriods = ['sharp_peak', 'peak', 'flat', 'valley'];
        let totalCapacity = 0;
        loads.forEach(l => {
            if (!validPeriods.includes(l.from_period))
                results.errors.push({ type: 'invalid_from_period', message: `可迁移负荷 ${l.load_id || ''} 的源时段 ${l.from_period} 无效` });
            if (!validPeriods.includes(l.to_period))
                results.errors.push({ type: 'invalid_to_period', message: `可迁移负荷 ${l.load_id || ''} 的目标时段 ${l.to_period} 无效` });
            if (l.from_period && l.to_period && l.from_period === l.to_period)
                results.errors.push({ type: 'same_period', message: `可迁移负荷 ${l.load_id || ''} 的源时段和目标时段相同 (${l.from_period})` });
            const eff = Number(l.shift_efficiency);
            if (!isNaN(eff) && (eff < 0.5 || eff > 1.0))
                results.warnings.push({ type: 'efficiency_out_of_range', message: `可迁移负荷 ${l.load_id || ''} 的迁移效率 ${eff} 超出合理范围 (0.5~1.0)` });
            const cap = Number(l.max_capacity_kwh);
            if (!isNaN(cap) && cap <= 0)
                results.warnings.push({ type: 'zero_capacity', message: `可迁移负荷 ${l.load_id || ''} 的最大可迁移量为 ${cap}` });
            if (!isNaN(cap) && cap > 0) totalCapacity += cap;
        });
        results.info.push({ type: 'migratable_load_summary', message: `可迁移负荷共 ${loads.length} 条，总可迁移容量 ${totalCapacity.toFixed(0)} kWh` });
    },

    _fmt(ts) {
        if (!ts) return '?';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return ts;
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
};
