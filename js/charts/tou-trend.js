import {
  createCanvas,
  linearScale,
  formatKWh,
  formatNumber,
  addTooltip,
  addLegend,
  responsiveSize,
  clearContainer
} from './chart-base.js';

const MARGINS = { top: 50, right: 180, bottom: 50, left: 60 };

const PERIOD_COLORS = {
  sharp: '#e74c3c',
  peak: '#e67e22',
  flat: '#3498db',
  valley: '#27ae60'
};

const PERIOD_LABELS = {
  sharp: 'Sharp',
  peak: 'Peak',
  flat: 'Flat',
  valley: 'Valley'
};

const FILL_ALPHA = 0.15;

export class TOUTrend {
  constructor() {
    this.container = null;
    this.touTrend = null;
    this.touBilling = null;
    this.tooltip = null;
    this._canvasEl = null;
    this._ctx = null;
    this._boundResize = null;
    this._boundMouseMove = null;
    this._boundMouseLeave = null;
    this._dates = [];
    this._xScale = null;
    this._yScale = null;
    this._plotWidth = 0;
    this._plotHeight = 0;
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container #${containerId} not found`);
    }
    this.tooltip = addTooltip();
    this._boundResize = () => {
      if (this.touTrend) {
        this.update(this.touTrend, this.touBilling);
      }
    };
    window.addEventListener('resize', this._boundResize);
  }

  update(touTrend, touBilling) {
    if (!this.container) return;
    clearContainer(this.container);

    if (!touTrend || (!touTrend.sharp && !touTrend.peak && !touTrend.flat && !touTrend.valley)) {
      this.showEmpty();
      return;
    }

    this.touTrend = touTrend;
    this.touBilling = touBilling || null;

    // Add legend at top
    const legendItems = Object.entries(PERIOD_COLORS).map(([key, color]) => ({
      label: PERIOD_LABELS[key],
      color: color
    }));
    addLegend(this.container, legendItems);

    const { width, height: totalHeight } = responsiveSize(this.container);
    const height = totalHeight - 30; // account for legend

    const { canvas, ctx } = createCanvas(this.container, width, height);
    this._canvasEl = canvas;
    this._ctx = ctx;

    this._plotWidth = width - MARGINS.left - MARGINS.right;
    this._plotHeight = height - MARGINS.top - MARGINS.bottom;

    // Collect all dates and values
    const allDates = new Set();
    const periods = ['sharp', 'peak', 'flat', 'valley'];
    periods.forEach(p => {
      if (touTrend[p]) {
        Object.keys(touTrend[p]).forEach(d => allDates.add(d));
      }
    });
    this._dates = Array.from(allDates).sort();

    if (this._dates.length === 0) {
      this.showEmpty();
      return;
    }

    let globalMax = 0;
    periods.forEach(p => {
      if (touTrend[p]) {
        Object.values(touTrend[p]).forEach(v => {
          if (v > globalMax) globalMax = v;
        });
      }
    });

    this._xScale = linearScale([0, this._dates.length - 1], [MARGINS.left, MARGINS.left + this._plotWidth]);
    this._yScale = linearScale([0, globalMax * 1.1 || 1], [MARGINS.top + this._plotHeight, MARGINS.top]);

    // Clear
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    this._drawGrid(ctx, width, height);

    // Draw axes
    this._drawAxes(ctx, width, height);

    // Draw filled area + line for each period
    periods.forEach(period => {
      if (!touTrend[period]) return;
      this._drawLine(ctx, touTrend[period], PERIOD_COLORS[period]);
    });

    // Draw billing summary box
    if (this.touBilling) {
      this._drawBillingSummary(ctx, width);
    }

    // Mouse interaction
    this._setupMouseEvents(canvas, width, height);
  }

  _drawGrid(ctx, width, height) {
    const yTicks = 5;
    const yMax = this._yScale.domain[1];
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;

    for (let i = 0; i <= yTicks; i++) {
      const val = (yMax * i) / yTicks;
      const y = this._yScale(val);
      ctx.beginPath();
      ctx.moveTo(MARGINS.left, y);
      ctx.lineTo(MARGINS.left + this._plotWidth, y);
      ctx.stroke();
    }
  }

  _drawAxes(ctx, width, height) {
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;

    // Y axis
    ctx.beginPath();
    ctx.moveTo(MARGINS.left, MARGINS.top);
    ctx.lineTo(MARGINS.left, MARGINS.top + this._plotHeight);
    ctx.stroke();

    // X axis
    ctx.beginPath();
    ctx.moveTo(MARGINS.left, MARGINS.top + this._plotHeight);
    ctx.lineTo(MARGINS.left + this._plotWidth, MARGINS.top + this._plotHeight);
    ctx.stroke();

    // Y axis ticks and labels
    const yTicks = 5;
    const yMax = this._yScale.domain[1];
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= yTicks; i++) {
      const val = (yMax * i) / yTicks;
      const y = this._yScale(val);
      ctx.fillText(formatNumber(Math.round(val)), MARGINS.left - 8, y);
    }

    // Y axis label
    ctx.save();
    ctx.translate(14, MARGINS.top + this._plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillText('kWh', 0, 0);
    ctx.restore();

    // X axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px sans-serif';
    const maxLabels = Math.min(this._dates.length, 10);
    const step = Math.max(1, Math.floor(this._dates.length / maxLabels));

    for (let i = 0; i < this._dates.length; i += step) {
      const x = this._xScale(i);
      const y = MARGINS.top + this._plotHeight + 6;
      ctx.fillText(this._dates[i], x, y);
    }

    // X axis label
    ctx.font = '12px sans-serif';
    ctx.fillText('Date', MARGINS.left + this._plotWidth / 2, height - 8);
  }

  _drawLine(ctx, periodData, color) {
    const points = [];
    this._dates.forEach((date, i) => {
      const val = periodData[date];
      if (val !== undefined && val !== null) {
        points.push({ x: this._xScale(i), y: this._yScale(val) });
      }
    });

    if (points.length === 0) return;

    const baselineY = this._yScale(0);

    // Fill area
    ctx.beginPath();
    ctx.moveTo(points[0].x, baselineY);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, baselineY);
    ctx.closePath();

    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${r},${g},${b},${FILL_ALPHA})`;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Dots
    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  _drawBillingSummary(ctx, chartWidth) {
    const billing = this.touBilling;
    const boxW = 155;
    const boxX = chartWidth - MARGINS.right + 10;
    const boxY = MARGINS.top;
    const lineH = 16;
    const periods = ['sharp', 'peak', 'flat', 'valley'];
    const lines = [];

    lines.push(`Total: ${formatKWh(billing.totalConsumption)}`);
    lines.push(`Cost: $${formatNumber(billing.totalCost)}`);
    lines.push('');

    if (billing.breakdown) {
      periods.forEach(p => {
        if (billing.breakdown[p]) {
          const bd = billing.breakdown[p];
          lines.push(`${PERIOD_LABELS[p]}: ${formatKWh(bd.kwh)}`);
          lines.push(`  Cost: $${formatNumber(bd.cost)}`);
        }
      });
    }

    const boxH = lines.length * lineH + 16;

    // Background
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Title
    ctx.fillStyle = '#333';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Billing Summary', boxX + 8, boxY + 4);

    // Content
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#555';
    lines.forEach((line, i) => {
      ctx.fillText(line, boxX + 8, boxY + 20 + i * lineH);
    });
  }

  _setupMouseEvents(canvas) {
    if (this._boundMouseMove) {
      canvas.removeEventListener('mousemove', this._boundMouseMove);
    }
    if (this._boundMouseLeave) {
      canvas.removeEventListener('mouseleave', this._boundMouseLeave);
    }

    this._boundMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (mx < MARGINS.left || mx > MARGINS.left + this._plotWidth ||
          my < MARGINS.top || my > MARGINS.top + this._plotHeight) {
        this.tooltip.hide();
        this._redrawCrosshair(null);
        return;
      }

      // Find nearest date index
      const xInv = this._xScale.invert(mx);
      const idx = Math.round(xInv);
      if (idx < 0 || idx >= this._dates.length) {
        this.tooltip.hide();
        return;
      }

      const date = this._dates[idx];
      const crossX = this._xScale(idx);

      // Redraw with crosshair
      this._redrawCrosshair(crossX);

      // Build tooltip
      const periods = ['sharp', 'peak', 'flat', 'valley'];
      let html = `<strong>${date}</strong><br/>`;
      periods.forEach(p => {
        if (this.touTrend[p] && this.touTrend[p][date] !== undefined) {
          const dot = `<span style="color:${PERIOD_COLORS[p]}">&#9679;</span>`;
          html += `${dot} ${PERIOD_LABELS[p]}: ${formatKWh(this.touTrend[p][date])}<br/>`;
        }
      });

      this.tooltip.show(e.clientX, e.clientY, html);
    };

    this._boundMouseLeave = () => {
      this.tooltip.hide();
      this._redrawCrosshair(null);
    };

    canvas.addEventListener('mousemove', this._boundMouseMove);
    canvas.addEventListener('mouseleave', this._boundMouseLeave);
  }

  _redrawCrosshair(crossX) {
    if (!this._ctx || !this._canvasEl) return;
    // Re-render the chart then overlay crosshair
    // For performance, just draw the crosshair over existing content
    const ctx = this._ctx;
    const canvas = this._canvasEl;

    // Redraw full chart
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this._drawGrid(ctx, canvas.width, canvas.height);
    this._drawAxes(ctx, canvas.width, canvas.height);

    const periods = ['sharp', 'peak', 'flat', 'valley'];
    periods.forEach(period => {
      if (!this.touTrend[period]) return;
      this._drawLine(ctx, this.touTrend[period], PERIOD_COLORS[period]);
    });

    if (this.touBilling) {
      this._drawBillingSummary(ctx, canvas.width);
    }

    // Draw crosshair
    if (crossX !== null) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(crossX, MARGINS.top);
      ctx.lineTo(crossX, MARGINS.top + this._plotHeight);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  showEmpty() {
    if (!this.container) return;
    clearContainer(this.container);
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:14px;';
    msg.textContent = 'No TOU trend data available';
    this.container.appendChild(msg);
  }

  destroy() {
    if (this._boundResize) {
      window.removeEventListener('resize', this._boundResize);
      this._boundResize = null;
    }
    if (this._canvasEl) {
      if (this._boundMouseMove) {
        this._canvasEl.removeEventListener('mousemove', this._boundMouseMove);
      }
      if (this._boundMouseLeave) {
        this._canvasEl.removeEventListener('mouseleave', this._boundMouseLeave);
      }
    }
    if (this.tooltip) {
      this.tooltip.hide();
    }
    if (this.container) {
      clearContainer(this.container);
    }
    this.container = null;
    this.touTrend = null;
    this.touBilling = null;
    this._canvasEl = null;
    this._ctx = null;
  }

  toDataURL() {
    if (!this._canvasEl) return null;
    try {
      return this._canvasEl.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }
}
