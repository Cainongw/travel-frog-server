'use strict';

const crypto = require('node:crypto');
// Keep the module independent so database.js can call these migration helpers.
const normalizeAccount = value => String(value || 'guest').trim().slice(0, 128) || 'guest';

// These values are present in the APK's Tabikaeru.Define; they are not a
// recovered copy of the official server's random-number implementation.
const DRAW_COST = 5;
const RANK_WEIGHTS = Object.freeze([40, 25, 22, 9, 3, 1]);

function migrateGameplay(database) {
  database.db.exec(`
    CREATE TABLE IF NOT EXISTS gacha_state (
      account TEXT PRIMARY KEY REFERENCES accounts(account) ON DELETE CASCADE,
      color_ball INTEGER NOT NULL DEFAULT -1 CHECK(color_ball BETWEEN -1 AND 5),
      reward_credits INTEGER NOT NULL DEFAULT 0 CHECK(reward_credits >= 0),
      draw_count INTEGER NOT NULL DEFAULT 0 CHECK(draw_count >= 0)
    );
  `);
}

function getGachaState(database, value) {
  const row = database.db.prepare(
    'SELECT color_ball,reward_credits,draw_count FROM gacha_state WHERE account=?',
  ).get(normalizeAccount(value));
  return row ? { ...row } : { color_ball: -1, reward_credits: 0, draw_count: 0 };
}

function checkedInteger(value, name, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid gacha ${name}`);
  return value;
}

// Called within the existing account-import transaction. Version 1-4 saves
// without this optional state are interpreted as having no outstanding draw.
function importGachaState(database, value, state = {}) {
  const account = normalizeAccount(value);
  const ball = checkedInteger(state.color_ball ?? -1, 'color_ball', -1, 5);
  const credits = checkedInteger(state.reward_credits ?? 0, 'reward_credits', 0);
  const count = checkedInteger(state.draw_count ?? 0, 'draw_count', 0);
  database.db.prepare(`
    INSERT INTO gacha_state(account,color_ball,reward_credits,draw_count) VALUES (?,?,?,?)
    ON CONFLICT(account) DO UPDATE SET color_ball=excluded.color_ball,
      reward_credits=excluded.reward_credits,draw_count=excluded.draw_count
  `).run(account, ball, credits, count);
}

// Credits must originate in a trusted, once-only settlement such as mail_open.
// The caller should invoke this inside that settlement's transaction.
function grantGachaCredits(database, value, count) {
  checkedInteger(count, 'reward credit count', 1, 999);
  const account = normalizeAccount(value);
  database.ensureAccount(account);
  database.db.prepare(`
    INSERT INTO gacha_state(account,reward_credits) VALUES (?,?)
    ON CONFLICT(account) DO UPDATE SET reward_credits=reward_credits+excluded.reward_credits
  `).run(account, count);
  return getGachaState(database, account);
}

class GameplayService {
  constructor(database, catalog, options = {}) {
    this.database = database;
    this.randomInt = options.randomInt || crypto.randomInt;
    migrateGameplay(database);
    const itemIds = new Set((catalog.items || []).map(item => item.id));
    this.prizes = new Map();
    for (const prize of catalog.prizes || []) {
      if (!Number.isSafeInteger(prize.id) || prize.id < 0 ||
          !Number.isSafeInteger(prize.rank) || prize.rank < 0 || prize.rank > 5 ||
          !Number.isSafeInteger(prize.stock) || prize.stock < 1 || prize.stock > 99 ||
          (prize.rank !== 0 && !itemIds.has(prize.itemId))) continue;
      this.prizes.set(prize.id, { ...prize });
    }
    this.available = RANK_WEIGHTS.every((_, rank) => [...this.prizes.values()].some(prize => prize.rank === rank));
  }

  getState(account) {
    return getGachaState(this.database, account);
  }

  draw(value, isReward = false) {
    const database = this.database;
    const account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const balance = database.db.prepare('SELECT ticket FROM accounts WHERE account=?').get(account).ticket;
      const state = this.getState(account);
      const failed = reason => ({ ok: false, rank: -1, ticket_balance: balance, reason });
      if (typeof isReward !== 'boolean') return failed('is_reward must be boolean');
      if (state.color_ball !== -1) {
        return { ok: true, rank: state.color_ball, ticket_balance: balance, replayed: true };
      }
      if (!this.available) return failed('Prize catalog is unavailable');
      if (isReward ? state.reward_credits < 1 : balance < DRAW_COST) {
        return failed(isReward ? 'No reward draw credit' : 'Not enough tickets');
      }
      let roll = checkedInteger(this.randomInt(100), 'random result', 0, 99);
      let rank = 0;
      while (roll >= RANK_WEIGHTS[rank]) roll -= RANK_WEIGHTS[rank++];
      const nextBalance = balance - (isReward ? 0 : DRAW_COST);
      database.db.prepare('UPDATE accounts SET ticket=?,updated_at=? WHERE account=?')
        .run(nextBalance, Math.floor(Date.now() / 1000), account);
      importGachaState(database, account, {
        color_ball: rank,
        reward_credits: state.reward_credits - (isReward ? 1 : 0),
        draw_count: state.draw_count + 1,
      });
      return { ok: true, rank, ticket_balance: nextBalance, replayed: false };
    });
  }

  redeem(value, prizeId) {
    const database = this.database;
    const account = database.ensureAccount(value).account;
    return database.transaction(() => {
      const balance = database.db.prepare('SELECT ticket FROM accounts WHERE account=?').get(account).ticket;
      const failed = reason => ({ ok: false, ticket_balance: balance, itemChanges: [], reason });
      const state = this.getState(account);
      if (state.color_ball === -1) return failed('No pending prize');
      const prize = Number.isSafeInteger(prizeId) ? this.prizes.get(prizeId) : null;
      if (!prize || prize.rank !== state.color_ball) return failed('Prize does not match the drawn color');
      let nextBalance = balance;
      const itemChanges = [];
      if (prize.rank === 0) {
        // RaffleView's white-ball branch awards Prize.stock tickets, not clover.
        nextBalance += prize.stock;
        database.db.prepare('UPDATE accounts SET ticket=?,updated_at=? WHERE account=?')
          .run(nextBalance, Math.floor(Date.now() / 1000), account);
      } else {
        itemChanges.push({ item_id: prize.itemId, count: database.changeInventory(account, prize.itemId, prize.stock) });
      }
      database.db.prepare('UPDATE gacha_state SET color_ball=-1 WHERE account=?').run(account);
      return { ok: true, ticket_balance: nextBalance, itemChanges, prize_id: prize.id };
    });
  }
}

module.exports = { GameplayService, migrateGameplay, getGachaState, importGachaState, grantGachaCredits, DRAW_COST, RANK_WEIGHTS };
