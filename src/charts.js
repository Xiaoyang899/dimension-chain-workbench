const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = { blue: '#365de5', amber: '#b77825', green: '#14816c', red: '#cf554f', ink: '#66758d', line: '#dce3ed' };

export function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

export function formatNumber(value, precision = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return (Math.abs(value) < 0.5 * 10 ** -precision ? 0 : value).toFixed(precision);
}

export function plotDomain(analysis, target) {
  const values = [analysis.worst.lower, analysis.worst.upper, analysis.mean - 4 * analysis.sigma, analysis.mean + 4 * analysis.sigma];
  if (Number.isFinite(target.lower)) values.push(target.lower);
  if (Number.isFinite(target.upper)) values.push(target.upper);
  let low = Math.min(...values), high = Math.max(...values);
  if (high === low) { low -= Math.max(1, Math.abs(low) * .02); high += Math.max(1, Math.abs(high) * .02); }
  const padding = (high - low) * .14;
  return [low - padding, high + padding];
}

export function projectCoordinate(value, domain, range) {
  return range[0] + (value - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);
}

export function createQualityChart(svg, kind, onTargetChange, onCursor) {
  let project, analysis, base = [0, 1], domain = [0, 1], zoom = 1, offset = 0, drag = null, printView = null;
  let width = 800, height = 252, right = 760, baseline = 184;
  const left = 58;
  function resize(nextWidth, nextHeight) {
    const rect = svg.getBoundingClientRect();
    const w = nextWidth ?? rect.width, h = nextHeight ?? rect.height;
    if (w <= 0 || h <= 0 || (width === w && height === h)) return;
    width = w; height = h; right = width - 48; baseline = height - 36;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    draw();
  }
  const key = `plot-${kind}`;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', kind === 'worst' ? '极值范围与规格区间，规格线可拖动' : '概率密度与超差区域，规格线可拖动');
  function x(value) { return projectCoordinate(value, domain, [left, right]); }
  function valueAt(pixel) { return projectCoordinate(pixel, [left, right], domain); }
  function point(event) {
    const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function add(tag, attrs, text, parent = svg) { const node = svgElement(tag, attrs, text); parent.append(node); return node; }
  function line(x1, y1, x2, y2, color, dashed = false, parent = svg) {
    return add('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 1.3, ...(dashed ? { 'stroke-dasharray': '5 4' } : {}) }, undefined, parent);
  }
  function draw() {
    svg.replaceChildren();
    if (!analysis?.valid) {
      add('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'chart-label' }, '完成有效输入后显示分析图');
      return;
    }
    const span = (base[1] - base[0]) / zoom;
    const middle = (base[0] + base[1]) / 2 + offset;
    domain = [middle - span / 2, middle + span / 2];
    const defs = add('defs');
    const clip = add('clipPath', { id: key }, undefined, defs);
    add('rect', { x: left, y: 35, width: right - left, height: baseline - 35 }, undefined, clip);
    const ticks = Math.max(2, Math.min(6, Math.floor((right - left) / 110)));
    for (let i = 0; i <= ticks; i++) {
      const px = left + i * (right - left) / ticks;
      line(px, 35, px, baseline, COLORS.line, true);
      const axisValue = valueAt(px);
      const tick = Math.abs(axisValue) >= 1e5 ? axisValue.toExponential(2) : formatNumber(axisValue, Math.min(8, Math.max(2, Math.ceil(-Math.log10(span)) + 2)));
      add('text', { x: px, y: baseline + 16, 'text-anchor': 'middle', class: 'chart-tick' }, tick);
    }
    line(left, baseline, right, baseline, COLORS.line);
    add('text', { x: right, y: height - 4, 'text-anchor': 'end', class: 'chart-tick' }, '封闭环尺寸 / mm');
    const plot = add('g', { 'clip-path': `url(#${key})` });
    if (analysis.targetPresent) {
      add('rect', { x: x(project.target.lower), y: 35, width: Math.max(0, x(project.target.upper) - x(project.target.lower)), height: baseline - 35, fill: COLORS.green, opacity: '.045' }, undefined, plot);
    }
    if (kind === 'worst') {
      const w = analysis.worst;
      const full = Math.max(2, x(w.upper) - x(w.lower));
      const center = (35 + baseline) / 2, band = Math.min(50, (baseline - 35) * .45);
      add('rect', { x: x(w.lower), y: center - band / 2, width: full, height: band, rx: 3, fill: COLORS.amber, opacity: '.18' }, undefined, plot);
      line(x(w.lower), center, x(w.upper), center, COLORS.amber, false, plot);
      for (const bound of [w.lower, w.upper]) {
        line(x(bound), center - band / 2 - 3, x(bound), center + band / 2 + 3, COLORS.amber, false, plot);
        add('circle', { cx: x(bound), cy: center, r: 3, fill: COLORS.amber }, undefined, plot);
        add('text', { x: x(bound), y: Math.min(baseline - 3, center + band / 2 + 14), 'text-anchor': 'middle', class: 'chart-tick' }, formatNumber(bound, project.display.precision), plot);
      }
      add('text', { x: x((w.lower + w.upper) / 2), y: Math.max(45, center - band / 2 - 8), 'text-anchor': 'middle', class: 'chart-label' }, '最坏尺寸范围', plot);
      if (analysis.targetPresent) {
        for (const [lo, hi] of [[w.lower, Math.min(w.upper, project.target.lower)], [Math.max(w.lower, project.target.upper), w.upper]]) {
          if (hi > lo) add('rect', { x: x(lo), y: center - band / 2, width: x(hi) - x(lo), height: band, fill: COLORS.red, opacity: '.24' }, undefined, plot);
        }
      }
    } else if (analysis.sigma > 0) {
      const y = (value) => baseline - (baseline - 42) * Math.exp(-.5 * ((value - analysis.mean) / analysis.sigma) ** 2);
      function densityPath(lo, hi) {
        const points = [];
        for (let i = 0; i <= 240; i++) { const v = lo + (hi - lo) * i / 240; points.push(`${x(v).toFixed(3)},${y(v).toFixed(3)}`); }
        return `M${x(lo)},${baseline} L${points.join(' L')} L${x(hi)},${baseline} Z`;
      }
      add('path', { d: densityPath(domain[0], domain[1]), fill: COLORS.blue, 'fill-opacity': '.10', stroke: COLORS.blue, 'stroke-width': 2 }, undefined, plot);
      if (analysis.targetPresent) {
        const tails = [[domain[0], Math.min(domain[1], project.target.lower)], [Math.max(domain[0], project.target.upper), domain[1]]];
        for (const [lo, hi] of tails) if (hi > lo) add('path', { d: densityPath(lo, hi), fill: COLORS.red, 'fill-opacity': '.38' }, undefined, plot);
      }
      line(x(analysis.mean), 44, x(analysis.mean), baseline, COLORS.blue, true, plot);
      add('text', { x: Math.max(left + 65, Math.min(right - 65, x(analysis.mean))), y: 31, 'text-anchor': 'middle', class: 'chart-label' }, `μ ${formatNumber(analysis.mean, project.display.precision)}`);
      if (analysis.statistical.available) {
        for (const v of [analysis.statistical.lower, analysis.statistical.upper]) line(x(v), 72, x(v), baseline, COLORS.blue, true, plot);
      }
    } else {
      line(x(analysis.mean), 60, x(analysis.mean), baseline, COLORS.blue, false, plot);
      add('circle', { cx: x(analysis.mean), cy: 60, r: 5, fill: COLORS.blue }, undefined, plot);
      add('text', { x: width / 2, y: 31, 'text-anchor': 'middle', class: 'chart-label' }, '确定值 · σ = 0，不存在连续密度');
    }
    if (analysis.targetPresent) {
      for (const [field, label] of [['lower', 'LSL'], ['upper', 'USL']]) {
        const px = x(project.target[field]);
        if (px < left || px > right) continue;
        const handle = add('g', { 'data-bound': field, tabindex: 0, role: 'slider', 'aria-label': field === 'lower' ? '拖动规格下限' : '拖动规格上限', 'aria-valuenow': project.target[field], class: 'spec-handle' });
        add('rect', { x: px - 10, y: 37, width: 20, height: baseline - 37, fill: 'transparent' }, undefined, handle);
        line(px, 40, px, baseline, COLORS.green, true, handle);
        add('path', { d: `M${px - 5},40 L${px + 5},40 L${px},47Z`, fill: COLORS.green }, undefined, handle);
        add('text', { x: px, y: 15, 'text-anchor': 'middle', class: 'spec-label' }, label, handle);
      }
    }
  }
  svg.addEventListener('pointerdown', (event) => {
    if (!analysis?.valid) return;
    const bound = event.target.closest('[data-bound]')?.getAttribute('data-bound');
    drag = { bound, point: point(event).x, offset, domain: [...domain] };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!analysis?.valid) return;
    const px = point(event).x;
    if (drag?.bound) {
      const v = valueAt(Math.max(left, Math.min(right, px)));
      const next = drag.bound === 'lower' ? Math.min(v, project.target.upper) : Math.max(v, project.target.lower);
      onTargetChange(drag.bound, next);
    } else if (drag) {
      offset = drag.offset - (px - drag.point) / (right - left) * (drag.domain[1] - drag.domain[0]);
      draw();
    }
    const value = valueAt(px);
    onCursor?.(`游标 ${formatNumber(value, 5)} mm${kind === 'probability' && analysis.sigma > 0 ? ` · 密度 ${formatNumber(Math.exp(-.5 * ((value - analysis.mean) / analysis.sigma) ** 2) / (analysis.sigma * Math.sqrt(2 * Math.PI)), 4)} /mm` : ''}`);
  });
  svg.addEventListener('pointerup', () => { drag = null; });
  svg.addEventListener('pointercancel', () => { drag = null; });
  svg.addEventListener('keydown', (event) => {
    const field = event.target.closest('[data-bound]')?.getAttribute('data-bound');
    if (!field || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = (domain[1] - domain[0]) / 100 * (event.key === 'ArrowRight' ? 1 : -1);
    onTargetChange(field, field === 'lower' ? Math.min(project.target.lower + step, project.target.upper) : Math.max(project.target.upper + step, project.target.lower));
    svg.querySelector(`[data-bound="${field}"]`)?.focus();
  });
  svg.addEventListener('wheel', (event) => {
    if (!analysis?.valid || !event.ctrlKey) return;
    event.preventDefault(); zoom = Math.max(.5, Math.min(12, zoom * (event.deltaY > 0 ? .85 : 1.15))); draw();
  }, { passive: false });
  return {
    update(nextProject, nextAnalysis) { project = nextProject; analysis = nextAnalysis; if (analysis.valid && !drag) base = plotDomain(analysis, project.target); draw(); },
    reset() { zoom = 1; offset = 0; draw(); },
    beforePrint() { printView = { zoom, offset }; zoom = 1; offset = 0; resize(490, 190); draw(); },
    afterPrint() { if (printView) { ({ zoom, offset } = printView); printView = null; } resize(); draw(); },
    resize
  };
}
