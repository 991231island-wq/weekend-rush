import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicError } from './mcp-gateway.mjs';
import { createModelScopeClient } from './modelscope-client.mjs';
import { applyAdjustment, generateIntentPlans } from './intent-agent.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sessionTtlMs = 2 * 60 * 60 * 1000;
const stageLabel = value => String(value).slice(0, 100);
const shanghaiDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const cookieName = 'weekend_rush_session';

function safeCompare(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function defaultStateDir() {
  return process.env.APP_STATE_DIR || (process.platform === 'linux' ? '/mnt/workspace/weekend-rush-state' : join(root, '.cache', 'runtime-state'));
}

function intentQuestions(missing) {
  const labels = { originCity: '出发城市', destinationCity: '目的城市', departureDate: '出发日期', returnDate: '返程日期' };
  return `还差${missing.map(key => labels[key] ?? key).join('、')}。请一次告诉我，例如：“广州白云区到武汉，10 月 17 日去、18 日回。”`;
}

export function createAiRuntime({ service, gateway, modelClient, stateDir = defaultStateDir(), publicOrigin = process.env.PUBLIC_ORIGIN || '', now = () => Date.now() } = {}) {
  const sessions = new Map();
  const jobs = new Map();
  const trips = new Map();
  const waitQueue = [];
  const loginFailures = [];
  let activeJobs = 0;
  let pendingStarts = 0;
  const jobContext = new AsyncLocalStorage();
  const runtimeModel = modelClient ?? createModelScopeClient({ beforeRequest: async () => jobContext.getStore()?.consumeModel() ?? Promise.reject(new PublicError('MODEL_CONTEXT_MISSING', '模型请求缺少有效会话。', 401)) });
  gateway?.setCallGuard?.(async () => {
    const context = jobContext.getStore();
    if (!context) return;
    context.check();
    context.toolCalls++;
    if (context.toolCalls > 60) throw new PublicError('TOOL_LIMIT', '本次查询触及数据工具上限，原有行程已保留。', 429);
  });
  const expectedOrigin = publicOrigin ? new URL(publicOrigin).origin : '';

  let quotaMemory;
  let quotaTail = Promise.resolve();
  async function loadQuota() {
    if (quotaMemory) return quotaMemory;
    const day = shanghaiDay();
    const path = join(stateDir, `quota-${day}.json`);
    await mkdir(stateDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      if (parsed.day !== day || !Number.isInteger(parsed.generations) || !Number.isInteger(parsed.modelRequests) || !parsed.sessions || typeof parsed.sessions !== 'object') throw new Error('quota state shape mismatch');
      quotaMemory = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new PublicError('QUOTA_STATE_UNAVAILABLE', '额度记录不可读取，已暂停真实查询。请检查持久化目录。', 503);
      quotaMemory = { day, generations: 0, modelRequests: 0, sessions: {} };
      await saveQuota(quotaMemory);
    }
    return quotaMemory;
  }
  async function saveQuota(data) {
    const path = join(stateDir, `quota-${data.day}.json`);
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, path);
  }
  async function updateQuota(change) {
    const operation = quotaTail.then(async () => {
      const data = await loadQuota();
      const next = structuredClone(data);
      await change(next);
      await saveQuota(next);
      quotaMemory = next;
      return next;
    });
    quotaTail = operation.catch(() => {});
    try { return await operation; }
    catch (error) {
      if (error instanceof PublicError) throw error;
      quotaMemory = undefined;
      throw new PublicError('QUOTA_STATE_UNAVAILABLE', '额度记录不可写，已暂停真实查询。请检查持久化目录。', 503);
    }
  }
  const sessionDigest = session => createHash('sha256').update(session.cookieToken).digest('hex');
  async function reserveGeneration(session) {
    const digest = sessionDigest(session);
    await updateQuota(data => {
      if (data.generations >= 20) throw new PublicError('DAILY_SITE_LIMIT', '今天的全站真实规划次数已用完，请明天再试。', 429);
      if ((data.sessions[digest] ?? 0) >= 5) throw new PublicError('DAILY_SESSION_LIMIT', '这个体验会话今天已使用 5 次真实规划。你仍可查看固定示例。', 429);
      data.generations++;
      data.sessions[digest] = (data.sessions[digest] ?? 0) + 1;
    });
  }
  async function reserveModelRequest() {
    await updateQuota(data => {
      if (data.modelRequests >= 100) throw new PublicError('DAILY_MODEL_LIMIT', '今天的模型调用额度已用完，请明天再试。', 429);
      data.modelRequests++;
    });
  }

  function tokenFromRequest(request) {
    const header = request.headers.cookie ?? '';
    const match = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
    return match?.slice(cookieName.length + 1) ?? '';
  }
  function sessionFor(request) {
    const token = tokenFromRequest(request);
    const session = sessions.get(token);
    if (!session) return null;
    if (session.deleted || now() - session.lastSeen > sessionTtlMs) { sessions.delete(token); return null; }
    session.lastSeen = now();
    return session;
  }
  function setCookie(response, token, maxAge = 7200) {
    const secure = expectedOrigin.startsWith('https://') ? '; Secure' : '';
    response.setHeader('set-cookie', `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`);
  }
  function refreshCookie(response, session) { setCookie(response, session.cookieToken); }
  async function readBody(request) {
    let total = 0; const chunks = [];
    for await (const chunk of request) {
      total += chunk.length;
      if (total > 32768) throw new PublicError('BODY_TOO_LARGE', '请求内容过大。', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new PublicError('INVALID_JSON', '请求不是有效 JSON。'); }
  }
  function send(response, status, data, extraHeaders = {}) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extraHeaders });
    response.end(JSON.stringify(data));
  }
  function ownsTrip(session, id) {
    const trip = trips.get(id);
    return trip && trip.sessionToken === session.cookieToken ? trip : null;
  }
  function viewTrip(trip) {
    return { id: trip.id, currentVersion: trip.currentVersion, current: trip.plans, versions: trip.history };
  }
  function queueJob(job, run) {
    if (activeJobs >= 1 && waitQueue.length >= 2) throw new PublicError('JOB_QUEUE_FULL', '当前有 1 个任务运行、2 个任务排队，请稍后重试。', 429);
    waitQueue.push({ job, run });
    void pumpQueue();
  }
  async function pumpQueue() {
    if (activeJobs >= 1 || !waitQueue.length) return;
    activeJobs++;
    const { job, run } = waitQueue.shift();
    job.status = 'running'; job.stage = '整理需求';
    try { await run(); }
    finally { activeJobs--; void pumpQueue(); }
  }
  function findLatestTrip(session) {
    return session.activeTripId ? ownsTrip(session, session.activeTripId) : null;
  }
  function createJob(session) {
    const id = randomUUID();
    const job = { id, sessionToken: session.cookieToken, status: 'queued', stage: '排队中', createdAt: new Date(now()).toISOString(), result: null, error: null, cancelled: false };
    jobs.set(id, job); session.jobIds.add(id); return job;
  }
  async function startChat(session, body) {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const existing = body.tripId ? ownsTrip(session, body.tripId) : null;
    if (body.tripId && !existing) throw new PublicError('TRIP_NOT_FOUND', '没有找到本会话中的这份行程。', 404);
    if (existing && Number(body.baseVersion) !== existing.currentVersion) throw new PublicError('STALE_VERSION', '这份行程已有更新版本。请刷新后再提交修改。', 409);
    if (!message && !eventId) throw new PublicError('INVALID_MESSAGE', '请先描述你想去哪里，或说说希望怎么调整。');
    if (activeJobs + waitQueue.length + pendingStarts >= 3) throw new PublicError('JOB_QUEUE_FULL', '当前有 1 个任务运行、2 个任务排队，请稍后重试。', 429);
    pendingStarts++;
    try {
      await reserveGeneration(session);
      const job = createJob(session);
      const jobDeadline = now() + 6 * 60 * 1000;
      queueJob(job, async () => {
        const context = {
          toolCalls: 0, modelCalls: 0, deadline: jobDeadline, job,
          check() { if (job.cancelled || !sessions.has(session.cookieToken)) throw new PublicError('JOB_CANCELLED', '会话已结束，任务已取消。', 409); if (now() > jobDeadline) throw new PublicError('JOB_TIMEOUT', '本次规划超过 6 分钟上限，原有行程已保留。', 504); },
          async consumeModel() { this.check(); this.modelCalls++; if (this.modelCalls > 12) throw new PublicError('MODEL_JOB_LIMIT', '本次任务达到 12 次模型请求上限。', 429); await reserveModelRequest(); },
        };
        const withProgress = async label => { context.check(); job.stage = stageLabel(label); job.updatedAt = new Date(now()).toISOString(); };
        const guardedService = new Proxy(service, { get(target, key) { const value = target[key]; if (typeof value !== 'function') return value; return async (...args) => { context.check(); const result = await value.apply(target, args); context.check(); return result; }; } });
        try {
          await jobContext.run(context, async () => {
            if (existing) {
              const result = await applyAdjustment({ service: guardedService, client: runtimeModel, trip: existing, message, eventId, onProgress: withProgress });
              if (!sessions.has(session.cookieToken)) throw new PublicError('JOB_CANCELLED', '会话已结束，任务已取消。', 409);
              job.result = { kind: 'trip', tripId: existing.id, version: result.version, trip: viewTrip(existing) };
            } else {
              const generated = await generateIntentPlans({ service: guardedService, client: runtimeModel, input: { message, fields: body.fields ?? {} }, onProgress: withProgress });
              if (generated.kind === 'need-input') {
                job.result = { kind: 'need-input', intent: generated.intent, missing: generated.missing, question: generated.question || intentQuestions(generated.missing) };
              } else {
                generated.plans.version = 1;
                generated.plans.previousVersion = null;
                const trip = { id: randomUUID(), sessionToken: session.cookieToken, currentVersion: 1, rawPlanInput: generated.rawPlanInput, plans: generated.plans, history: [structuredClone(generated.plans)] };
                if (!sessions.has(session.cookieToken)) throw new PublicError('JOB_CANCELLED', '会话已结束，任务已取消。', 409);
                trips.set(trip.id, trip); session.activeTripId = trip.id;
                job.result = { kind: 'trip', tripId: trip.id, version: 1, trip: viewTrip(trip) };
              }
            }
            job.status = 'complete'; job.stage = '已完成'; job.updatedAt = new Date(now()).toISOString();
          });
        } catch (error) {
          job.status = error.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed';
          job.error = error instanceof PublicError ? { code: error.code, message: error.message } : { code: 'PLANNING_FAILED', message: '规划暂时失败；旧版本仍然保留，请稍后重试。' };
          job.stage = job.status === 'cancelled' ? '已取消' : '未完成'; job.updatedAt = new Date(now()).toISOString();
        }
      });
      return job;
    } finally { pendingStarts--; }
  }

  async function handle(request, response, pathname, aiOnly = process.env.AI_ONLY_MODE === '1') {
    if (pathname === '/healthz' && request.method === 'GET') { send(response, 200, { ok: true, service: 'weekend-rush-web' }); return true; }
    if (!pathname.startsWith('/api/')) return false;
    try {
      if (pathname === '/api/status' && request.method === 'GET') { send(response, 200, { today: shanghaiDay(), aiEnabled: true }); return true; }
      if (pathname === '/api/session' && request.method === 'GET') {
        const session = sessionFor(request);
        if (!session) { send(response, 200, { authenticated: false, activeTripId: null }); return true; }
        refreshCookie(response, session); send(response, 200, { authenticated: true, activeTripId: session.activeTripId }); return true;
      }
      if (pathname === '/api/session' && request.method === 'POST') {
        const current = sessionFor(request); if (current) { refreshCookie(response, current); send(response, 200, { authenticated: true, activeTripId: current.activeTripId }); return true; }
        const body = await readBody(request); const expected = process.env.APP_ACCESS_CODE;
        if (!expected) throw new PublicError('ACCESS_CODE_NOT_CONFIGURED', '体验码尚未配置，真实生成暂未开放。', 503);
        const cutoff = now() - 60_000;
        while (loginFailures.length && loginFailures[0] < cutoff) loginFailures.shift();
        if (loginFailures.length >= 10) throw new PublicError('LOGIN_RATE_LIMIT', '体验码尝试次数过多，请一分钟后重试。', 429);
        if (!safeCompare(body.accessCode, expected)) { loginFailures.push(now()); throw new PublicError('INVALID_ACCESS_CODE', '体验码不正确，请检查后重试。', 401); }
        loginFailures.length = 0;
        const cookieToken = randomBytes(32).toString('base64url');
        const session = { cookieToken, lastSeen: now(), activeTripId: null, jobIds: new Set(), deleted: false };
        sessions.set(cookieToken, session); setCookie(response, cookieToken);
        send(response, 200, { authenticated: true, activeTripId: null }); return true;
      }
      const session = sessionFor(request);
      if (pathname === '/api/session' && request.method === 'DELETE') {
        if (session) {
          session.deleted = true;
          for (const id of session.jobIds) { const job = jobs.get(id); if (job && ['queued', 'running'].includes(job.status)) job.cancelled = true; }
          for (const [id, trip] of trips) if (trip.sessionToken === session.cookieToken) trips.delete(id);
          sessions.delete(session.cookieToken);
        }
        setCookie(response, '', 0); send(response, 200, { cleared: true }); return true;
      }
      if (!session) throw new PublicError('AUTH_REQUIRED', '请先输入体验码。', 401);
      refreshCookie(response, session);
      if (pathname === '/api/chat' && request.method === 'POST') {
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError('INVALID_INPUT', '请求格式不正确。');
        const job = await startChat(session, body);
        send(response, 202, { jobId: job.id, status: job.status }); return true;
      }
      const jobMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/i);
      if (jobMatch && request.method === 'GET') {
        const job = jobs.get(jobMatch[1]);
        if (!job || job.sessionToken !== session.cookieToken) throw new PublicError('JOB_NOT_FOUND', '没有找到本会话中的任务。', 404);
        send(response, 200, { id: job.id, status: job.status, stage: job.stage, result: job.result, error: job.error }); return true;
      }
      const tripMatch = pathname.match(/^\/api\/trips\/([0-9a-f-]{36})$/i);
      if (tripMatch && request.method === 'GET') {
        const trip = ownsTrip(session, tripMatch[1]);
        if (!trip) throw new PublicError('TRIP_NOT_FOUND', '没有找到本会话中的行程。', 404);
        session.activeTripId = trip.id; send(response, 200, viewTrip(trip)); return true;
      }
      if (aiOnly && ['/api/stations', '/api/tickets', '/api/places', '/api/place', '/api/around', '/api/route', '/api/weather', '/api/plan'].includes(pathname)) {
        throw new PublicError('AI_ONLY_MODE', '本部署仅开放受额度保护的 AI 规划接口。', 404);
      }
      return false;
    } catch (error) {
      const publicError = error instanceof PublicError ? error : new PublicError('SERVER_ERROR', '服务暂时无法完成请求。', 500);
      send(response, publicError.status, { error: publicError.message, code: publicError.code }); return true;
    }
  }

  return { handle, sessions, jobs, trips, model: runtimeModel, close() { gateway?.setCallGuard?.(null); sessions.clear(); jobs.clear(); trips.clear(); waitQueue.length = 0; } };
}
