import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRow, validateProject, DISTRIBUTIONS, CONFIDENCE_LEVELS } from '../src/model.js';
import { analyze, normalCDF, normalSurvival, normalDensity } from '../src/math.js';
import { createSample } from '../src/samples.js';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Number.isFinite(actual), `Expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function projectWith(rows, target = { lower: -1, upper: 1 }) {
  return { ...createProject(), rows: rows.map((row, i) => ({ ...createRow(i), ...row })), target };
}
function setPath(value, path, next) {
  const parts = path.split('.');
  const last = parts.pop();
  parts.reduce((object, part) => object[part], value)[last] = next;
}

// These fixtures catch ABS(L0), stale asymmetric lower deviations, and separate-side RSS.
for (const [index, nominal, lower, upper, mean, threeSigma] of [
  [0, 0, .1, .45, .275, .082915619758885],
  [1, -.1, -.55, .35, -.1, .206155281280883],
  [2, 4.5, 4.1, 4.9, 4.5, .223606797749979],
]) {
  test(`sample ${index + 1}: signed nominal, endpoints and statistics`, () => {
    const p = createSample(index);
    assert.equal(validateProject(p).ok, true);
    const a = analyze(p);
    assert.equal(a.valid, true);
    close(a.nominal, nominal); close(a.worst.lower, lower); close(a.worst.upper, upper);
    close(a.center, (lower + upper) / 2); close(a.mean, mean); close(3 * a.sigma, threeSigma);
    close(a.statistical.lower, mean - threeSigma); close(a.statistical.upper, mean + threeSigma);
    close(a.worst.lowerDeviation, lower - nominal); close(a.statistical.upperDeviation, mean + threeSigma - nominal);
    assert.equal(a.statistical.available, true); assert.equal(a.quality.available, true);
    assert.ok(p.rows.every(r => r.nominal >= 0));
    assert.ok(p.rows.every(r => r.symmetric === (index !== 0)));
  });
}

test('sample 2 retains the workbook rows with active symmetric deviations', () => {
  assert.deepEqual(createSample(1).rows.map(r => [r.nominal, r.direction, r.upperDeviation, r.lowerDeviation]), [
    [29.7, -1, .1, -.1], [4.3, 1, .05, -.05], [20, 1, .1, -.1],
    [5.3, 1, .1, -.1], [0, -1, .1, -.1],
  ]);
});

test('sample instances, rows and constructors do not share mutable data or IDs', () => {
  const a = createSample(2), b = createSample(2);
  a.rows[0].drawing.layer = 4; a.target.lower = 0;
  assert.equal(b.rows[0].drawing.layer, 0); close(b.target.lower, 4.2);
  assert.equal(new Set(Array.from({ length: 200 }, () => createRow().id)).size, 200);
  const p = createProject();
  assert.equal(p.rows[0].label, 'A1'); assert.equal(createRow(4).label, 'A5');
  assert.deepEqual(p.target, { lower: null, upper: null });
  assert.equal(validateProject(p).ok, true);
  assert.equal(createSample().name, '端盖轴向间隙分析');
  assert.equal(createSample(1).name, '摇臂装配间隙分析');
  assert.equal(createSample(2).name, '轴套定位尺寸分析');
  assert.throws(() => createSample(3), RangeError);
});

for (const [distribution, e, k] of [
  ['normal', 0, 1], ['triangular', 0, 1.22], ['uniform', 0, 1.73],
  ['rayleigh', -.28, 1.14], ['skewExternal', .26, 1.17], ['skewInternal', -.26, 1.17],
]) {
  test(`${distribution} uses tabulated mean displacement and variance`, () => {
    assert.equal(typeof DISTRIBUTIONS[distribution].label, 'string');
    const p = projectWith([{ nominal: 10, direction: -1, upperDeviation: .2, lowerDeviation: -.1, symmetric: false, distribution }]);
    const a = analyze(p);
    close(a.worst.lower, -10.2); close(a.worst.upper, -9.9);
    close(a.mean, -10.05 - e * .15); close(a.sigma, k * .05);
    close(a.center, -10.05); close(a.contributions[0].variance, (k * .05) ** 2);
  });
}

for (const [probability, k0] of [[99.73, 1], [99.5, 1.06], [99, 1.16], [98, 1.29], [95, 1.52], [90, 1.82]]) {
  test(`confidence ${probability} uses rounded standard k0 ${k0}`, () => {
    const p = projectWith([{ upperDeviation: 3, lowerDeviation: -3 }]);
    p.statistics.confidence = probability;
    assert.ok(CONFIDENCE_LEVELS.some(v => v.probability === probability && v.k0 === k0));
    close(analyze(p).statistical.width, 6 / k0);
  });
}

const badValues = [
  ['schemaVersion', 2], ['name', 'x'.repeat(121)], ['name', 0], ['revision', 'x'.repeat(61)],
  ['rows', []], ['rows', null], ['rows', Array.from({ length: 26 }, (_, i) => ({ ...createRow(i) }))],
  ['rows.0.id', ''], ['rows.0.id', 1], ['rows.0.label', 'x'.repeat(121)], ['rows.0.note', 'x'.repeat(501)],
  ['rows.0.nominal', ''], ['rows.0.nominal', '2'], ['rows.0.nominal', null], ['rows.0.nominal', NaN],
  ['rows.0.nominal', Infinity], ['rows.0.nominal', 1e9 + 1], ['rows.0.direction', 0], ['rows.0.direction', '1'],
  ['rows.0.upperDeviation', -.2], ['rows.0.lowerDeviation', -.2], ['rows.0.distribution', 'constructor'],
  ['rows.0.locked', 0], ['rows.0.symmetric', 'true'], ['rows.0.drawing.scale', 0],
  ['rows.0.drawing.scale', 20.01], ['rows.0.drawing.layer', 1.5], ['rows.0.drawing.layer', 25],
  ['rows.0.drawing.label', 'x'.repeat(121)], ['target.lower', 0], ['target.upper', ''],
  ['statistics.mode', 'auto'], ['statistics.confidence', 99.9], ['statistics.manualK0', 1],
  ['statistics.manualK0', 1.31], ['statistics.acceptNormalApproximation', 'true'],
  ['display.precision', 9], ['display.precision', 1.2], ['display.chainScale', .24],
  ['display.chainScale', 4.01], ['display.labelMode', 'all'],
];
for (const [path, value] of badValues) {
  test(`validation rejects ${path}=${String(value).slice(0, 25)} without coercion`, () => {
    const p = createProject(); setPath(p, path, value);
    const v = validateProject(p);
    assert.equal(v.ok, false); assert.equal(v.value, null);
    assert.ok(v.errors.some(e => e.path === path || e.path.startsWith(path + '.') || (path.includes('Deviation') && e.path.startsWith('rows.0.'))), JSON.stringify(v.errors));
    assert.ok(v.errors.every(e => typeof e.path === 'string' && /[\u3400-\u9fff]/u.test(e.message)));
    assert.equal(analyze(p).valid, false);
  });
}

test('validation rejects duplicate IDs, reversed targets and missing structures', () => {
  const p = createProject(); p.rows.push({ ...p.rows[0] });
  assert.ok(validateProject(p).errors.some(e => e.path === 'rows.1.id'));
  p.rows.pop(); p.target = { lower: 1, upper: 0 };
  assert.equal(validateProject(p).ok, false);
  for (const raw of [null, undefined, [], '', 1, {}, { rows: [null] }]) {
    const a = analyze(raw);
    assert.equal(a.valid, false); assert.equal(a.nominal, null);
    assert.equal(a.statistical.available, false); assert.equal(a.quality.available, false);
    assert.ok(Array.isArray(a.errors)); assert.ok(Array.isArray(a.warnings));
    assert.deepEqual(Object.keys(a).sort(), ['valid', 'errors', 'nominal', 'center', 'mean', 'sigma', 'worst', 'statistical', 'quality', 'contributions', 'warnings', 'effectiveCount', 'hasNonNormal', 'dominantShare', 'targetPresent'].sort());
  }
});

test('validation clones only known fields and accepts signed nominal and bounded limits', () => {
  const p = createProject();
  p.name = '项目'; p.rows[0].nominal = -1e9; p.rows[0].upperDeviation = 1e9; p.rows[0].lowerDeviation = -1e9;
  p.rows[0].drawing.scale = 20; p.rows[0].drawing.layer = 24;
  p.derived = { dangerous: true }; p.rows[0].injected = true; p.rows[0].drawing.untrusted = true;
  p.statistics.cached = 1; p.display.script = 'bad'; p.target.extra = 'bad';
  const v = validateProject(p);
  assert.equal(v.ok, true); assert.ok(!('derived' in v.value));
  assert.ok(!('injected' in v.value.rows[0])); assert.ok(!('untrusted' in v.value.rows[0].drawing));
  assert.ok(!('cached' in v.value.statistics)); assert.ok(!('script' in v.value.display)); assert.ok(!('extra' in v.value.target));
  v.value.rows[0].drawing.layer = 0;
  assert.equal(p.rows[0].drawing.layer, 24);
});

test('scaled symmetry tolerance permits roundoff but not a materially shifted band', () => {
  const p = createProject(); p.rows[0].upperDeviation = .3; p.rows[0].lowerDeviation = -.1 - .2;
  assert.equal(validateProject(p).ok, true);
  p.rows[0].lowerDeviation = -.300001;
  assert.equal(validateProject(p).ok, false);
});

test('non-normal model eligibility counts only random rows and keeps quality opt-in', () => {
  const p = projectWith([{ distribution: 'uniform' }]);
  let a = analyze(p);
  assert.equal(a.effectiveCount, 1); assert.equal(a.hasNonNormal, true);
  assert.equal(a.statistical.available, false); assert.equal(a.statistical.lower, null);
  assert.equal(a.quality.available, false); assert.equal(a.quality.yield, null); assert.ok(a.sigma > 0);
  p.statistics.mode = 'manual';
  a = analyze(p); assert.equal(a.statistical.available, true); close(a.statistical.k0, 1.2);
  assert.equal(a.quality.available, false);
  p.statistics.mode = 'preset'; p.statistics.acceptNormalApproximation = true;
  a = analyze(p); assert.equal(a.statistical.available, true); assert.equal(a.quality.available, true);
  p.statistics.acceptNormalApproximation = false;
  p.rows = Array.from({ length: 5 }, (_, i) => ({ ...createRow(i), distribution: 'uniform' }));
  a = analyze(p); assert.equal(a.statistical.available, true); assert.equal(a.quality.available, false);
  p.rows[0].upperDeviation = 20; p.rows[0].lowerDeviation = -20;
  a = analyze(p); assert.ok(a.dominantShare > .99); assert.ok(a.warnings.some(s => s.includes('50%')));
  p.rows = [{ ...createRow(), distribution: 'rayleigh', upperDeviation: 0, lowerDeviation: 0 }, createRow(1)];
  a = analyze(p); assert.equal(a.hasNonNormal, false); assert.equal(a.effectiveCount, 1); assert.equal(a.quality.available, true);
});

test('quality reports normal tails, PPM, signed Cpk and no fake worst yield', () => {
  const p = projectWith([{ upperDeviation: 3, lowerDeviation: -3 }], { lower: -3, upper: 3 });
  const a = analyze(p);
  close(a.quality.yield, .9973002039367398); close(a.quality.ppm, 2699.79606326019);
  close(a.quality.lowerTail, .001349898031630095); close(a.quality.upperTail, .001349898031630095);
  close(a.quality.cp, 1); close(a.quality.cpk, 1); assert.equal(a.worst.pass, true);
  assert.equal('yield' in a.worst, false);
  p.target = { lower: 8, upper: 9 };
  const q = analyze(p).quality;
  assert.ok(q.yield > 6.21e-16 && q.yield < 6.23e-16); close(q.cpk, -8 / 3);
  p.target = { lower: 1, upper: 1 };
  assert.equal(analyze(p).quality.yield, 0);
});

test('narrow normal target bands retain independent width when standardized endpoints coincide', () => {
  const p = projectWith([{ nominal: 1, upperDeviation: 3, lowerDeviation: -3 }], { lower: -1e-20, upper: 1e-20 });
  const a = analyze(p);
  assert.equal(a.valid, true); assert.equal(a.quality.available, true);
  assert.ok(Math.abs(a.quality.yield / 4.839414490382867e-21 - 1) < 1e-12, `yield=${a.quality.yield}`);
  p.target = { lower: 0, upper: 0 };
  assert.equal(analyze(p).quality.yield, 0);
});

test('narrow normal target bands retain relative accuracy before standardized endpoints coincide', () => {
  const p = projectWith([{ nominal: 1, upperDeviation: 3, lowerDeviation: -3 }], { lower: -1e-12, upper: 1e-12 });
  const q = analyze(p).quality;
  assert.ok(Math.abs(q.yield / 4.839414490382867e-13 - 1) < 1e-12, `yield=${q.yield}`);
});

test('independent narrow widths remain stable in large positive and negative tails', () => {
  for (const nominal of [-20, 20]) {
    const p = projectWith([{ nominal, upperDeviation: 3, lowerDeviation: -3 }], { lower: -1e-20, upper: 1e-20 });
    const q = analyze(p).quality;
    assert.ok(Math.abs(q.yield / 1.1041896724319526e-107 - 1) < 1e-12, `yield=${q.yield}`);
    assert.ok(Number.isFinite(q.lowerTail)); assert.ok(Number.isFinite(q.upperTail));
  }
});

test('deterministic zero-width outcomes use closed limits and null capabilities', () => {
  const p = projectWith([{ nominal: 1, upperDeviation: 0, lowerDeviation: 0, distribution: 'uniform' }], { lower: 1, upper: 1 });
  let a = analyze(p);
  assert.equal(a.sigma, 0); assert.equal(a.quality.deterministic, true);
  assert.equal(a.quality.yield, 1); assert.equal(a.quality.ppm, 0);
  assert.equal(a.quality.cp, null); assert.equal(a.quality.cpk, null);
  assert.equal(a.worst.pass, true); assert.equal(a.statistical.pass, true);
  assert.equal(a.effectiveCount, 0); assert.equal(a.hasNonNormal, false);
  assert.equal(a.contributions[0].worstShare, 0); assert.equal(a.contributions[0].varianceShare, 0);
  p.target = { lower: 2, upper: 3 };
  a = analyze(p); assert.equal(a.quality.yield, 0); assert.equal(a.quality.lowerTail, 1); assert.equal(a.quality.ppm, 1e6);
  p.target = { lower: null, upper: null };
  a = analyze(p); assert.equal(a.targetPresent, false); assert.equal(a.worst.pass, null); assert.equal(a.statistical.lowerMargin, null);
  assert.equal(a.quality.available, false); assert.equal(a.quality.yield, null);
});

test('normal CDF, survival and density retain eight significant tail digits', () => {
  for (const [z, tail] of [[0, .5], [1, .15865525393145705], [3, .001349898031630095], [8, 6.22096057427182e-16], [10, 7.61985302416047e-24], [20, 2.753624118606234e-89], [37, 5.725571222524577e-300]]) {
    assert.ok(Math.abs(normalSurvival(z) / tail - 1) < 1e-8, `Q(${z})=${normalSurvival(z)}`);
    assert.ok(Math.abs(normalCDF(-z) / tail - 1) < 1e-8);
    close(normalCDF(z) + normalSurvival(z), 1);
  }
  close(normalDensity(0), .3989422804014327); close(normalDensity(2, 2, 2), .19947114020071635);
  assert.equal(normalCDF(-Infinity), 0); assert.equal(normalCDF(Infinity), 1);
  assert.equal(normalSurvival(Infinity), 0); assert.equal(normalSurvival(-Infinity), 1);
  assert.equal(normalDensity(Infinity), 0);
  assert.ok(Number.isNaN(normalCDF(NaN))); assert.ok(Number.isNaN(normalDensity(0, 0, 0)));
});

test('row permutation, sign reversal, scaling and enumerated extremes obey chain identities', () => {
  let state = 1947;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 45; trial++) {
    const p = projectWith(Array.from({ length: 5 }, () => {
      const lower = random() - .8;
      return { nominal: random() * 40, direction: random() < .5 ? -1 : 1, lowerDeviation: lower, upperDeviation: lower + random(), symmetric: false, distribution: Object.keys(DISTRIBUTIONS)[Math.floor(random() * 6)] };
    }));
    p.statistics.acceptNormalApproximation = true;
    const a = analyze(p), reverse = analyze({ ...p, rows: [...p.rows].reverse() });
    for (const key of ['nominal', 'center', 'mean', 'sigma']) close(reverse[key], a[key]);
    const neg = analyze({ ...p, rows: p.rows.map(r => ({ ...r, direction: -r.direction })) });
    close(neg.worst.lower, -a.worst.upper); close(neg.mean, -a.mean); close(neg.statistical.upper, -a.statistical.lower);
    const scaled = analyze({ ...p, rows: p.rows.map(r => ({ ...r, nominal: r.nominal * 1000, upperDeviation: r.upperDeviation * 1000, lowerDeviation: r.lowerDeviation * 1000 })), target: { lower: -1000, upper: 1000 } });
    close(scaled.mean, a.mean * 1000); close(scaled.sigma, a.sigma * 1000); close(scaled.worst.lower, a.worst.lower * 1000);
    const corners = Array.from({ length: 32 }, (_, mask) => p.rows.reduce((sum, r, i) => sum + r.direction * (r.nominal + ((mask >> i) & 1 ? r.upperDeviation : r.lowerDeviation)), 0));
    close(a.worst.lower, Math.min(...corners)); close(a.worst.upper, Math.max(...corners));
    close(a.contributions.reduce((s, c) => s + c.worstShare, 0), 1);
    close(a.contributions.reduce((s, c) => s + c.varianceShare, 0), 1);
  }
});

test('large cancelling nominal dimensions retain small deviations', () => {
  const p = projectWith([
    { nominal: 1e9, upperDeviation: .0002, lowerDeviation: .0001, symmetric: false },
    { nominal: 1e9, direction: -1, upperDeviation: 0, lowerDeviation: -.0001, symmetric: false },
  ], { lower: .0001, upper: .0003 });
  const a = analyze(p);
  close(a.nominal, 0, 1e-15); close(a.worst.lower, .0001, 1e-15); close(a.worst.upper, .0003, 1e-15);
  close(a.mean, .0002, 1e-15);
});
