import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGateway, PublicError } from './mcp-gateway.mjs';
import { createLiveService } from './live-service.mjs';

export async function runQueries(service, request) {
  const queries = request.queries ?? [request];
  if (!Array.isArray(queries) || !queries.length || queries.length > 30) throw new PublicError('QUERY_COUNT', '每批需要 1–30 项查询。');
  const results = [];
  for (const query of queries) {
    const input = query?.input ?? {};
    const actions = {
      status: () => service.status(),
      stations: () => service.stations(input.city),
      tickets: () => service.tickets(input),
      search: () => service.search(input),
      detail: () => service.detail(input),
      weather: () => service.weather(input.city),
      route: () => service.route(input.origin, input.destination, input.city, input.pace),
    };
    try {
      if (!Object.hasOwn(actions, query?.operation)) throw new PublicError('UNKNOWN_OPERATION', '未知查询类型。仅支持 status/stations/tickets/search/detail/weather/route。');
      results.push({ id: query.id ?? null, operation: query.operation, ok: true, result: await actions[query.operation]() });
    } catch (error) {
      results.push({ id: query?.id ?? null, operation: query?.operation ?? null, ok: false, code: error instanceof PublicError ? error.code : 'QUERY_FAILED', error: error instanceof PublicError ? error.message : '查询未成功，未生成替代数据。' });
    }
  }
  return { ok: results.every(row => row.ok), results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let gateway;
  try {
    const index = process.argv.indexOf('--input');
    if (index < 0 || !process.argv[index + 1]) throw new Error('缺少输入文件');
    const raw = await readFile(resolve(process.argv[index + 1]), 'utf8');
    if (Buffer.byteLength(raw) > 65536) throw new Error('输入过大');
    const request = JSON.parse(raw);
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('输入须为对象');
    gateway = createGateway();
    const result = await runQueries(createLiveService(gateway), request);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write((error instanceof PublicError ? error.message : '无法读取有效查询输入；请检查文件（最大 64 KiB）及本机依赖安装。') + '\n');
    process.exitCode = 1;
  } finally { await gateway?.close(); }
}
