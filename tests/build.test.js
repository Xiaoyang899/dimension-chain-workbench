import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildHtml } from '../scripts/build.mjs';

test('inline packaging preserves script data without permitting closing-tag injection', () => {
  const shell = '<meta content="__CSP__"><style>__STYLE__</style><script>__SCRIPT__</script>';
  const html = buildHtml(shell, 'globalThis.label = "</script><script>unsafe</script>";', 'body{color:black}');
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = {};
  runInNewContext(script, context);
  assert.equal(context.label, '</script><script>unsafe</script>');
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`));
});

test('inline packaging generates an independently matching style integrity policy', () => {
  const style = 'body{color:blue}';
  const html = buildHtml('__CSP__<style>__STYLE__</style><script>__SCRIPT__</script>', 'globalThis.answer=42;', style);
  assert.ok(html.includes(`'sha256-${createHash('sha256').update(style).digest('base64')}'`));
  assert.ok(html.includes("connect-src 'none'"));
});

test('delivered HTML is a complete offline artifact without external resources', async () => {
  const html = await readFile(new URL('../尺寸链计算工具.html', import.meta.url), 'utf8');
  assert.ok(html.length > 30000);
  assert.doesNotMatch(html, /<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:https?:|\/|\.\/)/i);
  assert.doesNotMatch(html, /<script[^>]*\btype=["']module/i);
  assert.doesNotMatch(html, /__(?:SCRIPT|STYLE|CSP)__/);
  assert.doesNotMatch(html, /<meta\b[^>]*http-equiv=["']refresh["']/i, 'the built app must not contain the source preview redirect');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(html.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`));
});
