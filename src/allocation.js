import { validateProject, DISTRIBUTIONS } from './model.js';
import { analyze } from './math.js';

function sum(values) {
  let total = 0, correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + correction;
}

function result(status, reasons, analysis = null, candidateRows = null, scale = null) {
  return { status, candidateRows, scale, analysis, reasons };
}

export function allocate(project, options) {
  const validated = validateProject(project);
  if (!validated.ok) return result('invalid', validated.errors.map(e => `${e.path}：${e.message}`));
  if (!options || !['worst', 'statistical'].includes(options.method) || !['equal', 'proportional'].includes(options.strategy)) {
    return result('invalid', ['请选择有效的分配方法和策略']);
  }
  const p = validated.value, { method, strategy } = options;
  const initial = analyze(p);
  if (!initial.targetPresent) return result('invalid', ['请先填写目标上下限']);
  if (method === 'statistical' && !initial.statistical.available) {
    return result('invalid', ['当前统计模型尚未具备资格：请选择手动 k₀ 或明确接受正态近似']);
  }
  const k0 = initial.statistical.k0;
  if (options.k0 !== undefined && (method !== 'statistical' || !Number.isFinite(options.k0) || options.k0 !== k0)) {
    return result('invalid', ['请求的 k₀ 必须与当前已确认的统计策略完全一致，不能用分配参数绕过模型确认']);
  }
  const free = p.rows.map((r, index) => ({ r, index })).filter(({ r }) => !r.locked);
  if (free.length === 0) {
    return initial[method].pass
      ? result('unchanged', ['全部组成环已锁定，当前方案满足目标，未修改任何公差'], initial)
      : result('infeasible', ['全部组成环已锁定，当前方案不满足目标'], initial);
  }
  const weights = p.rows.map(r => r.locked ? 0 : strategy === 'equal' ? 1 : r.upperDeviation - r.lowerDeviation);
  const weightSum = sum(weights);
  if (weightSum === 0) return result('invalid', ['自由环的比例权重全部为零，请改用等公差分配']);
  const widths = p.rows.map(r => r.upperDeviation - r.lowerDeviation);
  const midpoints = p.rows.map(r => r.lowerDeviation / 2 + r.upperDeviation / 2);
  // Separate nominals and deviations preserve small budgets in the compensated sum.
  const centerTerms = p.rows.flatMap((r, i) => [r.direction * r.nominal, r.direction * midpoints[i]]);
  const targetWidth = p.target.upper - p.target.lower, halfTarget = targetWidth / 2;
  const reasons = [];
  let schemaCap = Infinity;
  for (const { index } of free) {
    if (weights[index] > 0) schemaCap = Math.min(schemaCap, 2 * (1e9 - Math.abs(midpoints[index])) / weights[index]);
  }
  let scale, minimumScale = 0;
  if (method === 'worst') {
    const left = sum([...centerTerms, -p.target.lower]);
    const right = sum([p.target.upper, ...centerTerms.map(x => -x)]);
    const availableWidth = 2 * Math.min(left, right);
    const fixedWidth = sum(widths.filter((_, i) => p.rows[i].locked));
    if (left < 0 || right < 0) return result('infeasible', ['公差中心在目标规格外；保持中点的极值分配无法达到目标']);
    const budget = availableWidth - fixedWidth;
    if (budget < 0) return result('infeasible', ['锁定环已超过中心两侧允许的极值公差预算']);
    scale = budget / weightSum;
    if (schemaCap < scale) { scale = schemaCap; reasons.push('候选公差已受输入偏差绝对值上限 10⁹ 限制'); }
  } else {
    const fixedShift = [], freeShift = [], fixedWeightedWidths = [], freeWeightedWidths = [];
    p.rows.forEach((r, i) => {
      const { e, k } = DISTRIBUTIONS[r.distribution];
      if (r.locked) {
        fixedShift.push(r.direction * e * widths[i] / 2);
        fixedWeightedWidths.push(k * widths[i]);
      } else {
        freeShift.push(r.direction * e * weights[i] / 2);
        freeWeightedWidths.push(k * weights[i]);
      }
    });
    const fixedRSS = Math.hypot(...fixedWeightedWidths), freeRSS = Math.hypot(...freeWeightedWidths);
    const a = sum([...centerTerms, ...fixedShift, -p.target.lower, -halfTarget]);
    const b = sum(freeShift);
    const widthLimit = k0 * targetWidth;
    const epsilon = 32 * Number.EPSILON * Math.max(halfTarget, fixedRSS / (2 * k0), Number.MIN_VALUE);
    if (fixedRSS > widthLimit) return result('infeasible', ['锁定环方差已超过目标统计宽度预算']);
    if (freeRSS === 0) return result('invalid', ['自由环统计权重为零，请改用等公差分配']);
    // Factored difference avoids catastrophic cancellation near a fixed-budget boundary.
    const remainingRSS = Math.sqrt(widthLimit - fixedRSS) * Math.sqrt(widthLimit + fixedRSS);
    const widthCap = remainingRSS / freeRSS;
    const upper = Math.min(widthCap, schemaCap);
    if (upper < 0 || !Number.isFinite(upper)) return result('infeasible', ['输入偏差上限或统计预算不允许有限非负公差']);
    if (schemaCap < widthCap) reasons.push('候选公差已受输入偏差绝对值上限 10⁹ 限制');
    // Normalize to [0,1] to avoid overflow when squaring huge proportional scales.
    const shiftAtUpper = b * upper, rssAtUpper = freeRSS * upper;
    const g = t => sum([Math.abs(sum([a, shiftAtUpper * t])), Math.hypot(fixedRSS, rssAtUpper * t) / (2 * k0), -halfTarget]);
    const derivative = t => {
      const offset = sum([a, shiftAtUpper * t]);
      const norm = Math.hypot(fixedRSS, rssAtUpper * t);
      const radial = norm === 0 ? rssAtUpper / (2 * k0) : rssAtUpper * ((rssAtUpper * t) / norm) / (2 * k0);
      // At the kink, zero is a valid subgradient if the derivative interval spans zero.
      if (offset === 0) return Math.max(0, radial - Math.abs(shiftAtUpper));
      return Math.sign(offset) * shiftAtUpper + radial;
    };
    // Convex derivative bisection locates tangency and feasible points even when g(0)>0.
    let lo = 0, hi = 1;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      if (derivative(mid) < 0) lo = mid; else hi = mid;
    }
    const points = [0, 1, lo, hi, (lo + hi) / 2];
    const kink = -a / shiftAtUpper;
    if (Number.isFinite(kink) && kink >= 0 && kink <= 1) points.push(kink);
    let minimum = points[0];
    for (const point of points) if (g(point) < g(minimum)) minimum = point;
    const minValue = g(minimum);
    if (minValue > epsilon || (minimum === 0 && minValue > 0)) return result('infeasible', ['保持公差中点及锁定环时，偏态均值移动与统计宽度不能同时落入目标']);
    if (Math.abs(minValue) <= epsilon) reasons.push('结果位于相切或数值临界边界，请保留完整计算精度并确认制造可行性');
    let chosen;
    if (g(1) <= 0) {
      chosen = 1;
    } else if (minValue >= 0) {
      chosen = minimum;
    } else {
      lo = minimum; hi = 1;
      while (true) {
        const mid = (lo + hi) / 2;
        if (mid === lo || mid === hi) break;
        if (g(mid) <= 0) lo = mid; else hi = mid;
      }
      chosen = lo;
    }
    scale = upper * chosen;
    minimumScale = upper * minimum;
  }
  if (scale < 0 || !Number.isFinite(scale)) return result('infeasible', ['未能生成有限非负公差候选']);
  const candidateAt = s => {
    const candidateRows = p.rows.map((row, i) => {
      if (row.locked) return project.rows[i]; // Preserve locked rows and their metadata exactly.
      const halfWidth = weights[i] * s / 2;
      return { ...row, upperDeviation: midpoints[i] + halfWidth, lowerDeviation: midpoints[i] - halfWidth };
    });
    if (s > 0 && candidateRows.some((row, i) => weights[i] > 0 && row.upperDeviation === row.lowerDeviation)) {
      return result('infeasible', ['所需正公差小于当前公差中点的数值精度，保存后只能得到零公差，未生成候选']);
    }
    const candidate = { ...p, rows: candidateRows };
    const check = validateProject(candidate);
    if (!check.ok) return result('invalid', ['候选方案超出可靠数值范围或模型约束', ...check.errors.map(e => `${e.path}：${e.message}`)]);
    // Requalify changed random rows under the original frozen statistical policy.
    const forward = analyze(candidate);
    if (method === 'statistical' && (!forward.statistical.available || forward.statistical.k0 !== k0)) {
      return result('invalid', ['候选方案改变了有效随机环，当前统计策略不再具备资格；请明确选择模型后重新分配']);
    }
    if (!forward.valid || forward[method].pass !== true) return result('infeasible', ['候选方案未通过独立前向两侧边界复核，未提供可应用的结果'], forward);
    return result('feasible', [], forward, candidateRows, s);
  };
  let candidate = candidateAt(scale);
  if (candidate.status === 'infeasible' && candidate.analysis && scale > minimumScale) {
    let failed = scale;
    let step = Math.max(Number.MIN_VALUE, scale * Number.EPSILON, ...free.map(({ index }) => weights[index] > 0 ? 2 * Number.EPSILON * Math.abs(midpoints[index]) / weights[index] : 0));
    // Search only the upper convex branch; shrinking toward zero can invalidate skew solutions.
    for (let i = 0; i < 64; i++, step *= 2) {
      const s = Math.max(minimumScale, scale - step);
      const trial = candidateAt(s);
      if (trial.status === 'feasible' || (trial.status === 'infeasible' && !trial.analysis)) {
        if (s > 0 && trial.status === 'feasible') candidate = trial;
        let lo = s, hi = failed;
        // A collapsed lower probe brackets representable positive widths; it is not a solution.
        for (let j = 0; j < 1100; j++) {
          const mid = lo + (hi - lo) / 2;
          if (mid === lo || mid === hi) break;
          const next = candidateAt(mid);
          if (next.status === 'feasible') { lo = mid; candidate = next; }
          else if (next.status === 'infeasible' && !next.analysis) lo = mid;
          else hi = mid;
        }
        if (candidate.status === 'feasible') reasons.push('边界候选受浮点数值精度影响，已沿共同尺度向内搜索并通过前向复核；请保留完整精度');
        break;
      }
      if (trial.status === 'invalid' || s === minimumScale) break;
      failed = s;
    }
  }
  if (candidate.status !== 'feasible') return result(candidate.status, candidate.reasons);
  if (candidate.candidateRows.some(row => !row.locked && row.upperDeviation === row.lowerDeviation)) reasons.push('候选含自由环零公差，仅为数学可行解，不代表制造可行，请确认制造能力');
  return { ...candidate, reasons };
}
