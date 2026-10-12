import { createProject, createRow, validateProject, DISTRIBUTIONS, CONFIDENCE_LEVELS } from './model.js';
import { createSample } from './samples.js';
import { analyze } from './math.js';
import { allocate } from './allocation.js';
import { createQualityChart, svgElement, formatNumber } from './charts.js';
import { renderChain } from './chain-diagram.js';
import { MAX_FILE_BYTES, parseProjectJson, serializeProject, parseTsv, exportCsv, saveAutosave, readAutosave } from './project-io.js';

const $ = id => document.getElementById(id);
// Bounds the quality-page width editor only; wider imported values keep their data and just show a warning.
const TOLERANCE_WIDTH_MAX = 10;
const ICONS = {
  folder: 'M3 7V5h6l2 2h10v13H3V7Z', print: 'M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7ZM17 11h.01',
  save: 'M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8', table: 'M3 4h18v16H3ZM3 10h18M9 4v16',
  chart: 'M4 3v17h17M7 15l4-5 4 2 5-7', sliders: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  paste: 'M9 5H5v16h14V5h-4M9 3h6v4H9ZM8 11h8M8 15h6', chain: 'M4 7h16l-4-4M20 17H4l4 4M4 11v2M20 11v2',
  target: 'M12 3v3M12 18v3M3 12h3M18 12h3M19 12a7 7 0 1 0-14 0 7 7 0 0 0 14 0ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  expand: 'M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', arrow: 'M4 12h16m-6-6 6 6-6 6'
};
function icon(name) {
  const svg = svgElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.append(svgElement('path', { d: ICONS[name] || ICONS.target })); return svg;
}
for (const element of document.querySelectorAll('[data-icon]')) element.append(icon(element.dataset.icon));
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function option(value, label) { const node = element('option', '', label); node.value = value; return node; }

let project = createSample(2);
let selectedId = project.rows[0].id;
let analysis = analyze(project);
let preview = null, undoProject = null, dirty = false, toastTimer;
let activePage = 'components', printing = false, printFocus = null;
let chainViewScale = project.display.chainScale;
const pages = { components: { index: 0, size: 6 }, contributions: { index: 0, size: 6 }, candidates: { index: 0, size: 2 } };
const pageBodies = { components: 'component-rows', contributions: 'contribution-bars', candidates: 'allocation-rows' };
function paginate(name) {
  const state = pages[name], rows = [...$(pageBodies[name]).children];
  const count = Math.max(1, Math.ceil(rows.length / state.size));
  state.index = Math.max(0, Math.min(state.index, count - 1));
  rows.forEach((row, i) => row.classList.toggle('paged-out', i < state.index * state.size || i >= (state.index + 1) * state.size));
  $(`${name}-page`).textContent = `${state.index + 1} / ${count} 页 · 共 ${rows.length} 项`;
  $(`${name}-prev`).disabled = state.index === 0;
  $(`${name}-next`).disabled = state.index === count - 1;
}
function revealSelection() {
  const index = project.rows.findIndex(row => row.id === selectedId);
  if (index >= 0) pages.components.index = Math.floor(index / pages.components.size);
  paginate('components');
}
function measurePages() {
  if (printing) return;
  for (const [name, selector, rowHeight, header] of [['components', '.table-scroll', 40, 30], ['contributions', '#contribution-bars', 30, 0], ['candidates', '.allocation-table-scroll', 24, 22]]) {
    const box = document.querySelector(selector);
    if (!box.checkVisibility() || box.clientHeight === 0) continue;
    const desktop = matchMedia('(min-width:1280px) and (min-height:720px)').matches;
    const size = desktop ? Math.max(1, Math.min(25, Math.floor((box.clientHeight - header) / rowHeight))) : name === 'candidates' ? 5 : 6;
    if (size === pages[name].size) continue;
    const first = pages[name].index * pages[name].size;
    pages[name].size = size;
    pages[name].index = Math.floor(first / size);
    if (name === 'components') revealSelection();
    paginate(name);
  }
  drawChain();
}
function showPage(name, focus = false) {
  if (!['components', 'quality', 'allocation'].includes(name)) return;
  activePage = name;
  for (const id of ['components', 'quality', 'allocation']) {
    $(id).hidden = id !== name;
    $(`tab-${id}`).setAttribute('aria-selected', String(id === name));
    $(`tab-${id}`).tabIndex = id === name ? 0 : -1;
  }
  if (name !== 'components') $(`${name}-chart-host`).append(document.querySelector('.charts-grid'));
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  if (focus) $(`tab-${name}`).focus();
  measurePages();
  worstChart.resize(); probabilityChart.resize();
}
function drawChain() {
  const { index, size } = pages.components;
  const start = printing ? 0 : index * size, end = printing ? project.rows.length : Math.min(project.rows.length, start + size);
  $('chain-range').textContent = `第 ${project.rows.length ? start + 1 : 0}–${end} 环 / 共 ${project.rows.length} 环 · 封闭环按全链计算`;
  renderChain($('chain-svg'), project, analysis, selectedId, selectRow, { start, end, scale: printing ? 1 : chainViewScale, printing });
}
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const previous = readAutosave(storage);
let recoveryPending = previous.ok && Boolean(previous.value);
const num = input => input.value.trim() === '' ? null : Number(input.value);
const fmt = value => formatNumber(value, project.display.precision);
function assignInput(id, value) {
  const input = $(id);
  if (document.activeElement !== input) input.value = value === null || value === undefined ? '' : String(value);
}
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}
function safeStorageSave() {
  $('storage-status').textContent = recoveryPending ? '旧暂存尚待恢复或忽略 · 当前编辑请保存项目文件' : saveAutosave(storage, project).message;
}
function clearPreview() {
  preview = null; $('allocation-preview').hidden = true; $('apply-allocation').disabled = true;
  allocationMessage('从目标规格，反推公差空间', '在组成环表中锁定不能调整的环，再预览分配方案。');
}
function commit({ rows = false, model = false, keepUndo = false } = {}) {
  if (model) project.statistics.acceptNormalApproximation = false;
  if (!keepUndo) undoProject = null;
  clearPreview(); dirty = true; $('edit-state').textContent = '已修改 · 请保存项目文件';
  if (rows) renderRows();
  render(); if (analysis.valid) safeStorageSave();
}
function selectRow(id) {
  selectedId = id;
  revealSelection(); renderSelection(); renderVisuals();
}
function fieldInput(row, key, type, label) {
  const input = element('input'); input.type = type; input.dataset.field = key; input.dataset.rowId = row.id;
  input.setAttribute('aria-label', `${row.label} ${label}`);
  if (type === 'checkbox') input.checked = row[key];
  else { input.value = row[key] ?? ''; if (type === 'number') input.step = 'any'; }
  if (key === 'label') { input.maxLength = 120; input.className = 'row-label'; }
  if (key === 'description') input.maxLength = 120;
  if (key === 'lowerDeviation') input.title = '可直接输入；与 −上偏差不同时自动取消对称，上偏差保持不变';
  return input;
}
function renderRows() {
  const body = $('component-rows'); body.replaceChildren();
  for (const [index, row] of project.rows.entries()) {
    const tr = element('tr'); tr.dataset.rowId = row.id;
    const indexCell = element('td', '', String(index + 1).padStart(2, '0')); tr.append(indexCell);
    indexCell.addEventListener('click', () => selectRow(row.id));
    const append = (control, cls = '') => { const td = element('td', cls); td.append(control); tr.append(td); };
    append(fieldInput(row, 'label', 'text', '环标识'));
    append(fieldInput(row, 'description', 'text', '环描述'));
    append(fieldInput(row, 'nominal', 'number', '基本尺寸'));
    const direction = element('select', row.direction === 1 ? 'direction-positive' : 'direction-negative');
    direction.dataset.field = 'direction'; direction.dataset.rowId = row.id; direction.setAttribute('aria-label', `${row.label} 方向`);
    direction.append(option('1', '+ 增环'), option('-1', '− 减环')); direction.value = row.direction; append(direction);
    append(fieldInput(row, 'upperDeviation', 'number', '上偏差'));
    append(fieldInput(row, 'lowerDeviation', 'number', '下偏差'));
    append(fieldInput(row, 'symmetric', 'checkbox', '对称公差'), 'center-cell');
    const distribution = element('select'); distribution.dataset.field = 'distribution'; distribution.dataset.rowId = row.id;
    distribution.setAttribute('aria-label', `${row.label} 分布`);
    for (const [key, preset] of Object.entries(DISTRIBUTIONS)) distribution.append(option(key, preset.label));
    distribution.value = row.distribution; append(distribution);
    const lock = fieldInput(row, 'locked', 'checkbox', '锁定公差分配'); lock.title = '反算时保持此环公差不变'; append(lock, 'center-cell');
    const remove = element('button', 'delete-row', '×'); remove.setAttribute('aria-label', `删除 ${row.label}`);
    remove.addEventListener('click', () => {
      project.rows = project.rows.filter(item => item.id !== row.id);
      if (selectedId === row.id) selectedId = project.rows[0]?.id;
      commit({ rows: true, model: true });
    }); append(remove); body.append(tr);
  }
  revealSelection(); renderSelection();
}
function updateRowFromControl(event) {
  const control = event.target, key = control.dataset.field;
  if (!key) return;
  if (event.type === 'input' && (control.tagName === 'SELECT' || control.type === 'checkbox')) return;
  if (event.type === 'change' && control.tagName === 'INPUT' && control.type !== 'checkbox') return;
  const row = project.rows.find(item => item.id === control.dataset.rowId); if (!row) return;
  selectedId = row.id;
  if (key === 'symmetric') {
    if (control.checked && row.upperDeviation !== -row.lowerDeviation && !window.confirm('开启对称模式将设置下偏差 = −上偏差，并将上偏差取非负值。是否转换？')) { control.checked = false; return; }
    row.symmetric = control.checked;
    if (row.symmetric) { row.upperDeviation = Number.isFinite(row.upperDeviation) ? Math.abs(row.upperDeviation) : null; row.lowerDeviation = Number.isFinite(row.upperDeviation) ? -row.upperDeviation : null; }
    commit({ rows: true, model: true }); return;
  }
  row[key] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? num(control) : key === 'direction' ? Number(control.value) : control.value;
  if (key === 'lowerDeviation' && row.symmetric && (!Number.isFinite(row.upperDeviation) || row.lowerDeviation !== -row.upperDeviation)) {
    row.symmetric = false;
    control.closest('tr').querySelector('[data-field="symmetric"]').checked = false;
  }
  if (key === 'upperDeviation' && row.symmetric) {
    row.lowerDeviation = Number.isFinite(row.upperDeviation) ? -row.upperDeviation : null;
    control.closest('tr').querySelector('[data-field="lowerDeviation"]').value = row.lowerDeviation ?? '';
  }
  if (key === 'direction') control.className = row.direction === 1 ? 'direction-positive' : 'direction-negative';
  commit({ model: ['nominal', 'direction', 'upperDeviation', 'lowerDeviation', 'distribution'].includes(key) });
}
$('component-rows').addEventListener('input', updateRowFromControl);
$('component-rows').addEventListener('change', updateRowFromControl);
$('component-rows').addEventListener('focusin', event => { const rowId = event.target.dataset.rowId; if (rowId && selectedId !== rowId) selectRow(rowId); });
function renderSelection() {
  const row = project.rows.find(item => item.id === selectedId);
  for (const tr of $('component-rows').children) tr.classList.toggle('selected', tr.dataset.rowId === selectedId);
  $('selected-row-name').textContent = row?.label || '未选中';
  const selector = $('quality-row-select');
  const ringOption = item => item.description ? `${item.label} · ${item.description}` : item.label;
  if (selector.options.length !== project.rows.length || project.rows.some((item, i) => selector.options[i]?.value !== item.id || selector.options[i]?.textContent !== ringOption(item))) selector.replaceChildren(...project.rows.map(item => option(item.id, ringOption(item))));
  selector.value = selectedId || ''; selector.disabled = !row;
  $('row-settings').disabled = !row;
  $('row-dialog-title').textContent = `${row?.label || '未选中'} · 备注与绘图设置`;
  $('tolerance-slider').disabled = !row || !analysis.valid;
  const widthInput = $('tolerance-value');
  widthInput.disabled = !row || !analysis.valid;
  const width = row ? row.upperDeviation - row.lowerDeviation : null;
  assignInput('tolerance-value', width);
  if (document.activeElement !== widthInput) widthInput.setCustomValidity('');
  if (!widthInput.validity.valid && !widthInput.disabled) widthInput.setAttribute('aria-invalid', 'true');
  else widthInput.removeAttribute('aria-invalid');
  $('width-warning').hidden = !row || width <= TOLERANCE_WIDTH_MAX;
  if (!row) return;
  assignInput('tolerance-slider', width);
  assignInput('row-note', row.note); assignInput('row-drawing-label', row.drawing.label);
  assignInput('row-scale', row.drawing.scale); assignInput('row-layer', row.drawing.layer);
}
function targetChange(field, value) {
  project.target[field] = value;
  assignInput(`target-${field}`, value); commit();
}
const worstChart = createQualityChart($('worst-chart'), 'worst', targetChange, text => { $('worst-cursor').textContent = text; });
const probabilityChart = createQualityChart($('probability-chart'), 'probability', targetChange, text => { $('probability-cursor').textContent = text; });
function renderVisuals() {
  drawChain();
  worstChart.update(project, analysis); probabilityChart.update(project, analysis); renderContributions();
}
function renderContributions() {
  const container = $('contribution-bars');
  const focusedId = container.contains(document.activeElement) ? document.activeElement.dataset.rowId : null;
  container.replaceChildren();
  if (!analysis.valid) { container.append(element('p', 'panel-note', '完成有效输入后显示贡献分析。')); return; }
  const mode = $('contribution-mode').value;
  const contributions = [...analysis.contributions].sort((a, b) => (mode === 'variance' ? b.varianceShare - a.varianceShare : b.worstShare - a.worstShare));
  for (const item of contributions) {
    const row = project.rows.find(r => r.id === item.id);
    const share = mode === 'variance' ? item.varianceShare : item.worstShare;
    const button = element('button', `contribution-row${item.id === selectedId ? ' selected' : ''}`);
    button.setAttribute('aria-label', `选择 ${row.label}${row.description ? `，${row.description}` : ''}，贡献 ${formatNumber(share * 100, 1)}%`);
    const identity = element('div', 'contribution-id');
    identity.append(element('strong', '', row.label));
    if (row.description) identity.append(element('em', '', row.description));
    button.append(identity);
    const bar = svgElement('svg', { viewBox: '0 0 250 10', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    bar.append(svgElement('rect', { width: 250, height: 10, rx: 3, fill: '#f0f3f9' }), svgElement('rect', { width: Math.max(0, share * 250), height: 10, rx: 3, fill: mode === 'variance' ? item.id === selectedId ? '#365de5' : '#849cef' : '#c99b5c' }));
    button.append(bar, element('span', '', `${formatNumber(share * 100, 1)}%`));
    button.title = row.description ? `${row.label} · ${row.description}` : row.label; button.dataset.rowId = row.id;
    button.addEventListener('click', () => selectRow(row.id)); container.append(button);
  }
  paginate('contributions');
  if (focusedId) [...container.children].find(button => button.dataset.rowId === focusedId)?.focus({ preventScroll: true });
}
function setBadge(id, data, available = true) {
  const node = $(id);
  node.className = `result-badge ${!available || data?.pass === null || data?.pass === undefined ? 'pending' : data.pass ? 'pass' : 'fail'}`;
  node.textContent = !available ? '模型待确认' : data?.pass === null || data?.pass === undefined ? '未设置规格' : data.pass ? '区间满足规格' : '区间超出规格';
}
function render() {
  analysis = analyze(project);
  const valid = analysis.valid;
  $('row-count').textContent = `${project.rows.length} / 25`;
  $('add-row').disabled = project.rows.length >= 25;
  $('save-button').disabled = !valid; $('export-button').disabled = !valid; $('print-button').disabled = !valid;
  $('preview-allocation').disabled = !valid || !analysis.targetPresent;
  $('undo-allocation').disabled = !undoProject;
  $('unlocked-count').textContent = `${project.rows.filter(row => !row.locked).length} 个可调整环`;
  assignInput('project-name', project.name); assignInput('project-revision', project.revision);
  for (const field of ['lower', 'upper']) assignInput(`target-${field}`, project.target[field]);
  assignInput('precision', project.display.precision); assignInput('label-mode', project.display.labelMode);
  if (![...$('chain-scale').options].some(item => Number(item.value) === chainViewScale)) $('chain-scale').append(option(chainViewScale, `${chainViewScale}×`));
  assignInput('chain-scale', chainViewScale);
  assignInput('statistics-mode', project.statistics.mode); assignInput('confidence', project.statistics.confidence); assignInput('manual-k0', project.statistics.manualK0);
  $('accept-approximation').checked = project.statistics.acceptNormalApproximation;
  $('confidence-field').hidden = project.statistics.mode !== 'preset'; $('manual-k-field').hidden = project.statistics.mode !== 'manual';
  $('approximation-notice').hidden = !analysis.hasNonNormal;
  $('error-list').replaceChildren(); $('validation-errors').hidden = valid;
  $('validation-summary').textContent = valid ? '' : `${analysis.errors.length} 项输入需修正 · ${analysis.errors[0].message}`;
  for (const control of document.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  if (!valid) {
    for (const error of analysis.errors) {
      const parts = error.path.split('.');
      let control;
      if (parts[0] === 'rows') {
        const tr = $('component-rows').children[Number(parts[1])];
        control = parts[2] === 'drawing' ? $({ label: 'row-drawing-label', scale: 'row-scale', layer: 'row-layer' }[parts[3]]) : parts[2] === 'note' ? $('row-note') : tr?.querySelector(`[data-field="${parts[2]}"]`);
      } else if (parts[0] === 'target') control = $(`target-${parts[1]}`);
      else control = $({ name: 'project-name', revision: 'project-revision', 'statistics.manualK0': 'manual-k0' }[error.path]);
      control?.setAttribute('aria-invalid', 'true');
      const link = element('button', 'text-button', error.message);
      link.addEventListener('click', () => {
        $('errors-dialog').close();
        if (parts[0] === 'rows') {
          showPage('components');
          if (project.rows[Number(parts[1])]) selectRow(project.rows[Number(parts[1])].id);
          if (parts[2] === 'drawing' || parts[2] === 'note') $('row-dialog').showModal();
        } else if (parts[0] === 'statistics') showPage('quality');
        (control || $('add-row')).focus();
      });
      $('error-list').append(link);
    }
  }
  $('metric-nominal').textContent = fmt(valid ? analysis.nominal : null);
  $('metric-worst').textContent = fmt(valid ? analysis.worst.width : null);
  $('metric-statistical').textContent = fmt(valid ? analysis.statistical.width : null);
  for (const method of ['worst', 'statistical']) {
    const result = valid && (method === 'worst' || analysis.statistical.available) ? analysis[method] : null;
    for (const bound of ['lower', 'upper']) $(`closure-${method}-${bound}`).textContent = fmt(result?.[bound]);
  }
  $('closure-statistical-model').textContent = !valid ? '输入待修正' : !analysis.statistical.available ? '模型待确认' : analysis.hasNonNormal ? '等效正态估算' : '正态模型';
  setBadge('worst-status', valid ? analysis.worst : null, valid);
  setBadge('statistical-status', valid ? analysis.statistical : null, valid && analysis.statistical.available);
  $('statistical-k0').textContent = valid && analysis.statistical.k0 ? `k₀ = ${formatNumber(analysis.statistical.k0, 2)}` : '请明确统计假设';
  const quality = valid ? analysis.quality : null;
  const percent = quality?.available ? quality.yield * 100 : null;
  $('metric-yield').textContent = percent !== null && percent < 100 && percent.toFixed(4) === '100.0000' ? '>99.9999' : formatNumber(percent, 4);
  $('yield-model').textContent = analysis.hasNonNormal ? '等效正态估算' : '正态模型';
  $('wc-min').textContent = fmt(valid ? analysis.worst.lower : null); $('wc-max').textContent = fmt(valid ? analysis.worst.upper : null);
  $('stat-mean').textContent = fmt(valid ? analysis.mean : null); $('stat-sigma').textContent = formatNumber(valid ? analysis.sigma : null, Math.max(project.display.precision, 5));
  $('probability-caption').textContent = analysis.hasNonNormal ? '等效正态示意，不代表真实分布密度' : '独立正态模型，阴影表示规格外区域';
  function ppm(value) { return value === null || value === undefined ? '—' : value > 0 && value < .001 ? value.toExponential(2) : formatNumber(value, 3); }
  $('lower-ppm').textContent = ppm(quality?.available ? quality.lowerTail * 1e6 : null);
  $('upper-ppm').textContent = ppm(quality?.available ? quality.upperTail * 1e6 : null);
  $('quality-cp').textContent = formatNumber(quality?.cp, 3); $('quality-cpk').textContent = formatNumber(quality?.cpk, 3);
  $('analysis-warnings').replaceChildren();
  if (valid) for (const warning of analysis.warnings) $('analysis-warnings').append(element('p', '', warning));
  $('show-warnings').textContent = valid && analysis.warnings.length ? `模型说明 · ${analysis.warnings.length} 项警告` : '模型说明';
  renderSelection(); renderVisuals(); renderPrintReport();
}
function renderPrintReport() {
  $('print-project').textContent = `${project.name} · 版本 ${project.revision}`;
  $('print-rows').replaceChildren(); $('print-summary').replaceChildren();
  if (!analysis.valid) return;
  const consent = analysis.hasNonNormal ? project.statistics.acceptNormalApproximation ? '已接受等效正态近似' : '未接受等效正态近似；不提供合格率和能力估算' : '独立正态模型；输入公差按 ±3σ 解释';
  $('print-model').textContent = `GB/T 5847—2004 · ${consent} · ${project.statistics.mode === 'manual' ? '手动 k₀，无对应实际置信概率' : `表列置信水平 ${project.statistics.confidence}%`} · k₀ = ${analysis.statistical.k0 ?? '未选定'}`;
  if (analysis.warnings.length) $('print-model').textContent += ` · 模型警告：${analysis.warnings.join('；')}`;
  for (const row of project.rows) {
    const tr = element('tr'), distribution = DISTRIBUTIONS[row.distribution];
    for (const value of [row.label, row.description, row.nominal, row.direction, row.upperDeviation, row.lowerDeviation, distribution.label, distribution.e, distribution.k, row.symmetric ? '是' : '否', row.locked ? '是' : '否', row.note]) tr.append(element('td', '', String(value)));
    $('print-rows').append(tr);
  }
  $('print-target').textContent = analysis.targetPresent ? `目标绝对规格 [${project.target.lower}, ${project.target.upper}] mm` : '未设置目标规格';
  const head = element('tr');
  for (const title of ['方法', '最小尺寸', '最大尺寸', '下偏差', '上偏差', '下侧裕量', '上侧裕量']) head.append(element('th', '', title));
  $('print-summary').append(head);
  for (const [name, result] of [['极值法', analysis.worst], ['统计法', analysis.statistical]]) {
    const tr = element('tr'); tr.append(element('td', '', name));
    for (const key of ['lower', 'upper', 'lowerDeviation', 'upperDeviation', 'lowerMargin', 'upperMargin']) tr.append(element('td', '', fmt(result[key])));
    $('print-summary').append(tr);
  }
}
function allocationMessage(title, detail, state = '') {
  const container = $('allocation-message'); container.className = `allocation-empty ${state}`;
  const text = element('strong', '', `${title}${detail.includes('零公差') ? ' · 零公差制造警告' : ''}`);
  const more = element('button', 'text-button', '详情');
  more.addEventListener('click', () => $('allocation-dialog').showModal());
  $('allocation-detail-title').textContent = title; $('allocation-detail').textContent = detail;
  container.replaceChildren(icon('target'), text, more);
}
function replaceProject(next, message) {
  project = next; selectedId = project.rows[0]?.id; undoProject = null; dirty = false;
  chainViewScale = project.display.chainScale;
  for (const state of Object.values(pages)) state.index = 0;
  clearPreview(); renderRows(); render(); worstChart.reset(); probabilityChart.reset(); showPage('components');
  $('edit-state').textContent = '参数已载入'; $('recovery-banner').hidden = !recoveryPending;
  safeStorageSave(); toast(message);
}
function canReplace() { return !dirty || window.confirm('当前参数尚未保存为项目文件。继续会替换当前项目，是否继续？'); }

for (const id of ['project-name', 'project-revision']) $(id).addEventListener('input', () => { project[id === 'project-name' ? 'name' : 'revision'] = $(id).value; commit(); });
for (const field of ['lower', 'upper']) $(`target-${field}`).addEventListener('input', () => { project.target[field] = num($(`target-${field}`)); commit(); });
$('precision').replaceChildren(...Array.from({ length: 9 }, (_, i) => option(i, `${i} 位小数`)));
$('precision').addEventListener('change', () => { project.display.precision = Number($('precision').value); commit(); });
$('label-mode').addEventListener('change', () => { project.display.labelMode = $('label-mode').value; commit(); });
$('chain-scale').addEventListener('change', () => { chainViewScale = Number($('chain-scale').value); drawChain(); });
$('reset-chain').addEventListener('click', () => { chainViewScale = 1; $('chain-scale').value = '1'; drawChain(); });
$('quality-row-select').addEventListener('change', () => selectRow($('quality-row-select').value));
$('row-settings').addEventListener('click', () => $('row-dialog').showModal());
$('show-errors').addEventListener('click', () => $('errors-dialog').showModal());
$('show-warnings').addEventListener('click', () => $('warnings-dialog').showModal());
$('confidence').append(...CONFIDENCE_LEVELS.map(level => option(level.probability, `${level.probability}% · k₀ ${level.k0}`)));
$('statistics-mode').addEventListener('change', () => { project.statistics.mode = $('statistics-mode').value; commit(); });
$('confidence').addEventListener('change', () => { project.statistics.confidence = Number($('confidence').value); commit(); });
$('manual-k0').addEventListener('input', () => { project.statistics.manualK0 = num($('manual-k0')); commit(); });
$('accept-approximation').addEventListener('change', () => { project.statistics.acceptNormalApproximation = $('accept-approximation').checked; commit(); });
$('add-row').addEventListener('click', () => { const row = createRow(project.rows.length); project.rows.push(row); selectedId = row.id; commit({ rows: true, model: true }); });
function setToleranceWidth(width) {
  const row = project.rows.find(item => item.id === selectedId);
  if (!row || !analysis.valid || !Number.isFinite(width) || width < 0 || width > TOLERANCE_WIDTH_MAX) return false;
  if (width === row.upperDeviation - row.lowerDeviation) return true;
  const midpoint = (row.upperDeviation + row.lowerDeviation) / 2;
  const nextRow = { ...row, upperDeviation: midpoint + width / 2, lowerDeviation: midpoint - width / 2 };
  if (width > 0 && nextRow.upperDeviation === nextRow.lowerDeviation) return false;
  if (!validateProject({ ...project, rows: project.rows.map(item => item === row ? nextRow : item) }).ok) return false;
  row.upperDeviation = nextRow.upperDeviation; row.lowerDeviation = nextRow.lowerDeviation;
  commit({ rows: true, model: true });
  return true;
}
$('tolerance-slider').addEventListener('input', () => setToleranceWidth(num($('tolerance-slider'))));
$('tolerance-value').addEventListener('input', event => {
  const input = event.target;
  input.setCustomValidity('');
  if (setToleranceWidth(num(input))) input.removeAttribute('aria-invalid');
  else {
    input.setCustomValidity(`请输入 0 至 ${TOLERANCE_WIDTH_MAX} mm 内可计算的公差全宽`);
    input.setAttribute('aria-invalid', 'true');
  }
});
$('tolerance-value').addEventListener('blur', event => {
  if (!event.target.validity.valid) toast(`未应用无效公差，已恢复原值。请输入 0 至 ${TOLERANCE_WIDTH_MAX} mm 内可计算的数值。`);
  renderSelection();
});
for (const [id, key] of [['row-note', 'note'], ['row-drawing-label', 'label'], ['row-scale', 'scale'], ['row-layer', 'layer']]) {
  $(id).addEventListener('input', () => {
    const row = project.rows.find(item => item.id === selectedId); if (!row) return;
    const value = $(id).type === 'number' ? num($(id)) : $(id).value;
    if (key === 'note') row.note = value; else row.drawing[key] = value;
    commit();
  });
}
$('reset-worst').addEventListener('click', () => worstChart.reset());
$('reset-probability').addEventListener('click', () => probabilityChart.reset());
$('contribution-mode').addEventListener('change', renderContributions);
$('sample-select').addEventListener('change', () => { const index = $('sample-select').value; if (index !== '' && canReplace()) replaceProject(createSample(Number(index)), '已载入经过校正的参考样例'); $('sample-select').value = ''; });
$('new-button').addEventListener('click', () => { if (canReplace()) replaceProject(createProject(), '已创建新尺寸链'); });
for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => $(control.dataset.close).close());
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('paste-button').addEventListener('click', () => { $('paste-errors').textContent = ''; $('paste-dialog').showModal(); });
$('import-paste').addEventListener('click', () => {
  const result = parseTsv($('paste-text').value);
  if (!result.ok) { $('paste-errors').textContent = result.errors.map(error => error.message).join('\n'); return; }
  if (!canReplace()) return;
  project.rows = result.rows; selectedId = project.rows[0].id; $('paste-dialog').close(); commit({ rows: true, model: true }); toast(`已导入 ${project.rows.length} 个组成环`);
});
function download(text, extension, type) {
  const filename = `AEME-${project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || '项目'}.${extension}`;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = element('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
$('save-button').addEventListener('click', () => {
  try {
    const text = serializeProject(project); $('export-text').value = text;
    try { download(text, 'json', 'application/json;charset=utf-8'); } catch { toast('自动下载不可用，可复制项目内容保存'); }
    $('export-dialog').showModal(); $('edit-state').textContent = '已请求导出 · 尚待确认保存';
  } catch (error) { toast(error.message); }
});
$('confirm-saved').addEventListener('click', () => { dirty = false; $('edit-state').textContent = '已确认保存项目文件'; $('export-dialog').close(); });
$('select-export').addEventListener('click', () => { $('export-text').focus(); $('export-text').select(); });
$('open-button').addEventListener('click', () => $('project-file').click());
$('project-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) { toast('项目文件不能超过 1 MB'); return; }
    const result = parseProjectJson(await file.text());
    if (!result.ok) { toast(result.errors.map(error => error.message).join('；')); return; }
    if (canReplace()) replaceProject(result.value, '已打开项目文件');
  } catch { toast('无法读取项目文件，请重新选择本地 JSON 文件。'); }
  finally { event.target.value = ''; }
});
$('export-button').addEventListener('click', () => { try { download(exportCsv(project, analysis), 'csv', 'text/csv;charset=utf-8'); toast('已请求下载 CSV 计算报告'); } catch (error) { toast(error.message); } });
$('print-button').addEventListener('click', () => { document.title = `${project.name} · AEME尺寸链分析`; window.print(); });
$('preview-allocation').addEventListener('click', () => {
  clearPreview();
  const result = allocate(project, { method: $('allocation-method').value, strategy: $('allocation-strategy').value });
  if (result.status !== 'feasible') { allocationMessage(result.status === 'unchanged' ? '当前方案无需分配' : '无法生成可行分配方案', result.reasons.join('；'), result.status === 'unchanged' ? '' : 'error'); return; }
  preview = result; $('allocation-preview').hidden = false; $('apply-allocation').disabled = false;
  const body = $('allocation-rows'); body.replaceChildren();
  for (const row of result.candidateRows) {
    const old = project.rows.find(item => item.id === row.id), tr = element('tr');
    for (const [i, text] of [row.label + (row.description ? ` · ${row.description}` : '') + (row.locked ? ' · 锁定' : ''), fmt(old.upperDeviation - old.lowerDeviation), fmt(row.upperDeviation - row.lowerDeviation), fmt(row.lowerDeviation), fmt(row.upperDeviation)].entries()) tr.append(element('td', i === 2 && !row.locked ? 'changed' : '', text));
    body.append(tr);
  }
  const interval = $('allocation-method').value === 'worst' ? result.analysis.worst : result.analysis.statistical;
  allocationMessage('方案已复算，等待应用', result.reasons.join('；') || '锁定环与各环原公差中点保持不变。', 'success');
  $('allocation-check').textContent = `候选区间 [${fmt(interval.lower)}, ${fmt(interval.upper)}] mm · 均值 ${fmt(result.analysis.mean)} mm · 显示舍入不参与计算`;
  pages.candidates.index = 0; paginate('candidates'); measurePages();
});
for (const id of ['allocation-method', 'allocation-strategy']) $(id).addEventListener('change', clearPreview);
$('apply-allocation').addEventListener('click', () => {
  if (!preview) return;
  const fresh = allocate(project, { method: $('allocation-method').value, strategy: $('allocation-strategy').value });
  if (fresh.status !== 'feasible') { clearPreview(); toast('输入已变化，请重新生成方案。'); return; }
  undoProject = structuredClone(project); project.rows = fresh.candidateRows;
  commit({ rows: true, model: true, keepUndo: true }); toast('已应用分配结果，可在继续编辑前撤销；非正态质量估算需重新确认');
});
$('undo-allocation').addEventListener('click', () => { if (!undoProject) return; project = undoProject; undoProject = null; commit({ rows: true }); toast('已撤销公差分配'); });
$('restore-button').addEventListener('click', () => {
  if (recoveryPending && canReplace()) { recoveryPending = false; replaceProject(previous.value, '已恢复浏览器暂存项目'); }
});
$('dismiss-recovery').addEventListener('click', () => { recoveryPending = false; $('recovery-banner').hidden = true; if (analysis.valid) safeStorageSave(); });
for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => showPage(tab.getAttribute('aria-controls')));
  tab.addEventListener('keydown', event => {
    const names = ['components', 'quality', 'allocation'], index = names.indexOf(activePage);
    const next = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[event.key];
    if (next !== undefined) { event.preventDefault(); showPage(names[next], true); }
  });
}
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); showPage('components', true); });
window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));
for (const name of Object.keys(pages)) for (const [suffix, step] of [['prev', -1], ['next', 1]]) {
  $(`${name}-${suffix}`).addEventListener('click', () => { pages[name].index += step; paginate(name); if (name === 'components') drawChain(); });
}
window.addEventListener('beforeprint', () => {
  if (printing) return;
  printing = true; printFocus = document.activeElement;
  $('quality-chart-host').append(document.querySelector('.charts-grid'));
  drawChain(); worstChart.beforePrint(); probabilityChart.beforePrint();
});
window.addEventListener('afterprint', () => {
  if (!printing) return;
  printing = false;
  $(activePage === 'allocation' ? 'allocation-chart-host' : 'quality-chart-host').append(document.querySelector('.charts-grid'));
  worstChart.afterPrint(); probabilityChart.afterPrint(); drawChain();
  if (printFocus?.isConnected) printFocus.focus({ preventScroll: true });
  printFocus = null;
});
const referenceTable = element('table', 'help-table');
const referenceHead = element('tr'); for (const text of ['分布', '相对不对称系数 e', '相对分布系数 k']) referenceHead.append(element('th', '', text)); referenceTable.append(referenceHead);
for (const preset of Object.values(DISTRIBUTIONS)) { const tr = element('tr'); for (const text of [preset.label, preset.e, preset.k]) tr.append(element('td', '', String(text))); referenceTable.append(tr); }
$('distribution-reference').append(referenceTable);
$('recovery-banner').hidden = !previous.ok || !previous.value;
$('storage-status').textContent = previous.ok ? '计算在本地完成 · 请保存项目文件' : '浏览器暂存不可用 · 请保存项目文件';
renderRows(); render(); showPage('components');
const layoutObserver = new ResizeObserver(() => {
  if (printing) return;
  measurePages(); worstChart.resize(); probabilityChart.resize();
});
for (const selector of ['.page-area', '.table-scroll', '#contribution-bars', '.allocation-table-scroll', '#quality-chart-host', '#allocation-chart-host']) layoutObserver.observe(document.querySelector(selector));
