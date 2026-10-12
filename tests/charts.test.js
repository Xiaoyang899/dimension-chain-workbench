import test from 'node:test';
import assert from 'node:assert/strict';
import { plotDomain, projectCoordinate } from '../src/charts.js';

test('chart domain includes both specification and computed limits', () => {
  const domain = plotDomain({ mean: 4.5, sigma: .1, worst: { lower: 4.1, upper: 4.9 } }, { lower: 3, upper: 6 });
  assert.ok(domain[0] < 3);
  assert.ok(domain[1] > 6);
});

test('a deterministic zero dimension has a usable nonzero chart span', () => {
  const domain = plotDomain({ mean: 0, sigma: 0, worst: { lower: 0, upper: 0 } }, { lower: null, upper: null });
  assert.ok(Number.isFinite(domain[0]) && Number.isFinite(domain[1]));
  assert.ok(domain[0] < 0 && domain[1] > 0);
});

test('chart coordinates preserve signed values and linear placement', () => {
  assert.equal(projectCoordinate(-1, [-1, 1], [50, 750]), 50);
  assert.equal(projectCoordinate(0, [-1, 1], [50, 750]), 400);
  assert.equal(projectCoordinate(1, [-1, 1], [50, 750]), 750);
});
