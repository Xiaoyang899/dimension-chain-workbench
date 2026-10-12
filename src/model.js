// GB/T 5847—2004, appendices A and C. These are the tabulated, rounded coefficients.
export const DISTRIBUTIONS = Object.freeze(Object.fromEntries([
  ['normal', '正态分布', 0, 1],
  ['triangular', '三角分布', 0, 1.22],
  ['uniform', '均匀分布', 0, 1.73],
  ['rayleigh', '瑞利分布', -.28, 1.14],
  ['skewExternal', '外尺寸偏态', .26, 1.17],
  ['skewInternal', '内尺寸偏态', -.26, 1.17],
].map(([key, label, e, k]) => [key, Object.freeze({ label, e, k })])));

export const CONFIDENCE_LEVELS = Object.freeze([
  [99.73, 1], [99.5, 1.06], [99, 1.16], [98, 1.29], [95, 1.52], [90, 1.82],
].map(([probability, k0]) => Object.freeze({ probability, k0 })));

let sequence = 0;
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createRow(index = 0) {
  return {
    id: `row-${sessionId}-${(++sequence).toString(36)}`,
    label: `A${index + 1}`,
    description: '',
    nominal: 0,
    direction: 1,
    upperDeviation: .1,
    lowerDeviation: -.1,
    distribution: 'normal',
    locked: false,
    symmetric: true,
    drawing: { scale: 1, layer: 0, label: '' },
    note: '',
  };
}

export function createProject() {
  return {
    schemaVersion: 1,
    name: '新建尺寸链',
    revision: 'A',
    rows: [createRow(0)],
    target: { lower: null, upper: null },
    statistics: { mode: 'preset', confidence: 99.73, manualK0: 1.2, acceptNormalApproximation: false },
    display: { precision: 4, chainScale: 1, labelMode: 'both' },
  };
}

const MAX_NUMBER = 1e9;
// Keeps the squared variance representable and capabilities finite across the input range.
const MIN_POSITIVE_WIDTH = 1e-150;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_NUMBER;

export function validateProject(raw) {
  const errors = [];
  const error = (path, message) => errors.push({ path, message });
  const record = (value, path) => {
    if (!isRecord(value)) { error(path, '必须是有效对象'); return {}; }
    return value;
  };
  const text = (value, path, max, required = false) => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      error(path, `必须是${required ? '非空' : ''}文本，最多 ${max} 个字符`);
    }
    return value;
  };
  const number = (value, path, min = -MAX_NUMBER, max = MAX_NUMBER, integer = false) => {
    if (!finiteNumber(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      error(path, `必须是 ${min} 至 ${max} 之间的有限${integer ? '整数' : '数字'}，不得留空`);
    }
    return value;
  };
  const boolean = (value, path) => {
    if (typeof value !== 'boolean') error(path, '必须是布尔值');
    return value;
  };
  const choice = (value, path, choices) => {
    if (!choices.includes(value)) error(path, '不是支持的选项');
    return value;
  };

  try {
    const p = record(raw, '');
    if (p.schemaVersion !== 1) error('schemaVersion', '不支持的项目版本，当前仅支持版本 1');
    const ids = new Set();
    if (!Array.isArray(p.rows) || p.rows.length < 1 || p.rows.length > 25) error('rows', '组成环数量必须为 1 至 25');
    const rows = [];
    if (Array.isArray(p.rows)) {
      for (let i = 0; i < Math.min(p.rows.length, 25); i++) {
        const path = `rows.${i}`, r = record(p.rows[i], path), d = record(r.drawing, `${path}.drawing`);
        const id = text(r.id, `${path}.id`, 120, true);
        if (typeof id === 'string' && ids.has(id)) error(`${path}.id`, '组成环标识不能重复');
        ids.add(id);
        number(r.upperDeviation, `${path}.upperDeviation`);
        number(r.lowerDeviation, `${path}.lowerDeviation`);
        if (finiteNumber(r.upperDeviation) && finiteNumber(r.lowerDeviation)) {
          const width = r.upperDeviation - r.lowerDeviation;
          if (width < 0) error(`${path}.upperDeviation`, '上偏差必须大于或等于下偏差');
          if (width > 0 && width < MIN_POSITIVE_WIDTH) error(`${path}.upperDeviation`, '非零公差过小，无法可靠计算方差');
          const symmetryEpsilon = 16 * Number.EPSILON * Math.max(Math.abs(r.upperDeviation), Math.abs(r.lowerDeviation));
          if (r.symmetric === true && Math.abs(r.upperDeviation + r.lowerDeviation) > symmetryEpsilon) {
            error(`${path}.lowerDeviation`, '对称公差必须满足下偏差等于上偏差的相反数');
          }
        }
        number(d.scale, `${path}.drawing.scale`, Number.MIN_VALUE, 20);
        rows.push({
          id,
          label: text(r.label, `${path}.label`, 120),
          description: r.description === undefined ? '' : text(r.description, `${path}.description`, 120),
          nominal: number(r.nominal, `${path}.nominal`),
          direction: choice(r.direction, `${path}.direction`, [-1, 1]),
          upperDeviation: r.upperDeviation,
          lowerDeviation: r.lowerDeviation,
          distribution: choice(r.distribution, `${path}.distribution`, Object.keys(DISTRIBUTIONS)),
          locked: boolean(r.locked, `${path}.locked`),
          symmetric: boolean(r.symmetric, `${path}.symmetric`),
          drawing: { scale: d.scale, layer: number(d.layer, `${path}.drawing.layer`, 0, 24, true), label: text(d.label, `${path}.drawing.label`, 120) },
          note: text(r.note, `${path}.note`, 500),
        });
      }
    }
    const t = record(p.target, 'target');
    if (!(t.lower === null && t.upper === null)) {
      number(t.lower, 'target.lower');
      number(t.upper, 'target.upper');
      if (t.lower === null || t.upper === null) {
        error('target.lower', '目标上下限必须同时填写，或同时为空');
        error('target.upper', '目标上下限必须同时填写，或同时为空');
      }
      if (finiteNumber(t.lower) && finiteNumber(t.upper) && t.lower > t.upper) error('target.upper', '目标上限必须大于或等于下限');
    }
    const s = record(p.statistics, 'statistics'), d = record(p.display, 'display');
    const value = {
      schemaVersion: 1,
      name: text(p.name, 'name', 120),
      revision: text(p.revision, 'revision', 60),
      rows,
      target: { lower: t.lower, upper: t.upper },
      statistics: {
        mode: choice(s.mode, 'statistics.mode', ['preset', 'manual']),
        confidence: choice(s.confidence, 'statistics.confidence', CONFIDENCE_LEVELS.map(v => v.probability)),
        manualK0: number(s.manualK0, 'statistics.manualK0', 1.1, 1.3),
        acceptNormalApproximation: boolean(s.acceptNormalApproximation, 'statistics.acceptNormalApproximation'),
      },
      display: {
        precision: number(d.precision, 'display.precision', 0, 8, true),
        chainScale: number(d.chainScale, 'display.chainScale', .25, 4),
        labelMode: choice(d.labelMode, 'display.labelMode', ['id', 'value', 'both']),
      },
    };
    return { ok: errors.length === 0, value: errors.length ? null : value, errors };
  } catch {
    // Imported values may be malformed non-JSON objects; validation must still be total.
    error('', '项目内容无法安全读取');
    return { ok: false, value: null, errors };
  }
}
