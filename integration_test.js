'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const { FrogDatabase } = require('./database');
const { TRAVEL_ROUTES, selectTrip, makePostcard } = require('./travel_data');

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

function waitForProtocolEvent(protocol, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const event = protocol.events.find(predicate);
      if (event) {
        clearInterval(timer);
        resolve(event);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('protocol event timeout'));
      }
    }, 20);
  });
}

test('persists archive and basic gameplay state through export and import', async t => {
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
  assert.equal(protocol.events.find(event => event.cmd === 'clover_load_clovers').data.length, 20);
  assert.equal(protocol.events.find(event => event.cmd === 'mail_load').data.length, 1);
  assert.deepEqual(protocol.events.find(event => event.cmd === 'weather_load').data, { season: 4, hours_type: 1, weather: 0 });

  assert.equal((await protocol.send('client.set_name', { name: 'Archive Frog' })).code, 0);
  assert.equal((await protocol.send('misc.moment_unlock', { id: 3 })).code, 0);
  assert.deepEqual((await protocol.send('misc.moment_load')).list, [3]);
  assert.equal((await protocol.send('album.delete', { id: 1 })).code, 0);
  assert.equal((await protocol.send('album.load_all')).id_list.length, 0);
  assert.equal((await protocol.send('album.load_recover')).pictures.length, 1);

  assert.equal((await protocol.send('mail.open', { id: 9000001 })).code, 0);
  let itemState = await protocol.send('item.load_items');
  assert.deepEqual(itemState.house, [{ item_id: 0, count: 1 }]);
  assert.equal((await protocol.send('item.buy', { shop_id: 0 })).code, 0);
  itemState = await protocol.send('item.load_items');
  assert.deepEqual(itemState.house, [{ item_id: 0, count: 2 }]);
  assert.equal((await protocol.send('item.putin_bag', { pos: 1, item_id: 0 })).code, 0);
  itemState = await protocol.send('item.load_items');
  assert.equal(itemState.bag[0], 0);
  assert.deepEqual(itemState.house, [{ item_id: 0, count: 1 }]);
  assert.equal((await protocol.send('item.putin_desk', { pos: 1, item_id: 0 })).code, 0);
  itemState = await protocol.send('item.load_items');
  assert.equal(itemState.desk[0], 0);
  assert.deepEqual(itemState.house, []);
  assert.equal((await protocol.send('clover.harvest', { clover_id: 1 })).code, 0);
  assert.equal((await protocol.send('mail.load')).length, 0);

  const weatherResponse = await fetch(`http://127.0.0.1:${port}/api/weather?account=archive-test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ season: 2, hours_type: 3, weather: 1 }),
  });
  assert.deepEqual(await weatherResponse.json(), { season: 2, hours_type: 3, weather: 1 });

  const exportedResponse = await fetch(`http://127.0.0.1:${port}/api/export?account=archive-test`);
  assert.equal(exportedResponse.status, 200);
  const exported = await exportedResponse.json();
  assert.equal(exported.version, 3);
  assert.equal(exported.account.frog_name, 'Archive Frog');
  assert.deepEqual(exported.moments, [3]);
  assert.equal(exported.postcards[0].location, 'recycle');
  assert.equal(exported.account.clover, 491);
  assert.equal(exported.items.bag[0], 0);
  assert.equal(exported.items.desk[0], 0);
  assert.deepEqual(exported.items.house, []);
  assert.deepEqual(exported.shop_purchases, [{ item_id: 0, count: 1 }]);
  assert.ok(exported.clover_plots[0].last_harvest > 0);
  assert.equal(exported.mails[0].opened, true);
  assert.deepEqual(exported.weather, { season: 2, hours_type: 3, weather: 1 });

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
  assert.equal(copied.account.clover, 491);
  assert.equal(copied.items.bag[0], 0);
  assert.equal(copied.items.desk[0], 0);
  assert.deepEqual(copied.items.house, []);
  assert.deepEqual(copied.shop_purchases, [{ item_id: 0, count: 1 }]);
  assert.equal(copied.mails[0].opened, true);
  assert.deepEqual(copied.weather, { season: 2, hours_type: 3, weather: 1 });
});

test('runs a persistent travel loop and settles native client rewards', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-frog-trip-'));
  const database = path.join(tempDir, 'archive.sqlite');
  const port = 20000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      FROG_HOST: '127.0.0.1',
      FROG_PORT: String(port),
      FROG_DB: database,
      FROG_TRIP_SECONDS: '1',
    },
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
  const token = await protocol.send('hall.gen_token', { account: 'trip-test' });
  await protocol.send('hall.login', { token: token.token });
  await protocol.send('client.load_all_info');
  await protocol.send('mail.open', { id: 9000001 });
  await protocol.send('item.putin_bag', { pos: 1, item_id: 0 });

  const startIndex = protocol.events.length;
  assert.equal((await protocol.send('item.set_bag_completed', { completed: true })).code, 0);
  const startEvents = protocol.events.slice(startIndex);
  assert.equal(startEvents.find(event => event.cmd === 'client_load_role').data.frog.status, 1);
  const goTravel = startEvents.find(event => event.cmd === 'notify_new_event').data.event;
  assert.equal(goTravel.evt_type, 1);

  const backHomeMessage = await waitForProtocolEvent(protocol,
    event => event.cmd === 'notify_new_event' && event.data.event.evt_type === 2);
  assert.deepEqual(backHomeMessage.data.event.evt_value.slice(0, 5), [0, 0, 0, 0, -1]);
  assert.equal(protocol.events.filter(event => event.cmd === 'client_load_role').at(-1).data.frog.status, 0);
  assert.equal(protocol.events.filter(event => event.cmd === 'album_load_new').at(-1).data.pictures.length, 1);
  assert.equal(protocol.events.filter(event => event.cmd === 'notify_new_mail').at(-1).data.mail.type, 11);
  assert.equal(protocol.events.filter(event => event.cmd === 'travel_load_note').at(-1).data.note_list[0].id, 1000);
  assert.deepEqual(protocol.events.filter(event => event.cmd === 'item_load_handbook').at(-1).data.specialtys, [3000]);

  await protocol.send('client.confirm_event', { id: goTravel.id });
  await protocol.send('client.confirm_event', { id: backHomeMessage.data.event.id });
  const exported = await (await fetch(`http://127.0.0.1:${port}/api/export?account=trip-test`)).json();
  assert.equal(exported.version, 3);
  assert.equal(exported.account.trip_count, 1);
  assert.equal(exported.account.frog_status, 0);
  assert.equal(exported.travel.current, null);
  assert.deepEqual(exported.travel.events, []);
  assert.equal(exported.postcards.find(item => item.location === 'new').pic_id, 100);
  assert.equal(exported.mails.find(item => item.type === 11).pictures[0], 2);
  assert.equal(exported.items.bag[0], -1);
  assert.equal(exported.items.house.find(item => item.item_id === 3000).count, 1);
});

test('settles an elapsed trip after the SQLite archive is reopened', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-frog-offline-'));
  const filename = path.join(tempDir, 'archive.sqlite');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const seed = [{ id: 1, pic_id: 100, layers: [{ layer: [1, 0, 0] }] }];

  let database = new FrogDatabase(filename, seed);
  database.ensureAccount('offline-test');
  database.changeInventory('offline-test', 0, 1);
  database.placeItem('offline-test', 'bag', 1, 0);
  database.setBagCompleted('offline-test', true);
  const selection = selectTrip(1);
  assert.equal(database.startTravel('offline-test', selection.route, selection.companionId, 60, 100).ok, true);
  database.close();

  database = new FrogDatabase(filename, seed);
  const result = database.advanceTravel('offline-test', TRAVEL_ROUTES, makePostcard, 161);
  assert.ok(result);
  assert.equal(database.getRole('offline-test').frog.status, 0);
  assert.equal(database.getPostcards('offline-test', 'new').length, 1);
  assert.equal(database.getTravelState('offline-test'), null);
  database.close();
});
