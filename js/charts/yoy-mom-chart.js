import {
  createSVG,
  linearScale,
  bandScale,
  svgEl,
  drawXAxis,
  drawYAxis,
  drawGridLines,
  formatKWh,
  addTooltip,
  responsiveSize,
  clearContainer
} from './chart-base.js';

const MARGINS = { top: 40, right: 20, bottom: 50, left: 60 };
const COLORS = {
  current: '#3498db',
  previous: '#bdc3c7'
};

export class YoyMomChart {
  constructor() {
    this.container = null;
    this.data = [];
    this.tooltip = null;
    this._boundResize = null;
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container #${containerId} not found`);
    }
    this.tooltip = addTooltip();
    this._boundResize = () => {
      if (this.data.length > 0) {
        this.update(this.data);
      }
    };
    window.addEventListener('resize', this._boundResize);
  }

  update(data) {
    if (!this.container) return;
    clearContainer(this.container);

    if (!data || data.length === 0) {
      this.showEmpty();
      return;
    }

    this.data = data;

    const { width, height } = responsiveSize(this.container);
    const svg = createSVG(this.container, width, height);
    const innerW = width - MARGINS.left - MARGINS.right;
    const innerH = height - MARGINS.top - MARGINS.bottom;

    const periods = data.map(d => d.period);
    const maxVal = Math.max(
      ...data.map(d => Math.max(d.current || 0, d.previous || 0))
    );

    const xScale = bandScale(periods, [0, innerW], 0.3);
    const yScale = linearScale([0, maxVal * 1.2 || 1], [innerH, 0]);

    // Grid lines
    drawGridLines(svg, yScale, [MARGINS.left, MARGINS.left + innerW]);

    // Axes
    drawXAxis(svg, xScale, 'Period', MARGINS.top + innerH);
    drawYAxis(svg, yScale, 'kWh', MARGINS.left);

    const groupWidth = xScale.bandwidth();
    const barWidth = groupWidth / 2 - 2;

    data.forEach((d) => {
      const groupX = MARGINS.left + xScale(d.period);

      // Previous bar (left)
      const prevH = innerH - yScale(d.previous || 0);
      const prevY = yScale(d.previous || 0);

      const prevRect = svgEl('rect', {
        x: groupX,
        y: MARGINS.top + prevY,
        width: barWidth,
        height: Math.max(prevH, 0),
        fill: COLORS.previous,
        rx: 2,
        style: 'cursor:pointer;transition:opacity 0.2s'
      });

      this._addBarEvents(prevRect, d);
      svg.appendChild(prevRect);

      // Current bar (right)
      const curH = innerH - yScale(d.current || 0);
      const curY = yScale(d.current || 0);

      const curRect = svgEl('rect', {
        x: groupX + barWidth + 4,
        y: MARGINS.top + curY,
        width: barWidth,
        height: Math.max(curH, 0),
        fill: COLORS.current,
        rx: 2,
        style: 'cursor:pointer;transition:opacity 0.2s'
      });

      this._addBarEvents(curRect, d);
      svg.appendChild(curRect);

      // Change percentage label above the group
      const changeVal = d.change !== undefined ? d.change : 0;
      const isIncrease = changeVal > 0;
      const isDecrease = changeVal < 0;
      const arrow = isIncrease ? '\u25B2' : isDecrease ? '\u25BC' : '';
      const changeColor = isIncrease ? '#e74c3c' : isDecrease ? '#27ae60' : '#999';
      const changeText = `${arrow} ${Math.abs(changeVal).toFixed(1)}%`;

      const labelX = groupX + groupWidth / 2;
      const labelY = MARGINS.top + Math.min(prevY, curY) - 8;

      const changeLbl = svgEl('text', {
        x: labelX,
        y: labelY,
        'text-anchor': 'middle',
        'font-size': '11px',
        'font-weight': 'bold',
        fill: changeColor
      });
      changeLbl.textContent = changeText;
      svg.appendChild(changeLbl);
    });

    // Legend
    const legendG = svgEl('g', {
      transform: `translate(${MARGINS.left + innerW - 160}, 8)`
    });

    // Previous legend item
    const prevLegendRect = svgEl('rect', {
      x: 0, y: 0, width: 12, height: 12, fill: COLORS.previous, rx: 2
    });
    legendG.appendChild(prevLegendRect);
    const prevLegendText = svgEl('text', {
      x: 16, y: 10, 'font-size': '11px', fill: '#666'
    });
    prevLegendText.textContent = 'Previous';
    legendG.appendChild(prevLegendText);

    // Current legend item
    const curLegendRect = svgEl('rect', {
      x: 80, y: 0, width: 12, height: 12, fill: COLORS.current, rx: 2
    });
    legendG.appendChild(curLegendRect);
    const curLegendText = svgEl('text', {
      x: 96, y: 10, 'font-size': '11px', fill: '#666'
    });
    curLegendText.textContent = 'Current';
    legendG.appendChild(curLegendText);

    svg.appendChild(legendG);
  }

  _addBarEvents(rect, d) {
    rect.addEventListener('mouseenter', (e) => {
      rect.setAttribute('opacity', '0.8');
      const changeVal = d.change !== undefined ? d.change : 0;
      const arrow = changeVal > 0 ? '\u25B2' : changeVal < 0 ? '\u25BC' : '';
      const trendLabel = d.trend || (changeVal > 0 ? 'increase' : changeVal < 0 ? 'decrease' : 'unchanged');

      this.tooltip.show(e.clientX, e.clientY, `
        <strong>${d.period}</strong><br/>
        Current: ${formatKWh(d.current || 0)}<br/>
        Previous: ${formatKWh(d.previous || 0)}<br/>
        Change: ${arrow} ${Math.abs(changeVal).toFixed(1)}% (${trendLabel})
      `);
    });

    rect.addEventListener('mousemove', (e) => {
      const changeVal = d.change !== undefined ? d.change : 0;
      const arrow = changeVal > 0 ? '\u25B2' : changeVal < 0 ? '\u25BC' : '';
      const trendLabel = d.trend || (changeVal > 0 ? 'increase' : changeVal < 0 ? 'decrease' : 'unchanged');

      this.tooltip.show(e.clientX, e.clientY, `
        <strong>${d.period}</strong><br/>
        Current: ${formatKWh(d.current || 0)}<br/>
        Previous: ${formatKWh(d.previous || 0)}<br/>
        Change: ${arrow} ${Math.abs(changeVal).toFixed(1)}% (${trendLabel})
      `);
    });

    rect.addEventListener('mouseleave', () => {
      rect.setAttribute('opacity', '1');
      this.tooltip.hide();
    });
  }

  showEmpty() {
    if (!this.container) return;
    clearContainer(this.container);
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:14px;';
    msg.textContent = 'No year-over-year / month-over-month data available';
    this.container.appendChild(msg);
  }

  destroy() {
    if (this._boundResize) {
      window.removeEventListener('resize', this._boundResize);
      this._boundResize = null;
    }
    if (this.tooltip) {
      this.tooltip.hide();
    }
    if (this.container) {
      clearContainer(this.container);
    }
    this.container = null;
    this.data = [];
  }

  toDataURL() {
    if (!this.container) return null;
    const svgNode = this.container.querySelector('svg');
    if (!svgNode) return null;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgNode);
    const canvas = document.createElement('canvas');
    const { width, height } = responsiveSize(this.container);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;

    try {
      ctx.drawImage(img, 0, 0);
      const dataURL = canvas.toDataURL('image/png');
      URL.revokeObjectURL(url);
      return dataURL;
    } catch (e) {
      URL.revokeObjectURL(url);
      return null;
    }
  }
}
