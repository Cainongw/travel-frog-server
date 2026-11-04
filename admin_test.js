'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { FrogDatabase } = require('./database');
const { TRAVEL_ROUTES } = require('./travel_data');
const { loadCatalog } = require('./catalog');

const TOKEN = 'test-only-admin-token-not-for-deployment';

// Generated fixtures keep the tests usable without redistributing APK artwork.
function createAssets(directory) {
  const root = path.join(directory, 'assets');
  fs.mkdirSync(path.join(root, 'eab'), { recursive: true });
  fs.mkdirSync(path.join(root, 'images', 'Picture', 'Test'), { recursive: true });
  const resources = {};
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
  for (const route of TRAVEL_ROUTES) {
    for (const id of [...route.back, ...route.front, route.frog[0], ...route.companions.map(x => x[0])]) {
      resources[id] = `Picture/Test/r${id}`;
      fs.writeFileSync(path.join(root, 'images', `${resources[id]}.png`), png);
    }
  }
  const entries = {
    Item_json: [0, 1000, 2000, 3000].map(id => ({ id, name: `Test item ${id}`, type: id === 3000 ? 3 : 0 })),
    Picture_json: TRAVEL_ROUTES.map(x => ({ id: x.picId, name: x.destination })),
    Note_json: { 1000: { id: 1000, type: 1 }, 1001: { id: 1001, type: 1 } },
    resources_json: resources,
    Prize_json: [{ id: 0, itemId: -1, rank: 0, stock: 1 }],
  };
  const payloads = Object.entries(entries).map(([name, value]) => ({ name, bytes: Buffer.from(JSON.stringify(value)) }));
  const metadata = Buffer.from(JSON.stringify(payloads.map(x => ({ n: x.name, t: 'json', s: x.bytes.length }))));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(metadata.length);
  fs.writeFileSync(path.join(root, 'eab', 'config.eab'), Buffer.concat([
    Buffer.from('894541420d0a1a0a', 'hex'), length, metadata, ...payloads.map(x => x.bytes),
  ]));
  return root;
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function startServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-admin-test-'));
  const port = await freePort();
  const sockets = new Set();
  const assets = createAssets(directory);
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: { ...process.env, FROG_HOST: '127.0.0.1', FROG_PORT: String(port), FROG_DB: path.join(directory, 'test.sqlite'),
      FROG_ADMIN_TOKEN: TOKEN, FROG_ASSETS: assets, FROG_TRIP_SECONDS: '3600', FROG_VISIT_SECONDS: '60' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', bytes => { output += bytes; });
  t.after(async () => {
    for (const socket of sockets) socket.close();
    if (child.exitCode == null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await stopped;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Startup timeout: ${output}`)), 10000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Exited ${code}: ${output}`)); });
    child.stdout.on('data', bytes => {
      output += bytes;
      if (output.includes('SQLite archive:')) { clearTimeout(timer); resolve(); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  async function api(route, options = {}) {
    const headers = { authorization: `Bearer ${TOKEN}`, ...options.headers };
    return fetch(`${base}/api/admin/${route}`, { ...options, headers });
  }
  async function get(route) {
    const response = await api(route);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  async function post(account, action, body, key = randomUUID(), status = 200) {
    const response = await api(`${action}?account=${encodeURIComponent(account)}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  async function connect(account) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.add(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let session = 0;
    const events = [], pending = new Map();
    socket.addEventListener('message', message => {
      const value = JSON.parse(message.data);
      if (value.session != null && pending.has(value.session)) {
        pending.get(value.session)(value.data);
        pending.delete(value.session);
      } else if (value.cmd) events.push(value);
    });
    function send(cmd, data = {}) {
      return new Promise((resolve, reject) => {
        const id = ++session;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`No reply for ${cmd}: ${output}`)); }, 5000);
        pending.set(id, data => { clearTimeout(timer); resolve(data); });
        socket.send(JSON.stringify({ session: id, cmd, data }));
      });
    }
    const token = await send('hall.gen_token', { account });
    await send('hall.login', { token: token.token });
    await send('client.load_all_info');
    return { socket, events, send };
  }
  return { base, api, get, post, connect };
}

async function eventAfter(client, index, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = client.events.slice(index).find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Expected a game WebSocket notification');
}

test('authenticated remote administration delivers and preserves game state', async t => {
  const { base, api, get, post, connect } = await startServer(t);
  const account = 'managed-frog';

  await t.test('token protects management, images and legacy APIs', async () => {
    for (const route of ['/api/admin/status', '/api/admin/image/190', '/api/accounts', '/api/export?account=x', '/api/weather?account=x']) {
      assert.equal((await fetch(base + route)).status, 401, route);
    }
    assert.equal((await api('status', { headers: { authorization: 'Bearer incorrect' } })).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.deepEqual((await get('accounts')).accounts, []);
    const status = await get('status');
    assert.equal(status.accounts, 0);
    assert.equal(status.schema, 5);
    assert.equal((await api('account?account=missing')).status, 400);
    assert.deepEqual((await get('accounts')).accounts, [], 'read must not create unknown accounts');
    assert.equal((await fetch(`${base}/api/import`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status, 409);
  });

  await t.test('create is idempotent, catalog images are valid, account starts offline', async () => {
    const key = randomUUID();
    const created = await post(account, 'create', {}, key);
    assert.equal(created.ok, true);
    assert.equal((await post(account, 'create', {}, key)).replayed, true);
    await post(' whitespace ', 'create', {}, randomUUID(), 400);
    await post('invalid-shape', 'create', [], randomUUID(), 400);
    assert.equal((await get('accounts')).accounts.length, 1);
    assert.equal((await get('accounts')).accounts[0].online, false);
    await post(account, 'create', {}, randomUUID(), 400);
    const snapshot = await get(`account?account=${account}`);
    assert.equal(snapshot.version, 5);
    assert.equal(snapshot.account.account, account);
    assert.equal(snapshot.travel.current, null);
    assert.equal(snapshot.visitor.current, null, 'management reads do not generate visitors');
    const catalog = await get('catalog');
    assert.ok(catalog.available);
    assert.equal(catalog.templates.length, 5);
    assert.ok(catalog.items.some(item => item.id === 0));
    assert.ok(catalog.notes.some(item => item.id === 1000));
    const image = await api('image/190');
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal((await api('image/999999')).status, 400);
  });

  const client = await connect(account);
  assert.equal((await get('accounts')).accounts[0].online, true);
  assert.equal((await get('status')).online, 1);

  await t.test('postcard reaches online player and opening its mail pushes its full layers', async () => {
    const key = randomUUID(), body = { template_id: 0, companion_id: 0, title: '测试明信片', message: '请查收' };
    let index = client.events.length;
    const result = await post(account, 'postcards', body, key);
    assert.ok(result.picture.layers.some(x => x.layer[0] === 245));
    assert.deepEqual(result.mail.pictures, [result.picture.id]);
    assert.equal(result.mail.type, 11);
    await eventAfter(client, index, e => e.cmd === 'notify_new_mail' && e.data.mail.id === result.mail.id);
    await eventAfter(client, index, e => e.cmd === 'album_load_new' && e.data.pictures.some(x => x.id === result.picture.id));
    assert.equal((await post(account, 'postcards', body, key)).replayed, true);
    await client.send('client.hello');
    assert.equal(client.events.slice(index).filter(e => e.cmd === 'notify_new_mail' && e.data.mail.id === result.mail.id).length, 1,
      'replaying the delivery must not create duplicate client notifications');
    await post(account, 'postcards', { ...body, title: 'changed' }, key, 400);
    let state = await get(`export?account=${account}`);
    assert.equal(state.postcards.filter(x => x.id === result.picture.id).length, 1);
    assert.equal(state.mails.filter(x => x.id === result.mail.id).length, 1);
    const another = await post(account, 'postcards', { template_id: 1, title: '另一个待收明信片' });
    index = client.events.length;
    assert.equal((await client.send('mail.open', { id: result.mail.id })).code, 0);
    const opened = await eventAfter(client, index, e => e.cmd === 'album_load_new');
    assert.deepEqual(opened.data.pictures.find(x => x.id === result.picture.id).layers, result.picture.layers);
    assert.ok(opened.data.pictures.some(x => x.id === another.picture.id),
      'album_load_new replaces the client list, so opening one mail must keep other unsaved pictures');
    assert.equal((await client.send('album.save_new', { id: result.picture.id })).code, 0);
    state = await get(`export?account=${account}`);
    assert.equal(state.postcards.find(x => x.id === result.picture.id).location, 'album');
    assert.equal((await client.send('mail.open', { id: result.mail.id })).code, 1);
  });

  await t.test('mail rewards settle exactly once; invalid delivery rolls back the postcard too', async () => {
    const before = await get(`account?account=${account}`);
    const result = await post(account, 'mail', { title: '礼物', clover: 25, ticket: 2, items: [{ item_id: 3000, count: 3 }] });
    assert.equal((await client.send('mail.open', { id: result.mail.id })).code, 0);
    assert.equal((await client.send('mail.open', { id: result.mail.id })).code, 1);
    const after = await get(`account?account=${account}`);
    assert.equal(after.account.clover, before.account.clover + 25);
    assert.equal(after.account.ticket, before.account.ticket + 2);
    assert.equal(after.items.house.find(x => x.item_id === 3000).count, 3);
    await post(account, 'postcards', { template_id: 0, items: [{ item_id: -555, count: 1 }] }, randomUUID(), 400);
    await post(account, 'postcards', { picture: { pic_id: 100, layers: [{ layer: [999999, 0, 0] }] } }, randomUUID(), 400);
    await post(account, 'mail', { title: 'invalid', clover: -1 }, randomUUID(), 400);
    await post(account, 'mail', { title: 'invalid', ticket: 0.5 }, randomUUID(), 400);
    await post(account, 'mail', { title: 'invalid', items: [{ item_id: 0, count: 0 }] }, randomUUID(), 400);
    const rolledBack = await get(`account?account=${account}`);
    assert.deepEqual(rolledBack.postcards, after.postcards);
    assert.deepEqual(rolledBack.mails, after.mails);
    assert.equal((await api(`mail?account=${account}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  });

  await t.test('discarded postcard IDs are never reassigned to another delivery', async () => {
    const first = await post(account, 'postcards', { template_id: 0, title: '原始邮件保留引用' });
    assert.equal((await client.send('album.delete_new', { id: first.picture.id })).code, 0);
    const second = await post(account, 'postcards', { template_id: 1, title: '新的独立投递' });
    assert.ok(second.picture.id > first.picture.id, 'new postcards must not reuse deleted IDs referenced by existing mail');
    const state = await get(`export?account=${account}`);
    assert.deepEqual(state.mails.find(x => x.id === first.mail.id).pictures, [first.picture.id]);
    assert.deepEqual(state.mails.find(x => x.id === second.mail.id).pictures, [second.picture.id]);
    assert.equal(state.postcards.some(x => x.id === first.picture.id), false);
    assert.equal(state.postcards.find(x => x.id === second.picture.id).pic_id, 103);
  });

  await t.test('role, weather and note changes persist with protocol pushes', async () => {
    let index = client.events.length;
    await post(account, 'role', { frog_name: '小邮差', clover: 123, ticket: 6 });
    const role = await eventAfter(client, index, e => e.cmd === 'client_load_role');
    assert.equal(role.data.frog.name, '小邮差');
    assert.equal(role.data.res.clover_point, 123);
    index = client.events.length;
    await post(account, 'notes', { id: 1000 });
    const note = await eventAfter(client, index, e => e.cmd === 'travel_load_note');
    assert.equal(note.data.note_list.find(x => x.id === 1000).read, false);
    await post(account, 'weather', { season: 1, hours_type: 3, weather: 9 });
    const snapshot = await get(`account?account=${account}`);
    assert.deepEqual(snapshot.weather, { season: 1, hours_type: 3, weather: 9 });
    await post(account, 'weather', { season: 5, hours_type: 1, weather: 1 }, randomUUID(), 400);
    await post(account, 'role', { ticket: -1 }, randomUUID(), 400);
    await post(account, 'role', { frog_status: 1 }, randomUUID(), 400);
    await post(account, 'notes', { id: 999999 }, randomUUID(), 400);
  });

  await t.test('departed visitor is claimable once; restore automatically backs up overwritten state', async () => {
    assert.equal((await client.send('visit.open')).code, 1);
    await post(account, 'visitor-depart', {});
    assert.equal((await client.send('visit.open')).code, 0);
    assert.equal((await client.send('visit.open')).code, 1);
    const before = await get(`export?account=${account}`);
    const incoming = structuredClone(before);
    incoming.account.frog_name = '导入蛙';
    incoming.account.clover = 999;
    const imported = await post(account, 'import', { save: incoming });
    assert.ok(imported.backup_id > 0);
    const after = await get(`export?account=${account}`);
    assert.equal(after.account.frog_name, '导入蛙');
    const backup = await get(`backup?account=${account}&id=${imported.backup_id}`);
    assert.deepEqual(backup.account, before.account);
    assert.deepEqual(backup.postcards, before.postcards);
    assert.deepEqual(backup.visitor, before.visitor);
    const beforeAudit = await get(`audit?account=${account}`);
    await post(account, 'import', { save: { ...incoming, version: 1000 } }, randomUUID(), 400);
    for (const makeInvalid of [
      save => { save.account.clover = -1; },
      save => { save.items.house = [{ item_id: 999999, count: 1 }]; },
      save => { save.items.house = [{ item_id: 0, count: -1 }]; },
      save => { save.postcards[0].layers = [{ layer: [999999, 0, 0] }]; },
      save => { save.account.frog_status = 1; save.travel.current = null; },
    ]) {
      const invalid = structuredClone(incoming);
      makeInvalid(invalid);
      await post(account, 'import', { save: invalid }, randomUUID(), 400);
    }
    assert.deepEqual((await get(`audit?account=${account}`)).backups, beforeAudit.backups);
    assert.equal((await get(`export?account=${account}`)).account.frog_name, '导入蛙');
    await post(account, 'import', { save: backup });
    assert.deepEqual((await get(`export?account=${account}`)).account, before.account);
    await post('other-frog', 'create', {});
    assert.equal((await api(`backup?account=other-frog&id=${imported.backup_id}`)).status, 400);
    await post(account, 'import', { save: { ...incoming, account: { ...incoming.account, account: 'other-frog' } } }, randomUUID(), 400);
    const audit = await get(`audit?account=${account}`);
    assert.ok(audit.operations.some(x => x.action === 'postcards'));
    assert.ok(audit.operations.some(x => x.action === 'import'));
    assert.equal(audit.operations.filter(x => x.action === 'create').length, 1);
  });

  await t.test('offline delivery appears at login and returning visitor pushes the authoritative ticket balance', async () => {
    await post('offline-player', 'create', {});
    const delivery = await post('offline-player', 'postcards', { template_id: 2 });
    const offline = await connect('offline-player');
    assert.ok(offline.events.find(x => x.cmd === 'mail_load').data.some(x => x.id === delivery.mail.id));
    assert.ok(offline.events.find(x => x.cmd === 'album_load_new').data.pictures.some(x => x.id === delivery.picture.id));
    const snapshot = await get('export?account=offline-player');
    snapshot.visitor.current.first = false;
    snapshot.visitor.current.expire_time = Math.floor(Date.now() / 1000) - 1;
    snapshot.visitor.acquire = ['北京'];
    const initialTickets = snapshot.account.ticket;
    await post('offline-player', 'import', { save: snapshot });
    const index = offline.events.length;
    assert.equal((await offline.send('visit.open')).code, 0);
    const ticketPush = await eventAfter(offline, index, e => e.cmd === 'item_update_ticket');
    assert.equal(ticketPush.data.ticket, initialTickets + 1);
    assert.equal((await get('export?account=offline-player')).account.ticket, initialTickets + 1);
  });
});

test('visitor gifts survive process-style reopen, rotate provinces, and never pay twice', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-visitor-persistence-'));
  const filename = path.join(directory, 'visitor.sqlite');
  let database = new FrogDatabase(filename);
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  database.ensureAccount('visitor-restart');
  const first = database.getVisitorState('visitor-restart', 100, 60).visitor;
  assert.equal(database.openVisitor('visitor-restart', 60, 159).ok, false);
  database.close();
  database = new FrogDatabase(filename);
  assert.deepEqual(database.getVisitorState('visitor-restart', 100000, 60).visitor, first);
  assert.equal(database.openVisitor('visitor-restart', 60, 100000).ok, true);
  assert.equal(database.openVisitor('visitor-restart', 60, 100000).ok, false);
  assert.deepEqual(database.getVisitorAcquire('visitor-restart'), ['北京']);
  assert.equal(database.getVisitorState('visitor-restart', 100001, 60).visitor, null);

  let now = 100060;
  for (let i = 0; i < 6; i++) {
    const next = database.getVisitorState('visitor-restart', now, 60).visitor;
    assert.equal(next.first, true);
    assert.equal(database.openVisitor('visitor-restart', 60, now + 60).ok, true);
    now += 120;
  }
  assert.equal(database.getVisitorAcquire('visitor-restart').length, 7);
  const repeat = database.getVisitorState('visitor-restart', now, 60).visitor;
  assert.equal(repeat.first, false);
  assert.equal(repeat.city, '北京_北京');
  const ticketBefore = database.getRole('visitor-restart').res.ticket;
  assert.equal(database.openVisitor('visitor-restart', 60, now + 60).ok, true);
  assert.equal(database.openVisitor('visitor-restart', 60, now + 60).ok, false);
  assert.equal(database.getRole('visitor-restart').res.ticket, ticketBefore + 1);
  assert.equal(database.getVisitorState('visitor-restart', now + 120, 60).visitor.city, '上海_上海');
});

test('local APK catalog is decoded when available', t => {
  const catalog = loadCatalog();
  if (!catalog.available) { t.skip('APK resource directory is optional and not distributed in this repository'); return; }
  assert.ok(catalog.items.some(x => x.id === 0 && x.name));
  assert.ok(catalog.pictures.some(x => x.id === 100));
  assert.ok(catalog.notes.some(x => x.id === 1000));
  assert.equal(catalog.resources[190], 'Picture/Normal/roof1_qw');
});

test('schema upgrade and old snapshot import preserve postcard IDs referenced only by mail', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-postcard-sequence-'));
  const filename = path.join(directory, 'archive.sqlite');
  let database = new FrogDatabase(filename);
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  database.ensureAccount('legacy-mail');
  database.db.prepare('UPDATE mails SET pictures_json=? WHERE account=? AND id=9000001')
    .run('[90001]', 'legacy-mail');
  // Recreate the absence of a sequence column in an existing v4 archive.
  database.db.exec('ALTER TABLE accounts DROP COLUMN postcard_sequence; PRAGMA user_version=4;');
  database.close();
  database = new FrogDatabase(filename);
  assert.equal(database.db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.equal(database.nextPostcardId('legacy-mail'), 90002);

  const olderSave = database.exportAccount('legacy-mail');
  olderSave.version = 4;
  delete olderSave.account.postcard_sequence;
  olderSave.mails[0].pictures = [400001];
  database.importAccount(olderSave);
  assert.equal(database.nextPostcardId('legacy-mail'), 400002);
  olderSave.mails[0].pictures = [90001];
  database.importAccount(olderSave);
  assert.equal(database.nextPostcardId('legacy-mail'), 400003,
    'restoring an older save cannot lower the live sequence');
});
