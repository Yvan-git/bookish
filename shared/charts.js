/**
 * Hand-rolled SVG charts (no chart library): bar, horizontal bar, Pareto,
 * donut and timeline. Every chart reads its colours from CSS custom properties
 * so it follows the active theme, and exposes accessible text alternatives.
 */

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, v);
  }
  return node;
}

/** Theme-aware colour palette. */
export function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    primary: v('--primary', '#8C2F39'),
    accent: v('--accent', '#B98A44'),
    ink: v('--ink', '#1A1614'),
    muted: v('--muted', '#6B6157'),
    line: v('--line', '#E6DFD4'),
    surface: v('--surface', '#FFFFFF'),
    series: [
      v('--primary', '#8C2F39'),
      v('--accent', '#B98A44'),
      v('--primary-soft', '#F6E9EA'),
      v('--accent-soft', '#FAF1E1'),
      '#5C7C89', '#8A6F9B', '#6E8B5A', '#A5614E', '#4E7A7A', '#9A5B87',
    ],
  };
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Attach a native tooltip (<title>) to an SVG node. */
function withTitle(node, text) {
  const title = svgEl('title', {});
  title.textContent = text;
  node.append(title);
  return node;
}

/** Render a chart into a container, re-rendering on resize. */
function render(container, draw) {
  clear(container);
  const width = Math.max(260, container.clientWidth || 320);
  const drawFn = () => {
    const w = Math.max(260, container.clientWidth || 320);
    clear(container);
    container.append(draw(w));
  };
  const svg = draw(width);
  container.append(svg);
  if (container._resizeObserver) container._resizeObserver.disconnect();
  const ro = new ResizeObserver(() => drawFn());
  ro.observe(container);
  container._resizeObserver = ro;
  container._redraw = drawFn;
}

const niceMax = (value) => {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * base;
};

/** Vertical bar chart. data: [{label, value}] */
export function barChart(container, data, opts = {}) {
  render(container, (width) => {
    const p = palette();
    const height = opts.height || 190;
    const padTop = 18;
    const padBottom = 34;
    const padLeft = 8;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`, width: '100%', height,
      role: 'img', 'aria-label': opts.ariaLabel || 'chart',
    });
    if (!data.length) {
      svg.append(svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: p.muted, 'font-size': 13 }));
      svg.lastChild.textContent = opts.emptyText || '—';
      return svg;
    }
    const max = niceMax(Math.max(...data.map((d) => d.value)));
    const innerW = width - padLeft * 2;
    const innerH = height - padTop - padBottom;
    const slot = innerW / data.length;
    const barW = Math.max(8, Math.min(38, slot * 0.6));

    // baseline
    svg.append(svgEl('line', {
      x1: padLeft, y1: padTop + innerH, x2: width - padLeft, y2: padTop + innerH, stroke: p.line, 'stroke-width': 1,
    }));

    data.forEach((d, i) => {
      const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * innerH);
      const x = padLeft + slot * i + (slot - barW) / 2;
      const y = padTop + innerH - h;
      const g = svgEl('g', { class: 'chart-bar' });
      g.append(svgEl('rect', {
        x, y, width: barW, height: h, rx: Math.min(6, barW / 3),
        fill: d.color || p.primary, opacity: 0.92,
      }));
      const value = svgEl('text', {
        x: x + barW / 2, y: y - 6, 'text-anchor': 'middle', fill: p.ink,
        'font-size': 11, 'font-weight': 600,
      });
      value.textContent = d.value;
      g.append(value);
      const label = svgEl('text', {
        x: x + barW / 2, y: padTop + innerH + 15, 'text-anchor': 'middle',
        fill: p.muted, 'font-size': 10.5,
      });
      label.textContent = d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label;
      g.append(label);
      withTitle(g, `${d.label}: ${d.value}`);
      svg.append(g);
    });
    return svg;
  });
}

/** Horizontal bars — good for long labels (languages, publishers). */
export function hBarChart(container, data, opts = {}) {
  render(container, (width) => {
    const p = palette();
    const rowH = 26;
    const height = Math.max(40, data.length * rowH + 10);
    const labelW = Math.min(130, Math.max(80, width * 0.34));
    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`, width: '100%', height,
      role: 'img', 'aria-label': opts.ariaLabel || 'chart',
    });
    if (!data.length) {
      const t = svgEl('text', { x: width / 2, y: 24, 'text-anchor': 'middle', fill: p.muted, 'font-size': 13 });
      t.textContent = opts.emptyText || '—';
      svg.append(t);
      return svg;
    }
    const max = Math.max(...data.map((d) => d.value)) || 1;
    const barArea = width - labelW - 46;
    data.forEach((d, i) => {
      const y = 6 + i * rowH;
      const w = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * barArea);
      const g = svgEl('g');
      const label = svgEl('text', { x: 0, y: y + 15, fill: p.ink, 'font-size': 12 });
      label.textContent = d.label.length > 20 ? `${d.label.slice(0, 19)}…` : d.label;
      g.append(label);
      g.append(svgEl('rect', {
        x: labelW, y: y + 3, width: w, height: 15, rx: 5,
        fill: d.color || p.primary, opacity: 0.9,
      }));
      const val = svgEl('text', { x: labelW + w + 8, y: y + 15, fill: p.muted, 'font-size': 11.5, 'font-weight': 600 });
      val.textContent = d.value;
      g.append(val);
      withTitle(g, `${d.label}: ${d.value}`);
      svg.append(g);
    });
    return svg;
  });
}

/**
 * Pareto chart: bars sorted descending + cumulative percentage line.
 * data: [{label, value}]
 */
export function paretoChart(container, data, opts = {}) {
  render(container, (width) => {
    const p = palette();
    const height = opts.height || 210;
    const padTop = 16;
    const padBottom = 46;
    const padLeft = 26;
    const padRight = 30;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`, width: '100%', height,
      role: 'img', 'aria-label': opts.ariaLabel || 'pareto',
    });
    if (!data.length) {
      const t = svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: p.muted, 'font-size': 13 });
      t.textContent = opts.emptyText || '—';
      svg.append(t);
      return svg;
    }
    const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
    const max = niceMax(Math.max(...data.map((d) => d.value)));
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;
    const slot = innerW / data.length;
    const barW = Math.max(8, Math.min(34, slot * 0.58));

    // horizontal gridlines (0/50/100 % axis on the right)
    [0, 50, 100].forEach((pct) => {
      const y = padTop + innerH - (pct / 100) * innerH;
      svg.append(svgEl('line', { x1: padLeft, y1: y, x2: width - padRight, y2: y, stroke: p.line, 'stroke-width': 1, 'stroke-dasharray': pct === 0 ? '' : '3 4' }));
      const label = svgEl('text', { x: width - padRight + 5, y: y + 3.5, fill: p.muted, 'font-size': 9.5 });
      label.textContent = `${pct}%`;
      svg.append(label);
    });

    const points = [];
    let cumulative = 0;
    data.forEach((d, i) => {
      cumulative += d.value;
      const pct = (cumulative / total) * 100;
      const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * innerH);
      const x = padLeft + slot * i + (slot - barW) / 2;
      const y = padTop + innerH - h;
      svg.append(svgEl('rect', { x, y, width: barW, height: h, rx: 5, fill: p.primary, opacity: 0.9 }));
      const value = svgEl('text', { x: x + barW / 2, y: y - 5, 'text-anchor': 'middle', fill: p.ink, 'font-size': 10.5, 'font-weight': 600 });
      value.textContent = d.value;
      svg.append(value);
      const label = svgEl('text', { x: x + barW / 2, y: padTop + innerH + 14, 'text-anchor': 'middle', fill: p.muted, 'font-size': 10 });
      label.textContent = d.label.length > 11 ? `${d.label.slice(0, 10)}…` : d.label;
      svg.append(label);
      const px = x + barW / 2;
      const py = padTop + innerH - (pct / 100) * innerH;
      points.push(`${px},${py}`);
      const g = svgEl('g');
      withTitle(g, `${d.label}: ${d.value} (${Math.round(pct)} % cumulés)`);
      svg.append(g);
    });

    svg.append(svgEl('polyline', {
      points: points.join(' '), fill: 'none', stroke: p.accent, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    points.forEach((pt) => {
      const [px, py] = pt.split(',').map(Number);
      svg.append(svgEl('circle', { cx: px, cy: py, r: 3.2, fill: p.accent, stroke: p.surface, 'stroke-width': 1.5 }));
    });
    return svg;
  });
}

/** Donut chart. data: [{label, value}] */
export function donutChart(container, data, opts = {}) {
  render(container, (width) => {
    const p = palette();
    const height = opts.height || 200;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`, width: '100%', height,
      role: 'img', 'aria-label': opts.ariaLabel || 'chart',
    });
    const values = data.filter((d) => d.value > 0);
    if (!values.length) {
      const t = svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: p.muted, 'font-size': 13 });
      t.textContent = opts.emptyText || '—';
      svg.append(t);
      return svg;
    }
    const total = values.reduce((s, d) => s + d.value, 0);
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 12;
    const thickness = opts.thickness || 26;
    let angle = -Math.PI / 2;

    values.forEach((d, i) => {
      const sweep = (d.value / total) * Math.PI * 2;
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      const x2 = cx + radius * Math.cos(angle + sweep);
      const y2 = cy + radius * Math.sin(angle + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      const path = svgEl('path', {
        d: `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`,
        stroke: d.color || p.series[i % p.series.length],
        'stroke-width': thickness, fill: 'none', 'stroke-linecap': 'butt',
      });
      withTitle(path, `${d.label}: ${d.value} (${Math.round((d.value / total) * 100)} %)`);
      svg.append(path);
      angle += sweep;
    });

    if (opts.centerLabel) {
      const label = svgEl('text', { x: cx, y: cy + 2, 'text-anchor': 'middle', fill: p.ink, 'font-size': 22, 'font-weight': 700 });
      label.textContent = opts.centerLabel;
      svg.append(label);
      const sub = svgEl('text', { x: cx, y: cy + 19, 'text-anchor': 'middle', fill: p.muted, 'font-size': 11 });
      sub.textContent = opts.centerSub || '';
      svg.append(sub);
    }
    return svg;
  });
}

/** Legend rows for a donut/bar chart. */
export function legendList(container, data, opts = {}) {
  clear(container);
  const p = palette();
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  data.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'legend__row';
    row.innerHTML = `
      <span class="legend__dot" style="background:${d.color || p.series[i % p.series.length]}"></span>
      <span class="legend__label">${escapeText(d.label)}</span>
      <span class="legend__value">${d.value}</span>
      <span class="legend__pct">${Math.round((d.value / total) * 100)} %</span>`;
    container.append(row);
  });
}

function escapeText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Timeline of books per year (columns). */
export function timelineChart(container, data, opts = {}) {
  barChart(container, data, { ...opts, height: opts.height || 170 });
}
