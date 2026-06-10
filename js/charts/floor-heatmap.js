import {
  createCanvas,
  hslColor,
  formatKWh,
  addTooltip,
  responsiveSize,
  clearContainer
} from './chart-base.js';

const LABEL_LEFT = 80;
const LABEL_BOTTOM = 40;
const LEGEND_HEIGHT = 30;
const PADDING_TOP = 20;
const PADDING_RIGHT = 20;

export class FloorHeatmap {
  constructor() {
    this.container = null;
    this.data = null;
    this.tooltip = null;
    this._boundResize = null;
    this._boundMouseMove = null;
    this._boundMouseLeave = null;
    this._canvasEl = null;
    this._cellWidth = 0;
    this._cellHeight = 0;
    this._floorIds = [];
    this._minVal = 0;
    this._maxVal = 0;
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container #${containerId} not found`);
    }
    this.tooltip = addTooltip();
    this._boundResize = () => {
      if (this.data) {
        this.update(this.data);
      }
    };
    window.addEventListener('resize', this._boundResize);
  }

  update(data) {
    if (!this.container) return;
    clearContainer(this.container);

    if (!data || !data.floorIds || data.floorIds.length === 0) {
      this.showEmpty();
      return;
    }

    this.data = data;
    this._floorIds = data.floorIds;

    const { width, height } = responsiveSize(this.container);
    const chartHeight = height - LEGEND_HEIGHT;

    const { canvas, ctx } = createCanvas(this.container, width, chartHeight);
    this._canvasEl = canvas;

    const gridW = width - LABEL_LEFT - PADDING_RIGHT;
    const gridH = chartHeight - PADDING_TOP - LABEL_BOTTOM;
    const hours = 24;
    const floors = this._floorIds.length;

    this._cellWidth = gridW / hours;
    this._cellHeight = gridH / floors;

    // Compute min/max
    const values = Object.values(data.data).filter(v => typeof v === 'number');
    this._minVal = values.length > 0 ? Math.min(...values) : 0;
    this._maxVal = values.length > 0 ? Math.max(...values) : 1;

    // Clear canvas
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, chartHeight);

    // Draw cells
    for (let fi = 0; fi < floors; fi++) {
      for (let h = 0; h < hours; h++) {
        const key = `${this._floorIds[fi]}_${h}`;
        const value = data.data[key];
        const x = LABEL_LEFT + h * this._cellWidth;
        const y = PADDING_TOP + fi * this._cellHeight;

        if (value !== undefined && value !== null) {
          ctx.fillStyle = hslColor(value, this._minVal, this._maxVal);
        } else {
          ctx.fillStyle = '#f0f0f0';
        }
        ctx.fillRect(x, y, this._cellWidth - 1, this._cellHeight - 1);
      }
    }

    // Draw floor labels on left
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let fi = 0; fi < floors; fi++) {
      const y = PADDING_TOP + fi * this._cellHeight + this._cellHeight / 2;
      ctx.fillText(this._floorIds[fi], LABEL_LEFT - 8, y);
    }

    // Draw hour labels on bottom
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let h = 0; h < hours; h++) {
      const x = LABEL_LEFT + h * this._cellWidth + this._cellWidth / 2;
      const y = PADDING_TOP + floors * this._cellHeight + 6;
      ctx.fillText(String(h), x, y);
    }

    // Axis titles
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hour', LABEL_LEFT + gridW / 2, chartHeight - 4);

    ctx.save();
    ctx.translate(14, PADDING_TOP + gridH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Floor', 0, 0);
    ctx.restore();

    // Draw color scale legend at bottom
    this._drawColorLegend(width);

    // Mouse interaction
    this._setupMouseEvents(canvas);
  }

  _drawColorLegend(totalWidth) {
    const legendContainer = document.createElement('div');
    legendContainer.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:4px 0;gap:4px;';

    const labelMin = document.createElement('span');
    labelMin.style.cssText = 'font-size:11px;color:#666;';
    labelMin.textContent = formatKWh(this._minVal);
    legendContainer.appendChild(labelMin);

    const gradientBar = document.createElement('canvas');
    const gradientW = Math.min(200, totalWidth - 120);
    gradientBar.width = gradientW;
    gradientBar.height = 14;
    gradientBar.style.borderRadius = '2px';

    const gCtx = gradientBar.getContext('2d');
    for (let i = 0; i < gradientW; i++) {
      const val = this._minVal + (this._maxVal - this._minVal) * (i / gradientW);
      gCtx.fillStyle = hslColor(val, this._minVal, this._maxVal);
      gCtx.fillRect(i, 0, 1, 14);
    }
    legendContainer.appendChild(gradientBar);

    const labelMax = document.createElement('span');
    labelMax.style.cssText = 'font-size:11px;color:#666;';
    labelMax.textContent = formatKWh(this._maxVal);
    legendContainer.appendChild(labelMax);

    this.container.appendChild(legendContainer);
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

      const col = Math.floor((mx - LABEL_LEFT) / this._cellWidth);
      const row = Math.floor((my - PADDING_TOP) / this._cellHeight);

      if (col >= 0 && col < 24 && row >= 0 && row < this._floorIds.length) {
        const floorId = this._floorIds[row];
        const hour = col;
        const key = `${floorId}_${hour}`;
        const value = this.data.data[key];
        const valStr = value !== undefined && value !== null ? formatKWh(value) : 'N/A';

        this.tooltip.show(e.clientX, e.clientY, `
          <strong>Floor: ${floorId}</strong><br/>
          Hour: ${hour}:00<br/>
          Consumption: ${valStr}
        `);
      } else {
        this.tooltip.hide();
      }
    };

    this._boundMouseLeave = () => {
      this.tooltip.hide();
    };

    canvas.addEventListener('mousemove', this._boundMouseMove);
    canvas.addEventListener('mouseleave', this._boundMouseLeave);
  }

  showEmpty() {
    if (!this.container) return;
    clearContainer(this.container);
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:14px;';
    msg.textContent = 'No floor heatmap data available';
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
    this.data = null;
    this._canvasEl = null;
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
