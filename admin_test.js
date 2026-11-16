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
    Item_json: [...[0, 1000, 2000, 3000].map(id => ({ id, name: `Test item ${id}`, type: id === 3000 ? 3 : 0 })),
      ...[[10001,10],[10003,10],[10101,11],[10201,12],[10202,12],[10301,13]].map(([id,type])=>({id,type,name:`Craft ${id}`}))],
    Picture_json: TRAVEL_ROUTES.map(x => ({ id: x.picId, name: x.destination })),
    Note_json: { 1000: { id: 1000, type: 1 }, 1001: { id: 1001, type: 1 } },
    resources_json: resources,
    Prize_json: [{ id: 0, itemId: -1, rank: 0, stock: 1 }],
    furnitureData_json: {1001:{id:1001,name:'Default wall',style:1,type:1,drawing:10301},1101:{id:1101,name:'Stone wall',style:2,type:1,drawing:10301}},
    furnitureShopData_json: {1:{id:1,item_id:10001,price:2,limit:0,shop_limit:1,has_item:0}},
    benchData_json: [{id:1101,type:1}],
    Character_json: {data:[0,1,2].map(id=>({id,name:`Neighbor ${id}`,taste:[99]}))},
    Specialty_json: [{id:0,itemId:3000}],
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

async function startServer(t, options={}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-admin-test-'));
  const port = await freePort();
  const sockets = new Set();
  const assets = createAssets(directory);
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: { ...process.env, FROG_HOST: '127.0.0.1', FROG_PORT: String(port), FROG_DB: path.join(directory, 'test.sqlite'),
      FROG_ADMIN_TOKEN: TOKEN, FROG_ASSETS: assets, FROG_TRIP_SECONDS: options.tripSeconds || '3600', FROG_VISIT_SECONDS: '60',FROG_GAME_AUTH_REQUIRED:options.gameAuth?'1':'0' },
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
    const events = [], messages = [], pending = new Map();
    socket.addEventListener('message', message => {
      const value = JSON.parse(message.data);
      messages.push(value);
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
    return { socket, events, messages, send };
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
    assert.equal(status.schema, 6);
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
    assert.equal(snapshot.version, 6);
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

test('snapshot unlocks imported account, mutations and travel progress, unsupported calls are retained',async t=>{
  const {get,post,connect}=await startServer(t,{tripSeconds:'1'}),account='official-123';
  const raw={
    client_load_role:{uid:123,res:{clover_point:100,ticket:10},settings:{client:'{"guideStep":"Complete"}'},misc:{picture_cnt:1,create_time:100},frog:{name:'测试蛙',icon:0,cur_achieve:0,achieves:[0],achieves_time:{},status:3,motion:-1}},
    album_load_all:{id_list:[{id:5,pic_id:100}]},album_load_by_id_list:{pic_list:[{id:5,pic_id:100,layers:[{layer:[1,-0.5,2.5]}]}]},album_load_recover:{pictures:{}},album_load_new:{pictures:{}},travel_load_gift:{pictures:[],specialtys:{}},
    item_load_items:{house:[{item_id:0,count:4}],bag:[0,-1,-1,-1],desk:Array(8).fill(-1),gacha:{color_ball:-1}},travel_load_note:{note_list:[]},
    furniture_load_furniture:{bench:Array(10).fill(-1),bench_lock:false,has_fur:[1001],put_fur:[{id:1001,type:1}],shop:{start_time:100,leave_time:200}},
    clover_load_clovers:[],weather_load:{season:1,hours_type:1,weather:1},mail_load:{},
    furniture_load_flowerpot:{list:[401],plant_list:[],show_index:1},
    qa_load_history:{entries:[1]},
  };
  const capture={format:'frog-official-protocol-capture',complete:true,finished_at:200000,account:'source-user',responses:Object.fromEntries(Object.entries(raw).map(([cmd,data])=>[cmd,[{data,time:150000}]]))};
  const save=require('./official_import').convertCapture(capture);
  await post(account,'create',{});await post(account,'import',{save});
  const frozen=await connect(account);assert.equal(frozen.events.find(x=>x.cmd==='client_load_role').data.frog.status,3);
  const checkpoint=await post(account,'snapshot-create',{label:'测试前'});assert.equal(checkpoint.activated,true);
  const client=await connect(account);
  assert.equal(client.events.find(x=>x.cmd==='client_load_role').data.frog.status,0);
  assert.deepEqual(client.events.find(x=>x.cmd==='qa_load_history').data,raw.qa_load_history,'static unimplemented state remains visible');
  assert.deepEqual(client.events.find(x=>x.cmd==='furniture_load_flowerpot').data.list,[401],'imported garden ownership remains visible');
  assert.equal((await client.send('item.buy',{shop_id:0})).code,0);
  assert.equal((await client.send('client.load_role')).res.clover_point,90);
  assert.equal((await client.send('album.delete',{id:5})).code,0);
  assert.equal((await client.send('album.load_all')).id_list.length,0,'does not replay frozen list');
  const start=client.events.length;
  assert.equal((await client.send('item.set_bag_completed',{completed:true})).code,0);
  await eventAfter(client,start,x=>x.cmd==='notify_new_event'&&x.data.event.evt_type===2);
  assert.equal((await client.send('album.load_new')).pictures.length,1,'active timer settles imported trip');
  const unsupported=await client.send('qa.not_implemented',{id:8,token:'do-not-log',message:'private-text'});
  assert.equal(unsupported.code,1);assert.equal(unsupported.supported,false);
  await client.send('qa.not_implemented',{id:8,token:'do-not-log'});
  await client.send('qa.load_history');
  const calls=(await get(`unsupported?account=${account}`)).calls;
  assert.equal(calls.find(x=>x.command==='qa_not_implemented').count,2);
  assert.equal(calls.find(x=>x.command==='qa_load_history').reason,'snapshot_read_only');
  assert.ok(!JSON.stringify(calls).includes('do-not-log'));
  const activeSave=await get(`export?account=${account}`);
  assert.equal(activeSave.official.mode,'active');assert.deepEqual(activeSave.official.capture,capture);
  await post(account,'import',{save:activeSave});
  await post(account,'snapshot-restore',{snapshot_id:checkpoint.snapshot.id,confirm_account:account});
  const after=await connect(account);
  assert.equal((await after.send('album.load_all')).id_list.length,1);
  assert.equal((await after.send('client.load_role')).res.clover_point,100);
  assert.equal((await after.send('item.buy',{shop_id:0})).code,0,'restored original snapshot remains writable');
  assert.equal((await get(`unsupported?account=${account}`)).calls.find(x=>x.command==='qa_not_implemented').count,2,'diagnostics survive rollback');
});

test('HTTP snapshot restore protects state and invalidates connected game clients', async t => {
  const {base,get,post,connect}=await startServer(t),account='snapshot-game';
  assert.equal((await fetch(`${base}/api/admin/snapshots?account=${account}`)).status,401);
  await post(account,'create',{});
  await post(account,'role',{clover:60});
  const saved=await post(account,'snapshot-create',{label:'出发前'});
  assert.equal(saved.snapshot.summary.clover,60);
  const key=randomUUID();
  await post(account,'role',{clover:90});
  const client=await connect(account),index=client.events.length;
  const closed=new Promise(resolve=>client.socket.addEventListener('close',resolve,{once:true}));
  await post(account,'snapshot-restore',{snapshot_id:saved.snapshot.id,confirm_account:'wrong'},randomUUID(),400);
  const restored=await post(account,'snapshot-restore',{snapshot_id:saved.snapshot.id,confirm_account:account},key);
  await eventAfter(client,index,x=>x.cmd==='notify_reload');
  await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Game socket not closed after restore')),2000))]);
  assert.equal((await get(`account?account=${account}`)).account.clover,60);
  assert.equal((await post(account,'snapshot-restore',{snapshot_id:saved.snapshot.id,confirm_account:account},key)).replayed,true);
  const list=await get(`snapshots?account=${account}`);
  assert.equal(list.snapshots.length,2);
  assert.equal(list.snapshots[0].id,restored.safety_snapshot_id);
  assert.equal(list.snapshots[0].summary.clover,90);
  const reconnected=await connect(account);
  assert.equal(reconnected.events.find(x=>x.cmd==='client_load_role').data.res.clover_point,60);
});

test('game password login is required, tokens survive reconnect and password resets revoke access',async t=>{
  const {base,post}=await startServer(t,{gameAuth:true});await post('password-frog','create',{});
  await post('password-frog','game-credentials',{username:'dog',password:'test-password-123'});
  const login=async password=>fetch(base+'/api/game/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'dog',password})});
  assert.equal((await login('wrong')).status,401);
  const response=await login('test-password-123');assert.equal(response.status,200);const {token}=await response.json();
  const socket=new WebSocket(base.replace('http','ws'));t.after(()=>socket.close());await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  let session=0;async function call(cmd,data={}){const id=++session;return new Promise(resolve=>{function on(e){const v=JSON.parse(e.data);if(v.session===id){socket.removeEventListener('message',on);resolve(v.data);}}socket.addEventListener('message',on);socket.send(JSON.stringify({cmd,data,session:id}));});}
  assert.equal((await call('hall.gen_token',{account:'password-frog'})).code,1);
  assert.equal((await call('client.load_role')).code,1);
  assert.equal((await call('hall.gen_token',{account:token})).token,token);
  assert.equal((await call('hall.login',{token})).code,0);
  assert.equal((await call('hall.reconnect',{token})).account,'password-frog');
  assert.ok((await call('client.load_role')).frog);
  await post('password-frog','game-credentials',{username:'dog',password:'updated-password-123'});
  assert.equal((await call('client.load_role')).code,1);
  assert.equal((await call('hall.login',{token})).code,1);
});

test('merchant rows resolve client item details and purchases synchronize after the reply', async t => {
  const {get,post,connect}=await startServer(t),account='merchant-frog';
  await post(account,'create',{});
  await post(account,'role',{clover:10});
  const catalog=await get('catalog'),items=new Map(catalog.items.map(x=>[x.id,x]));
  const client=await connect(account);
  const initial=client.events.find(x=>x.cmd==='furniture_load_furniture').data;
  // FurnitureShopItem and FurnitureShopView look up ItemDB by the row's
  // item_id directly, independently of the shop_id used for the purchase.
  for(const row of initial.shop.shop_list){
    assert.ok(items.get(row.item_id)?.name,'merchant row must resolve client item details');
    assert.equal(catalog.furnitureShop.find(x=>x.id===row.shop_id).item_id,row.item_id);
  }
  const row=initial.shop.shop_list.find(x=>x.item_id===10001);
  assert.equal(row.num,1);
  const begin=client.messages.length;
  assert.equal((await client.send('furniture.buy_shop',{shop_id:row.shop_id})).code,0);
  await client.send('client.hello');
  const updates=client.messages.slice(begin);
  assert.ok(updates[0].session,'reply precedes authoritative pushes because the client also deducts locally');
  assert.equal(updates.find(x=>x.cmd==='clover_update').data.clover,8);
  assert.deepEqual(updates.find(x=>x.cmd==='item_update').data.item,{item_id:10001,count:1});
  assert.equal(updates.find(x=>x.cmd==='furniture_load_furniture').data.shop.shop_list.find(x=>x.shop_id===row.shop_id).num,0);
  assert.equal((await client.send('furniture.buy_shop',{shop_id:row.shop_id})).code,1);
  const reconnected=await connect(account);
  const state=await reconnected.send('furniture.load_furniture');
  assert.equal(state.shop.shop_list.find(x=>x.shop_id===row.shop_id).num,0);
  const save=await get(`export?account=${account}`);
  assert.equal(save.account.clover,8);
  assert.equal(save.items.house.find(x=>x.item_id===10001).count,1);
  assert.equal(save.furniture.purchases[row.shop_id],1);
});

test('garden workbench, construction, placement and neighbor rewards use native protocol', async t => {
  const {get,post,connect}=await startServer(t), account='garden-frog';
  await post(account,'create',{});
  const original=await get(`export?account=${account}`);
  assert.equal(original.furniture,null);
  const garden=await get(`garden?account=${account}`);
  assert.deepEqual(garden.furniture.has_fur,[1001]);
  assert.equal((await get(`export?account=${account}`)).furniture,null,'garden GET must not initialize records');
  const client=await connect(account);
  assert.equal(client.events.find(x=>x.cmd==='furniture_load_furniture').data.bench.length,10);
  const parcel=await post(account,'mail',{title:'Workshop supplies',clover:10,items:[10202,10301,10101,10003,3000].map(item_id=>({item_id,count:1}))});
  await client.send('mail.open',{id:parcel.mail.id});
  assert.equal((await client.send('furniture.putin_bench',{pos:1,id:10101})).code,1);
  assert.equal((await client.send('furniture.putin_bench',{pos:1,id:10202})).code,0);
  assert.equal((await client.send('furniture.putin_bench',{pos:6,id:10101})).code,0);
  await client.send('client.hello');
  assert.equal(client.events.filter(x=>x.cmd==='furniture_load_furniture').at(-1).data.bench[5],10101);
  await post(account,'furniture-advance',{});
  assert.equal((await get(`garden?account=${account}`)).furniture.job.furniture_id,1101);
  assert.equal((await client.send('furniture.takeout_bench',{pos:6})).code,1,'locked workbench');
  const crafting=await get(`export?account=${account}`);
  const restored=await post(account,'import',{save:crafting});
  assert.ok(restored.backup_id);
  const finishKey=randomUUID();
  const finished=await post(account,'furniture-finish',{},finishKey);
  assert.equal(finished.completed,1101);
  assert.equal((await post(account,'furniture-finish',{},finishKey)).replayed,true);
  assert.equal((await client.send('furniture.replace_fur',{id:99999})).code,-1);
  assert.equal((await client.send('furniture.replace_fur',{id:1101})).code,1);
  await client.send('client.hello');
  const placed=await get(`garden?account=${account}`);
  assert.deepEqual(placed.furniture.put_fur,[{type:1,id:1101}]);
  assert.equal(placed.inventory.find(x=>x.item_id===10202).count,1,'reusable tool remains owned');
  assert.ok(!placed.inventory.some(x=>x.item_id===10003),'raw material spent');
  assert.equal((await client.send('furniture.buy_shop',{shop_id:1})).code,0);
  assert.equal((await client.send('furniture.buy_shop',{shop_id:1})).code,1,'per-visit shop limit');
  await post(account,'visitor-depart',{});
  const arrival=await post(account,'neighbor-arrive',{});
  const guest=arrival.guest;
  assert.equal(guest.id,0);
  assert.equal((await client.send('guest.confirm',{id:guest.id})).code,0);
  assert.equal((await client.send('guest.serve',{id:guest.id,item_id:3000})).code,0);
  assert.equal((await client.send('guest.serve',{id:guest.id,item_id:3000})).code,1,'no repeat feeding');
  const departure=await post(account,'neighbor-depart',{});
  assert.equal(departure.mail.type,3);
  assert.equal(departure.mail.resource.clover_point,80);
  const before=await get(`export?account=${account}`);
  await client.send('mail.open',{id:departure.mail.id});
  assert.equal((await client.send('mail.open',{id:departure.mail.id})).code,1);
  const after=await get(`export?account=${account}`);
  assert.equal(after.account.clover,before.account.clover+80);
  assert.equal(after.account.ticket,before.account.ticket+1);
  assert.equal(after.neighbors.id,-1);
  assert.ok(client.events.some(x=>x.cmd==='notify_new_mail'&&x.data.mail.id===departure.mail.id));
  assert.ok(client.events.some(x=>x.cmd==='notify_new_event'&&x.data.event.evt_type===21));
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
  assert.equal(database.db.prepare('PRAGMA user_version').get().user_version, 6);
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
