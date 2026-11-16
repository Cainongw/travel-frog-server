'use strict';
const { PROJECT_ROOT } = require("../src/paths");


const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const { loadCatalog } = require('../src/core/catalog');

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error(`Server start timed out: ${output}`)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('SQLite archive:')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Server exited (${code}): ${output}`)); });
  });
}

function protocolClient(socket) {
  const pending = new Map(), events = [];
  let session = 0;
  socket.addEventListener('message', message => {
    const response = JSON.parse(message.data);
    if (response.cmd) events.push(response);
    else if (pending.has(response.session)) {
      const item = pending.get(response.session);
      clearTimeout(item.timer);
      pending.delete(response.session);
      item.resolve(response.data);
    }
  });
  return {
    events,
    send(cmd, data = {}) {
      const id = ++session;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`No response for ${cmd}`)); }, 4000);
        pending.set(id, { resolve, timer });
      });
      socket.send(JSON.stringify({ session: id, cmd, data }));
      return promise;
    },
  };
}

test('WebSocket gacha returns rank separately from wallet pushes and redeems exactly once', { timeout: 20000 }, async t => {
  const catalog = loadCatalog();
  if (!catalog.available) return t.skip('APK assets not provided');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-gacha-protocol-'));
  const port = await freePort();
  const token = 'gacha-protocol-integration-test-token';
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server.js')], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FROG_HOST: '127.0.0.1', FROG_PORT: String(port), FROG_DB: path.join(temp, 'gacha.sqlite'), FROG_ADMIN_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let socket;
  t.after(async () => {
    socket?.close();
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitForServer(child);
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const client = protocolClient(socket);
  await client.send('hall.login', { token: 'local-protocol-gacha' });
  await client.send('client.load_all_info');
  const update = await fetch(`${base}/api/admin/role?account=protocol-gacha`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': 'gacha-test-wallet' },
    body: JSON.stringify({ ticket: 10 }),
  });
  assert.equal(update.status, 200);
  client.events.length = 0;

  const draw = await client.send('item.gacha', { is_reward: false });
  assert.equal(draw.code, 0);
  assert.ok(Number.isInteger(draw.ticket) && draw.ticket >= 0 && draw.ticket <= 5);
  assert.equal(client.events.filter(e => e.cmd === 'item_update_ticket').at(-1).data.ticket, 5);
  const same = await client.send('item.gacha', { is_reward: false });
  assert.equal(same.ticket, draw.ticket);
  assert.equal(client.events.filter(e => e.cmd === 'item_update_ticket').at(-1).data.ticket, 5);

  const wrongPrize = catalog.prizes.find(prize => prize.rank !== draw.ticket);
  assert.equal((await client.send('item.redeem_prize', { prize_id: wrongPrize.id })).code, 1);
  const chosen = catalog.prizes.find(prize => prize.rank === draw.ticket);
  // The actual client redeems without a session. A following inventory request
  // is a barrier proving that the server has processed that one-way message.
  socket.send(JSON.stringify({ cmd: 'item.redeem_prize', data: { prize_id: chosen.id } }));
  assert.equal((await client.send('item.load_items')).gacha.color_ball, -1);
  const balance = draw.ticket === 0 ? 5 + chosen.stock : 5;
  assert.equal(client.events.filter(e => e.cmd === 'item_update_ticket').at(-1).data.ticket, balance);
  if (draw.ticket !== 0) {
    const item = client.events.filter(e => e.cmd === 'item_update' && e.data.item.item_id === chosen.itemId).at(-1);
    assert.deepEqual(item.data.item, { item_id: chosen.itemId, count: chosen.stock });
  }
  assert.equal((await client.send('item.redeem_prize', { prize_id: chosen.id })).code, 1);
  const snapshot = await (await fetch(`${base}/api/admin/export?account=protocol-gacha`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  assert.equal(snapshot.account.ticket, balance);
  assert.equal(snapshot.items.gacha.color_ball, -1);
  assert.equal(snapshot.items.gacha.draw_count, 1);
  if (draw.ticket !== 0) assert.equal(snapshot.items.house.find(item => item.item_id === chosen.itemId).count, chosen.stock);
  assert.equal((await client.send('item.gacha', { is_reward: true })).code, 1);
});
