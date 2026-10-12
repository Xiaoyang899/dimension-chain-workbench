import { createProject, createRow, validateProject, DISTRIBUTIONS } from './model.js';

export const MAX_FILE_BYTES = 1024 * 1024;
const STORAGE_KEY = 'chainlab-project-v1';
const failure = message => ({ ok: false, value: null, rows: [], errors: [{ path: '', message }] });

export function serializeProject(project) {
  const result = validateProject(project);
  if (!result.ok) throw new Error(result.errors.map(error => error.message).join('；'));
  return JSON.stringify(result.value, null, 2);
}

export function parseProjectJson(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) return failure('项目文件超过 1 MB 限制。');
  let raw;
  try { raw = JSON.parse(text); } catch { return failure('无法解析 JSON，请选择由AEME保存的项目文件。'); }
  return validateProject(raw);
}

export function parseTsv(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) return failure('粘贴内容为空或超过 1 MB。');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length && /^(基本尺寸|尺寸|nominal|nominal dimension)$/i.test(lines[0].split('\t')[1]?.trim())) lines.shift();
  if (lines.length < 1 || lines.length > 25) return failure('请粘贴 1–25 个组成环，每行 5 列。');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('\t').map(cell => cell.trim());
    if (cells.length !== 5) return failure(`第 ${i + 1} 行需要 5 列：环标识、基本尺寸、方向、上偏差、下偏差。`);
    const [label, nominal, direction, upper, lower] = cells;
    if (!label || [nominal, upper, lower].some(value => value === '' || !Number.isFinite(Number(value)))) return failure(`第 ${i + 1} 行含空白或非数值。固定尺寸请明确填写 0，不接受 Excel 公式。`);
    const sign = ['+', '+1', '1', '增环'].includes(direction) ? 1 : ['-', '−', '-1', '减环'].includes(direction) ? -1 : null;
    if (sign === null) return failure(`第 ${i + 1} 行方向应为 + 或 −。`);
    rows.push({ ...createRow(i), label, nominal: Number(nominal), direction: sign, upperDeviation: Number(upper), lowerDeviation: Number(lower), symmetric: Number(upper) === -Number(lower) });
  }
  const result = validateProject({ ...createProject(), rows });
  return { ...result, rows: result.ok ? result.value.rows : [] };
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCsv(project, analysis) {
  if (!analysis.valid) throw new Error('请先修正无效输入，再导出计算结果。');
  const rows = [
    ['AEME尺寸链计算结果', 'GB/T 5847—2004'],
    ['项目', project.name, '版本', project.revision],
    ['说明', '直线尺寸链；各环相互独立；质量指标为设计参数估算，非实测能力'],
    ['统计模型', analysis.hasNonNormal ? '非正态输入，曲线为等效正态示意' : '独立正态模型'],
    ['接受正态近似', project.statistics.acceptNormalApproximation ? '是' : '否'],
    ['环标识', '基本尺寸/mm', '方向', '上偏差', '下偏差', '公差全宽', '分布', 'e', 'k', '锁定', '备注'],
    ...project.rows.map(row => [row.label, row.nominal, row.direction, row.upperDeviation, row.lowerDeviation, row.upperDeviation - row.lowerDeviation, DISTRIBUTIONS[row.distribution].label, DISTRIBUTIONS[row.distribution].e, DISTRIBUTIONS[row.distribution].k, row.locked ? '是' : '否', row.note]),
    [],
    ['目标下限', project.target.lower, '目标上限', project.target.upper],
    ['封闭环基本尺寸', analysis.nominal],
    ['极值最小', analysis.worst.lower, '极值最大', analysis.worst.upper],
    ['极值公差全宽', analysis.worst.width, '极值下裕量', analysis.worst.lowerMargin, '极值上裕量', analysis.worst.upperMargin],
    ['统计均值', analysis.mean, '标准差', analysis.sigma, 'k0', analysis.statistical.k0],
    ['统计最小', analysis.statistical.lower, '统计最大', analysis.statistical.upper],
    ['统计公差全宽', analysis.statistical.width, '统计下裕量', analysis.statistical.lowerMargin, '统计上裕量', analysis.statistical.upperMargin],
    ['预计合格率(0..1)', analysis.quality.yield, '总超差PPM', analysis.quality.ppm],
    ['下侧超差率(0..1)', analysis.quality.lowerTail, '上侧超差率(0..1)', analysis.quality.upperTail],
    ['估算Cp', analysis.quality.cp, '估算Cpk', analysis.quality.cpk],
    ['环标识', '极值宽度贡献(0..1)', '统计方差贡献(0..1)'],
    ...analysis.contributions.map(item => [project.rows.find(row => row.id === item.id)?.label, item.worstShare, item.varianceShare]),
    ...analysis.warnings.map(warning => ['模型说明', warning])
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function saveAutosave(storage, project) {
  try { storage.setItem(STORAGE_KEY, serializeProject(project)); return { ok: true, message: '已自动暂存 · 请另存项目文件' }; }
  catch { return { ok: false, message: '浏览器暂存不可用 · 请保存项目文件' }; }
}

export function readAutosave(storage) {
  try { const text = storage.getItem(STORAGE_KEY); return text === null ? { ok: true, value: null, errors: [] } : parseProjectJson(text); }
  catch { return failure('浏览器暂存不可用，请使用项目 JSON 文件。'); }
}
