/* ===== 工具函数模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.utils = {
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    },
    formatDate(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },
    formatDateTime(date) {
        const d = new Date(date);
        return `${this.formatDate(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    },
    formatNumber(num, decimals = 2) {
        if (num == null || isNaN(num)) return '-';
        return Number(num).toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    },
    formatEnergy(kwh) {
        if (kwh == null || isNaN(kwh)) return '-';
        if (kwh >= 10000) return (kwh / 10000).toFixed(2) + ' 万kWh';
        return kwh.toFixed(2) + ' kWh';
    },
    formatCost(yuan) {
        if (yuan == null || isNaN(yuan)) return '-';
        return '¥' + yuan.toFixed(2);
    },
    parseDate(str) {
        if (!str) return null;
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    },
    getMonthKey(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    },
    getQuarterKey(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-Q${Math.floor(d.getMonth()/3)+1}`;
    },
    getYearKey(date) { return String(new Date(date).getFullYear()); },
    debounce(fn, delay) {
        let timer;
        return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); };
    },
    throttle(fn, limit) {
        let inThrottle;
        return function(...args) { if (!inThrottle) { fn.apply(this, args); inThrottle = true; setTimeout(() => inThrottle = false, limit); } };
    },
    groupBy(arr, keyFn) {
        const map = new Map();
        for (const item of arr) { const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn]; if (!map.has(key)) map.set(key, []); map.get(key).push(item); }
        return map;
    },
    sumBy(arr, key) { return arr.reduce((s, item) => s + (Number(item[key]) || 0), 0); },
    avgBy(arr, key) { return arr.length ? this.sumBy(arr, key) / arr.length : 0; },
    clamp(val, min, max) { return Math.max(min, Math.min(max, val)); },
    lerp(a, b, t) { return a + (b - a) * t; },
    getColorForValue(value, min, max) {
        const t = max === min ? 0.5 : (value - min) / (max - min);
        const r = Math.round(16 + t * (220 - 16));
        const g = Math.round(185 - t * (185 - 38));
        const b = Math.round(129 - t * (129 - 38));
        return `rgb(${r},${g},${b})`;
    },
    timePeriodLabels: { sharp_peak: '尖峰', peak: '峰', flat: '平', valley: '谷' },
    timePeriodColors: { sharp_peak: '#dc2626', peak: '#ef4444', flat: '#f59e0b', valley: '#10b981' },
    energyTypeLabels: { electricity: '电力', ac: '空调', lighting: '照明' }
};
