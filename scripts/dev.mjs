import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildApp } from './build.mjs';

await buildApp();
const application = new URL('../尺寸链计算工具.html', import.meta.url);
const server = createServer(async (request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  if (request.method !== 'GET' || !['/', '/index.html', '/' + encodeURIComponent('尺寸链计算工具.html')].includes(request.url)) {
    response.writeHead(404).end('Not found'); return;
  }
  try {
    const html = await readFile(application);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  } catch { response.writeHead(500).end('Build output unavailable'); }
});
server.listen(5173, '127.0.0.1', () => console.log('本地预览 http://127.0.0.1:5173 · npm run build 后刷新即可'));
