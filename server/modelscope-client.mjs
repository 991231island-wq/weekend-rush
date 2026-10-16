import { execFileSync } from 'node:child_process';
import { PublicError } from './mcp-gateway.mjs';

const DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1';
const DEFAULT_MODEL = 'Qwen/Qwen3.5-35B-A3B';
let windowsUserToken;

function configuredToken() {
  const token = process.env.MODELSCOPE_INFERENCE_TOKEN?.trim() || process.env.MODELSCOPE_API_TOKEN?.trim();
  if (token) return token;
  if (process.platform !== 'win32') return '';
  if (windowsUserToken !== undefined) return windowsUserToken;
  try {
    windowsUserToken = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('MODELSCOPE_API_TOKEN','User')"], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
  } catch { windowsUserToken = ''; }
  return windowsUserToken;
}

export function createModelScopeClient({ token = configuredToken(), model = process.env.LLM_MODEL || DEFAULT_MODEL, baseUrl = process.env.LLM_BASE_URL || DEFAULT_BASE_URL, fetchImpl = fetch, beforeRequest = async () => {}, timeoutMs = 90000 } = {}) {
  let requestCount = 0;
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api-inference.modelscope.cn' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new PublicError('INVALID_MODEL_ENDPOINT', '魔搭推理地址必须是官方 HTTPS API 地址。', 500);
  }
  const endpointUrl = `${endpoint.href.replace(/\/$/, '')}/chat/completions`;

  async function complete(messages, options = {}) {
    if (!token) throw new PublicError('MODEL_NOT_CONFIGURED', '服务端尚未配置魔搭推理凭证。', 503);
    await beforeRequest();
    requestCount++;
    let response;
    try {
      response = await fetchImpl(endpointUrl, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(Math.min(timeoutMs, options.timeoutMs ?? timeoutMs)),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1800, ...options.request }),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new PublicError('MODEL_TIMEOUT', '模型响应超时，请稍后重试；已有行程不会丢失。', 504);
      throw new PublicError('MODEL_UNAVAILABLE', '暂时无法连接魔搭模型，请稍后重试。', 503);
    }
    if (response.status >= 300 && response.status < 400) throw new PublicError('MODEL_REDIRECT_REJECTED', '模型服务返回了非预期跳转，已停止发送凭证。', 502);
    let data;
    try { data = await response.json(); } catch { throw new PublicError('MODEL_BAD_RESPONSE', '模型服务返回内容无法解析。', 502); }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : 502;
      const code = response.status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_REQUEST_FAILED';
      const message = response.status === 429 ? '魔搭模型调用额度或频率已到限制，请稍后重试。' : '魔搭模型请求失败，请检查模型权限和服务状态。';
      throw new PublicError(code, message, status);
    }
    const choice = data.choices?.[0];
    if (!choice?.message) throw new PublicError('MODEL_EMPTY_RESPONSE', '模型未返回可用内容。', 502);
    return { message: choice.message, finishReason: choice.finish_reason ?? null, responseId: data.id ?? null, model: data.model ?? model };
  }

  async function json(messages, options = {}) {
    const result = await complete(messages, { ...options, request: { response_format: { type: 'json_object' }, ...options.request } });
    const text = typeof result.message.content === 'string' ? result.message.content : '';
    try { return { ...result, value: JSON.parse(text) }; }
    catch { throw new PublicError('MODEL_INVALID_JSON', '模型返回格式不正确；请重试，原有行程已保留。', 502); }
  }

  return { complete, json, get requestCount() { return requestCount; }, model, endpoint: endpoint.origin };
}

export { DEFAULT_MODEL, DEFAULT_BASE_URL };
