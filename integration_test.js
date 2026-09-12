'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`server start timeout\n${output}`)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('SQLite archive:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`server exited with ${code}\n${output}`));
    });
  });
}

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

function protocolClient(socket) {
  let session = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', message => {
    const value = JSON.parse(message.data);
    if (value.session != null && pending.has(value.session)) {
      pending.get(value.session)(value.data);
      pending.delete(value.session);
    } else if (value.cmd) {
      events.push(value);
    }
  });
  return {
    events,
    send(cmd, data = {}) {
      const id = ++session;
      const response = new Promise(resolve => pending.set(id, resolve));
      socket.send(JSON.stringify({ session: id, timestamp: Math.floor(Date.now() / 1000), cmd, data }));
      return response;
    },
  };
}

test('persists priority-one archive data and imports an export', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-frog-server-'));
  const database = path.join(tempDir, 'archive.sqlite');
  const port = 20000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: { ...process.env, FROG_HOST: '127.0.0.1', FROG_PORT: String(port), FROG_DB: database },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode == null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await waitForServer(child);
  const socket = await openWebSocket(`ws://127.0.0.1:${port}`);
  t.after(() => socket.close());
  const protocol = protocolClient(socket);

  const token = await protocol.send('hall.gen_token', { account: 'archive-test' });
  assert.equal(token.token, 'local-archive-test');
  assert.equal((await protocol.send('hall.login', { token: token.token })).code, 0);
  assert.equal((await protocol.send('hall.enter_game')).code, 0);
  assert.equal((await protocol.send('client.load_all_info')).code, 0);
  assert.ok(protocol.events.some(event => event.cmd === 'client_load_role'));
  assert.equal(protocol.events.find(event => event.cmd === 'album_load_all').data.id_list.length, 1);

  assert.equal((await protocol.send('client.set_name', { name: 'Archive Frog' })).code, 0);
  assert.equal((await protocol.send('misc.moment_unlock', { id: 3 })).code, 0);
  assert.deepEqual((await protocol.send('misc.moment_load')).list, [3]);
  assert.equal((await protocol.send('album.delete', { id: 1 })).code, 0);
  assert.equal((await protocol.send('album.load_all')).id_list.length, 0);
  assert.equal((await protocol.send('album.load_recover')).pictures.length, 1);

  const exportedResponse = await fetch(`http://127.0.0.1:${port}/api/export?account=archive-test`);
  assert.equal(exportedResponse.status, 200);
  const exported = await exportedResponse.json();
  assert.equal(exported.account.frog_name, 'Archive Frog');
  assert.deepEqual(exported.moments, [3]);
  assert.equal(exported.postcards[0].location, 'recycle');

  exported.account = { ...exported.account, account: 'archive-copy', frog_name: 'Imported Frog' };
  exported.travel_notes = [{ id: 12, read: true, timestamp: 123456 }];
  exported.stories = [{ id: 7, partner: 2, name: 'archive story', gift: -1, feedback: -1 }];
  exported.achievements = [{ id: 5, time: 123000 }];
  exported.handbook = { collections: [101], specialtys: [201] };
  exported.encyclopedia = {
    unlock_list: [301],
    unlock_desc: [{ id: 301, list: [1, 2] }],
    show_sub: [{ id: 301, sub_id: 302 }],
  };
  exported.gift_specialties = [{ item_id: 401, count: 2 }];
  const importResponse = await fetch(`http://127.0.0.1:${port}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(exported),
  });
  assert.equal(importResponse.status, 200);
  const copied = await (await fetch(`http://127.0.0.1:${port}/api/export?account=archive-copy`)).json();
  assert.equal(copied.account.frog_name, 'Imported Frog');
  assert.deepEqual(copied.moments, [3]);
  assert.equal(copied.postcards[0].location, 'recycle');
  assert.deepEqual(copied.travel_notes, exported.travel_notes);
  assert.deepEqual(copied.stories, exported.stories);
  assert.deepEqual(copied.achievements, exported.achievements);
  assert.deepEqual(copied.handbook, exported.handbook);
  assert.deepEqual(copied.encyclopedia, exported.encyclopedia);
  assert.deepEqual(copied.gift_specialties, exported.gift_specialties);
});
