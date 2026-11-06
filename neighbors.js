'use strict';

const accountKey = value => String(value || 'guest').trim().slice(0, 128) || 'guest';
const clock = () => Math.floor(Date.now() / 1000);
const DEFAULT_NEIGHBOR = Object.freeze({
  id: -1, confirmed: false, served: false, expire_time: 0, pos: 0,
  food_item: -1, feeling: 0, next_visit_at: 0, visit_count: 0,
});

function number(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid neighbor ${field}`);
  return value;
}

function migrateNeighbors(database) {
  database.db.exec(`
    CREATE TABLE IF NOT EXISTS neighbor_state (
      account TEXT PRIMARY KEY REFERENCES accounts(account) ON DELETE CASCADE,
      id INTEGER NOT NULL DEFAULT -1 CHECK(id BETWEEN -1 AND 2),
      confirmed INTEGER NOT NULL DEFAULT 0,
      served INTEGER NOT NULL DEFAULT 0,
      expire_time INTEGER NOT NULL DEFAULT 0,
      pos INTEGER NOT NULL DEFAULT 0,
      food_item INTEGER NOT NULL DEFAULT -1,
      feeling INTEGER NOT NULL DEFAULT 0,
      next_visit_at INTEGER NOT NULL DEFAULT 0,
      visit_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function getNeighborState(database, value) {
  const row = database.db.prepare(`
    SELECT id,confirmed,served,expire_time,pos,food_item,feeling,next_visit_at,visit_count
    FROM neighbor_state WHERE account=?
  `).get(accountKey(value));
  return row ? { ...row, confirmed: Boolean(row.confirmed), served: Boolean(row.served) } : { ...DEFAULT_NEIGHBOR };
}

function importNeighborState(database, value, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid neighbor state');
  const state = { ...DEFAULT_NEIGHBOR, ...input };
  number(state.id, 'id', -1, 2);
  number(state.expire_time, 'expire_time'); number(state.pos, 'pos', 0, 2);
  number(state.food_item, 'food_item', -1, 999999); number(state.feeling, 'feeling', 0, 100);
  number(state.next_visit_at, 'next_visit_at'); number(state.visit_count, 'visit_count');
  if (typeof state.confirmed !== 'boolean' || typeof state.served !== 'boolean') throw Error('Invalid neighbor flags');
  if (state.id === -1 && (state.served || state.confirmed || state.expire_time !== 0 || state.food_item !== -1)) {
    throw Error('Absent neighbor cannot retain active visit state');
  }
  if (state.served !== (state.food_item >= 0)) throw Error('Neighbor food and served flag disagree');
  database.db.prepare(`
    INSERT INTO neighbor_state(account,id,confirmed,served,expire_time,pos,food_item,feeling,next_visit_at,visit_count)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account) DO UPDATE SET
      id=excluded.id,confirmed=excluded.confirmed,served=excluded.served,expire_time=excluded.expire_time,
      pos=excluded.pos,food_item=excluded.food_item,feeling=excluded.feeling,
      next_visit_at=excluded.next_visit_at,visit_count=excluded.visit_count
  `).run(accountKey(value), state.id, +state.confirmed, +state.served, state.expire_time,
    state.pos, state.food_item, state.feeling, state.next_visit_at, state.visit_count);
  return state;
}

function guestProtocol(state) {
  return { id: state.id, confirmed: state.confirmed, served: state.served, expire_time: state.expire_time, pos: state.pos };
}

// Local policy, not recovered official server logic. Taste values and client
// feedback thresholds are observed; the amounts below are deliberately explicit.
function neighborReward(feeling) {
  if (feeling >= 80) return { clover_point: 80, ticket: 1 };
  if (feeling >= 60) return { clover_point: 50, ticket: 0 };
  if (feeling >= 20) return { clover_point: 30, ticket: 0 };
  return { clover_point: 20, ticket: 0 };
}

class NeighborService {
  constructor(database, catalog = {}, options = {}) {
    this.database = database;
    migrateNeighbors(database);
    this.duration = number(options.durationSeconds ?? 1800, 'duration', 1, 86400);
    this.cooldown = number(options.cooldownSeconds ?? 21600, 'cooldown', 1, 604800);
    this.characters = new Map((catalog.neighbors || []).map(x => [x.id, x]));
    this.items = new Map((catalog.items || []).map(x => [x.id, x]));
    this.specialtyIndex = new Map((catalog.specialties || []).map((x, index) => [x.itemId, index]));
    this.available = [0, 1, 2].every(id => Array.isArray(this.characters.get(id)?.taste)) && this.specialtyIndex.size > 0;
  }

  state(account) { return getNeighborState(this.database, account); }
  result(account, fields = {}) {
    return { ok: true, guest: guestProtocol(this.state(account)), mail: null, changed: false, ...fields };
  }

  visitorActive(account, now) {
    const row = this.database.db.prepare('SELECT visitor_json FROM visitor_state WHERE account=?').get(account);
    const visitor = row?.visitor_json ? JSON.parse(row.visitor_json) : null;
    return !!visitor && (visitor.expire_time === 0 || visitor.expire_time > now);
  }

  // Caller owns a transaction. Reward creation and clearing the visit commit
  // together, so reconnects/restarts cannot issue a second copy of the gift.
  settle(account, now) {
    const database = this.database, state = this.state(account);
    if (state.id < 0 || state.expire_time <= 0 || state.expire_time > now) return null;
    let mail = null;
    if (state.served) {
      const reward = neighborReward(state.feeling);
      const resource = { ...reward, reward_gacha: 0, ads_id: '', share_id: '' };
      const id = Math.max(now * 1000, Number(database.db.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM mails WHERE account=?').get(account).id));
      const name = this.characters.get(state.id)?.name || ['困困', '胖胖', '跳跳'][state.id];
      database.db.prepare(`INSERT INTO mails(account,id,type,sender,timestamp,title,message,resource_json,items_json,pictures_json)
        VALUES (?,?,3,?,?,?,?,?,'[]','[]')`).run(account, id, state.id, now, `${name}的回礼`, '谢谢你的招待！这是送给你的礼物。', JSON.stringify(resource));
      mail = database.getMail(account, id);
    }
    importNeighborState(database, account, { ...DEFAULT_NEIGHBOR, visit_count: state.visit_count,
      next_visit_at: now + this.cooldown });
    return { mail };
  }

  arrive(account, now) {
    const state = this.state(account);
    importNeighborState(this.database, account, { ...DEFAULT_NEIGHBOR, id: state.visit_count % 3,
      expire_time: now + this.duration, visit_count: state.visit_count + 1 });
  }

  sync(value, now = clock()) {
    number(now, 'time');
    const database = this.database, account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const finished = this.settle(account, now);
      let changed = Boolean(finished);
      const state = this.state(account);
      if (this.available && state.id < 0 && state.next_visit_at <= now && !this.visitorActive(account, now)) {
        this.arrive(account, now); changed = true;
      }
      return this.result(account, { mail: finished?.mail || null, changed });
    });
  }

  confirm(value, id, now = clock()) {
    const database = this.database, account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const state = this.state(account);
      if (id !== state.id || state.id < 0 || state.expire_time <= now) return this.result(account, { ok: false, reason: 'Neighbor is not present' });
      if (state.confirmed) return this.result(account, { replayed: true });
      importNeighborState(database, account, { ...state, confirmed: true });
      return this.result(account, { changed: true });
    });
  }

  serve(value, id, itemId, now = clock()) {
    const database = this.database, account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const state = this.state(account);
      const failed = reason => this.result(account, { ok: false, reason, itemChanges: [] });
      if (id !== state.id || state.id < 0 || state.expire_time <= now) return failed('Neighbor is not present');
      if (state.served) return failed('Neighbor already served');
      const index = this.specialtyIndex.get(itemId), item = this.items.get(itemId);
      const feeling = this.characters.get(id)?.taste[index];
      if (!Number.isSafeInteger(itemId) || item?.type !== 3 || index === undefined || !Number.isSafeInteger(feeling) || feeling < 0 || feeling > 100) {
        return failed('Expected a known specialty with a taste entry');
      }
      if (database.getInventoryCount(account, itemId) < 1) return failed('Specialty not owned');
      const count = database.changeInventory(account, itemId, -1);
      importNeighborState(database, account, { ...state, served: true, food_item: itemId, feeling });
      return this.result(account, { changed: true, feeling, itemChanges: [{ item_id: itemId, count }] });
    });
  }

  setExpire(value, time, now = clock()) {
    const database = this.database, account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const state = this.state(account);
      if (state.id < 0 || !Number.isSafeInteger(time) || time <= now || time > now + 86400) {
        return this.result(account, { ok: false, reason: 'Invalid neighbor departure time' });
      }
      if (state.expire_time > 0) return this.result(account, { replayed: true });
      importNeighborState(database, account, { ...state, expire_time: time });
      return this.result(account, { changed: true });
    });
  }

  finish(value, now = clock()) {
    const database = this.database, account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const finished = this.settle(account, now);
      if (!finished) return this.result(account, { ok: this.state(account).id < 0, reason: 'Neighbor has not departed' });
      return this.result(account, { mail: finished.mail, changed: true });
    });
  }

  forceArrive(value, now = clock()) {
    const database = this.database, account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const finished = this.settle(account, now);
      const result = { mail: finished?.mail || null, changed: Boolean(finished) };
      if (this.state(account).id >= 0) return this.result(account, { ...result, replayed: true });
      if (!this.available || this.visitorActive(account, now)) return this.result(account, {
        ...result, ok: false, reason: !this.available ? 'Neighbor catalog unavailable' : 'A province visitor is still present',
      });
      this.arrive(account, now);
      return this.result(account, { ...result, changed: true });
    });
  }

  forceDepart(value, now = clock()) {
    const database = this.database, account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const state = this.state(account);
      if (state.id < 0) return this.result(account, { replayed: true });
      importNeighborState(database, account, { ...state, expire_time: now });
      const finished = this.settle(account, now);
      return this.result(account, { mail: finished?.mail || null, changed: true });
    });
  }
}

module.exports = { NeighborService, migrateNeighbors, getNeighborState, importNeighborState, guestProtocol, neighborReward };
