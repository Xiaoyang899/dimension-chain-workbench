import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRow, validateProject } from '../src/model.js';
import { analyze } from '../src/math.js';
import { allocate } from '../src/allocation.js';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function project(rows, target = { lower: -1, upper: 1 }) {
  return { ...createProject(), rows: rows.map((r, i) => ({ ...createRow(i), ...r })), target };
}
function width(row) { return row.upperDeviation - row.lowerDeviation; }
function midpoint(row) { return (row.upperDeviation + row.lowerDeviation) / 2; }
function verify(p, result, method) {
  assert.equal(result.status, 'feasible', result.reasons.join('; '));
  assert.equal(validateProject({ ...p, rows: result.candidateRows }).ok, true);
  const forward = analyze({ ...p, rows: result.candidateRows });
  assert.deepEqual(result.analysis, forward);
  assert.equal(forward[method].pass, true, JSON.stringify(forward[method]));
  result.candidateRows.forEach((r, i) => {
    const old = p.rows[i];
    close(midpoint(r), midpoint(old));
    for (const key of ['id', 'label', 'nominal', 'direction', 'distribution', 'locked', 'symmetric', 'note']) assert.equal(r[key], old[key]);
    assert.deepEqual(r.drawing, old.drawing);
    if (old.locked) assert.strictEqual(r, old, 'locked row must be the exact original object');
  });
}

test('worst equal fixture preserves fixed width .2 and allocates .4 per free row', () => {
  const p = project([
    { nominal: .2, locked: true },
    { upperDeviation: .3, lowerDeviation: -.1, symmetric: false },
    { direction: -1, upperDeviation: .25, lowerDeviation: -.05, symmetric: false },
  ], { lower: -.5, upper: .7 });
  const original = structuredClone(p);
  const r = allocate(p, { method: 'worst', strategy: 'equal' });
  verify(p, r, 'worst'); close(r.scale, .4); close(width(r.candidateRows[1]), .4);
  close(r.analysis.worst.lower, -.3); close(r.analysis.worst.upper, .7);
  assert.deepEqual(p, original);
});

for (const method of ['worst', 'statistical']) {
  for (const strategy of ['equal', 'proportional']) {
    test(`${method}/${strategy}: normal allocation uses full budget and preserves proportions`, () => {
      const p = project([{ upperDeviation: .1, lowerDeviation: -.1 }, { upperDeviation: .2, lowerDeviation: -.2 }]);
      const r = allocate(p, { method, strategy });
      verify(p, r, method);
      close(r.analysis[method].width, 2);
      close(width(r.candidateRows[1]) / width(r.candidateRows[0]), strategy === 'equal' ? 1 : 2);
      if (method === 'statistical' && strategy === 'equal') close(r.scale, Math.SQRT2);
      if (method === 'worst' && strategy === 'proportional') close(r.scale, 10 / 3);
    });
  }
}

test('single external skew maximum is 1.619433198380567, not naive RSS 2.051282051', () => {
  const p = project([{ distribution: 'skewExternal' }]); p.statistics.mode = 'manual';
  const r = allocate(p, { method: 'statistical', strategy: 'equal' });
  verify(p, r, 'statistical'); close(r.scale, 1.619433198380567);
  close(r.analysis.mean, .2105263157894737); close(r.analysis.statistical.upper, 1);
  assert.equal(r.analysis.quality.available, false);
  const naive = { ...p, rows: [{ ...p.rows[0], upperDeviation: 2.051282051 / 2, lowerDeviation: -2.051282051 / 2 }] };
  assert.equal(analyze(naive).statistical.pass, false);
});

function skewFixture(center = .51) {
  const p = project([
    { nominal: center, upperDeviation: .6, lowerDeviation: -.6, locked: true },
    { direction: -1, distribution: 'skewExternal' },
  ]);
  p.statistics.mode = 'manual';
  return p;
}

test('skew feasible interval away from zero is found instead of rejecting g(0)>0', () => {
  const p = skewFixture(), r = allocate(p, { method: 'statistical', strategy: 'equal' });
  verify(p, r, 'statistical'); close(r.scale, .484556892980411);
  close(r.analysis.mean, .44700760391254657);
  close(r.analysis.statistical.upper, 1);
});

test('skew convex minimum above target returns infeasible without negative widths', () => {
  const r = allocate(skewFixture(.55), { method: 'statistical', strategy: 'equal' });
  assert.equal(r.status, 'infeasible'); assert.equal(r.candidateRows, null); assert.ok(r.reasons.length);
});

test('a small negative statistical minimum yields the positive maximum, not a zero tangency', () => {
  const p = project([{ nominal: 1 - 2 ** -50 }]);
  const r = allocate(p, { method: 'statistical', strategy: 'equal' });
  verify(p, r, 'statistical');
  assert.equal(r.scale, 2 ** -49);
  assert.equal(width(r.candidateRows[0]), 2 ** -49);
  assert.equal(r.analysis.statistical.upperMargin, 0);
  assert.ok(r.reasons.some(s => /临界|边界/.test(s)));
});

test('statistical convex tangent is a valid nonzero isolated solution', () => {
  // Independent analytic stationary point: h'(s)=.13, with F=1.44, D=1.3689.
  const slope = .13, k0 = 1.2, F = 1.44, D = 1.3689;
  const s = Math.sqrt(4 * k0 ** 2 * slope ** 2 * F / (D * (D - 4 * k0 ** 2 * slope ** 2)));
  const center = 1 - Math.sqrt(F + D * s ** 2) / (2 * k0) + slope * s;
  const p = skewFixture(center), r = allocate(p, { method: 'statistical', strategy: 'equal' });
  verify(p, r, 'statistical'); close(r.scale, s, 2e-7);
  assert.ok(r.reasons.some(s => /临界|相切|边界/.test(s)));
});

test('unqualified statistical allocation and custom k0 cannot bypass policy', () => {
  const p = project([{ distribution: 'uniform' }]);
  for (const options of [{ method: 'statistical', strategy: 'equal' }, { method: 'statistical', strategy: 'equal', k0: 1.2 }]) {
    const r = allocate(p, options);
    assert.equal(r.status, 'invalid'); assert.equal(r.candidateRows, null);
  }
  p.statistics.mode = 'manual';
  assert.equal(allocate(p, { method: 'statistical', strategy: 'equal', k0: 1.3 }).status, 'invalid');
  verify(p, allocate(p, { method: 'statistical', strategy: 'equal', k0: 1.2 }), 'statistical');
});

test('candidate gaining non-normal random rows is independently checked under frozen policy', () => {
  const p = project([
    { distribution: 'uniform', upperDeviation: 0, lowerDeviation: 0 },
    { distribution: 'normal' },
  ]);
  assert.equal(analyze(p).statistical.available, true);
  const r = allocate(p, { method: 'statistical', strategy: 'equal' });
  assert.equal(r.status, 'invalid'); assert.equal(r.candidateRows, null);
  assert.equal(p.statistics.acceptNormalApproximation, false);
  p.statistics.acceptNormalApproximation = true;
  verify(p, allocate(p, { method: 'statistical', strategy: 'equal' }), 'statistical');
});

test('zero proportional weights advise equal allocation instead of NaN', () => {
  const p = project([{ upperDeviation: 0, lowerDeviation: 0 }]);
  for (const method of ['worst', 'statistical']) {
    const r = allocate(p, { method, strategy: 'proportional' });
    assert.equal(r.status, 'invalid'); assert.equal(r.scale, null); assert.ok(r.reasons.some(s => s.includes('等')));
    verify(p, allocate(p, { method, strategy: 'equal' }), method);
  }
});

test('zero proportional weights remain zero while nonzero weights grow', () => {
  const p = project([{ upperDeviation: 0, lowerDeviation: 0 }, {}]);
  for (const method of ['worst', 'statistical']) {
    const r = allocate(p, { method, strategy: 'proportional' });
    verify(p, r, method); assert.equal(width(r.candidateRows[0]), 0); close(width(r.candidateRows[1]), 2);
  }
});

test('all locked rows are only checked, never rewritten', () => {
  const p = project([{ locked: true }]);
  for (const method of ['worst', 'statistical']) {
    const r = allocate(p, { method, strategy: 'equal' });
    assert.equal(r.status, 'unchanged'); assert.equal(r.candidateRows, null); assert.equal(r.analysis[method].pass, true);
    p.target = { lower: 1, upper: 2 };
    assert.equal(allocate(p, { method, strategy: 'equal' }).status, 'infeasible');
    p.target = { lower: -1, upper: 1 };
  }
});

test('overdrawn fixed budgets and off-center bands remain infeasible', () => {
  for (const method of ['worst', 'statistical']) {
    for (const p of [
      project([{ locked: true, upperDeviation: 2, lowerDeviation: -2 }, {}]),
      project([{ locked: true, upperDeviation: 1 + 2 ** -50, lowerDeviation: -1 - 2 ** -50 }, {}]),
      project([{ nominal: 3 }]),
      project([{ nominal: 1 + 2 ** -50 }]),
      project([{ nominal: 1 }], { lower: 0, upper: 0 }),
      project([{ nominal: .1, locked: true, upperDeviation: 1, lowerDeviation: -1 }, {}]),
    ]) {
      const r = allocate(p, { method, strategy: 'equal' });
      assert.equal(r.status, 'infeasible'); assert.equal(r.candidateRows, null); assert.equal(r.scale, null);
      assert.ok(r.reasons.length > 0);
    }
  }
});

for (const method of ['worst', 'statistical']) {
  for (const strategy of ['equal', 'proportional']) {
    for (const [label, makeProject] of [
      ['zero target', () => project([{}], { lower: 0, upper: 0 })],
      ['exhausted fixed budget', () => project([{ locked: true, upperDeviation: 1, lowerDeviation: -1, note: 'fixed' }, {}])],
      ['center on target boundary', () => project([{ nominal: 1 }])],
    ]) {
      test(`${method}/${strategy}: ${label} returns a forward-checked zero scale with manufacturing warning`, () => {
        const p = makeProject(), before = structuredClone(p);
        const r = allocate(p, { method, strategy });
        verify(p, r, method); assert.equal(r.scale, 0);
        r.candidateRows.forEach(row => { if (!row.locked) assert.equal(width(row), 0); });
        assert.ok(r.reasons.some(s => /零公差/.test(s) && /制造/.test(s)));
        assert.deepEqual(p, before);
      });
    }
  }
  test(`${method}: zero schema cap still permits a mathematical zero candidate`, () => {
    const p = project([{ nominal: -1e9, lowerDeviation: 1e9, upperDeviation: 1e9, symmetric: false }]);
    const r = allocate(p, { method, strategy: 'equal' });
    verify(p, r, method); assert.equal(r.scale, 0);
    assert.ok(r.reasons.some(s => /零公差/.test(s) && /制造/.test(s)));
  });
}

test('allocation rejects invalid requests and missing targets without throwing', () => {
  for (const p of [null, {}, createProject()]) {
    const r = allocate(p, { method: 'worst', strategy: 'equal' });
    assert.equal(r.status, 'invalid'); assert.equal(r.candidateRows, null);
  }
  for (const options of [null, undefined, {}, { method: 'invalid', strategy: 'equal' }, { method: 'worst', strategy: 'x' }, { method: 'statistical', strategy: 'equal', k0: NaN }]) {
    const r = allocate(project([{}]), options);
    assert.equal(r.status, 'invalid'); assert.equal(r.scale, null);
  }
});

test('large cancelling dimensions do not supply a loose feasibility epsilon', () => {
  const p = project([
    { nominal: 1e9, locked: true, upperDeviation: .0006, lowerDeviation: -.0006 },
    { nominal: 1e9, direction: -1 },
  ], { lower: -.0005, upper: .0005 });
  for (const method of ['worst', 'statistical']) assert.equal(allocate(p, { method, strategy: 'equal' }).status, 'infeasible');
});

test('bounded general solver respects schema bounds on candidate deviations', () => {
  const p = project([{ upperDeviation: 1e9, lowerDeviation: 1e9 - 1, symmetric: false }], { lower: -1e9, upper: 1e9 });
  const r = allocate(p, { method: 'statistical', strategy: 'equal' });
  assert.ok(['feasible', 'infeasible'].includes(r.status));
  if (r.status === 'feasible') verify(p, r, 'statistical');
});

for (const method of ['worst', 'statistical']) {
  for (const strategy of ['equal', 'proportional']) {
    test(`${method}/${strategy}: rounded boundary searches inward for the nearest passing representation`, () => {
      const p = project([{ nominal: -100, lowerDeviation: 99, upperDeviation: 101, symmetric: false }], { lower: -.01, upper: .01 });
      const before = structuredClone(p);
      const r = allocate(p, { method, strategy });
      verify(p, r, method);
      assert.equal(r.candidateRows[0].lowerDeviation, 99.99000000000001);
      assert.equal(r.candidateRows[0].upperDeviation, 100.00999999999999);
      const maximum = strategy === 'equal' ? .02 : .01;
      assert.ok(r.scale <= maximum && r.scale > maximum * (1 - 1e-11));
      assert.ok(r.reasons.some(s => /精度/.test(s)));
      assert.deepEqual(p, before);
    });
  }
}

test('inward rounding refines probes that skip past the last positive representation', () => {
  for (const method of ['worst', 'statistical']) for (const strategy of ['equal', 'proportional']) {
    for (const halfTarget of [2.14e-14, 2.2e-14, 2.8e-14]) {
      const p = project([{ nominal: -100, lowerDeviation: 99, upperDeviation: 101, symmetric: false }], { lower: -halfTarget, upper: halfTarget });
      const r = allocate(p, { method, strategy });
      verify(p, r, method);
      assert.equal(r.candidateRows[0].lowerDeviation, 100 - 2 ** -46);
      assert.equal(r.candidateRows[0].upperDeviation, 100 + 2 ** -46);
      assert.ok(r.scale > 0);
    }
  }
});

test('inward rounding preserves proportional weights, midpoints, locked metadata and frozen k0', () => {
  const p = project([
    { nominal: -100, lowerDeviation: 99, upperDeviation: 101, symmetric: false },
    { nominal: -100, lowerDeviation: 98, upperDeviation: 102, symmetric: false },
    { locked: true, upperDeviation: 0, lowerDeviation: 0, note: 'keep fixed' },
  ], { lower: -.012, upper: .012 });
  p.rows[2].metadata = { source: 'locked original' };
  p.statistics.mode = 'manual';
  const before = structuredClone(p);
  for (const method of ['worst', 'statistical']) {
    const r = allocate(p, { method, strategy: 'proportional' });
    verify(p, r, method);
    assert.equal(midpoint(r.candidateRows[0]), 100); assert.equal(midpoint(r.candidateRows[1]), 100);
    close(width(r.candidateRows[1]) / width(r.candidateRows[0]), 2, 1e-10);
    assert.equal(r.analysis.statistical.k0, 1.2);
    const wider = r.candidateRows.map(row => row.locked ? row : { ...row, upperDeviation: midpoint(row) + width(row) * 1.000001 / 2, lowerDeviation: midpoint(row) - width(row) * 1.000001 / 2 });
    assert.equal(analyze({ ...p, rows: wider })[method].pass, false);
  }
  assert.deepEqual(p, before);
});

test('inward rounding does not shrink a skew solution through its infeasible lower branch', () => {
  const p = project([
    { nominal: .0000663, upperDeviation: .000078, lowerDeviation: -.000078, locked: true },
    { nominal: -100, direction: -1, lowerDeviation: 99, upperDeviation: 101, symmetric: false, distribution: 'skewExternal' },
  ], { lower: -.00013, upper: .00013 });
  p.statistics.mode = 'manual';
  const zero = { ...p, rows: p.rows.map(row => row.locked ? row : { ...row, lowerDeviation: 100, upperDeviation: 100 }) };
  assert.equal(analyze(zero).statistical.pass, false);
  const r = allocate(p, { method: 'statistical', strategy: 'equal' });
  verify(p, r, 'statistical');
  assert.ok(Math.abs(r.scale / .00006299239608745343 - 1) < 1e-8);
  assert.equal(r.analysis.statistical.k0, 1.2);
  assert.ok(r.reasons.some(s => /精度/.test(s)));
});

test('unrepresentable positive widths must not masquerade as a successful zero-width allocation', () => {
  const p = project([
    { upperDeviation: .15, lowerDeviation: .05, symmetric: false },
    { direction: -1, upperDeviation: .1, lowerDeviation: .1, locked: true, symmetric: false },
  ], { lower: -1e-20, upper: 1e-20 });
  for (const method of ['worst', 'statistical']) {
    const r = allocate(p, { method, strategy: 'equal' });
    assert.equal(r.status, 'infeasible'); assert.equal(r.candidateRows, null);
    assert.ok(r.reasons.some(s => /零|精度/.test(s)));
  }
});

test('zero fixed variance with collective skew finds a feasible interval away from zero', () => {
  const p = project(Array.from({ length: 25 }, (_, i) => ({ nominal: i === 0 ? 1.1 : 0, distribution: 'skewInternal' })));
  p.statistics.mode = 'manual';
  const r = allocate(p, { method: 'statistical', strategy: 'equal' });
  verify(p, r, 'statistical'); close(r.scale, .36923076923076923);
  close(r.analysis.statistical.lower, -1); close(r.analysis.mean, -.1);
});

test('very small weights and huge proportional scale do not overflow intermediate squares', () => {
  const p = project([{ upperDeviation: 5e-151, lowerDeviation: -5e-151 }], { lower: -1e9, upper: 1e9 });
  for (const method of ['worst', 'statistical']) {
    const r = allocate(p, { method, strategy: 'proportional' });
    verify(p, r, method); close(r.scale, 2e159); close(width(r.candidateRows[0]), 2e9);
  }
});

test('independent closed quadratic roots reproduce both skew inverse fixtures', () => {
  // Squaring sqrt(F+D*s²)=2k(1-A-B*s) gives an independent quadratic.
  for (const [A, B, F, D, expected] of [[0, .13, 0, 1.3689, 1.619433198380567], [.51, -.13, 1.44, 1.3689, .484556892980411]]) {
    const k = 1.2, qa = D - 4 * k * k * B * B, qb = 8 * k * k * (1 - A) * B, qc = F - 4 * k * k * (1 - A) ** 2;
    const root = (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
    close(root, expected, 1e-13);
    const p = F === 0 ? project([{ distribution: 'skewExternal' }]) : skewFixture();
    p.statistics.mode = 'manual';
    const r = allocate(p, { method: 'statistical', strategy: 'equal' });
    close(r.scale, root, 1e-13);
    assert.ok(Math.abs(A + B * root) + Math.sqrt(F + D * root * root) / (2 * k) <= 1 + 1e-14);
  }
});

test('deterministic randomized successful allocations forward-check and are locally maximal', () => {
  let state = 582;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 90; trial++) {
    const rows = Array.from({ length: 1 + trial % 6 }, () => {
      const w = .02 + random() * .3, delta = (random() - .5) * .08;
      return { direction: random() < .5 ? 1 : -1, upperDeviation: delta + w / 2, lowerDeviation: delta - w / 2, symmetric: false, locked: random() < .2, distribution: ['normal', 'uniform', 'rayleigh', 'skewExternal', 'skewInternal'][Math.floor(random() * 5)] };
    });
    rows[0].locked = false;
    const p = project(rows); p.statistics.mode = 'manual'; p.statistics.acceptNormalApproximation = true;
    const before = structuredClone(p);
    for (const method of ['worst', 'statistical']) for (const strategy of ['equal', 'proportional']) {
      const r = allocate(p, { method, strategy }); verify(p, r, method);
      const wider = r.candidateRows.map(row => row.locked ? row : { ...row, upperDeviation: midpoint(row) + width(row) * 1.000001 / 2, lowerDeviation: midpoint(row) - width(row) * 1.000001 / 2 });
      assert.equal(analyze({ ...p, rows: wider })[method].pass, false);
    }
    assert.deepEqual(p, before);
  }
});
