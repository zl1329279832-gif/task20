import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';

class FilterController {
  constructor() {
    this.elements = {};
  }

  init() {
    this.elements = {
      building: document.getElementById('filter-building'),
      floor: document.getElementById('filter-floor'),
      energyType: document.getElementById('filter-energy-type'),
      billing: document.getElementById('filter-billing'),
      startDate: document.getElementById('filter-start-date'),
      endDate: document.getElementById('filter-end-date'),
      comparison: document.getElementById('filter-comparison'),
      topN: document.getElementById('filter-topn')
    };

    this._bindEvents();

    eventBus.on('data:imported', () => this._refreshBuildingList());
    stateManager.subscribe(state => this._syncUI(state));
  }

  _bindEvents() {
    const el = this.elements;

    el.building.addEventListener('change', () => {
      const val = el.building.value || null;
      stateManager.setState({ selectedBuildingId: val, selectedFloorId: null });
      this._refreshFloorList(val);
    });

    el.floor.addEventListener('change', () => {
      stateManager.setState({ selectedFloorId: el.floor.value || null });
    });

    el.energyType.addEventListener('change', () => {
      stateManager.setState({ energyType: el.energyType.value });
    });

    el.billing.addEventListener('change', () => {
      stateManager.setState({ billingMethod: el.billing.value });
    });

    el.startDate.addEventListener('change', () => {
      const state = stateManager.getState();
      stateManager.setState({
        timeRange: { start: el.startDate.value || null, end: state.timeRange.end }
      });
    });

    el.endDate.addEventListener('change', () => {
      const state = stateManager.getState();
      stateManager.setState({
        timeRange: { start: state.timeRange.start, end: el.endDate.value || null }
      });
    });

    el.comparison.addEventListener('change', () => {
      stateManager.setState({ comparisonMode: el.comparison.value });
    });

    el.topN.addEventListener('change', () => {
      const v = parseInt(el.topN.value) || 10;
      stateManager.setState({ topN: Math.max(5, Math.min(50, v)) });
    });
  }

  async _refreshBuildingList() {
    const el = this.elements.building;
    const currentVal = el.value;
    el.innerHTML = '<option value="">全部楼栋</option>';

    try {
      const dataStore = (await import('../storage/data-store.js')).default;
      const buildings = await dataStore.getAll('buildings');
      buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name || b.id;
        el.appendChild(opt);
      });
      if (currentVal) el.value = currentVal;

      // Update summary
      const devices = await dataStore.count('devices');
      const readings = await dataStore.count('meter_readings');
      document.getElementById('summary-buildings').textContent = buildings.length;
      document.getElementById('summary-devices').textContent = devices;
      document.getElementById('summary-readings').textContent = readings;
    } catch (e) {
      console.error('Failed to refresh building list:', e);
    }
  }

  async _refreshFloorList(buildingId) {
    const el = this.elements.floor;
    el.innerHTML = '<option value="">全部楼层</option>';

    if (!buildingId) return;

    try {
      const dataStore = (await import('../storage/data-store.js')).default;
      const floors = await dataStore.getByIndex('floors', 'building_id', buildingId);
      floors.sort((a, b) => (a.floor_number || 0) - (b.floor_number || 0));
      floors.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = `${f.floor_number || f.id}层`;
        el.appendChild(opt);
      });
    } catch (e) {
      console.error('Failed to refresh floor list:', e);
    }
  }

  _syncUI(state) {
    const el = this.elements;
    if (el.building.value !== (state.selectedBuildingId || '')) el.building.value = state.selectedBuildingId || '';
    if (el.floor.value !== (state.selectedFloorId || '')) el.floor.value = state.selectedFloorId || '';
    if (el.energyType.value !== state.energyType) el.energyType.value = state.energyType;
    if (el.billing.value !== state.billingMethod) el.billing.value = state.billingMethod;
    if (state.timeRange.start && el.startDate.value !== state.timeRange.start) el.startDate.value = state.timeRange.start;
    if (state.timeRange.end && el.endDate.value !== state.timeRange.end) el.endDate.value = state.timeRange.end;
    if (el.comparison.value !== state.comparisonMode) el.comparison.value = state.comparisonMode;
  }
}

export const filterController = new FilterController();
