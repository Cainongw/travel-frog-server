'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { FrogDatabase } = require('../src/core/database');
const { NeighborService, getNeighborState, importNeighborState, neighborReward } = require('../src/game/neighbors/neighbors');

const CATALOG = {
  // Reversed item IDs intentionally test taste-by-specialty-order, not id.
  items: [{ id: 3001, type: 3 }, { id: 3000, type: 3 }, { id: 0, type: 0 }],
  specialties: [{ id: 0, itemId: 3001 }, { id: 1, itemId: 3000 }],
  neighbors: [
    { id: 0, name: '困困', taste: [99, 15] },
    { id: 1, name: '胖胖', taste: [30, 75] },
    { id: 2, name: '跳跳', taste: [15, 99] },
  ],
};

function fixture(t) {
  const database = new FrogDatabase(':memory:');
  t.after(() => database.close());
  let randomIndex=0;const rolls=[0.5,0.9,0.1];
  const service = new NeighborService(database, CATALOG, { durationSeconds: 60, cooldownSeconds: 120, arrivalChance:1, random:()=>rolls[randomIndex++%rolls.length] });
  database.ensureAccount('neighbor-test');
  return { database, service, account: 'neighbor-test' };
}

test('neighbor protocol, specialty taste and one-time feeding follow client fields', t => {
  const { database, service, account } = fixture(t);
  assert.deepEqual(service.sync(account, 100).guest, { id: 0, confirmed: false, served: false, expire_time: 160, pos: 0 });
  assert.equal(service.confirm(account, 1, 101).ok, false);
  assert.equal(service.confirm(account, 0, 101).ok, true);
  assert.equal(service.confirm(account, 0, 102).replayed, true);
  database.changeInventory(account, 0, 2);
  database.changeInventory(account, 3001, 2);
  assert.equal(service.serve(account, 0, 0, 102).ok, false, 'ordinary food cannot feed neighbors');
  assert.equal(service.serve(account, 0, 3000, 102).ok, false, 'unowned specialties cannot be consumed');
  assert.equal(service.serve(account, 1, 3001, 102).ok, false, 'neighbor identity must match');
  const fed = service.serve(account, 0, 3001, 103);
  assert.equal(fed.ok, true);
  assert.equal(fed.feeling, 99);
  assert.deepEqual(fed.itemChanges, [{ item_id: 3001, count: 1 }]);
  assert.equal(fed.guest.served, true);
  assert.equal(service.serve(account, 0, 3001, 104).ok, false);
  assert.equal(database.getInventoryCount(account, 3001), 1);
  assert.equal(service.finish(account, 159).ok, false, 'client finish cannot force early departure');
  assert.equal(service.setExpire(account, 100000, 120).ok, false);
  assert.equal(service.setExpire(account, 130, 120).replayed, true, 'client cannot alter scheduled departure');
  assert.equal(getNeighborState(database, account).expire_time, 160);
});

test('served neighbor leaves one reward mail, and mail_open settles it only once', t => {
  const { database, service, account } = fixture(t);
  service.sync(account, 100);
  database.changeInventory(account, 3001, 1);
  service.serve(account, 0, 3001, 110);
  const before = database.getRole(account).res;
  const result = service.sync(account, 160);
  assert.equal(result.guest.id, -1);
  assert.equal(result.mail.type, 3);
  assert.equal(result.mail.sender, 0);
  assert.deepEqual(result.mail.resource, { clover_point: 80, ticket: 1, reward_gacha: 0, ads_id: '', share_id: '' });
  assert.deepEqual(database.getRole(account).res, before, 'departure deposits a mail rather than applying rewards early');
  assert.equal(service.sync(account, 160).mail, null);
  assert.equal(service.finish(account, 161).mail, null);
  assert.equal(database.getMails(account).filter(x => x.id === result.mail.id).length, 1);
  assert.equal(database.openMail(account, result.mail.id).ok, true);
  assert.equal(database.openMail(account, result.mail.id).ok, false);
  assert.equal(database.getRole(account).res.clover_point, before.clover_point + 80);
  assert.equal(database.getRole(account).res.ticket, before.ticket + 1);
  assert.equal(service.sync(account, 279).guest.id, -1);
  assert.equal(service.sync(account, 280).guest.id, 1, 'injected random chooses the next identity after cooldown');
});

test('unfed departure grants no reward and late feeding is rejected', t => {
  const { database, service, account } = fixture(t);
  service.sync(account, 100);
  database.changeInventory(account, 3001, 1);
  assert.equal(service.serve(account, 0, 3001, 160).ok, false);
  assert.equal(database.getInventoryCount(account, 3001), 1);
  const result = service.finish(account, 160);
  assert.equal(result.changed, true);
  assert.equal(result.mail, null);
  assert.equal(service.sync(account, 280).guest.id, 1);
  assert.equal(database.getMails(account).length, 1, 'only the existing welcome mail remains');
});

test('active province visitors defer neighbors without confusing pending province gifts', t => {
  const { database, service, account } = fixture(t);
  const provinceVisitor = database.getVisitorState(account, 100, 60).visitor;
  assert.equal(service.sync(account, 120).guest.id, -1);
  assert.equal(service.forceArrive(account, 120).ok, false);
  assert.equal(getNeighborState(database, account).visit_count, 0);
  const arrived = service.sync(account, 160);
  assert.equal(arrived.guest.id, 0);
  assert.deepEqual(database.getVisitorState(account, 160, 60).visitor, provinceVisitor, 'the province gift is retained');
  assert.equal(database.openVisitor(account, 60, 160).ok, true);
  assert.equal(service.state(account).id, 0, 'visit_open does not consume the neighbor');
});

test('management arrival and departure preserve outstanding settlements and do not overwrite live visits', t => {
  const { database, service, account } = fixture(t);
  assert.equal(service.forceArrive(account, 100).guest.id, 0);
  database.changeInventory(account, 3001, 2);
  service.serve(account, 0, 3001, 110);
  assert.equal(service.forceArrive(account, 120).replayed, true);
  assert.equal(service.state(account).served, true);
  const replacement = service.forceArrive(account, 160);
  assert.equal(replacement.guest.id, 1);
  assert.ok(replacement.mail, 'settlement mail survives replacing an expired visit');
  assert.equal(service.forceDepart(account, 161).guest.id, -1);
  assert.equal(service.forceDepart(account, 162).replayed, true);
  assert.equal(service.forceArrive(account, 163).guest.id, 2, 'management may bypass cooldown');
  service.serve(account, 2, 3001, 164);
  const departure = service.forceDepart(account, 165);
  assert.equal(departure.mail.sender, 2);
  assert.equal(departure.mail.resource.clover_point, 20);
  assert.equal(service.forceDepart(account, 166).mail, null);
});

test('a database error during gift creation rolls back departure for a safe retry', t => {
  const { database, service, account } = fixture(t);
  service.sync(account, 100);
  database.changeInventory(account, 3001, 1);
  service.serve(account, 0, 3001, 110);
  database.db.exec("CREATE TRIGGER fail_neighbor_mail BEFORE INSERT ON mails WHEN NEW.title='困困的回礼' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(() => service.finish(account, 160), /test failure/);
  assert.equal(service.state(account).served, true);
  assert.equal(service.state(account).id, 0);
  database.db.exec('DROP TRIGGER fail_neighbor_mail;');
  assert.ok(service.finish(account, 161).mail);
  assert.equal(service.finish(account, 162).mail, null);
});

test('offline restart and snapshot round-trip preserve feeding and pending rewards', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-neighbor-restart-'));
  const filename = path.join(directory, 'test.sqlite');
  let database = new FrogDatabase(filename);
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  let service = new NeighborService(database, CATALOG, { durationSeconds: 60, cooldownSeconds: 120 });
  database.ensureAccount('restart');
  service.sync('restart', 100);
  database.changeInventory('restart', 3001, 2);
  service.serve('restart', 0, 3001, 110);
  const snapshot = getNeighborState(database, 'restart');
  database.close();
  database = new FrogDatabase(filename);
  service = new NeighborService(database, CATALOG, { durationSeconds: 60, cooldownSeconds: 120 });
  assert.deepEqual(getNeighborState(database, 'restart'), snapshot);
  const result = service.sync('restart', 10000);
  assert.ok(result.mail);
  assert.equal(service.sync('restart', 10001).mail, null);
  database.ensureAccount('imported');
  importNeighborState(database, 'imported', snapshot);
  assert.deepEqual(getNeighborState(database, 'imported'), snapshot);
  assert.ok(service.sync('imported', 10000).mail);
});

test('invalid imports and unavailable catalogs do not invent playable neighbors', t => {
  const { database, service, account } = fixture(t);
  for (const invalid of [
    { id: 3 }, { id: 0, feeling: 101 }, { id: 0, served: true },
    { id: -1, food_item: 3000, served: true }, { id: 0, confirmed: 'yes' }, { visit_count: -1 },
  ]) assert.throws(() => importNeighborState(database, account, invalid), /neighbor|Neighbor|Absent/);
  assert.equal(service.state(account).id, -1);
  const unavailable = new NeighborService(database, {});
  assert.equal(unavailable.sync(account, 100).guest.id, -1);
  assert.equal(unavailable.forceArrive(account, 100).ok, false);
  assert.deepEqual(neighborReward(80), { clover_point: 80, ticket: 1 });
  assert.deepEqual(neighborReward(60), { clover_point: 50, ticket: 0 });
  assert.deepEqual(neighborReward(20), { clover_point: 30, ticket: 0 });
  assert.deepEqual(neighborReward(19), { clover_point: 20, ticket: 0 });
});

test('arrival probability is evaluated once per persisted check interval and identities are sampled',t=>{
  const {database,account}=fixture(t);let calls=0;
  const service=new NeighborService(database,CATALOG,{durationSeconds:60,cooldownSeconds:120,arrivalChance:0.1,checkSeconds:30,random:()=>{calls++;return 0.9;}});
  service.sync(account,100);service.finish(account,160);
  assert.equal(service.sync(account,280).guest.id,-1);assert.equal(calls,1);
  assert.equal(service.state(account).next_visit_at,310);
  service.sync(account,281);service.sync(account,309);assert.equal(calls,1,'polling every second must not reroll the arrival chance');
  service.random=()=>0.05;const arrived=service.sync(account,310);assert.equal(arrived.guest.id,0,'same identity can revisit instead of a forced 0,1,2 cycle');
  assert.equal(service.sync(account,311).guest.id,0);assert.equal(service.state(account).expire_time,370,'resync keeps persisted departure time');
});

test('configured reward ranges remain stable across retries and service recreation',t=>{
  const {database,account}=fixture(t),options={durationSeconds:60,cooldownSeconds:120,rewardTable:[{feeling:80,clover:[60,100],ticket:[1,3]},{feeling:0,clover:[10,30],ticket:[0,0]}]};
  const service=new NeighborService(database,CATALOG,options);service.sync(account,100);database.changeInventory(account,3001,1);service.serve(account,0,3001,110);
  const state=service.state(account),reward=service.reward(account,state);assert.ok(reward.clover_point>=60&&reward.clover_point<=100);assert.ok(reward.ticket>=1&&reward.ticket<=3);
  assert.deepEqual(new NeighborService(database,CATALOG,options).reward(account,state),reward);
  const mail=service.finish(account,160).mail;assert.equal(mail.resource.clover_point,reward.clover_point);assert.equal(mail.resource.ticket,reward.ticket);assert.equal(service.finish(account,161).mail,null);
});
