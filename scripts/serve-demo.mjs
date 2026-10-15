import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const routes = new Map([
  ['/', 'demo/index.html'],
  ['/demo.css', 'demo/demo.css'],
  ['/demo.js', 'demo/demo.js'],
  ['/skills/weekend-rush/scripts/trip-utils.mjs', 'skills/weekend-rush/scripts/trip-utils.mjs'],
]);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relativePath = routes.get(pathname);
  if (!relativePath) { response.writeHead(404).end('Not found'); return; }
  try {
    const safePath = normalize(relativePath);
    const body = await readFile(join(root, safePath));
    response.writeHead(200, { 'content-type': mime[extname(safePath)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});
const port = Number(process.env.PORT) || 4173;
server.listen(port, '127.0.0.1', () => console.log(`演示界面已启动：http://127.0.0.1:${port}`));
