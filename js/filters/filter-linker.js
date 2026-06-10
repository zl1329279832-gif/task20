import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';

class FilterLinker {
  constructor() {
    this.charts = {};
    this.worker = null;
    this._pendingRequest = null;
    this._debounceTimer = null;
  }

  init(charts) {
    this.charts = charts;
    this._initWorker();

    stateManager.subscribe(() => this._debouncedRefresh());
    eventBus.on('data:imported', () => this.refreshAll());
  }

  _initWorker() {
    try {
      this.worker = new Worker('js/workers/calc-worker.js');
      this.worker.onmessage = (e) => this._handleWorkerMessage(e.data);
      this.worker.onerror = (e) => console.error('Calc worker error:', e);
    } catch (err) {
      console.warn('Worker init failed, will calculate on main thread:', err);
    }
  }

  _debouncedRefresh() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.refreshAll(), 150);
  }

  async refreshAll() {
    try {
      const dataStore = (await import('../storage/data-store.js')).default;
      const state = stateManager.getState();

      // Load all data from IndexedDB
      const [buildings, floors, rooms, devices, meterReadings, acEnergy, lightingEnergy, touPricing] = await Promise.all([
        dataStore.getAll('buildings'),
        dataStore.getAll('floors'),
        dataStore.getAll('rooms'),
        dataStore.getAll('devices'),
        dataStore.getAll('meter_readings'),
        dataStore.getAll('ac_energy'),
        dataStore.getAll('lighting_energy'),
        dataStore.getAll('tou_pricing')
      ]);

      if (buildings.length === 0 && meterReadings.length === 0 && acEnergy.length === 0) {
        this._showEmptyState();
        return;
      }

      // Enrich devices with building/floor info
      const floorMap = new Map(floors.map(f => [f.id, f]));
      const roomMap = new Map(rooms.map(r => [r.id, r]));
      const deviceMap = new Map(devices.map(d => [d.id, d]));

      devices.forEach(d => {
        const room = roomMap.get(d.room_id);
        if (room) {
          d._floor_id = room.floor_id;
          const floor = floorMap.get(room.floor_id);
          if (floor) d._building_id = floor.building_id;
        }
      });

      // Enrich energy data with hierarchy info
      const enrichEnergy = (records) => {
        return records.map(r => {
          const dev = deviceMap.get(r.device_id);
          return {
            ...r,
            building_id: dev?._building_id || null,
            floor_id: dev?._floor_id || null,
            device_type: dev?.device_type || 'other',
            timestamp: r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp)
          };
        });
      };

      const enrichedMeter = enrichEnergy(meterReadings);
      const enrichedAC = enrichEnergy(acEnergy);
      const enrichedLighting = enrichEnergy(lightingEnergy);

      // Filter by current state
      let data = [];
      if (state.energyType === 'ac') data = enrichedAC;
      else if (state.energyType === 'lighting') data = enrichedLighting;
      else data = [...enrichedMeter, ...enrichedAC, ...enrichedLighting];

      // Apply building filter
      if (state.selectedBuildingId) {
        data = data.filter(d => d.building_id === state.selectedBuildingId);
      }

      // Apply floor filter
      if (state.selectedFloorId) {
        data = data.filter(d => d.floor_id === state.selectedFloorId);
      }

      // Apply time range filter
      if (state.timeRange.start) {
        const start = new Date(state.timeRange.start);
        data = data.filter(d => new Date(d.timestamp) >= start);
      }
      if (state.timeRange.end) {
        const end = new Date(state.timeRange.end);
        end.setHours(23, 59, 59, 999);
        data = data.filter(d => new Date(d.timestamp) <= end);
      }

      const payload = {
        data: {
          filtered: data,
          meterReadings: enrichedMeter,
          acEnergy: enrichedAC,
          lightingEnergy: enrichedLighting,
          devices, buildings, floors, rooms
        },
        state,
        touPricing: touPricing.length ? touPricing : this._defaultTOUPricing()
      };

      // Use main thread calculation for reliability
      // Worker can be enabled later with format normalization
      this._calculateAndRender(payload);
    } catch (err) {
      console.error('FilterLinker refreshAll error:', err);
    }
  }

  _handleWorkerMessage(msg) {
    if (msg.status === 'progress') return;
    if (msg.id !== this._pendingRequest) return;

    if (msg.status === 'success') {
      this._renderAllCharts(msg.payload);
    } else if (msg.status === 'error') {
      console.error('Worker calculation error:', msg.payload);
      // Try main thread fallback
    }
  }

  _calculateAndRender(payload) {
    // Main-thread fallback calculation
    const results = this._doCalculation(payload);
    this._renderAllCharts(results);
  }

  _doCalculation({ data, state, touPricing }) {
    const filtered = data.filtered || [];
    const consumption = r => r.power_consumption || r.reading || 0;

    // Building overview
    const buildingGroups = {};
    data.buildings.forEach(b => { buildingGroups[b.id] = { id: b.id, name: b.name || b.id, total: 0, area: b.area || 0 }; });
    filtered.forEach(r => {
      if (r.building_id && buildingGroups[r.building_id]) {
        buildingGroups[r.building_id].total += consumption(r);
      }
    });
    const buildingOverview = Object.values(buildingGroups).filter(b => b.total > 0);

    // Floor heatmap
    const floorTimeMap = {};
    filtered.forEach(r => {
      if (!r.floor_id) return;
      const ts = new Date(r.timestamp);
      const hour = ts.getHours();
      const key = `${r.floor_id}_${hour}`;
      floorTimeMap[key] = (floorTimeMap[key] || 0) + consumption(r);
    });
    const floorIds = [...new Set(filtered.map(r => r.floor_id).filter(Boolean))];
    const floorHeatmap = { floorIds, data: floorTimeMap };

    // Device ranking
    const deviceConsumption = {};
    filtered.forEach(r => {
      if (!r.device_id) return;
      if (!deviceConsumption[r.device_id]) {
        const dev = data.devices.find(d => d.id === r.device_id);
        deviceConsumption[r.device_id] = { id: r.device_id, name: dev?.device_type || r.device_id, type: r.device_type || 'other', total: 0 };
      }
      deviceConsumption[r.device_id].total += consumption(r);
    });
    const deviceRanking = Object.values(deviceConsumption).sort((a, b) => b.total - a.total).slice(0, state.topN);

    // TOU trend
    const touTrend = { sharp: {}, peak: {}, flat: {}, valley: {} };
    const classifyHour = (h) => {
      for (const p of touPricing) {
        const [sh, sm] = (p.start_time || '0:00').split(':').map(Number);
        const [eh, em] = (p.end_time || '0:00').split(':').map(Number);
        if (h >= sh && h < eh) return p.time_period;
      }
      // Default classification
      if (h >= 10 && h < 12 || h >= 19 && h < 21) return 'sharp';
      if (h >= 8 && h < 10 || h >= 12 && h < 17 || h >= 21 && h < 23) return 'peak';
      if (h >= 7 && h < 8 || h >= 17 && h < 19 || h >= 23) return 'flat';
      return 'valley';
    };
    filtered.forEach(r => {
      const ts = new Date(r.timestamp);
      const dateKey = ts.toISOString().slice(0, 10);
      const period = classifyHour(ts.getHours());
      if (touTrend[period]) {
        touTrend[period][dateKey] = (touTrend[period][dateKey] || 0) + consumption(r);
      }
    });

    // YoY / MoM
    const monthlyData = {};
    (data.meterReadings.concat(data.acEnergy, data.lightingEnergy)).forEach(r => {
      const ts = new Date(r.timestamp);
      const monthKey = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
      monthlyData[monthKey] = (monthlyData[monthKey] || 0) + consumption(r);
    });
    const months = Object.keys(monthlyData).sort();
    const yoyMom = months.map(m => {
      const [y, mo] = m.split('-');
      let prevKey;
      if (state.comparisonMode === 'yoy') {
        prevKey = `${parseInt(y) - 1}-${mo}`;
      } else {
        const pm = parseInt(mo) - 1;
        prevKey = pm < 1 ? `${parseInt(y) - 1}-12` : `${y}-${String(pm).padStart(2, '0')}`;
      }
      const current = monthlyData[m] || 0;
      const previous = monthlyData[prevKey] || 0;
      const change = previous ? ((current - previous) / previous * 100) : 0;
      return { period: m, current, previous, change: change.toFixed(1), trend: current > previous ? 'up' : current < previous ? 'down' : 'flat' };
    });

    // Anomalies (simple detection)
    const anomalies = [];
    const sortedReadings = [...(data.meterReadings || [])].sort((a, b) => {
      if (a.device_id !== b.device_id) return a.device_id < b.device_id ? -1 : 1;
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
    for (let i = 1; i < sortedReadings.length; i++) {
      const prev = sortedReadings[i - 1];
      const curr = sortedReadings[i];
      if (curr.device_id === prev.device_id && (curr.reading || 0) < (prev.reading || 0)) {
        anomalies.push({ type: 'reading_reversal', severity: 'critical', entityId: curr.device_id,
          message: `设备 ${curr.device_id} 读数倒挂: ${prev.reading} → ${curr.reading}`,
          timestamp: curr.timestamp });
      }
    }
    // High consumption detection
    const avgConsumption = filtered.length ? filtered.reduce((s, r) => s + consumption(r), 0) / filtered.length : 0;
    const stdDev = filtered.length ? Math.sqrt(filtered.reduce((s, r) => s + Math.pow(consumption(r) - avgConsumption, 2), 0) / filtered.length) : 0;
    filtered.forEach(r => {
      if (consumption(r) > avgConsumption + 3 * stdDev && stdDev > 0) {
        anomalies.push({ type: 'high_consumption', severity: 'warning', entityId: r.device_id,
          message: `设备 ${r.device_id} 能耗异常偏高: ${consumption(r).toFixed(1)} kWh (均值: ${avgConsumption.toFixed(1)})`,
          timestamp: r.timestamp });
      }
    });

    // Suggestions
    const suggestions = [];
    if (touTrend.peak) {
      const peakTotal = Object.values(touTrend.peak).reduce((s, v) => s + v, 0);
      const totalAll = Object.values(touTrend).reduce((s, period) => s + Object.values(period).reduce((a, b) => a + b, 0), 0);
      if (totalAll > 0 && peakTotal / totalAll > 0.4) {
        suggestions.push({ category: '负荷转移', title: '建议错峰用电', message: `峰时用电占比 ${(peakTotal/totalAll*100).toFixed(0)}%，建议将部分负荷转移至谷时段`, priority: 'high', estimatedSaving: (peakTotal * 0.1).toFixed(0) + ' kWh' });
      }
    }
    if (deviceRanking.length > 0) {
      const topDevice = deviceRanking[0];
      const buildingAvg = buildingOverview.length ? buildingOverview.reduce((s, b) => s + b.total, 0) / buildingOverview.length : 0;
      if (topDevice.total > buildingAvg * 0.3) {
        suggestions.push({ category: '设备优化', title: '高耗能设备检查', message: `设备 ${topDevice.name} 能耗占比过高(${topDevice.total.toFixed(0)} kWh)，建议检查运行状态`, priority: 'high', estimatedSaving: (topDevice.total * 0.15).toFixed(0) + ' kWh' });
      }
    }
    if (anomalies.length > 3) {
      suggestions.push({ category: '运维管理', title: '加强能耗监测', message: `检测到 ${anomalies.length} 条异常记录，建议加强能耗监测频率和巡检力度`, priority: 'medium' });
    }
    suggestions.push({ category: '节能优化', title: '照明定时控制', message: '建议对公共区域照明设置定时开关，非工作时段自动关闭', priority: 'low', estimatedSaving: '5-10%' });

    // TOU billing
    let touBilling = { totalCost: 0, totalConsumption: 0, breakdown: {} };
    const allFiltered = filtered;
    touPricing.forEach(p => {
      touBilling.breakdown[p.time_period] = { kwh: 0, cost: 0 };
    });
    allFiltered.forEach(r => {
      const h = new Date(r.timestamp).getHours();
      const period = classifyHour(h);
      const kwh = consumption(r);
      const pricing = touPricing.find(p => p.time_period === period);
      const price = pricing ? pricing.price_per_kwh : 0.5;
      if (touBilling.breakdown[period]) {
        touBilling.breakdown[period].kwh += kwh;
        touBilling.breakdown[period].cost += kwh * price;
      }
      touBilling.totalConsumption += kwh;
      touBilling.totalCost += kwh * price;
    });

    return { buildingOverview, floorHeatmap, deviceRanking, touTrend, yoyMom, anomalies, suggestions, touBilling };
  }

  _renderAllCharts(results) {
    if (!results) return;
    const c = this.charts;
    if (c.buildingOverview) c.buildingOverview.update(results.buildingOverview);
    if (c.floorHeatmap) c.floorHeatmap.update(results.floorHeatmap);
    if (c.deviceRanking) c.deviceRanking.update(results.deviceRanking);
    if (c.touTrend) c.touTrend.update(results.touTrend, results.touBilling);
    if (c.yoyMom) c.yoyMom.update(results.yoyMom);
    if (c.anomalyPanel) c.anomalyPanel.update(results.anomalies);
    if (c.suggestionPanel) c.suggestionPanel.update(results.suggestions);
  }

  _showEmptyState() {
    Object.values(this.charts).forEach(chart => {
      if (chart && chart.showEmpty) chart.showEmpty();
    });
  }

  _defaultTOUPricing() {
    return [
      { time_period: 'sharp', start_time: '10:00', end_time: '12:00', price_per_kwh: 1.4 },
      { time_period: 'sharp', start_time: '19:00', end_time: '21:00', price_per_kwh: 1.4 },
      { time_period: 'peak',  start_time: '8:00',  end_time: '10:00', price_per_kwh: 1.0 },
      { time_period: 'peak',  start_time: '12:00', end_time: '17:00', price_per_kwh: 1.0 },
      { time_period: 'peak',  start_time: '21:00', end_time: '23:00', price_per_kwh: 1.0 },
      { time_period: 'flat',  start_time: '7:00',  end_time: '8:00',  price_per_kwh: 0.6 },
      { time_period: 'flat',  start_time: '17:00', end_time: '19:00', price_per_kwh: 0.6 },
      { time_period: 'flat',  start_time: '23:00', end_time: '24:00', price_per_kwh: 0.6 },
      { time_period: 'valley', start_time: '0:00', end_time: '7:00',  price_per_kwh: 0.3 }
    ];
  }
}

export const filterLinker = new FilterLinker();
