import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelScopeClient } from '../server/modelscope-client.mjs';

test('ModelScope client sends the token only as a bearer header and supports function tool responses', async () => {
  let sent;
  const client = createModelScopeClient({ token: 'local-test-secret', fetchImpl: async (url, options) => {
    sent = { url, options };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup_station', arguments: '{"city":"杭州"}' } }] } }] });
  } });
  const result = await client.complete([{ role: 'user', content: '查询车站' }], { request: { tools: [{ type: 'function', function: { name: 'lookup_station' } }] } });
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.message.tool_calls[0].function.name, 'lookup_station');
  assert.equal(sent.url, 'https://api-inference.modelscope.cn/v1/chat/completions');
  assert.equal(sent.options.headers.authorization, 'Bearer local-test-secret');
  assert.equal(sent.options.redirect, 'manual');
  assert.equal(JSON.stringify(sent.options.body).includes('local-test-secret'), false);
});

test('ModelScope client parses JSON responses and rejects endpoint redirects without exposing response details', async () => {
  const client = createModelScopeClient({ token: 'test', fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"city":"杭州"}' }, finish_reason: 'stop' }] }) });
  assert.deepEqual((await client.json([{ role: 'user', content: '给 JSON' }])).value, { city: '杭州' });
  const redirect = createModelScopeClient({ token: 'test', fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://attacker.invalid/' } }) });
  await assert.rejects(redirect.complete([]), error => error.code === 'MODEL_REDIRECT_REJECTED' && !error.message.includes('attacker'));
  assert.throws(() => createModelScopeClient({ token: 'test', baseUrl: 'http://localhost:9999' }), error => error.code === 'INVALID_MODEL_ENDPOINT');
});

test('ModelScope errors do not relay raw upstream bodies to the browser', async () => {
  const client = createModelScopeClient({ token: 'secret-token', fetchImpl: async () => new Response('{"error":{"message":"secret-token internal trace"}}', { status: 429 }) });
  await assert.rejects(client.complete([]), error => error.code === 'MODEL_RATE_LIMIT' && !error.message.includes('secret-token'));
});
