import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiRuntime } from '../server/ai-runtime.mjs';

function fakeRequest(method, body, cookie = '') {
  return { method, headers: { cookie, 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
}
function fakeResponse() {
  return { headers: {}, status: 0, data: null, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))); }, end(data) { this.data = JSON.parse(data); } };
}
async function call(runtime, method, path, body, cookie = '') {
  const response = fakeResponse();
  await runtime.handle(fakeRequest(method, body, cookie), response, path, true);
  return response;
}
async function waitFor(job) {
  for (let i = 0; i < 100 && ['queued', 'running'].includes(job.status); i++) await new Promise(resolve => setTimeout(resolve, 5));
  return job.status;
}

test('public examples and health are open, while model and query routes require an experience session', async t => {
  const priorCode = process.env.APP_ACCESS_CODE;
  process.env.APP_ACCESS_CODE = 'unit-test-code';
  const stateDir = await mkdtemp(join(tmpdir(), 'weekend-rush-quota-'));
  const runtime = createAiRuntime({ service: {}, stateDir, modelClient: { async json() { return { value: { preferences: '本地体验' } }; } } });
  t.after(async () => { runtime.close(); await rm(stateDir, { recursive: true, force: true }); if (priorCode == null) delete process.env.APP_ACCESS_CODE; else process.env.APP_ACCESS_CODE = priorCode; });

  assert.equal((await call(runtime, 'GET', '/healthz')).data.ok, true);
  assert.equal((await call(runtime, 'GET', '/api/session')).data.authenticated, false);
  assert.equal((await call(runtime, 'POST', '/api/chat', { message: '杭州去上海' })).status, 401);
  assert.equal((await call(runtime, 'POST', '/api/stations', { city: '上海' })).status, 401);
  assert.equal((await call(runtime, 'POST', '/api/session', { accessCode: 'wrong' })).status, 401);

  const login = await call(runtime, 'POST', '/api/session', { accessCode: 'unit-test-code' });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.match(login.headers['set-cookie'], /SameSite=Lax/);
  assert.equal(JSON.stringify(login.data).includes('unit-test-code'), false);

  const disabledLegacy = await call(runtime, 'POST', '/api/stations', { city: '上海' }, cookie);
  assert.equal(disabledLegacy.status, 404);

  let latestJob;
  for (let i = 0; i < 5; i++) {
    const accepted = await call(runtime, 'POST', '/api/chat', { message: `去哪里 ${i}`, fields: {} }, cookie);
    assert.equal(accepted.status, 202);
    latestJob = runtime.jobs.get(accepted.data.jobId);
    assert.equal(await waitFor(latestJob), 'complete');
    assert.equal(latestJob.result.kind, 'need-input');
  }
  const overLimit = await call(runtime, 'POST', '/api/chat', { message: '第六次' }, cookie);
  assert.equal(overLimit.status, 429);
  assert.equal(overLimit.data.code, 'DAILY_SESSION_LIMIT');

  const otherLogin = await call(runtime, 'POST', '/api/session', { accessCode: 'unit-test-code' });
  const otherCookie = otherLogin.headers['set-cookie'].split(';')[0];
  assert.equal((await call(runtime, 'GET', `/api/jobs/${latestJob.id}`, undefined, otherCookie)).status, 404);
  assert.equal((await call(runtime, 'DELETE', '/api/session', undefined, cookie)).data.cleared, true);
  assert.equal((await call(runtime, 'GET', '/api/session', undefined, cookie)).data.authenticated, false);
});

test('a full queue rejects extra jobs without consuming daily generation quota', async t => {
  const priorCode = process.env.APP_ACCESS_CODE;
  process.env.APP_ACCESS_CODE = 'unit-test-code';
  const stateDir = await mkdtemp(join(tmpdir(), 'weekend-rush-queue-'));
  let releaseModel;
  const gate = new Promise(resolve => { releaseModel = resolve; });
  const runtime = createAiRuntime({ service: {}, stateDir, modelClient: { async json() { await gate; return { value: {} }; } } });
  t.after(async () => { releaseModel(); runtime.close(); await rm(stateDir, { recursive: true, force: true }); if (priorCode == null) delete process.env.APP_ACCESS_CODE; else process.env.APP_ACCESS_CODE = priorCode; });

  const login = await call(runtime, 'POST', '/api/session', { accessCode: 'unit-test-code' });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const accepted = await Promise.all([0, 1, 2].map(index => call(runtime, 'POST', '/api/chat', { message: `任务 ${index}` }, cookie)));
  assert.ok(accepted.every(response => response.status === 202));
  const full = await call(runtime, 'POST', '/api/chat', { message: '队列已满' }, cookie);
  assert.equal(full.status, 429);
  assert.equal(full.data.code, 'JOB_QUEUE_FULL');

  releaseModel();
  for (const response of accepted) assert.equal(await waitFor(runtime.jobs.get(response.data.jobId)), 'complete');
  const quotaFile = (await readdir(stateDir)).find(name => name.startsWith('quota-'));
  const quota = JSON.parse(await readFile(join(stateDir, quotaFile), 'utf8'));
  assert.equal(quota.generations, 3);
});

test('experience-code guessing is rate limited and recovers after one minute', async t => {
  const priorCode = process.env.APP_ACCESS_CODE;
  process.env.APP_ACCESS_CODE = 'unit-test-code';
  const stateDir = await mkdtemp(join(tmpdir(), 'weekend-rush-login-'));
  let clock = Date.now();
  const runtime = createAiRuntime({ service: {}, stateDir, now: () => clock, modelClient: { async json() { return { value: {} }; } } });
  t.after(async () => { runtime.close(); await rm(stateDir, { recursive: true, force: true }); if (priorCode == null) delete process.env.APP_ACCESS_CODE; else process.env.APP_ACCESS_CODE = priorCode; });

  for (let index = 0; index < 10; index++) assert.equal((await call(runtime, 'POST', '/api/session', { accessCode: `wrong-${index}` })).status, 401);
  const limited = await call(runtime, 'POST', '/api/session', { accessCode: 'wrong-again' });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, 'LOGIN_RATE_LIMIT');
  clock += 60_001;
  assert.equal((await call(runtime, 'POST', '/api/session', { accessCode: 'unit-test-code' })).status, 200);
});
