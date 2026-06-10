/* ===== HTML报告导出模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Export = {
    generateReport(data) {
        const { overview, trend, ranking, heatmap, yoy, mom, anomalies, recommendations, filter, generatedAt } = data;
        const title = '楼宇能耗分析报告';
        const date = generatedAt || new Date().toLocaleString('zh-CN');
        const filterDesc = this._describeFilter(filter);
        const fmt = (v, d = 2) => (v == null || isNaN(v)) ? '-' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });

        let trendTable = '';
        if (trend && trend.length) {
            trendTable = `<div class="section"><h2>尖峰平谷用电趋势</h2><table><thead><tr><th>时段</th><th>尖峰</th><th>峰</th><th>平</th><th>谷</th><th>合计</th></tr></thead><tbody>`;
            trend.forEach(t => { trendTable += `<tr><td>${t.period}</td><td>${fmt(t.sharp_peak)}</td><td>${fmt(t.peak)}</td><td>${fmt(t.flat)}</td><td>${fmt(t.valley)}</td><td><b>${fmt(t.energy)}</b></td></tr>`; });
            trendTable += '</tbody></table></div>';
        }

        let rankingBars = '';
        if (ranking && ranking.length) {
            const max = ranking[0]?.energy || 1;
            rankingBars = `<div class="section"><h2>设备能耗排行 TOP 15</h2><div class="bar-chart">`;
            ranking.forEach((d, i) => {
                rankingBars += `<div class="bar-row"><span class="bar-label">${d.device_name || d.meter_id}</span><div class="bar-track"><div class="bar-fill" style="width:${(d.energy/max*100).toFixed(1)}%;background:${i<3?'#ef4444':i<8?'#f59e0b':'#2563eb'}"></div></div><span class="bar-value">${d.energy.toFixed(1)} kWh</span></div>`;
            });
            rankingBars += '</div></div>';
        }

        let heatmapTable = '';
        if (heatmap && heatmap.length) {
            const total = heatmap.reduce((s, h) => s + h.energy, 0);
            heatmapTable = `<div class="section"><h2>楼层能耗分布</h2><table><thead><tr><th>楼层</th><th>楼栋</th><th>能耗(kWh)</th><th>占比</th></tr></thead><tbody>`;
            heatmap.sort((a, b) => b.energy - a.energy).forEach(h => { heatmapTable += `<tr><td>${h.floor_name||h.floor_id}</td><td>${h.building_id||'-'}</td><td>${fmt(h.energy)}</td><td>${total > 0 ? (h.energy/total*100).toFixed(1)+'%' : '-'}</td></tr>`; });
            heatmapTable += '</tbody></table></div>';
        }

        let anomalySection = '';
        if (anomalies && anomalies.length) {
            anomalySection = `<div class="section"><h2>异常能耗提醒 (${anomalies.length}项)</h2>`;
            anomalies.slice(0, 15).forEach(a => { anomalySection += `<div class="anomaly-item ${a.severity==='error'?'error':''}">电表 ${a.meter_id||'-'} | ${a.timestamp ? new Date(a.timestamp).toLocaleString('zh-CN') : '-'} | 能耗 ${fmt(a.energy)} kWh (预期 ~${fmt(a.expected)})</div>`; });
            if (anomalies.length > 15) anomalySection += `<div style="text-align:center;color:#9ca3af;font-size:12px;margin-top:8px">还有 ${anomalies.length-15} 条</div>`;
            anomalySection += '</div>';
        }

        let recSection = '';
        if (recommendations && recommendations.length) {
            recSection = `<div class="section"><h2>节能建议</h2>`;
            recommendations.forEach(r => { recSection += `<div class="rec-item"><div class="rec-title">${r.title} ${r.saving ? `(预计节省 ¥${r.saving}/月)` : ''}</div><div>${r.description}</div></div>`; });
            recSection += '</div>';
        }

        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f3f4f6;color:#1f2937;line-height:1.6;padding:24px}.report{max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.08);overflow:hidden}.header{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;padding:32px;text-align:center}.header h1{font-size:24px;margin-bottom:8px}.header .meta{font-size:13px;opacity:.85}.section{padding:24px 32px;border-bottom:1px solid #e5e7eb}.section:last-child{border-bottom:none}.section h2{font-size:18px;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #2563eb;display:inline-block}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}.summary-card{background:#f9fafb;border-radius:8px;padding:16px;text-align:center}.summary-card .label{font-size:12px;color:#6b7280;margin-bottom:4px}.summary-card .value{font-size:24px;font-weight:700}.summary-card .unit{font-size:12px;color:#9ca3af}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}th{background:#f3f4f6;padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb}td{padding:8px 12px;border-bottom:1px solid #f3f4f6}.anomaly-item{background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}.anomaly-item.error{background:#fef2f2;border-color:#ef4444}.rec-item{background:#f0fdf4;border-left:4px solid #10b981;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}.rec-item .rec-title{font-weight:600;margin-bottom:4px}.bar-chart{margin-top:12px}.bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}.bar-label{width:100px;text-align:right;font-size:12px;color:#374151;flex-shrink:0}.bar-track{flex:1;background:#e5e7eb;border-radius:4px;height:20px;overflow:hidden}.bar-fill{height:100%;border-radius:4px}.bar-value{width:80px;font-size:12px;color:#6b7280;flex-shrink:0}.footer{text-align:center;padding:20px;font-size:12px;color:#9ca3af;background:#f9fafb}</style></head>
<body><div class="report">
<div class="header"><h1>${title}</h1><div class="meta">生成时间: ${date} | 筛选: ${filterDesc}</div></div>
<div class="section"><h2>数据总览</h2><div class="summary-grid">
<div class="summary-card"><div class="label">总能耗</div><div class="value">${fmt(overview?.totalEnergy,0)}</div><div class="unit">kWh</div></div>
<div class="summary-card"><div class="label">总电费</div><div class="value">${fmt(overview?.totalCost,2)}</div><div class="unit">元</div></div>
<div class="summary-card"><div class="label">同比变化</div><div class="value" style="color:${(yoy?.change||0)>0?'#dc2626':'#059669'}">${yoy?.change>0?'+':''}${fmt(yoy?.change,1)}%</div><div class="unit">${yoy?.previousYear||'-'} vs ${yoy?.currentYear||'-'}</div></div>
<div class="summary-card"><div class="label">环比变化</div><div class="value" style="color:${(mom?.change||0)>0?'#dc2626':'#059669'}">${mom?.change>0?'+':''}${fmt(mom?.change,1)}%</div><div class="unit">本月 vs 上月</div></div>
</div></div>
${trendTable}${rankingBars}${heatmapTable}${anomalySection}${recSection}
<div class="footer"><p>本报告由楼宇能耗分析系统自动生成 | ${date}</p></div>
</div></body></html>`;
    },

    download(html, filename) {
        filename = filename || `能耗分析报告_${EnergyApp.utils.formatDate(new Date())}.html`;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    _describeFilter(filter) {
        if (!filter) return '全部数据';
        const parts = [];
        if (filter.buildingId && filter.buildingId !== 'all') parts.push('楼栋: ' + filter.buildingId);
        if (filter.startDate) parts.push('从: ' + filter.startDate);
        if (filter.endDate) parts.push('至: ' + filter.endDate);
        if (filter.energyType && filter.energyType !== 'all') parts.push('类型: ' + (EnergyApp.utils.energyTypeLabels[filter.energyType] || filter.energyType));
        return parts.length ? parts.join(', ') : '全部数据';
    }
};
