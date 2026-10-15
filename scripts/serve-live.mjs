import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGateway, PublicError } from '../server/mcp-gateway.mjs';
import { createLiveService } from '../server/live-service.mjs';
import { generatePlans } from '../server/planner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const routes = new Map([
  ['/', 'live/index.html'], ['/live.css', 'live/live.css'], ['/live.js', 'live/live.js'],
  ['/examples/intent-trip-v1', 'docs/examples/intent-trip-v1.html'], ['/examples/intent-trip-v2', 'docs/examples/intent-trip-v2.html'],
  ['/demo', 'demo/index.html'], ['/demo.css', 'demo/demo.css'], ['/demo.js', 'demo/demo.js'],
  ['/skills/weekend-rush/scripts/trip-utils.mjs', 'skills/weekend-rush/scripts/trip-utils.mjs'],
]);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const json = (response, status, data) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(data));
};

export function createLiveServer({ service, gateway } = {}) {
  const activeGateway = gateway ?? (service ? null : createGateway());
  const live = service ?? createLiveService(activeGateway);
  const recent = [];
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return json(response, 403, { error: '仅支持本机访问。' });
      if (request.headers.origin && ![`http://${host}`, `http://127.0.0.1:${host.split(':').pop()}`, `http://localhost:${host.split(':').pop()}`].includes(request.headers.origin)) return json(response, 403, { error: '拒绝跨站请求。' });
      const pathname = new URL(request.url, `http://${host}`).pathname;
      if (pathname === '/api/status' && request.method === 'GET') return json(response, 200, live.status());
      if (pathname.startsWith('/api/')) {
        if (request.method !== 'POST') return json(response, 405, { error: '此接口仅接受 POST。' });
        if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '请使用 JSON 请求。' });
        const now = Date.now(); while (recent.length && recent[0] < now - 60000) recent.shift();
        if (recent.length >= 50) return json(response, 429, { error: '请求过于频繁，请稍后重试。' });
        recent.push(now);
        const chunks = []; let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 32768) throw new PublicError('BODY_TOO_LARGE', '请求内容过大。', 413);
          chunks.push(chunk);
        }
        let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new PublicError('INVALID_JSON', '请求不是有效 JSON。'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicError('INVALID_INPUT', '请求格式不正确。');
        const actions = {
          '/api/stations': () => live.stations(input.city),
          '/api/tickets': () => live.tickets(input),
          '/api/places': () => live.search(input),
          '/api/place': () => live.detail(input),
          '/api/weather': () => live.weather(input.city),
          '/api/plan': () => generatePlans(live, input),
        };
        if (!actions[pathname]) return json(response, 404, { error: '没有此接口。' });
        return json(response, 200, await actions[pathname]());
      }
      if (request.method !== 'GET' || !routes.has(pathname)) return json(response, 404, { error: '页面不存在。' });
      const path = routes.get(pathname);
      const content = await readFile(join(root, path));
      response.writeHead(200, { 'content-type': mime[extname(path)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      response.end(content);
    } catch (error) {
      json(response, error instanceof PublicError ? error.status : 500, { error: error instanceof PublicError ? error.message : '服务暂时无法完成请求，请稍后重试。', code: error instanceof PublicError ? error.code : 'SERVER_ERROR' });
    }
  });
  server.requestTimeout = 240000;
  return { server, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await activeGateway?.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createLiveServer();
  const port = Number(process.env.PORT) || 4173;
  app.server.listen(port, '127.0.0.1', () => console.log(`真实数据版已启动：http://127.0.0.1:${port} （Key 仅在本机后端读取）`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
