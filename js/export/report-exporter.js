export class ReportExporter {
  generateReport(state, chartImages, summaryData) {
    const now = new Date();
    const energyLabels = { total: '总能耗', ac: '空调能耗', lighting: '照明能耗' };
    const billingLabels = { tou: '分时电价', flat: '统一电价' };
    const compLabels = { yoy: '同比', mom: '环比' };

    const chartsHtml = Object.entries(chartImages)
      .filter(([, url]) => url)
      .map(([key, url]) => {
        const titles = {
          buildingOverview: '楼栋能耗总览',
          floorHeatmap: '楼层热力图',
          deviceRanking: '设备能耗排行',
          touTrend: '尖峰平谷用电趋势',
          yoyMom: '同比环比分析',
          anomalyPanel: '异常能耗提醒',
          suggestionPanel: '节能建议'
        };
        return `<div class="report-chart">
          <h3>${titles[key] || key}</h3>
          <img src="${url}" style="max-width:100%;height:auto;">
        </div>`;
      }).join('');

    // For panels that don't have toDataURL, capture their innerHTML
    const anomalyContent = document.getElementById('chart-anomaly')?.innerHTML || '';
    const suggestionContent = document.getElementById('chart-suggestions')?.innerHTML || '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>楼宇能耗分析报告 - ${now.toLocaleDateString('zh-CN')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: #2c3e50; padding: 40px; max-width: 1100px; margin: 0 auto; }
    .report-header { text-align: center; border-bottom: 2px solid #3498db; padding-bottom: 20px; margin-bottom: 30px; }
    .report-header h1 { font-size: 24px; color: #2c3e50; }
    .report-header .subtitle { color: #7f8c8d; font-size: 14px; margin-top: 8px; }
    .report-meta { display: flex; justify-content: space-around; background: #f5f6fa; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .meta-item { text-align: center; }
    .meta-label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; }
    .meta-value { font-size: 18px; font-weight: 600; color: #2c3e50; margin-top: 4px; }
    .report-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .summary-card { background: #fff; border: 1px solid #dcdde1; border-radius: 8px; padding: 16px; text-align: center; }
    .summary-card .label { font-size: 12px; color: #7f8c8d; }
    .summary-card .value { font-size: 24px; font-weight: 700; color: #3498db; margin-top: 4px; }
    .report-chart { background: #fff; border: 1px solid #dcdde1; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .report-chart h3 { font-size: 16px; color: #2c3e50; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
    .report-section { margin-bottom: 24px; }
    .report-section h3 { font-size: 16px; margin-bottom: 12px; }
    .report-footer { text-align: center; color: #7f8c8d; font-size: 12px; border-top: 1px solid #dcdde1; padding-top: 16px; margin-top: 40px; }
    .alert-card { padding: 8px 12px; border-left: 3px solid #e67e22; margin-bottom: 6px; background: #fef9e7; border-radius: 0 6px 6px 0; font-size: 13px; }
    .alert-card.critical { border-left-color: #e74c3c; background: #fdf0ef; }
    .alert-card.info { border-left-color: #17a2b8; background: #eaf6fb; }
    .suggestion-card { padding: 8px 12px; border-left: 3px solid #27ae60; margin-bottom: 6px; background: #f0faf4; border-radius: 0 6px 6px 0; font-size: 13px; }
    @media print { body { padding: 20px; } .report-chart { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>楼宇能耗分析报告</h1>
    <div class="subtitle">生成时间: ${now.toLocaleString('zh-CN')} | 能耗类型: ${energyLabels[state.energyType] || state.energyType} | 计费方式: ${billingLabels[state.billingMethod] || state.billingMethod}</div>
  </div>

  <div class="report-meta">
    <div class="meta-item"><div class="meta-label">分析时段</div><div class="meta-value">${state.timeRange.start || '全部'} ~ ${state.timeRange.end || '全部'}</div></div>
    <div class="meta-item"><div class="meta-label">对比方式</div><div class="meta-value">${compLabels[state.comparisonMode] || state.comparisonMode}</div></div>
    <div class="meta-item"><div class="meta-label">筛选楼栋</div><div class="meta-value">${state.selectedBuildingId || '全部'}</div></div>
  </div>

  <div class="report-summary">
    <div class="summary-card"><div class="label">楼栋数</div><div class="value">${summaryData.buildings || 0}</div></div>
    <div class="summary-card"><div class="label">设备数</div><div class="value">${summaryData.devices || 0}</div></div>
    <div class="summary-card"><div class="label">读数记录</div><div class="value">${summaryData.readings || 0}</div></div>
  </div>

  ${chartsHtml}

  <div class="report-section">
    <h3>异常能耗提醒</h3>
    ${anomalyContent || '<p style="color:#7f8c8d">暂无异常</p>'}
  </div>

  <div class="report-section">
    <h3>节能建议</h3>
    ${suggestionContent || '<p style="color:#7f8c8d">暂无建议</p>'}
  </div>

  <div class="report-footer">
    <p>本报告由楼宇能耗分析系统自动生成 | ${now.toLocaleDateString('zh-CN')}</p>
  </div>
</body>
</html>`;
  }

  downloadReport(html, filename) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
