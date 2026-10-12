import { svgElement, formatNumber } from './charts.js';

let probeText;
function textWidth(text) {
  if (!probeText) {
    const probe = svgElement('svg', { class: 'chain-measure', 'aria-hidden': 'true' });
    probeText = svgElement('text', { class: 'chain-text' });
    probe.append(probeText); document.body.append(probe);
  }
  probeText.textContent = text;
  return probeText.getComputedTextLength();
}

const views = new WeakMap();
export function renderChain(svg, project, analysis, selectedId, onSelect, { start = 0, end = project.rows.length, scale = project.display.chainScale, printing = false } = {}) {
  let view = views.get(svg);
  if (!view) {
    view = { x: 0, y: 0, scale: 1, drag: null }; views.set(svg, view);
    const point = event => new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    svg.addEventListener('pointerdown', event => {
      if (view.scale <= 1) return;
      view.drag = { point: point(event), x: view.x, y: view.y };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', event => {
      if (!view.drag) return;
      const p = point(event);
      view.x = view.drag.x + p.x - view.drag.point.x; view.y = view.drag.y + p.y - view.drag.point.y;
      view.apply();
    });
    for (const type of ['pointerup', 'pointercancel']) svg.addEventListener(type, () => { view.drag = null; });
  }
  const focusedId = svg.contains(document.activeElement) ? document.activeElement.getAttribute('data-row-id') : null;
  svg.replaceChildren();
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '直线尺寸链示意图，蓝色增环，灰色减环，橙色全链封闭环');
  const rect = svg.getBoundingClientRect();
  const width = printing ? 680 : rect.width || 440;
  const height = printing ? Math.max(235, 130 + project.rows.length * 35) : Math.max(235, rect.height || 320);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('data-zoomed', String(scale > 1));
  if (!analysis.valid) {
    svg.append(svgElement('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'chart-label' }, '请先检查组成环输入'));
    return;
  }
  const add = (tag, attributes, text, parent = svg) => { const el = svgElement(tag, attributes, text); parent.append(el); return el; };
  const defs = add('defs');
  const grid = add('pattern', { id: 'chain-grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, undefined, defs);
  add('path', { d: 'M20 0H0V20', fill: 'none', stroke: '#dfe6f0', 'stroke-width': .65 }, undefined, grid);
  for (const [name, color] of [['positive', '#365de5'], ['negative', '#7a8ca7'], ['closing', '#b77825']]) {
    const marker = add('marker', { id: `arrow-${name}`, markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: 'auto', markerUnits: 'userSpaceOnUse' }, undefined, defs);
    add('path', { d: 'M0 0L7 3L0 6Z', fill: color }, undefined, marker);
  }
  add('rect', { width, height, fill: 'url(#chain-grid)' });
  let position = 0;
  const segments = project.rows.map((row) => {
    const start = position;
    position += row.direction * row.nominal * row.drawing.scale;
    return { row, start, end: position };
  });
  const points = [0, ...segments.flatMap(s => [s.start, s.end])];
  const low = Math.min(...points), high = Math.max(...points), span = Math.max(high - low, 1);
  const x = value => 50 + (value - low) / span * (width - 100);
  const drawing = add('g');
  if (!printing) {
    if (view.scale !== scale) { view.x = 0; view.y = 0; }
    view.scale = scale;
    view.apply = () => {
      const dx = width * Math.max(0, scale - 1) / 2, dy = height * Math.max(0, scale - 1) / 2;
      view.x = Math.max(-dx, Math.min(dx, view.x)); view.y = Math.max(-dy, Math.min(dy, view.y));
      drawing.setAttribute('transform', `translate(${width * (1 - scale) / 2 + view.x} ${height * (1 - scale) / 2 + view.y}) scale(${scale})`);
    };
    view.apply();
  }
  const visible = segments.slice(start, end);
  const layerSpace = Math.max(0, ...visible.map(segment => segment.row.drawing.layer * 2));
  const spacing = Math.min(35, (height - 130 - layerSpace) / Math.max(1, visible.length - 1));
  for (const [index, { row, start, end }] of visible.entries()) {
    const y = 40 + index * spacing + row.drawing.layer * 2;
    const kind = row.direction > 0 ? 'positive' : 'negative';
    const color = selectedId === row.id ? '#365de5' : row.direction > 0 ? '#365de5' : '#7a8ca7';
    const groupLabel = row.description ? `选择 ${row.label}，${row.description}` : `选择 ${row.label}`;
    const group = add('g', { class: 'chain-ring', tabindex: 0, role: 'button', 'aria-label': groupLabel, 'data-row-id': row.id }, undefined, drawing);
    group.addEventListener('click', () => onSelect(row.id));
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row.id); } });
    const top = row.description ? y - 31 : y - 22;
    add('rect', { x: Math.min(x(start), x(end)) - 14, y: top, width: Math.max(28, Math.abs(x(end) - x(start)) + 28), height: y + 11 - top, rx: 4, fill: selectedId === row.id ? '#365de50c' : 'transparent' }, undefined, group);
    for (const value of [start, end]) add('line', { x1: x(value), x2: x(value), y1: y - 6, y2: height - 46, stroke: '#b8c5d8', 'stroke-dasharray': '3 5', 'stroke-width': .7 }, undefined, drawing);
    add('line', { x1: x(start), y1: y, x2: x(end), y2: y, stroke: color, 'stroke-width': selectedId === row.id ? 2.4 : 1.7, 'marker-end': `url(#arrow-${kind})` }, undefined, group);
    add('circle', { cx: x(start), cy: y, r: 2.3, fill: color }, undefined, group);
    const dimension = `${row.nominal}${row.symmetric ? ` ±${formatNumber(row.upperDeviation, 2)}` : ` (${formatNumber(row.lowerDeviation, 2)}, ${formatNumber(row.upperDeviation, 2)})`}`;
    const label = row.drawing.label || (project.display.labelMode === 'id' ? row.label : project.display.labelMode === 'value' ? dimension : `${row.label}  ${dimension}`);
    const center = (x(start) + x(end)) / 2;
    add('text', { x: center, y: row.description ? y - 20 : y - 9, 'text-anchor': 'middle', class: 'chain-text', fill: color }, label, group);
    if (row.description) add('text', { x: center - textWidth(label) / 2, y: y - 9, 'text-anchor': 'start', class: 'chain-text', fill: color }, row.description, group);
  }
  const closingY = height - 41;
  add('line', { x1: x(0), y1: closingY, x2: x(position), y2: closingY, stroke: '#b77825', 'stroke-width': 2, 'marker-end': 'url(#arrow-closing)' }, undefined, drawing);
  if (Math.abs(position) < 1e-12) add('circle', { cx: x(0), cy: closingY, r: 5, fill: '#fff', stroke: '#b77825', 'stroke-width': 2 }, undefined, drawing);
  add('text', { x: (x(0) + x(position)) / 2, y: closingY + 24, 'text-anchor': 'middle', class: 'chain-text', fill: '#98641c' }, `A₀ = ${formatNumber(analysis.nominal, project.display.precision)} mm`, drawing);
  if (focusedId && !printing) [...svg.querySelectorAll('.chain-ring')].find(ring => ring.getAttribute('data-row-id') === focusedId)?.focus({ preventScroll: true });
}
