import {
  createSVG,
  linearScale,
  bandScale,
  svgEl,
  drawXAxis,
  drawGridLines,
  formatKWh,
  addTooltip,
  responsiveSize,
  clearContainer
} from './chart-base.js';

const MARGINS = { top: 20, right: 60, bottom: 40, left: 140 };

const TYPE_COLORS = {
  ac: '#3498db',
  lighting: '#f1c40f',
  other: '#95a5a6'
};

function getTypeColor(type) {
  const key = (type || '').toLowerCase();
  return TYPE_COLORS[key] || TYPE_COLORS.other;
}

export class DeviceRanking {
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

    const { width, height: containerHeight } = responsiveSize(this.container);
    const minHeight = data.length * 32 + MARGINS.top + MARGINS.bottom;
    const height = Math.max(containerHeight, minHeight);

    const svg = createSVG(this.container, width, height);
    const innerW = width - MARGINS.left - MARGINS.right;
    const innerH = height - MARGINS.top - MARGINS.bottom;

    const maxVal = Math.max(...data.map(d => d.total));
    const labels = data.map(d => `${d.name} (${d.type})`);

    const yScale = bandScale(labels, [0, innerH], 0.25);
    const xScale = linearScale([0, maxVal * 1.1], [0, innerW]);

    // Grid lines (vertical)
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const val = (maxVal * 1.1 * i) / tickCount;
      const x = MARGINS.left + xScale(val);
      const line = svgEl('line', {
        x1: x,
        y1: MARGINS.top,
        x2: x,
        y2: MARGINS.top + innerH,
        stroke: '#eee',
        'stroke-width': 1
      });
      svg.appendChild(line);
    }

    // X axis
    drawXAxis(svg, xScale, 'kWh', MARGINS.top + innerH);

    // Y axis labels
    data.forEach((d, i) => {
      const label = labels[i];
      const y = MARGINS.top + yScale(label) + yScale.bandwidth() / 2;
      const text = svgEl('text', {
        x: MARGINS.left - 8,
        y: y,
        'text-anchor': 'end',
        'dominant-baseline': 'middle',
        'font-size': '11px',
        fill: '#333'
      });
      text.textContent = label.length > 18 ? label.substring(0, 16) + '...' : label;
      svg.appendChild(text);
    });

    // Bars
    data.forEach((d, i) => {
      const label = labels[i];
      const barY = MARGINS.top + yScale(label);
      const barW = xScale(d.total);
      const barH = yScale.bandwidth();
      const color = getTypeColor(d.type);

      const rect = svgEl('rect', {
        x: MARGINS.left,
        y: barY,
        width: Math.max(barW, 0),
        height: barH,
        fill: color,
        rx: 2,
        style: 'cursor:pointer;transition:opacity 0.2s'
      });

      rect.addEventListener('mouseenter', (e) => {
        rect.setAttribute('opacity', '0.8');
        this.tooltip.show(e.clientX, e.clientY, `
          <strong>${d.name}</strong><br/>
          Type: ${d.type}<br/>
          ID: ${d.id}<br/>
          Consumption: ${formatKWh(d.total)}
        `);
      });

      rect.addEventListener('mousemove', (e) => {
        this.tooltip.show(e.clientX, e.clientY, `
          <strong>${d.name}</strong><br/>
          Type: ${d.type}<br/>
          ID: ${d.id}<br/>
          Consumption: ${formatKWh(d.total)}
        `);
      });

      rect.addEventListener('mouseleave', () => {
        rect.setAttribute('opacity', '1');
        this.tooltip.hide();
      });

      svg.appendChild(rect);

      // Value label at end of bar
      const valText = svgEl('text', {
        x: MARGINS.left + barW + 6,
        y: barY + barH / 2,
        'dominant-baseline': 'middle',
        'font-size': '11px',
        fill: '#555'
      });
      valText.textContent = formatKWh(d.total);
      svg.appendChild(valText);
    });
  }

  showEmpty() {
    if (!this.container) return;
    clearContainer(this.container);
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:14px;';
    msg.textContent = 'No device ranking data available';
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
