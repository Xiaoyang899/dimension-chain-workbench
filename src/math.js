import { validateProject, DISTRIBUTIONS, CONFIDENCE_LEVELS } from './model.js';

function sum(values) {
  let total = 0, correction = 0;
  for (const x of values) {
    const next = total + x;
    correction += Math.abs(total) >= Math.abs(x) ? (total - next) + x : (x - next) + total;
    total = next;
  }
  return total + correction;
}

function polynomial(x, coefficients, initial = 0) {
  return coefficients.reduce((value, coefficient) => value * x + coefficient, initial);
}

// Rational erf/erfc approximants (Cephes coefficients). Evaluate the small tail
// directly, never as 1-CDF, to retain relative accuracy beyond eight sigma.
const ERF_T = [9.60497373987051638749, 90.0260197203842689217, 2232.00534594684319226, 7003.32514112805075473, 55592.3013010394962768];
const ERF_U = [33.5617141647503099647, 521.357949780152679795, 4594.32382970980127987, 22629.0000613890934246, 49267.3942608635921086];
const ERFC_P = [2.46196981473530512524e-10, .564189564831068821977, 7.46321056442269912687, 48.6371970985681366614, 196.520832956077098242, 526.445194995477358631, 934.52852717195760754, 1027.55188689515710272, 557.535335369399327526];
const ERFC_Q = [13.2281951154744992508, 86.7072140885989742329, 354.937778887819891062, 975.708501743205489753, 1823.90916687909736289, 2246.33760818710981792, 1656.66309194161350182, 557.535340817727675546];
const ERFC_R = [.564189583547755073984, 1.27536670759978104416, 5.01905042251180477414, 6.16021097993053585195, 7.4097426995044893916, 2.9788666537210024067];
const ERFC_S = [2.2605286322011727659, 9.39603524938001434673, 12.0489539808096656605, 17.0814450747565897222, 9.60896809063285878198, 3.3690764510008151605];

function positiveTail(z) {
  if (z === Infinity || z > 38.5) return 0;
  const x = z / Math.SQRT2;
  if (x < 1) {
    const erf = x * polynomial(x * x, ERF_T) / polynomial(x * x, ERF_U, 1);
    return .5 - .5 * erf;
  }
  const ratio = x < 8
    ? polynomial(x, ERFC_P) / polynomial(x, ERFC_Q, 1)
    : polynomial(x, ERFC_R) / polynomial(x, ERFC_S, 1);
  return Math.exp(-z * z / 2) * (.5 * ratio);
}

export function normalCDF(z) {
  if (typeof z !== 'number' || Number.isNaN(z)) return NaN;
  return z < 0 ? positiveTail(-z) : 1 - positiveTail(z);
}

export function normalSurvival(z) {
  if (typeof z !== 'number' || Number.isNaN(z)) return NaN;
  return z < 0 ? 1 - positiveTail(-z) : positiveTail(z);
}

export function normalDensity(x, mean = 0, sigma = 1) {
  if (typeof x !== 'number' || !Number.isFinite(mean) || !Number.isFinite(sigma) || sigma <= 0) return NaN;
  const z = (x - mean) / sigma;
  return Math.exp(-z * z / 2) / (Math.sqrt(2 * Math.PI) * sigma);
}

function intervalProbability(lowerZ, upperZ, width) {
  if (width === 0) return 0;
  // Independent standardized width survives even when rounded endpoints coincide.
  if (Number.isFinite(width) && width * Math.max(1, Math.abs(lowerZ), Math.abs(upperZ)) < 1e-4) {
    return width * (normalDensity(lowerZ) + 4 * normalDensity(lowerZ + width / 2) + normalDensity(upperZ)) / 6;
  }
  if (lowerZ >= 0) return Math.max(0, normalSurvival(lowerZ) - normalSurvival(upperZ));
  if (upperZ <= 0) return Math.max(0, normalCDF(upperZ) - normalCDF(lowerZ));
  return Math.max(0, 1 - normalCDF(lowerZ) - normalSurvival(upperZ));
}

function emptyInterval() {
  return { lower: null, upper: null, width: null, lowerDeviation: null, upperDeviation: null, lowerMargin: null, upperMargin: null, pass: null };
}
function emptyQuality(deterministic = false) {
  return { available: false, yield: null, lowerTail: null, upperTail: null, ppm: null, cp: null, cpk: null, deterministic };
}
function emptyResult(errors) {
  return {
    valid: false, errors, nominal: null, center: null, mean: null, sigma: null,
    worst: emptyInterval(), statistical: { ...emptyInterval(), available: false, k0: null },
    quality: emptyQuality(), contributions: [], warnings: [], effectiveCount: 0,
    hasNonNormal: false, dominantShare: 0, targetPresent: false,
  };
}

export function analyze(project) {
  const validation = validateProject(project);
  if (!validation.ok) return emptyResult(validation.errors);
  const p = validation.value, targetPresent = p.target.lower !== null;
  const nominalTerms = [], midpointTerms = [], meanShiftTerms = [], lowerTerms = [], upperTerms = [];
  const widths = [], weightedWidths = [];
  let effectiveCount = 0, hasNonNormal = false;
  for (const row of p.rows) {
    const width = row.upperDeviation - row.lowerDeviation;
    const midpoint = row.lowerDeviation / 2 + row.upperDeviation / 2;
    const { e, k } = DISTRIBUTIONS[row.distribution];
    nominalTerms.push(row.direction * row.nominal);
    midpointTerms.push(row.direction * midpoint);
    meanShiftTerms.push(row.direction * e * width / 2);
    lowerTerms.push(row.direction * (row.direction > 0 ? row.lowerDeviation : row.upperDeviation));
    upperTerms.push(row.direction * (row.direction > 0 ? row.upperDeviation : row.lowerDeviation));
    widths.push(width); weightedWidths.push(k * width);
    if (width > 0) { effectiveCount++; if (row.distribution !== 'normal') hasNonNormal = true; }
  }
  const nominal = sum(nominalTerms), center = sum([...nominalTerms, ...midpointTerms]);
  const meanTerms = [...nominalTerms, ...midpointTerms, ...meanShiftTerms];
  const mean = sum(meanTerms), rss = Math.hypot(...weightedWidths), sigma = rss / 6;
  const totalWidth = sum(widths), deterministic = sigma === 0;
  const contributions = p.rows.map((r, i) => ({
    id: r.id, width: widths[i], variance: (weightedWidths[i] / 6) ** 2,
    worstShare: totalWidth === 0 ? 0 : widths[i] / totalWidth,
    varianceShare: rss === 0 ? 0 : (weightedWidths[i] / rss) ** 2,
  }));
  const dominantShare = Math.max(...contributions.map(c => c.varianceShare));
  const policy = p.statistics;
  const selectedK0 = policy.mode === 'manual' ? policy.manualK0 : CONFIDENCE_LEVELS.find(c => c.probability === policy.confidence).k0;
  const statisticalAvailable = !hasNonNormal || effectiveCount >= 5 || policy.mode === 'manual' || policy.acceptNormalApproximation;
  const targetWidth = targetPresent ? p.target.upper - p.target.lower : 0;
  // Only arithmetic at the tolerance/target-band scale is allowed to soften a boundary.
  // Large cancelling nominals must never turn a meaningful violation into a pass.
  const epsilon = 64 * Number.EPSILON * Math.max(totalWidth, targetWidth, rss, Number.MIN_VALUE);
  const makeInterval = (lowerParts, upperParts, lowerDeviation, upperDeviation, width) => {
    const lowerMargin = targetPresent ? sum([...lowerParts, -p.target.lower]) : null;
    const upperMargin = targetPresent ? sum([p.target.upper, ...upperParts.map(v => -v)]) : null;
    return {
      lower: sum(lowerParts), upper: sum(upperParts), width, lowerDeviation, upperDeviation,
      lowerMargin, upperMargin,
      pass: targetPresent ? lowerMargin >= -epsilon && upperMargin >= -epsilon : null,
    };
  };
  const worst = makeInterval([...nominalTerms, ...lowerTerms], [...nominalTerms, ...upperTerms], sum(lowerTerms), sum(upperTerms), totalWidth);
  let statistical = { ...emptyInterval(), available: false, k0: null };
  if (statisticalAvailable) {
    const half = rss / (2 * selectedK0);
    const deviationTerms = [...midpointTerms, ...meanShiftTerms];
    statistical = {
      ...makeInterval([...meanTerms, -half], [...meanTerms, half], sum([...deviationTerms, -half]), sum([...deviationTerms, half]), 2 * half),
      available: true, k0: selectedK0,
    };
  }
  let quality = emptyQuality(deterministic);
  if (targetPresent && (!hasNonNormal || policy.acceptNormalApproximation || deterministic)) {
    const lowerDistance = sum([...meanTerms, -p.target.lower]);
    const upperDistance = sum([p.target.upper, ...meanTerms.map(v => -v)]);
    const lowerTail = deterministic ? (lowerDistance < 0 ? 1 : 0) : normalCDF(-lowerDistance / sigma);
    const upperTail = deterministic ? (upperDistance < 0 ? 1 : 0) : normalSurvival(upperDistance / sigma);
    const yieldFraction = deterministic ? (lowerDistance >= 0 && upperDistance >= 0 ? 1 : 0) : intervalProbability(-lowerDistance / sigma, upperDistance / sigma, targetWidth / sigma);
    quality = {
      available: true, yield: Math.min(1, yieldFraction), lowerTail, upperTail,
      ppm: Math.min(1, lowerTail + upperTail) * 1e6,
      cp: deterministic ? null : targetWidth / (6 * sigma),
      cpk: deterministic ? null : Math.min(lowerDistance, upperDistance) / (3 * sigma),
      deterministic,
    };
  }
  const warnings = ['极值范围以所有组成环实际尺寸均在输入公差带内为前提；极值区间不是概率分布。', '统计模型假设组成环相互独立；正态输入公差按 ±3σ 解释，正态尾部不受极值边界截断。'];
  if (hasNonNormal) {
    warnings.push('含非正态随机环：e、k 仅用于均值和方差，不能还原实际分布；图形与质量指标仅为等效正态估算。');
    if (effectiveCount < 5) warnings.push('非正态且有效随机环少于 5 个：请选择手动 k₀（1.1～1.3），或明确接受正态近似后使用置信预设。');
    else warnings.push('非正态近似要求组成环公差范围不能相差过大；随机环达到 5 个并不自动保证近似精度。');
    if (dominantShare > .5) warnings.push('单环方差贡献超过 50%；这是应用诊断阈值，不是国标阈值，正态近似须谨慎。');
    if (!policy.acceptNormalApproximation) warnings.push('尚未接受等效正态假设，不提供非正态数值合格率及 Cp/Cpk。');
  }
  if (policy.mode === 'manual') warnings.push('手动 k₀ 没有自动对应的实际置信概率；各组成环偏态均值移动仍保留。');
  else warnings.push('置信预设采用国标表内舍入系数，与精确正态积分概率可能存在差异。');
  if (quality.available && !deterministic) warnings.push('合格率、PPM 和 Cp/Cpk 为设计参数估算，非实测过程能力。');
  if (deterministic) warnings.push('所有随机公差为零，按确定值及闭区间判定；Cp/Cpk 不适用。');
  return { valid: true, errors: [], nominal, center, mean, sigma, worst, statistical, quality, contributions, warnings, effectiveCount, hasNonNormal, dominantShare, targetPresent };
}
