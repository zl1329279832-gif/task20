import {
  createSVG,
  linearScale,
  bandScale,
  colorScale,
  svgEl,
  drawXAxis,
  drawYAxis,
  drawGridLines,
  formatKWh,
  formatNumber,
  addTooltip,
  addLegend,
  responsiveSize,
  clearContainer
} from './chart-base.js';

const MARGINS = { top: 20, right: 20, bottom: 40, left: 60 };
const DONUT_OUTER_RATIO = 0.38;
const DONUT_INNER_RATIO = 0.22;

export class BuildingOverview {
  constructor() {
    this.container = null;
    this.data = [];
    this.tooltip = null;
    this._onSegmentClick = null;
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

    const { width: totalWidth, height: totalHeight } = responsiveSize(this.container);
    const barWidth = Math.floor(totalWidth * 0.55);
    const donutWidth = totalWidth - barWidth;

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    this.container.appendChild(wrapper);

    const barContainer = document.createElement('div');
    barContainer.style.width = barWidth + 'px';
    barContainer.style.height = totalHeight + 'px';
    wrapper.appendChild(barContainer);

    const donutContainer = document.createElement('div');
    donutContainer.style.width = donutWidth + 'px';
    donutContainer.style.height = totalHeight + 'px';
    donutContainer.style.display = 'flex';
    donutContainer.style.flexDirection = 'column';
    donutContainer.style.alignItems = 'center';
    donutContainer.style.justifyContent = 'center';
    wrapper.appendChild(donutContainer);

    this._drawBarChart(barContainer, barWidth, totalHeight);
    this._drawDonutChart(donutContainer, donutWidth, totalHeight);
  }

  _drawBarChart(container, width, height) {
    const svg = createSVG(container, width, height);
    const innerW = width - MARGINS.left - MARGINS.right;
    const innerH = height - MARGINS.top - MARGINS.bottom;

    const names = this.data.map(d => d.name);
    const maxVal = Math.max(...this.data.map(d => d.total));

    const xScale = bandScale(names, [0, innerW], 0.2);
    const yScale = linearScale([0, maxVal * 1.1], [innerH, 0]);
    const colors = colorScale(this.data.length);

    const g = svgEl('g', { transform: `translate(${MARGINS.left},${MARGINS.top})` });
    svg.appendChild(g);

    drawGridLines(svg, yScale, [MARGINS.left, MARGINS.left + innerW]);
    drawXAxis(svg, xScale, '', MARGINS.top + innerH);
    drawYAxis(svg, yScale, 'kWh', MARGINS.left);

    this.data.forEach((d, i) => {
      const x = xScale(d.name);
      const barH = innerH - yScale(d.total);
      const y = yScale(d.total);

      const rect = svgEl('rect', {
        x: MARGINS.left + x,
        y: MARGINS.top + y,
        width: xScale.bandwidth(),
        height: barH,
        fill: colors[i],
        rx: 2,
        style: 'cursor:pointer;transition:opacity 0.2s'
      });

      rect.addEventListener('mouseenter', (e) => {
        rect.setAttribute('opacity', '0.8');
        const intensity = d.area > 0 ? (d.total / d.area).toFixed(2) : 'N/A';
        this.tooltip.show(e.clientX, e.clientY, `
          <strong>${d.name}</strong><br/>
          Total: ${formatKWh(d.total)}<br/>
          Area: ${formatNumber(d.area)} m&sup2;<br/>
          Intensity: ${intensity} kWh/m&sup2;
        `);
      });

      rect.addEventListener('mousemove', (e) => {
        const intensity = d.area > 0 ? (d.total / d.area).toFixed(2) : 'N/A';
        this.tooltip.show(e.clientX, e.clientY, `
          <strong>${d.name}</strong><br/>
          Total: ${formatKWh(d.total)}<br/>
          Area: ${formatNumber(d.area)} m&sup2;<br/>
          Intensity: ${intensity} kWh/m&sup2;
        `);
      });

      rect.addEventListener('mouseleave', () => {
        rect.setAttribute('opacity', '1');
        this.tooltip.hide();
      });

      svg.appendChild(rect);
    });
  }

  _drawDonutChart(container, width, height) {
    const size = Math.min(width, height);
    const svg = createSVG(container, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size * DONUT_OUTER_RATIO;
    const innerR = size * DONUT_INNER_RATIO;

    const totalAll = this.data.reduce((sum, d) => sum + d.total, 0);
    if (totalAll === 0) return;

    const colors = colorScale(this.data.length);
    let startAngle = -Math.PI / 2;

    const legendItems = [];

    this.data.forEach((d, i) => {
      const fraction = d.total / totalAll;
      const endAngle = startAngle + fraction * 2 * Math.PI;

      const path = this._arcPath(cx, cy, outerR, innerR, startAngle, endAngle);
      const segment = svgEl('path', {
        d: path,
        fill: colors[i],
        stroke: '#fff',
        'stroke-width': 2,
        style: 'cursor:pointer;transition:opacity 0.2s'
      });

      segment.addEventListener('mouseenter', (e) => {
        segment.setAttribute('opacity', '0.8');
        this.tooltip.show(e.clientX, e.clientY, `
          <strong>${d.name}</strong><br/>
          ${formatKWh(d.total)} (${(fraction * 100).toFixed(1)}%)
        `);
      });

      segment.addEventListener('mousemove', (e) => {
        this.tooltip.show(e.clientX, e.clientY, `
          <strong>${d.name}</strong><br/>
          ${formatKWh(d.total)} (${(fraction * 100).toFixed(1)}%)
        `);
      });

      segment.addEventListener('mouseleave', () => {
        segment.setAttribute('opacity', '1');
        this.tooltip.hide();
      });

      segment.addEventListener('click', () => {
        if (typeof this._onSegmentClick === 'function') {
          this._onSegmentClick(d);
        } else {
          console.log('Donut segment clicked:', d);
        }
      });

      svg.appendChild(segment);
      legendItems.push({ label: d.name, color: colors[i] });
      startAngle = endAngle;
    });

    // Center label
    const centerText = svgEl('text', {
      x: cx,
      y: cy - 6,
      'text-anchor': 'middle',
      'font-size': '12px',
      fill: '#666'
    });
    centerText.textContent = 'Total';
    svg.appendChild(centerText);

    const centerVal = svgEl('text', {
      x: cx,
      y: cy + 12,
      'text-anchor': 'middle',
      'font-size': '14px',
      'font-weight': 'bold',
      fill: '#333'
    });
    centerVal.textContent = formatKWh(totalAll);
    svg.appendChild(centerVal);

    addLegend(container, legendItems);
  }

  _arcPath(cx, cy, outerR, innerR, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);

    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);

    return [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
      'Z'
    ].join(' ');
  }

  onSegmentClick(callback) {
    this._onSegmentClick = callback;
  }

  showEmpty() {
    if (!this.container) return;
    clearContainer(this.container);
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:14px;';
    msg.textContent = 'No building data available';
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
    const svgEls = this.container.querySelectorAll('svg');
    if (svgEls.length === 0) return null;

    const canvas = document.createElement('canvas');
    const { width, height } = responsiveSize(this.container);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const promises = Array.from(svgEls).map((svgNode) => {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svgNode);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve(img);
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          resolve(null);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      });
    });

    // Synchronous fallback: serialize first SVG
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEls[0]);
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
