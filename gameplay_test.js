'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { FrogDatabase } = require('./database');
const { loadCatalog } = require('./catalog');
const { GameplayService, getGachaState, importGachaState, grantGachaCredits } = require('./gameplay');

// Minimal protocol fixture: one selectable prize in each client color. The
// server itself always consumes the APK catalog, not these test rows.
const fixture = {
  items: [1002, 1013, 6, 11, 1007].map(id => ({ id })),
  prizes: [
    { id: 0, rank: 0, itemId: -1, stock: 1 },
    { id: 1, rank: 1, itemId: 1002, stock: 1 },
    { id: 6, rank: 2, itemId: 1013, stock: 1 },
    { id: 10, rank: 3, itemId: 6, stock: 1 },
    { id: 15, rank: 4, itemId: 11, stock: 1 },
    { id: 19, rank: 5, itemId: 1007, stock: 1 },
  ],
};

function setup(t, roll = 40, catalog = fixture) {
  const database = new FrogDatabase(':memory:');
  const service = new GameplayService(database, catalog, { randomInt: () => roll });
  database.ensureAccount('frog');
  t.after(() => database.close());
  return { database, service };
}

test('paid draw reserves one color, deducts five tickets once, and validates redemption', t => {
  const { database, service } = setup(t);
  database.updateAccount('frog', { ticket: 12 });
  const draw = service.draw('frog');
  assert.deepEqual(draw, { ok: true, rank: 1, ticket_balance: 7, replayed: false });
  assert.deepEqual(service.draw('frog'), { ...draw, replayed: true });
  assert.equal(service.getState('frog').draw_count, 1);
  assert.equal(service.redeem('frog', 19).ok, false);
  assert.equal(service.redeem('frog', '1').ok, false);
  assert.equal(service.redeem('other-frog', 1).ok, false);
  assert.equal(service.getState('frog').color_ball, 1);
  assert.equal(database.getInventoryCount('frog', 1007), 0);
  assert.deepEqual(service.redeem('frog', 1), {
    ok: true, ticket_balance: 7, itemChanges: [{ item_id: 1002, count: 1 }], prize_id: 1,
  });
  assert.equal(service.redeem('frog', 1).ok, false);
  assert.equal(database.getInventoryCount('frog', 1002), 1);
  assert.equal(service.getState('frog').color_ball, -1);
});

test('white ball returns the configured ticket award, not clover', t => {
  const { database, service } = setup(t, 0);
  database.updateAccount('frog', { ticket: 5, clover: 73 });
  assert.equal(service.draw('frog').rank, 0);
  assert.equal(service.redeem('frog', 0).ticket_balance, 1);
  assert.equal(database.getRole('frog').res.clover_point, 73);
  assert.equal(database.getRole('frog').res.ticket, 1);
  assert.equal(service.redeem('frog', 0).ok, false);
  assert.equal(database.getRole('frog').res.ticket, 1);
});

test('insufficient balance and invented free-draw flag cannot spend or create a prize', t => {
  const { database, service } = setup(t, 99);
  database.updateAccount('frog', { ticket: 4 });
  assert.equal(service.draw('frog').ok, false);
  assert.equal(service.draw('frog', true).ok, false);
  assert.equal(service.draw('frog', 'false').ok, false);
  assert.equal(database.getRole('frog').res.ticket, 4);
  assert.deepEqual(service.getState('frog'), { color_ball: -1, reward_credits: 0, draw_count: 0 });

  database.transaction(() => grantGachaCredits(database, 'frog', 1));
  const draw = service.draw('frog', true);
  assert.equal(draw.ok, true);
  assert.equal(draw.rank, 5);
  assert.equal(draw.ticket_balance, 4);
  assert.equal(service.getState('frog').reward_credits, 0);
  assert.equal(service.draw('frog', true).replayed, true);
  assert.equal(service.redeem('frog', 19).ok, true);
  assert.equal(service.draw('frog', true).ok, false);
});

test('missing or incomplete prize catalog never charges a draw', t => {
  const { database, service } = setup(t, 40, { items: [], prizes: [] });
  database.updateAccount('frog', { ticket: 10 });
  assert.equal(service.draw('frog').ok, false);
  assert.equal(database.getRole('frog').res.ticket, 10);
});

test('redeem settlement rolls back both inventory and pending prize on failure', t => {
  const { database, service } = setup(t);
  database.updateAccount('frog', { ticket: 5 });
  service.draw('frog');
  const original = database.changeInventory.bind(database);
  database.changeInventory = (...args) => { original(...args); throw Error('simulated storage failure'); };
  assert.throws(() => service.redeem('frog', 1), /simulated storage failure/);
  assert.equal(database.getInventoryCount('frog', 1002), 0);
  assert.equal(service.getState('frog').color_ball, 1);
  database.changeInventory = original;
  assert.equal(service.redeem('frog', 1).ok, true);
  assert.equal(database.getInventoryCount('frog', 1002), 1);
});

test('pending prize survives database close/reopen and account archive restoration', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-gacha-'));
  const filename = path.join(directory, 'gacha.sqlite');
  let database = new FrogDatabase(filename);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let service = new GameplayService(database, fixture, { randomInt: () => 87 });
  database.ensureAccount('frog');
  database.updateAccount('frog', { ticket: 9 });
  service.draw('frog');
  const saved = service.getState('frog');
  assert.equal(saved.color_ball, 3);
  database.close();
  database = new FrogDatabase(filename);
  service = new GameplayService(database, fixture, { randomInt: () => { throw Error('must not reroll'); } });
  assert.equal(service.draw('frog').rank, 3);
  assert.equal(database.getRole('frog').res.ticket, 4);
  assert.equal(service.redeem('frog', 10).ok, true);

  database.ensureAccount('copy');
  database.transaction(() => importGachaState(database, 'copy', saved));
  assert.deepEqual(getGachaState(database, 'copy'), saved);
  assert.equal(service.redeem('copy', 10).ok, true);
  assert.equal(database.getInventoryCount('copy', 6), 1);
  assert.throws(() => database.transaction(() => importGachaState(database, 'copy', { color_ball: 9 })), /Invalid gacha/);
  assert.equal(service.getState('copy').color_ball, -1);
  database.transaction(() => importGachaState(database, 'copy'));
  assert.equal(service.getState('copy').draw_count, 0);
});

test('APK-derived prize catalog supports every weighted client rank', t => {
  const catalog = loadCatalog();
  if (!catalog.available) return t.skip('APK assets not provided');
  const { service } = setup(t, 0, catalog);
  assert.equal(service.available, true);
  assert.equal(catalog.prizes.find(prize => prize.id === 0).stock, 1);
});
