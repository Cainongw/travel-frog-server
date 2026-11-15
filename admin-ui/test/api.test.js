import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, setToken, setSession } from '../src/api.js';

test('OAuth requests use the session cookie and CSRF token without a Bearer key',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;setSession('');});
  setSession('session-csrf');let headers;
  globalThis.fetch=async(url,options)=>{headers=options.headers;return Response.json({ok:true});};
  await api('role','frog',{body:{clover:10}});
  assert.equal(headers['X-CSRF-Token'],'session-csrf');assert.equal(headers.Authorization,undefined);
});

test('requests use a header token and encoded account without persisting credentials', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; setToken(''); });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true });
  };
  setToken('test-token-with-private-value');
  await api('account', 'frog&another=account');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token-with-private-value');
  assert.equal(request.url, '/api/admin/account?account=frog%26another%3Daccount');
  assert.equal(request.url.includes('test-token'), false);
  assert.equal(request.options.method, 'GET');
});

test('uncertain writes retain a key; successful writes allow a new intentional operation', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; setToken(''); });
  const keys = [];
  setToken('test-token');
  globalThis.fetch = async (url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    if (keys.length === 1) throw Error('Connection lost after server committed');
    return Response.json({ ok: true });
  };
  const body = { title: 'Gift', ticket: 1 };
  await assert.rejects(api('mail', 'frog', { body }), /复用请求编号/);
  await api('mail', 'frog', { body });
  await api('mail', 'frog', { body });
  assert.ok(keys[0]);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test('server errors retain the key and authorization errors are actionable', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; setToken(''); });
  const keys = [];
  setToken('test-token');
  globalThis.fetch = async (url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    return Response.json({ error: 'Service unavailable' }, { status: keys.length === 1 ? 503 : 401 });
  };
  await assert.rejects(api('postcards', 'frog', { body: { template_id: 0 } }), /Service unavailable/);
  await assert.rejects(api('postcards', 'frog', { body: { template_id: 0 } }), /重新连接/);
  assert.equal(keys[0], keys[1]);
});

test('insecure LAN contexts fall back to random bytes when randomUUID is absent', async t => {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'crypto', descriptor);
    setToken('');
  });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: array => { array.fill(42); return array; } } });
  let key;
  globalThis.fetch = async (url, options) => { key = options.headers['Idempotency-Key']; return Response.json({ ok: true }); };
  setToken('test-token');
  await api('mail', 'frog', { body: { title: 'LAN delivery' } });
  assert.equal(key, '2a'.repeat(16));
});
