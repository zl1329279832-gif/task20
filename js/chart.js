/* ===== 图表渲染模块 ===== */
window.EnergyApp = window.EnergyApp || {};

EnergyApp.Chart = {
    renderOverview(container, data, buildings) {
        const body = container.querySelector('.chart-body');
        if (!data || !data.length) { body.innerHTML = '<div class="empty-state"><p>暂无楼栋能耗数据</p></div>'; return; }
        const total = data.reduce((s, d) => s + d.energy, 0);
        const colors = ['#2563eb','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
        const w = 300, h = 260, cx = 150, cy = 120, R = 85, r = 52;
        let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;margin:0 auto;display:block">`;
        let angle = -Math.PI / 2;
        data.forEach((d, i) => {
            const slice = (d.energy / total) * Math.PI * 2;
            const end = angle + slice;
            const la = slice > Math.PI ? 1 : 0;
            const x1 = cx+R*Math.cos(angle), y1 = cy+R*Math.sin(angle);
            const x2 = cx+R*Math.cos(end), y2 = cy+R*Math.sin(end);
            const x3 = cx+r*Math.cos(end), y3 = cy+r*Math.sin(end);
            const x4 = cx+r*Math.cos(angle), y4 = cy+r*Math.sin(angle);
            svg += `<path d="M${x1},${y1} A${R},${R} 0 ${la} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${la} 0 ${x4},${y4}Z" fill="${colors[i%colors.length]}" opacity="0.85"><title>${d.building_name||d.building_id}: ${EnergyApp.utils.formatEnergy(d.energy)}</title></path>`;
            angle = end;
        });
        svg += `<text x="${cx}" y="${cy-4}" text-anchor="middle" class="donut-center-text">${EnergyApp.utils.formatNumber(total,0)}</text>`;
        svg += `<text x="${cx}" y="${cy+14}" text-anchor="middle" class="donut-center-label">kWh 总计</text></svg>`;
        svg += '<div class="chart-legend">';
        data.forEach((d, i) => { svg += `<div class="legend-item"><span class="legend-color" style="background:${colors[i%colors.length]}"></span>${d.building_name||d.building_id} (${(d.energy/total*100).toFixed(1)}%)</div>`; });
        svg += '</div>';
        body.innerHTML = svg;
    },

    renderHeatmap(container, data) {
        const body = container.querySelector('.chart-body');
        if (!data || !data.length) { body.innerHTML = '<div class="empty-state"><p>暂无楼层数据</p></div>'; return; }
        const sorted = [...data].sort((a,b) => { if (a.building_id !== b.building_id) return String(a.building_id).localeCompare(String(b.building_id)); return (b.floor_number||0) - (a.floor_number||0); });
        const maxE = Math.max(...sorted.map(d => d.energy), 1);
        const cellW = 90, cellH = 56, gap = 4, cols = 4;
        const rows = Math.ceil(sorted.length / cols);
        const svgW = cols * (cellW + gap), svgH = rows * (cellH + gap) + 40;
        let svg = `<svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%">`;
        sorted.forEach((d, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            const x = col * (cellW + gap), y = row * (cellH + gap);
            const color = EnergyApp.utils.getColorForValue(d.energy, 0, maxE);
            svg += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="6" fill="${color}" class="heatmap-cell"><title>${d.floor_name||d.floor_id}: ${EnergyApp.utils.formatEnergy(d.energy)}</title></rect>`;
            svg += `<text x="${x+cellW/2}" y="${y+22}" text-anchor="middle" fill="#fff" font-size="12" font-weight="600">${d.floor_name||d.floor_id}</text>`;
            svg += `<text x="${x+cellW/2}" y="${y+40}" text-anchor="middle" fill="rgba(255,255,255,.85)" font-size="10">${EnergyApp.utils.formatNumber(d.energy,0)} kWh</text>`;
        });
        const ly = rows * (cellH + gap) + 8;
        svg += `<defs><linearGradient id="hg"><stop offset="0%" stop-color="${EnergyApp.utils.getColorForValue(0,0,maxE)}"/><stop offset="100%" stop-color="${EnergyApp.utils.getColorForValue(maxE,0,maxE)}"/></linearGradient></defs>`;
        svg += `<rect x="20" y="${ly}" width="${svgW-40}" height="10" rx="5" fill="url(#hg)"/>`;
        svg += `<text x="20" y="${ly+24}" font-size="10" fill="#6b7280">低</text><text x="${svgW-20}" y="${ly+24}" text-anchor="end" font-size="10" fill="#6b7280">高</text></svg>`;
        body.innerHTML = svg;
    },

    renderRanking(container, data) {
        const body = container.querySelector('.chart-body');
        if (!data || !data.length) { body.innerHTML = '<div class="empty-state"><p>暂无设备数据</p></div>'; return; }
        const canvas = document.createElement('canvas');
        const barH = 28, gap = 6, pad = { top: 10, right: 80, bottom: 30, left: 120 };
        canvas.height = pad.top + data.length * (barH + gap) + pad.bottom;
        canvas.width = body.clientWidth || 500;
        canvas.style.width = '100%';
        body.innerHTML = '';
        body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        const maxE = Math.max(...data.map(d => d.energy), 1);
        const barW = cw - pad.left - pad.right;
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const x = pad.left + (barW * i / 4);
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, ch - pad.bottom); ctx.stroke();
            ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(EnergyApp.utils.formatNumber(maxE * i / 4, 0), x, ch - pad.bottom + 16);
        }
        const typeColors = { ac: '#ef4444', lighting: '#f59e0b', electricity: '#2563eb' };
        data.forEach((d, i) => {
            const y = pad.top + i * (barH + gap);
            const w = (d.energy / maxE) * barW;
            ctx.fillStyle = '#374151'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText((d.device_name || d.meter_id).substring(0, 14), pad.left - 8, y + barH / 2 + 4);
            ctx.fillStyle = typeColors[d.device_type] || '#2563eb';
            ctx.beginPath();
            if (ctx.roundRect) { ctx.roundRect(pad.left, y, Math.max(w, 2), barH, [0, 4, 4, 0]); }
            else { ctx.rect(pad.left, y, Math.max(w, 2), barH); }
            ctx.fill();
            ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(`${d.energy.toFixed(1)} kWh`, pad.left + w + 6, y + barH / 2 + 4);
        });
    },

    renderTrend(container, data) {
        const body = container.querySelector('.chart-body');
        if (!data || !data.length) { body.innerHTML = '<div class="empty-state"><p>暂无趋势数据</p></div>'; return; }
        const canvas = document.createElement('canvas');
        const pad = { top: 30, right: 30, bottom: 60, left: 70 };
        canvas.width = body.clientWidth || 700;
        canvas.height = 320;
        canvas.style.width = '100%';
        body.innerHTML = '';
        body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        const chartW = cw - pad.left - pad.right, chartH = ch - pad.top - pad.bottom;
        const maxE = Math.max(...data.map(d => d.energy), 1);
        const periodColors = { sharp_peak: '#dc2626', peak: '#ef4444', flat: '#f59e0b', valley: '#10b981' };
        const periodLabels = { sharp_peak: '尖峰', peak: '峰', flat: '平', valley: '谷' };
        const periods = ['sharp_peak', 'peak', 'flat', 'valley'];
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
            const y = pad.top + (chartH * i / 5);
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(cw - pad.right, y); ctx.stroke();
            ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(EnergyApp.utils.formatNumber(maxE * (5 - i) / 5, 0), pad.left - 8, y + 4);
        }
        const barW = Math.min((chartW / data.length) * 0.65, 44);
        const barGap = chartW / data.length;
        data.forEach((d, i) => {
            const x = pad.left + i * barGap + (barGap - barW) / 2;
            let cumY = 0;
            periods.forEach(p => {
                const val = d[p] || 0;
                const h = (val / maxE) * chartH;
                ctx.fillStyle = periodColors[p];
                ctx.fillRect(x, pad.top + chartH - cumY - h, barW, h);
                cumY += h;
            });
            ctx.save();
            ctx.translate(x + barW / 2, ch - pad.bottom + 12);
            ctx.rotate(-0.4);
            ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(d.period || '', 0, 0);
            ctx.restore();
        });
        ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 2; ctx.beginPath();
        data.forEach((d, i) => {
            const x = pad.left + i * barGap + barGap / 2;
            const y = pad.top + chartH - (d.energy / maxE) * chartH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        data.forEach((d, i) => {
            const x = pad.left + i * barGap + barGap / 2;
            const y = pad.top + chartH - (d.energy / maxE) * chartH;
            ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#1f2937'; ctx.fill();
        });
        let lx = pad.left;
        periods.forEach(p => { ctx.fillStyle = periodColors[p]; ctx.fillRect(lx, 8, 12, 12); ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(periodLabels[p], lx + 16, 18); lx += 56; });
        ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx, 14); ctx.lineTo(lx + 20, 14); ctx.stroke();
        ctx.fillStyle = '#374151'; ctx.fillText('总计', lx + 24, 18);
    },

    renderYoY(container, yoyData, monthlyData) {
        const body = container.querySelector('.chart-body');
        body.innerHTML = '';
        if (yoyData) {
            const change = yoyData.change || 0;
            const card = document.createElement('div');
            card.style.cssText = 'text-align:center;padding:16px 0';
            card.innerHTML = `<div style="font-size:14px;color:#6b7280;margin-bottom:8px">同比变化 (${yoyData.previousYear||'去年'} vs ${yoyData.currentYear||'今年'})</div>
                <div style="font-size:36px;font-weight:700;color:${change>0?'#ef4444':'#10b981'}">${change>0?'+':''}${change.toFixed(1)}%</div>
                <div style="font-size:13px;color:#9ca3af;margin-top:8px">去年: ${EnergyApp.utils.formatEnergy(yoyData.previous)} → 今年: ${EnergyApp.utils.formatEnergy(yoyData.current)}</div>`;
            body.appendChild(card);
        }
        if (monthlyData && monthlyData.length) {
            const canvas = document.createElement('canvas');
            canvas.width = body.clientWidth || 400; canvas.height = 180; canvas.style.width = '100%';
            body.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            const pad = { t: 20, r: 20, b: 30, l: 50 };
            const cw = canvas.width, ch = canvas.height;
            const maxE = Math.max(...monthlyData.map(d => Math.max(d.current || 0, d.previous || 0)), 1);
            const groupW = (cw - pad.l - pad.r) / monthlyData.length;
            const bw = groupW * 0.32;
            monthlyData.forEach((d, i) => {
                const gx = pad.l + i * groupW;
                const h1 = ((d.previous || 0) / maxE) * (ch - pad.t - pad.b);
                const h2 = ((d.current || 0) / maxE) * (ch - pad.t - pad.b);
                ctx.fillStyle = '#93c5fd'; ctx.fillRect(gx + groupW * 0.1, ch - pad.b - h1, bw, h1);
                ctx.fillStyle = '#2563eb'; ctx.fillRect(gx + groupW * 0.1 + bw + 2, ch - pad.b - h2, bw, h2);
                ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(d.month || '', gx + groupW / 2, ch - pad.b + 14);
            });
            ctx.fillStyle = '#93c5fd'; ctx.fillRect(pad.l, ch - 10, 10, 8);
            ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('去年', pad.l + 14, ch - 3);
            ctx.fillStyle = '#2563eb'; ctx.fillRect(pad.l + 50, ch - 10, 10, 8);
            ctx.fillStyle = '#6b7280'; ctx.fillText('今年', pad.l + 64, ch - 3);
        }
    },

    renderMoM(container, momData, dailyData) {
        const body = container.querySelector('.chart-body');
        body.innerHTML = '';
        if (momData) {
            const change = momData.change || 0;
            const card = document.createElement('div');
            card.style.cssText = 'text-align:center;padding:16px 0';
            card.innerHTML = `<div style="font-size:14px;color:#6b7280;margin-bottom:8px">环比变化 (${momData.previousMonth||'上月'}月 vs ${momData.currentMonth||'本月'}月)</div>
                <div style="font-size:36px;font-weight:700;color:${change>0?'#ef4444':'#10b981'}">${change>0?'+':''}${change.toFixed(1)}%</div>
                <div style="font-size:13px;color:#9ca3af;margin-top:8px">上月: ${EnergyApp.utils.formatEnergy(momData.previous)} → 本月: ${EnergyApp.utils.formatEnergy(momData.current)}</div>`;
            body.appendChild(card);
        }
        if (dailyData && dailyData.length) {
            const canvas = document.createElement('canvas');
            canvas.width = body.clientWidth || 400; canvas.height = 180; canvas.style.width = '100%';
            body.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            const pad = { t: 20, r: 20, b: 30, l: 50 };
            const cw = canvas.width, ch = canvas.height;
            const chartW = cw - pad.l - pad.r, chartH = ch - pad.t - pad.b;
            const maxE = Math.max(...dailyData.map(d => d.energy), 1);
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2; ctx.beginPath();
            dailyData.forEach((d, i) => {
                const x = pad.l + (i / Math.max(dailyData.length - 1, 1)) * chartW;
                const y = pad.t + chartH - (d.energy / maxE) * chartH;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            dailyData.forEach((d, i) => {
                const x = pad.l + (i / Math.max(dailyData.length - 1, 1)) * chartW;
                const y = pad.t + chartH - (d.energy / maxE) * chartH;
                ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#10b981'; ctx.fill();
            });
        }
    },

    renderAnomalies(container, anomalies) {
        const body = container.querySelector('.chart-body');
        if (!anomalies || !anomalies.length) { body.innerHTML = '<div class="empty-state"><p>未检测到异常能耗</p></div>'; return; }
        let html = '';
        anomalies.slice(0, 10).forEach(a => {
            html += `<div class="anomaly-card severity-${a.severity||'warning'}">
                <div class="anomaly-title">${a.type === 'energy_spike' ? '能耗异常高峰' : '异常'}</div>
                <div class="anomaly-detail">电表: ${a.meter_id||'-'} | 时间: ${a.timestamp ? EnergyApp.utils.formatDateTime(a.timestamp) : '-'}${a.energy ? ` | 能耗: ${EnergyApp.utils.formatEnergy(a.energy)} (预期 ~${EnergyApp.utils.formatEnergy(a.expected)})` : ''}${a.deviation ? ` | 偏离: ${a.deviation.toFixed(1)}σ` : ''}</div>
            </div>`;
        });
        if (anomalies.length > 10) html += `<div style="text-align:center;color:#9ca3af;font-size:13px">还有 ${anomalies.length - 10} 条异常记录</div>`;
        body.innerHTML = html;
    },

    renderRecommendations(container, recs) {
        const body = container.querySelector('.chart-body');
        if (!recs || !recs.length) { body.innerHTML = '<div class="empty-state"><p>暂无节能建议</p></div>'; return; }
        let html = '';
        recs.forEach(r => {
            html += `<div class="recommendation-card">
                <div class="rec-header"><span class="rec-title">${r.title}</span>${r.saving ? `<span class="saving-badge">预计节省 ¥${r.saving}/月</span>` : ''}</div>
                <div class="rec-detail">${r.description}</div>
            </div>`;
        });
        body.innerHTML = html;
    },

    /* ===== 碳排放热力图: 行=楼栋, 列=尖/峰/平/谷 ===== */
    renderCarbonHeatmap(container, data) {
        const body = container.querySelector('.chart-body');
        if (!data || !data.byBuilding || !data.byBuilding.length) { body.innerHTML = '<div class="empty-state"><p>暂无碳排数据，请先导入碳排因子</p></div>'; return; }

        const periods = ['sharp_peak', 'peak', 'flat', 'valley'];
        const periodLabels = { sharp_peak: '尖峰', peak: '峰', flat: '平', valley: '谷' };
        const buildings = data.byBuilding;
        const maxCarbon = Math.max(...buildings.map(b => b.carbon), 1);

        const cellW = 100, cellH = 52, gap = 4, headerH = 30;
        const svgW = (periods.length + 1) * (cellW + gap);
        const svgH = headerH + buildings.length * (cellH + gap) + 40;

        let svg = `<svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%">`;
        // Header
        periods.forEach((p, ci) => {
            const x = (ci + 1) * (cellW + gap);
            svg += `<text x="${x + cellW/2}" y="${headerH - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="#374151">${periodLabels[p]}</text>`;
        });
        // Rows
        buildings.forEach((b, ri) => {
            const y = headerH + ri * (cellH + gap);
            svg += `<text x="${cellW - 4}" y="${y + cellH/2 + 4}" text-anchor="end" font-size="11" fill="#374151">${b.building_id}</text>`;
            periods.forEach((p, ci) => {
                const x = (ci + 1) * (cellW + gap);
                const val = (data.byPeriodType[p] || 0) * (b.carbon / (data.totalCarbon || 1));
                const color = EnergyApp.utils.getColorForValue(val, 0, maxCarbon / periods.length);
                svg += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" fill="${color}" class="heatmap-cell"><title>${b.building_id} ${periodLabels[p]}: ${val.toFixed(1)} kg CO₂</title></rect>`;
                svg += `<text x="${x + cellW/2}" y="${y + cellH/2 + 4}" text-anchor="middle" fill="#fff" font-size="11">${val.toFixed(0)}</text>`;
            });
        });
        // Legend
        const ly = headerH + buildings.length * (cellH + gap) + 8;
        svg += `<defs><linearGradient id="cg"><stop offset="0%" stop-color="${EnergyApp.utils.getColorForValue(0, 0, maxCarbon)}"/><stop offset="100%" stop-color="${EnergyApp.utils.getColorForValue(maxCarbon, 0, maxCarbon)}"/></linearGradient></defs>`;
        svg += `<rect x="40" y="${ly}" width="${svgW - 80}" height="10" rx="5" fill="url(#cg)"/>`;
        svg += `<text x="40" y="${ly+24}" font-size="10" fill="#6b7280">低</text><text x="${svgW - 40}" y="${ly+24}" text-anchor="end" font-size="10" fill="#6b7280">高 (kg CO₂)</text>`;
        svg += '</svg>';
        body.innerHTML = svg;
    },

    /* ===== 设备碳排排行 ===== */
    renderCarbonRanking(container, data) {
        const body = container.querySelector('.chart-body');
        const devices = data && data.byDevice ? data.byDevice : [];
        if (!devices.length) { body.innerHTML = '<div class="empty-state"><p>暂无碳排数据</p></div>'; return; }

        const canvas = document.createElement('canvas');
        const barH = 28, gap = 6, pad = { top: 10, right: 100, bottom: 30, left: 120 };
        canvas.height = pad.top + devices.length * (barH + gap) + pad.bottom;
        canvas.width = body.clientWidth || 500;
        canvas.style.width = '100%';
        body.innerHTML = '';
        body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        const maxC = Math.max(...devices.map(d => d.carbon), 1);
        const barW = cw - pad.left - pad.right;

        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const x = pad.left + (barW * i / 4);
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, ch - pad.bottom); ctx.stroke();
            ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText((maxC * i / 4).toFixed(0), x, ch - pad.bottom + 16);
        }

        devices.forEach((d, i) => {
            const y = pad.top + i * (barH + gap);
            const w = (d.carbon / maxC) * barW;
            ctx.fillStyle = '#374151'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText((d.meter_id || '').substring(0, 16), pad.left - 8, y + barH / 2 + 4);
            const intensity = d.carbon / (data.totalCarbon || 1);
            ctx.fillStyle = intensity > 0.15 ? '#dc2626' : intensity > 0.08 ? '#ef4444' : '#f59e0b';
            ctx.beginPath();
            if (ctx.roundRect) { ctx.roundRect(pad.left, y, Math.max(w, 2), barH, [0, 4, 4, 0]); }
            else { ctx.rect(pad.left, y, Math.max(w, 2), barH); }
            ctx.fill();
            ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(`${d.carbon.toFixed(1)} kg CO₂`, pad.left + w + 6, y + barH / 2 + 4);
        });
    },

    /* ===== 策略对比分组柱图 ===== */
    renderStrategyComparison(container, strategies) {
        const body = container.querySelector('.chart-body');
        if (!strategies || !strategies.length) { body.innerHTML = '<div class="empty-state"><p>暂无策略对比数据，请先创建并评估策略</p></div>'; return; }

        const canvas = document.createElement('canvas');
        canvas.width = body.clientWidth || 700;
        canvas.height = 360;
        canvas.style.width = '100%';
        body.innerHTML = '';
        body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const pad = { top: 40, right: 30, bottom: 80, left: 80 };
        const cw = canvas.width, ch = canvas.height;
        const chartW = cw - pad.left - pad.right, chartH = ch - pad.top - pad.bottom;

        const dims = [
            { key: 'cost', label: '总成本(元)', get: s => s.results.projected.totalCost },
            { key: 'carbon', label: '碳排放(kg)', get: s => s.results.projected.totalCarbon },
            { key: 'demand', label: '需量(kW)', get: s => s.results.projected.peakDemand },
            { key: 'saving', label: '节省(元)', get: s => s.results.savings.cost }
        ];

        const colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        const groupW = chartW / dims.length;
        const bw = Math.min((groupW / strategies.length) * 0.7, 36);

        dims.forEach((dim, di) => {
            const vals = strategies.map(s => dim.get(s));
            const maxVal = Math.max(...vals, 1);
            const gx = pad.left + di * groupW;

            // Grid
            ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(gx, pad.top); ctx.lineTo(gx, ch - pad.bottom); ctx.stroke();

            // Label
            ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(dim.label, gx + groupW / 2, ch - pad.bottom + 20);

            strategies.forEach((s, si) => {
                const val = dim.get(s);
                const h = (val / maxVal) * chartH * 0.85;
                const x = gx + (groupW - bw * strategies.length) / 2 + si * bw;
                const y = pad.top + chartH - h;
                ctx.fillStyle = colors[si % colors.length];
                ctx.fillRect(x, y, bw - 2, h);
                ctx.fillStyle = '#374151'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(EnergyApp.utils.formatNumber(val, 0), x + bw / 2, y - 4);
            });
        });

        // Legend
        let lx = pad.left;
        strategies.forEach((s, i) => {
            ctx.fillStyle = colors[i % colors.length];
            ctx.fillRect(lx, 10, 14, 14);
            ctx.fillStyle = '#374151'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText((s.name || s.strategy_id).substring(0, 12), lx + 18, 22);
            lx += 120;
        });
    },

    /* ===== 预测 vs 实际趋势 ===== */
    renderProjectedTrend(container, actualTrend, projectedData) {
        const body = container.querySelector('.chart-body');
        if (!actualTrend || !actualTrend.length) { body.innerHTML = '<div class="empty-state"><p>暂无趋势数据</p></div>'; return; }

        const canvas = document.createElement('canvas');
        const pad = { top: 30, right: 30, bottom: 60, left: 70 };
        canvas.width = body.clientWidth || 700;
        canvas.height = 300;
        canvas.style.width = '100%';
        body.innerHTML = '';
        body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        const chartW = cw - pad.left - pad.right, chartH = ch - pad.top - pad.bottom;
        const maxE = Math.max(...actualTrend.map(d => d.energy), 1);

        // Grid
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
            const y = pad.top + (chartH * i / 5);
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(cw - pad.right, y); ctx.stroke();
            ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(EnergyApp.utils.formatNumber(maxE * (5 - i) / 5, 0), pad.left - 8, y + 4);
        }

        const gap = chartW / actualTrend.length;

        // Actual line (solid)
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.5; ctx.beginPath();
        actualTrend.forEach((d, i) => {
            const x = pad.left + i * gap + gap / 2;
            const y = pad.top + chartH - (d.energy / maxE) * chartH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        actualTrend.forEach((d, i) => {
            const x = pad.left + i * gap + gap / 2;
            const y = pad.top + chartH - (d.energy / maxE) * chartH;
            ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#2563eb'; ctx.fill();
        });

        // X labels
        actualTrend.forEach((d, i) => {
            if (i % Math.max(1, Math.floor(actualTrend.length / 12)) === 0) {
                const x = pad.left + i * gap + gap / 2;
                ctx.save(); ctx.translate(x, ch - pad.bottom + 12); ctx.rotate(-0.4);
                ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
                ctx.fillText(d.period || '', 0, 0); ctx.restore();
            }
        });

        // Projected line (dashed) if available
        if (projectedData && projectedData.monthlyProjection) {
            const mp = projectedData.monthlyProjection;
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
            mp.forEach((m, i) => {
                const x = pad.left + i * gap + gap / 2;
                const y = pad.top + chartH - (m.projectedEnergy / maxE) * chartH;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke(); ctx.setLineDash([]);

            // Shaded savings area
            ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
            ctx.beginPath();
            mp.forEach((m, i) => {
                const x = pad.left + i * gap + gap / 2;
                const y = pad.top + chartH - (m.baselineEnergy / maxE) * chartH;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            for (let i = mp.length - 1; i >= 0; i--) {
                const x = pad.left + i * gap + gap / 2;
                const y = pad.top + chartH - (mp[i].projectedEnergy / maxE) * chartH;
                ctx.lineTo(x, y);
            }
            ctx.closePath(); ctx.fill();
        }

        // Legend
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(pad.left, 14); ctx.lineTo(pad.left + 20, 14); ctx.stroke();
        ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('实际', pad.left + 24, 18);

        if (projectedData) {
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(pad.left + 70, 14); ctx.lineTo(pad.left + 90, 14); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#374151'; ctx.fillText('策略预测', pad.left + 94, 18);
        }
    }
};
