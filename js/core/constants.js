// Entity type enumeration
export const ENTITY_TYPES = {
  BUILDING: 'buildings',
  FLOOR: 'floors',
  ROOM: 'rooms',
  DEVICE: 'devices',
  METER_READING: 'meter_readings',
  AC_ENERGY: 'ac_energy',
  LIGHTING_ENERGY: 'lighting_energy',
  TOU_PRICING: 'tou_pricing'
};

// Time-of-use period definitions
export const TOU_PERIODS = {
  SHARP: { key: 'sharp', label: '尖', color: '#e74c3c', defaultHours: [[10,12],[19,21]] },
  PEAK:  { key: 'peak',  label: '峰', color: '#e67e22', defaultHours: [[8,10],[12,17],[21,23]] },
  FLAT:  { key: 'flat',  label: '平', color: '#3498db', defaultHours: [[7,8],[17,19],[23,24]] },
  VALLEY:{ key: 'valley',label: '谷', color: '#27ae60', defaultHours: [[0,7]] }
};

// Anomaly types
export const ANOMALY_TYPES = {
  READING_REVERSAL:   { key: 'reading_reversal',   label: '读数倒挂',     severity: 'critical' },
  MISSING_TIMESTAMP:  { key: 'missing_timestamp',  label: '缺失时间点',   severity: 'warning' },
  DUPLICATE_METER:    { key: 'duplicate_meter',     label: '重复电表',     severity: 'warning' },
  OWNERSHIP_ERROR:    { key: 'ownership_error',     label: '设备归属错误', severity: 'critical' },
  CROSS_DAY_BILLING:  { key: 'cross_day_billing',   label: '跨日计费',     severity: 'info' },
  FALSE_PEAK:         { key: 'false_peak',          label: '异常高峰误判', severity: 'info' },
  HIGH_CONSUMPTION:   { key: 'high_consumption',    label: '异常高能耗',   severity: 'warning' }
};

export const SEVERITY_LEVELS = {
  CRITICAL: { key: 'critical', label: '严重', color: '#e74c3c', order: 0 },
  WARNING:  { key: 'warning',  label: '警告', color: '#e67e22', order: 1 },
  INFO:     { key: 'info',     label: '提示', color: '#3498db', order: 2 }
};

// Device types
export const DEVICE_TYPES = {
  AC: { key: 'ac', label: '空调' },
  LIGHTING: { key: 'lighting', label: '照明' },
  ELEVATOR: { key: 'elevator', label: '电梯' },
  OTHER: { key: 'other', label: '其他' }
};

// Energy types for filtering
export const ENERGY_TYPES = {
  TOTAL: { key: 'total', label: '总能耗' },
  AC: { key: 'ac', label: '空调能耗' },
  LIGHTING: { key: 'lighting', label: '照明能耗' }
};

// Billing methods
export const BILLING_METHODS = {
  FLAT: { key: 'flat', label: '统一电价' },
  TOU: { key: 'tou', label: '分时电价' }
};

// Field definitions for each entity type
export const FIELD_DEFINITIONS = {
  [ENTITY_TYPES.BUILDING]: {
    fields: {
      id:          { type: 'string', required: true,  aliases: ['building_id', '楼栋ID', '楼栋编号', 'bldg_id'] },
      name:        { type: 'string', required: true,  aliases: ['building_name', '楼栋名称', '楼栋名', 'bldg_name'] },
      area:        { type: 'number', required: false, aliases: ['building_area', '面积', '建筑面积'], min: 0 },
      floors_count:{ type: 'number', required: false, aliases: ['floor_count', '楼层数', '层数'], min: 1, max: 200 },
      build_year:  { type: 'number', required: false, aliases: ['year', '建成年份', '建筑年份'], min: 1900, max: 2030 }
    }
  },
  [ENTITY_TYPES.FLOOR]: {
    fields: {
      id:          { type: 'string', required: true,  aliases: ['floor_id', '楼层ID', '楼层编号'] },
      building_id: { type: 'string', required: true,  aliases: ['bldg_id', '楼栋ID', '所属楼栋'] },
      floor_number:{ type: 'number', required: true,  aliases: ['floor_no', '楼层号', '层号'], min: -5, max: 200 },
      area:        { type: 'number', required: false, aliases: ['floor_area', '面积', '楼层面积'], min: 0 }
    }
  },
  [ENTITY_TYPES.ROOM]: {
    fields: {
      id:          { type: 'string', required: true,  aliases: ['room_id', '房间ID', '房间编号'] },
      floor_id:    { type: 'string', required: true,  aliases: ['楼层ID', '所属楼层'] },
      room_number: { type: 'string', required: false, aliases: ['room_no', '房间号'] },
      area:        { type: 'number', required: false, aliases: ['room_area', '面积', '房间面积'], min: 0 },
      type:        { type: 'string', required: false, aliases: ['room_type', '房间类型', '用途'] }
    }
  },
  [ENTITY_TYPES.DEVICE]: {
    fields: {
      id:           { type: 'string', required: true,  aliases: ['device_id', '设备ID', '设备编号'] },
      room_id:      { type: 'string', required: true,  aliases: ['房间ID', '所属房间'] },
      device_type:  { type: 'string', required: true,  aliases: ['type', '设备类型', '类型'] },
      rated_power:  { type: 'number', required: false, aliases: ['power', '额定功率', '功率'], min: 0 },
      install_date: { type: 'date',   required: false, aliases: ['安装日期', '安装时间'] }
    }
  },
  [ENTITY_TYPES.METER_READING]: {
    fields: {
      meter_id:  { type: 'string',  required: true,  aliases: ['电表ID', '表号', '表计编号'] },
      device_id: { type: 'string',  required: true,  aliases: ['设备ID', '设备编号'] },
      timestamp: { type: 'date',    required: true,  aliases: ['time', '时间', '记录时间', '读数时间', '日期'] },
      reading:   { type: 'number',  required: true,  aliases: ['value', '读数', '表读数', '电表读数'], min: 0 },
      unit:      { type: 'string',  required: false, aliases: ['单位'], default: 'kWh' }
    }
  },
  [ENTITY_TYPES.AC_ENERGY]: {
    fields: {
      device_id:           { type: 'string', required: true,  aliases: ['设备ID', '空调ID'] },
      timestamp:           { type: 'date',   required: true,  aliases: ['time', '时间', '记录时间'] },
      power_consumption:   { type: 'number', required: true,  aliases: ['consumption', '能耗', '用电量', '功耗'], min: 0 },
      temperature_setting: { type: 'number', required: false, aliases: ['temp', '温度设定', '设定温度'], min: 10, max: 35 },
      mode:                { type: 'string', required: false, aliases: ['运行模式', '模式'] }
    }
  },
  [ENTITY_TYPES.LIGHTING_ENERGY]: {
    fields: {
      device_id:         { type: 'string', required: true,  aliases: ['设备ID', '照明ID'] },
      timestamp:         { type: 'date',   required: true,  aliases: ['time', '时间', '记录时间'] },
      power_consumption: { type: 'number', required: true,  aliases: ['consumption', '能耗', '用电量', '功耗'], min: 0 },
      duration:          { type: 'number', required: false, aliases: ['运行时长', '时长', '持续时间'], min: 0 },
      brightness:        { type: 'number', required: false, aliases: ['亮度', '亮度级别'], min: 0, max: 100 }
    }
  },
  [ENTITY_TYPES.TOU_PRICING]: {
    fields: {
      time_period:   { type: 'string', required: true,  aliases: ['period', '时段', '时间段', '电价类型'] },
      start_time:    { type: 'string', required: true,  aliases: ['start', '开始时间', '起始时间'] },
      end_time:      { type: 'string', required: true,  aliases: ['end', '结束时间', '截止时间'] },
      price_per_kwh: { type: 'number', required: true,  aliases: ['price', '电价', '单价', '每度电价'], min: 0 }
    }
  }
};

// IndexedDB configuration
export const DB_CONFIG = {
  name: 'EnergyAnalysisDB',
  version: 1,
  stores: {
    buildings:        { keyPath: 'id', indexes: [{ name: 'name', keyPath: 'name' }] },
    floors:           { keyPath: 'id', indexes: [{ name: 'building_id', keyPath: 'building_id' }] },
    rooms:            { keyPath: 'id', indexes: [{ name: 'floor_id', keyPath: 'floor_id' }, { name: 'type', keyPath: 'type' }] },
    devices:          { keyPath: 'id', indexes: [{ name: 'room_id', keyPath: 'room_id' }, { name: 'device_type', keyPath: 'device_type' }] },
    meter_readings:   { autoIncrement: true, indexes: [{ name: 'device_id', keyPath: 'device_id' }, { name: 'timestamp', keyPath: 'timestamp' }, { name: 'device_timestamp', keyPath: ['device_id', 'timestamp'] }] },
    ac_energy:        { autoIncrement: true, indexes: [{ name: 'device_id', keyPath: 'device_id' }, { name: 'timestamp', keyPath: 'timestamp' }, { name: 'device_timestamp', keyPath: ['device_id', 'timestamp'] }] },
    lighting_energy:  { autoIncrement: true, indexes: [{ name: 'device_id', keyPath: 'device_id' }, { name: 'timestamp', keyPath: 'timestamp' }, { name: 'device_timestamp', keyPath: ['device_id', 'timestamp'] }] },
    tou_pricing:      { keyPath: 'time_period', indexes: [] },
    schemes:          { keyPath: 'id', indexes: [{ name: 'name', keyPath: 'name' }, { name: 'created_at', keyPath: 'created_at' }] },
    anomalies:        { autoIncrement: true, indexes: [{ name: 'type', keyPath: 'type' }, { name: 'severity', keyPath: 'severity' }, { name: 'entity_id', keyPath: 'entity_id' }] }
  }
};

// Default state
export const DEFAULT_STATE = {
  selectedBuildingId: null,
  selectedFloorId: null,
  timeRange: { start: null, end: null },
  energyType: 'total',
  billingMethod: 'tou',
  topN: 10,
  comparisonMode: 'mom',
  anomalyThreshold: 'medium'
};

// Chart colors palette
export const COLORS = {
  primary: '#2c3e50',
  secondary: '#34495e',
  accent: '#3498db',
  success: '#27ae60',
  warning: '#e67e22',
  danger: '#e74c3c',
  info: '#17a2b8',
  light: '#ecf0f1',
  dark: '#2c3e50',
  chart: ['#3498db', '#e74c3c', '#27ae60', '#e67e22', '#9b59b6', '#1abc9c', '#f1c40f', '#e91e63', '#00bcd4', '#795548']
};
