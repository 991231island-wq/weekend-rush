import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export class PublicError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function localKey() {
  if (process.env.AMAP_MAPS_API_KEY?.trim()) return process.env.AMAP_MAPS_API_KEY.trim();
  if (process.platform === 'win32') {
    try {
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('AMAP_MAPS_API_KEY','User')"], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    } catch { return ''; }
  }
  return '';
}

export function createGateway({ key = localKey() } = {}) {
  const clients = new Map();
  const cache = new Map();
  const tails = new Map();
  const lastCalls = new Map();
  let closing = false;
  const entries = { rail: '12306-mcp/build/index.js', amap: '@amap/amap-maps-mcp-server/build/index.js' };
  const safeMessage = error => {
    let value = String(error?.message ?? error);
    if (key) value = value.split(key).join('[REDACTED]');
    return value.replace(/https?:\/\/\S+/g, '[服务地址已省略]').slice(0, 250);
  };
  async function clientFor(provider) {
    if (closing) throw new PublicError('STOPPING', '服务正在停止，请重新启动。', 503);
    if (provider === 'amap' && !key) throw new PublicError('MISSING_MAP_KEY', '本机尚未配置高德 Web 服务 Key。', 503);
    if (!entries[provider]) throw new PublicError('UNKNOWN_PROVIDER', '未知数据服务。');
    if (!clients.has(provider)) {
      const promise = (async () => {
        const client = new Client({ name: 'weekend-rush', version: '0.4.0-preview' });
        const transport = new StdioClientTransport({ command: process.execPath, args: [require.resolve(entries[provider])], env: { ...getDefaultEnvironment(), ...(provider === 'amap' ? { AMAP_MAPS_API_KEY: key } : {}) }, stderr: 'pipe' });
        transport.stderr?.on('data', () => {});
        try { await client.connect(transport, { timeout: 20000 }); return { client, transport }; }
        catch (error) { await transport.close().catch(() => {}); throw error; }
      })();
      clients.set(provider, promise);
      promise.catch(() => clients.delete(provider));
    }
    return clients.get(provider);
  }
  function queue(provider, task) {
    const next = (tails.get(provider) ?? Promise.resolve()).catch(() => {}).then(task);
    tails.set(provider, next);
    return next;
  }
  async function call(provider, name, args, ttlMs = 60000) {
    const cacheKey = JSON.stringify([provider, name, args]);
    const previous = cache.get(cacheKey);
    if (previous && Date.now() < previous.expiresAt) return { ...await previous.promise, cacheHit: true };
    const promise = queue(provider, async () => {
      try {
        const { client } = await clientFor(provider);
        const delay = provider === 'amap' ? Math.max(0, (lastCalls.get(provider) ?? 0) + 1100 - Date.now()) : 0;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        lastCalls.set(provider, Date.now());
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
        const text = (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
        if (result.isError || /^Error:|failed:/i.test(text.trim())) {
          if (/USERKEY|INVALID_USER|INSUFFICIENT|SERVICE_NOT_AVAILABLE/.test(text)) throw new PublicError('MAP_AUTH', '高德拒绝请求，请检查 Key 平台类型、权限与额度。', 502);
          if (/LIMIT|QPS/.test(text)) throw new PublicError('QUOTA', '数据服务额度或访问频率受限，请稍后再试。', 429);
          throw new PublicError('TOOL_FAILURE', `${provider === 'rail' ? '12306' : '高德'}查询失败：${safeMessage(text)}`, 502);
        }
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        return { data, source: provider === 'rail' ? '12306 MCP 0.3.10' : '高德 MCP 0.0.8', tool: name, queriedAt: new Date().toISOString(), cacheHit: false };
      } catch (error) {
        if (error instanceof PublicError) throw error;
        throw new PublicError('NETWORK_OR_TOOL', `${provider === 'rail' ? '12306' : '高德'}暂时无法连接，请稍后重试。`, 502);
      }
    });
    cache.set(cacheKey, { promise, expiresAt: Date.now() + ttlMs });
    promise.catch(() => cache.delete(cacheKey));
    if (cache.size > 250) cache.delete(cache.keys().next().value);
    return promise;
  }
  return {
    call,
    status: () => ({ mapKeyConfigured: Boolean(key), providers: { rail: '12306-mcp@0.3.10', amap: '@amap/amap-maps-mcp-server@0.0.8' } }),
    async close() {
      closing = true;
      await Promise.allSettled([...clients.values()].map(async promise => { const { client } = await promise; await client.close(); }));
      cache.clear();
    },
  };
}
