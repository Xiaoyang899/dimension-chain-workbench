import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, serializeProject, parseProjectJson, exportCsv, saveAutosave, readAutosave } from '../src/project-io.js';
import { createProject } from '../src/model.js';
import { analyze } from '../src/math.js';

test('JSON round trip preserves actual inputs and distribution assumptions', () => {
  const project = createProject();
  project.name = '中文项目 <script>not executable</script>';
  project.statistics.mode = 'manual';
  project.rows[0].distribution = 'rayleigh';
  const result = parseProjectJson(serializeProject(project));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, project);
});
test('invalid or unsupported project files are rejected rather than replaced by defaults', () => {
  assert.equal(parseProjectJson('{bad json').ok, false);
  assert.equal(parseProjectJson('{"schemaVersion":99}').ok, false);
  assert.equal(parseProjectJson('x'.repeat(1048577)).ok, false);
});
test('ring descriptions default to empty for projects saved before the column existed', () => {
  const project = createProject();
  const raw = JSON.parse(serializeProject(project));
  delete raw.rows[0].description;
  const result = parseProjectJson(JSON.stringify(raw));
  assert.equal(result.ok, true);
  assert.equal(result.value.rows[0].description, '');
});
test('ring description round trips and rejects non-text or overlong values', () => {
  const project = createProject();
  project.rows[0].description = '轴承座宽度 <b>';
  assert.equal(parseProjectJson(serializeProject(project)).value.rows[0].description, '轴承座宽度 <b>');
  for (const bad of [7, null, 'x'.repeat(121)]) {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.rows[0].description = bad;
    assert.equal(parseProjectJson(JSON.stringify(raw)).ok, false, String(bad));
  }
});
test('TSV parses explicit signed deviations without interpreting asymmetric inputs as symmetric', () => {
  const result = parseTsv('环标识\t基本尺寸\t方向\t上偏差\t下偏差\nA1\t30\t−\t0\t-0.1\nA2\t43\t+\t0.2\t0.1');
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].direction, -1);
  assert.equal(result.rows[1].lowerDeviation, .1);
  assert.equal(result.rows[1].symmetric, false);
});
test('TSV refuses missing tolerances, formula expressions, reversed deviations and excessive rows', () => {
  for (const input of ['A1\t10\t+\t\t0', 'A1\t=1+2\t+\t.1\t-.1', 'A1\t10\t+\t-.2\t.1', Array(26).fill('A\t1\t+\t.1\t-.1').join('\n')]) {
    assert.equal(parseTsv(input).ok, false, input);
  }
});
test('CSV neutralizes formula-like user text while preserving numeric negative values', () => {
  const project = createProject();
  project.name = '=HYPERLINK("bad")';
  project.rows[0].label = '+SUM(1,2)';
  const csv = exportCsv(project, analyze(project));
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'+SUM(1,2)"));
  assert.ok(csv.includes('-0.1'));
});
test('unavailable storage produces visible failure state rather than throwing', () => {
  const storage = { setItem() { throw new Error('denied'); }, getItem() { throw new Error('denied'); } };
  assert.equal(saveAutosave(storage, createProject()).ok, false);
  assert.equal(readAutosave(storage).ok, false);
});
test('stored projects use the same boundary validation as imported files', () => {
  const result = readAutosave({ getItem() { return '{"schemaVersion":99}'; } });
  assert.equal(result.ok, false);
});
