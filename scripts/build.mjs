import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function buildHtml(shell, javascript, stylesheet) {
  const script = javascript.replace(/<\/script/gi, '<\\/script');
  const style = stylesheet.replace(/<\/style/gi, '<\\/style');
  const hash = text => createHash('sha256').update(text).digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return shell.replace('__CSP__', () => csp).replace('__STYLE__', () => style).replace('__SCRIPT__', () => script);
}

export async function buildApp() {
  const root = new URL('../', import.meta.url);
  const result = await build({ entryPoints: [fileURLToPath(new URL('src/app.js', root))], bundle: true, write: false, format: 'iife', target: ['chrome120', 'edge120', 'safari17'], charset: 'utf8', minify: true, legalComments: 'none' });
  const [shell, style] = await Promise.all([readFile(new URL('src/shell.template.html', root), 'utf8'), readFile(new URL('src/styles.css', root), 'utf8')]);
  const html = buildHtml(shell, result.outputFiles[0].text, style);
  await writeFile(new URL('尺寸链计算工具.html', root), html, 'utf8');
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = await buildApp();
  console.log(`已构建 尺寸链计算工具.html · ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB · 无运行时外部依赖`);
}
