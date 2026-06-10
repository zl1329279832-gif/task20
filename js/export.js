/* ===== HTML报告导出模块 ===== */
/* 修复: 报告中嵌入 dataVersion + filterChecksum, 确保可追溯 */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Export = {
    generateReport(data) {
        const { overview, trend, ranking, heatmap, yoy, mom, anomalies, recommendations, filter, generatedAt, carbonData, demandCost, transferable, strategyComparison } = data;
        const title = '楼宇能耗分析报告';
        const date = generatedAt || new Date().toLocaleString('zh-CN');
        const filterDesc = this._describeFilter(filter);
        const fmt = (v, d = 2) => (v == null || isNaN(v)) ? '-' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });

        /* ===== 版本追溯信息 ===== */
        const dataVersion = data._dataSessionVersion || '-';
        const queryId = data._queryId || '-';
        const filterChecksum = this._filterChecksum(filter);

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

        /* ===== 碳排放段 ===== */
        let carbonSection = '';
        if (carbonData) {
            carbonSection = `<div class="section"><h2>碳排放核算</h2><div class="summary-grid">
                <div class="summary-card"><div class="label">总碳排放</div><div class="value">${fmt(carbonData.totalCarbon, 0)}</div><div class="unit">kg CO₂</div></div>
                <div class="summary-card"><div class="label">碳排强度</div><div class="value">${fmt(carbonData.intensity, 3)}</div><div class="unit">kg CO₂/kWh</div></div>
                <div class="summary-card"><div class="label">需量成本</div><div class="value">${demandCost ? fmt(demandCost.totalDemandCost, 0) : '-'}</div><div class="unit">元</div></div>
                <div class="summary-card"><div class="label">可转移负荷</div><div class="value">${transferable ? fmt(transferable.totalTransferable, 0) : '-'}</div><div class="unit">kWh</div></div>
            </div>`;
            if (carbonData.byMonth && carbonData.byMonth.length) {
                carbonSection += '<table><thead><tr><th>月份</th><th>碳排放(kg CO₂)</th><th>能耗(kWh)</th><th>碳排强度</th></tr></thead><tbody>';
                carbonData.byMonth.forEach(m => { carbonSection += `<tr><td>${m.month}</td><td>${fmt(m.carbon, 1)}</td><td>${fmt(m.energy, 1)}</td><td>${fmt(m.intensity, 3)}</td></tr>`; });
                carbonSection += '</tbody></table>';
            }
            carbonSection += '</div>';
        }

        /* ===== 策略对比段 ===== */
        let strategySection = '';
        if (strategyComparison && strategyComparison.length) {
            strategySection = `<div class="section"><h2>策略对比</h2><table><thead><tr><th>策略名称</th><th>预测成本(元)</th><th>预测碳排放(kg)</th><th>峰值需量(kW)</th><th>节省成本(元)</th><th>碳减排率</th></tr></thead><tbody>`;
            strategyComparison.forEach(s => {
                const r = s.results;
                strategySection += `<tr><td>${s.name}${s.is_baseline ? ' (基线)' : ''}</td><td>${fmt(r.projected.totalCost, 0)}</td><td>${fmt(r.projected.totalCarbon, 0)}</td><td>${fmt(r.projected.peakDemand, 0)}</td><td>${fmt(r.savings.cost, 0)}</td><td>${fmt(r.reductionPct, 1)}%</td></tr>`;
            });
            strategySection += '</tbody></table></div>';
        }

        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f3f4f6;color:#1f2937;line-height:1.6;padding:24px}.report{max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.08);overflow:hidden}.header{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;padding:32px;text-align:center}.header h1{font-size:24px;margin-bottom:8px}.header .meta{font-size:13px;opacity:.85}.section{padding:24px 32px;border-bottom:1px solid #e5e7eb}.section:last-child{border-bottom:none}.section h2{font-size:18px;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #2563eb;display:inline-block}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}.summary-card{background:#f9fafb;border-radius:8px;padding:16px;text-align:center}.summary-card .label{font-size:12px;color:#6b7280;margin-bottom:4px}.summary-card .value{font-size:24px;font-weight:700}.summary-card .unit{font-size:12px;color:#9ca3af}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}th{background:#f3f4f6;padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb}td{padding:8px 12px;border-bottom:1px solid #f3f4f6}.anomaly-item{background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}.anomaly-item.error{background:#fef2f2;border-color:#ef4444}.rec-item{background:#f0fdf4;border-left:4px solid #10b981;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}.rec-item .rec-title{font-weight:600;margin-bottom:4px}.bar-chart{margin-top:12px}.bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}.bar-label{width:100px;text-align:right;font-size:12px;color:#374151;flex-shrink:0}.bar-track{flex:1;background:#e5e7eb;border-radius:4px;height:20px;overflow:hidden}.bar-fill{height:100%;border-radius:4px}.bar-value{width:80px;font-size:12px;color:#6b7280;flex-shrink:0}.footer{text-align:center;padding:20px;font-size:12px;color:#9ca3af;background:#f9fafb}.version-info{font-size:11px;color:#9ca3af;text-align:center;padding:8px;background:#f9fafb;border-top:1px solid #e5e7eb}</style></head>
<body><div class="report">
<div class="header"><h1>${title}</h1><div class="meta">生成时间: ${date} | 筛选: ${filterDesc}</div></div>
<div class="section"><h2>数据总览</h2><div class="summary-grid">
<div class="summary-card"><div class="label">总能耗</div><div class="value">${fmt(overview?.totalEnergy,0)}</div><div class="unit">kWh</div></div>
<div class="summary-card"><div class="label">总电费</div><div class="value">${fmt(overview?.totalCost,2)}</div><div class="unit">元</div></div>
<div class="summary-card"><div class="label">同比变化</div><div class="value" style="color:${(yoy?.change||0)>0?'#dc2626':'#059669'}">${yoy?.change>0?'+':''}${fmt(yoy?.change,1)}%</div><div class="unit">${yoy?.previousYear||'-'} vs ${yoy?.currentYear||'-'}</div></div>
<div class="summary-card"><div class="label">环比变化</div><div class="value" style="color:${(mom?.change||0)>0?'#dc2626':'#059669'}">${mom?.change>0?'+':''}${fmt(mom?.change,1)}%</div><div class="unit">本月 vs 上月</div></div>
</div></div>
${trendTable}${rankingBars}${heatmapTable}${carbonSection}${strategySection}${anomalySection}${recSection}
<div class="footer"><p>本报告由楼宇能耗分析系统自动生成 | ${date}</p></div>
<div class="version-info">数据版本: ${dataVersion} | 查询ID: ${queryId} | 筛选校验码: ${filterChecksum}</div>
</div></body></html>`;
    },

    generateStrategyReport(strategies) {
        if (!strategies || !strategies.length) return '<html><body><p>无策略数据</p></body></html>';
        const title = '策略对比报告';
        const date = new Date().toLocaleString('zh-CN');
        const fmt = (v, d = 2) => (v == null || isNaN(v)) ? '-' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });

        let table = '<table><thead><tr><th>策略名称</th><th>基线成本</th><th>预测成本</th><th>节省</th><th>基线碳排</th><th>预测碳排</th><th>减排率</th><th>峰值需量(kW)</th></tr></thead><tbody>';
        strategies.forEach(s => {
            const r = s.results;
            table += `<tr><td>${s.name}${s.is_baseline ? ' (基线)' : ''}</td><td>${fmt(r.baseline.totalCost,0)}</td><td>${fmt(r.projected.totalCost,0)}</td><td>${fmt(r.savings.cost,0)}</td><td>${fmt(r.baseline.totalCarbon,0)}</td><td>${fmt(r.projected.totalCarbon,0)}</td><td>${fmt(r.reductionPct,1)}%</td><td>${fmt(r.projected.peakDemand,0)}</td></tr>`;
        });
        table += '</tbody></table>';

        let monthlySection = '';
        const first = strategies.find(s => s.results && s.results.monthlyProjection);
        if (first) {
            monthlySection = '<h2>月度碳排放投影</h2><table><thead><tr><th>月份</th><th>基线碳排</th><th>预测碳排</th><th>节省碳排</th></tr></thead><tbody>';
            first.results.monthlyProjection.forEach(m => {
                monthlySection += `<tr><td>${m.month}</td><td>${fmt(m.baselineCarbon,1)}</td><td>${fmt(m.projectedCarbon,1)}</td><td>${fmt(m.carbonSaved,1)}</td></tr>`;
            });
            monthlySection += '</tbody></table>';
        }

        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f3f4f6;color:#1f2937;line-height:1.6;padding:24px}.report{max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.08);overflow:hidden}.header{background:linear-gradient(135deg,#059669,#10b981);color:#fff;padding:32px;text-align:center}.header h1{font-size:24px;margin-bottom:8px}.section{padding:24px 32px;border-bottom:1px solid #e5e7eb}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}th{background:#f3f4f6;padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb}td{padding:8px 12px;border-bottom:1px solid #f3f4f6}.footer{text-align:center;padding:20px;font-size:12px;color:#9ca3af}</style></head>
<body><div class="report"><div class="header"><h1>${title}</h1><div style="font-size:13px;opacity:.85">生成时间: ${date}</div></div>
<div class="section"><h2>策略参数与效果对比</h2>${table}</div>
<div class="section">${monthlySection}</div>
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
    },

    /* ---- 简单筛选校验码: 用于追溯报告使用的筛选条件 ---- */
    _filterChecksum(filter) {
        if (!filter) return 'none';
        const str = JSON.stringify(filter);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
    }
};
