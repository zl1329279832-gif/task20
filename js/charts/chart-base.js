const SVG_NS = 'http://www.w3.org/2000/svg';

export function createSVG(container, width, height) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  container.appendChild(svg);
  return svg;
}

export function createCanvas(container, width, height) {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  container.appendChild(canvas);
  return { canvas, ctx, width, height };
}

export function linearScale(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const ratio = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const fn = v => r0 + (v - d0) * ratio;
  fn.invert = v => d0 + (v - r0) / (ratio || 1);
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export function bandScale(categories, range, padding = 0.2) {
  const [r0, r1] = range;
  const totalWidth = r1 - r0;
  const n = categories.length || 1;
  const step = totalWidth / n;
  const bandWidth = step * (1 - padding);
  const offset = step * padding / 2;
  const fn = category => {
    const idx = categories.indexOf(category);
    return idx === -1 ? r0 : r0 + idx * step + offset;
  };
  fn.bandwidth = () => bandWidth;
  fn.step = () => step;
  fn.categories = categories;
  fn.range = range;
  return fn;
}

export function colorScale(n) {
  const palette = ['#3498db','#e74c3c','#27ae60','#e67e22','#9b59b6','#1abc9c','#f1c40f','#e91e63','#00bcd4','#795548'];
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

export function drawXAxis(svg, scale, label, y, tickFormat) {
  const g = svgEl('g', { class: 'chart-axis', transform: `translate(0,${y})` });
  g.appendChild(svgEl('line', { x1: scale.range[0], x2: scale.range[1], y1: 0, y2: 0, stroke: '#dcdde1' }));

  const cats = scale.categories || [];
  if (cats.length) {
    cats.forEach(cat => {
      const x = scale(cat) + (scale.bandwidth ? scale.bandwidth() / 2 : 0);
      const tick = svgEl('text', { x, y: 18, 'text-anchor': 'middle', class: 'chart-axis' });
      tick.textContent = tickFormat ? tickFormat(cat) : (cat.length > 6 ? cat.slice(0, 6) + '..' : cat);
      g.appendChild(tick);
    });
  }
  if (label) {
    const lbl = svgEl('text', {
      x: (scale.range[0] + scale.range[1]) / 2,
      y: 36,
      'text-anchor': 'middle',
      fill: '#7f8c8d',
      'font-size': '11px'
    });
    lbl.textContent = label;
    g.appendChild(lbl);
  }
  svg.appendChild(g);
  return g;
}

export function drawYAxis(svg, scale, label, x) {
  const g = svgEl('g', { class: 'chart-axis', transform: `translate(${x},0)` });
  g.appendChild(svgEl('line', { x1: 0, x2: 0, y1: scale.range[0], y2: scale.range[1], stroke: '#dcdde1' }));

  const [d0, d1] = scale.domain;
  const ticks = niceTickValues(d0, d1, 5);
  ticks.forEach(v => {
    const y = scale(v);
    g.appendChild(svgEl('line', { x1: -4, x2: 0, y1: y, y2: y, stroke: '#dcdde1' }));
    const t = svgEl('text', { x: -8, y: y + 4, 'text-anchor': 'end', 'font-size': '11px', fill: '#7f8c8d' });
    t.textContent = formatNumber(v);
    g.appendChild(t);
  });
  if (label) {
    const lbl = svgEl('text', {
      x: 0, y: scale.range[1] - 10,
      transform: `rotate(-90, -36, ${(scale.range[0] + scale.range[1]) / 2})`,
      'text-anchor': 'middle',
      fill: '#7f8c8d',
      'font-size': '11px'
    });
    lbl.textContent = label;
    g.appendChild(lbl);
  }
  svg.appendChild(g);
  return g;
}

export function drawGridLines(svg, yScale, xRange) {
  const g = svgEl('g', { class: 'chart-grid' });
  const [d0, d1] = yScale.domain;
  const ticks = niceTickValues(d0, d1, 5);
  ticks.forEach(v => {
    const y = yScale(v);
    g.appendChild(svgEl('line', { x1: xRange[0], x2: xRange[1], y1: y, y2: y, stroke: '#dcdde1', 'stroke-dasharray': '3,3', opacity: '0.5' }));
  });
  svg.appendChild(g);
  return g;
}

function niceTickValues(min, max, count) {
  if (max === min) return [min];
  const range = max - min;
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm <= 1.5) step = 1 * mag;
  else if (norm <= 3) step = 2 * mag;
  else if (norm <= 7) step = 5 * mag;
  else step = 10 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max; v += step) {
    ticks.push(Math.round(v * 1e10) / 1e10);
  }
  return ticks;
}

export function formatNumber(n) {
  if (n === 0) return '0';
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
  if (Math.abs(n) >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

export function formatKWh(n) {
  return formatNumber(n) + ' kWh';
}

export function addTooltip() {
  const tip = document.getElementById('global-tooltip');
  return {
    show(x, y, html) {
      tip.innerHTML = html;
      tip.hidden = false;
      const rect = tip.getBoundingClientRect();
      const nx = Math.min(x + 12, window.innerWidth - rect.width - 10);
      const ny = Math.min(y - 10, window.innerHeight - rect.height - 10);
      tip.style.left = nx + 'px';
      tip.style.top = ny + 'px';
    },
    hide() { tip.hidden = true; }
  };
}

export function addLegend(container, items) {
  const div = document.createElement('div');
  div.className = 'chart-legend';
  items.forEach(item => {
    const span = document.createElement('span');
    span.className = 'legend-item';
    span.innerHTML = `<span class="legend-dot" style="background:${item.color}"></span>${item.label}`;
    div.appendChild(span);
  });
  container.appendChild(div);
  return div;
}

export function responsiveSize(container) {
  const rect = container.getBoundingClientRect();
  const w = Math.max(rect.width - 32, 300);
  const h = Math.max(rect.height - 40, 220);
  return { width: w, height: h };
}

export function clearContainer(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

export function hslColor(value, min, max) {
  const ratio = max === min ? 0 : (value - min) / (max - min);
  const hue = (1 - ratio) * 120; // green(120) to red(0)
  return `hsl(${hue}, 75%, 50%)`;
}
