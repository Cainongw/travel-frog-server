'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_SETTINGS = {
  guideStep: 'Complete',
  bgSound: 1,
  effectSound: 1,
  hasAchieve: false,
  hasOpenAttributeView: false,
  hasEnteredRaffle: false,
  hasOpenedDesk: false,
  hasBuyTool: false,
  hasFriendVisit: false,
  achieveList: [],
  guideVisitor: false,
  guideVisitorGift: false,
  guideStory: false,
  guideStoryGift: false,
  hasOpenedNote: false,
  guideNote: false,
  guideHandCraft: false,
  guideSlidePicture: false,
  guideFurniture: 0,
  guideAnnualReview: true,
  guideFurnitureNotice: false,
  guideDrawing: 0,
  noticeDrawing: 0,
  guideCamera: false,
};

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function stringify(value, fallback) {
  return JSON.stringify(value == null ? fallback : value);
}

function normalizeAccount(value) {
  const account = String(value || 'guest').trim();
  return account.slice(0, 128) || 'guest';
}

function rowToPostcard(row) {
  return {
    id: row.id,
    pic_id: row.pic_id,
    layers: parseJson(row.layers_json, []),
    for_ads: Boolean(row.for_ads),
    visit: Boolean(row.visit),
  };
}

class FrogDatabase {
  constructor(filename, seedPostcards = []) {
    this.filename = filename;
    this.seedPostcards = seedPostcards;
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        account TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        frog_name TEXT NOT NULL DEFAULT '旅行青蛙',
        icon INTEGER NOT NULL DEFAULT 0,
        current_achievement INTEGER NOT NULL DEFAULT -1,
        current_picture_id INTEGER,
        clover INTEGER NOT NULL DEFAULT 0,
        ticket INTEGER NOT NULL DEFAULT 0,
        push_switch INTEGER NOT NULL DEFAULT 0,
        rank_switch INTEGER NOT NULL DEFAULT 0,
        settings_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS postcards (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        id INTEGER NOT NULL,
        pic_id INTEGER NOT NULL,
        layers_json TEXT NOT NULL,
        for_ads INTEGER NOT NULL DEFAULT 0,
        visit INTEGER NOT NULL DEFAULT 0,
        location TEXT NOT NULL DEFAULT 'album' CHECK(location IN ('album','new','recycle','gift')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account, id)
      );
      CREATE INDEX IF NOT EXISTS postcards_location ON postcards(account, location, id);

      CREATE TABLE IF NOT EXISTS moments (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        moment_id INTEGER NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (account, moment_id)
      );

      CREATE TABLE IF NOT EXISTS travel_notes (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        note_id INTEGER NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account, note_id)
      );

      CREATE TABLE IF NOT EXISTS stories (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        story_id INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (account, story_id)
      );

      CREATE TABLE IF NOT EXISTS handbook (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('collection','specialty')),
        item_id INTEGER NOT NULL,
        PRIMARY KEY (account, kind, item_id)
      );

      CREATE TABLE IF NOT EXISTS achievements (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        achievement_id INTEGER NOT NULL,
        achieved_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account, achievement_id)
      );

      CREATE TABLE IF NOT EXISTS encyclopedia_unlocks (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        entry_id INTEGER NOT NULL,
        description_ids_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (account, entry_id)
      );

      CREATE TABLE IF NOT EXISTS encyclopedia_show_sub (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        entry_id INTEGER NOT NULL,
        sub_id INTEGER NOT NULL,
        PRIMARY KEY (account, entry_id)
      );

      CREATE TABLE IF NOT EXISTS gift_specialties (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        item_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account, item_id)
      );

      PRAGMA user_version = 1;
    `);
  }

  transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ensureAccount(value, seed = true) {
    const account = normalizeAccount(value);
    let row = this.db.prepare('SELECT * FROM accounts WHERE account = ?').get(account);
    if (row) return row;
    const now = Math.floor(Date.now() / 1000);
    this.transaction(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO accounts
          (account, uid, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(account, `local-${account}`, JSON.stringify(DEFAULT_SETTINGS), now, now);
      if (seed) {
        const insert = this.db.prepare(`
          INSERT OR IGNORE INTO postcards
            (account, id, pic_id, layers_json, for_ads, visit, location, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'album', ?, ?)
        `);
        for (const picture of this.seedPostcards) {
          insert.run(account, picture.id, picture.pic_id, stringify(picture.layers, []),
            picture.for_ads ? 1 : 0, picture.visit ? 1 : 0, now, now);
        }
      }
    });
    row = this.db.prepare('SELECT * FROM accounts WHERE account = ?').get(account);
    return row;
  }

  getAccounts() {
    return this.db.prepare('SELECT account, uid, frog_name, updated_at FROM accounts ORDER BY updated_at DESC').all();
  }

  getRole(value) {
    const row = this.ensureAccount(value);
    const achievements = this.db.prepare(
      'SELECT achievement_id AS id, achieved_at AS time FROM achievements WHERE account = ? ORDER BY achievement_id',
    ).all(row.account);
    let currentPicture = [];
    if (row.current_picture_id != null) {
      const picture = this.db.prepare('SELECT layers_json FROM postcards WHERE account = ? AND id = ?').get(row.account, row.current_picture_id);
      if (picture) currentPicture = parseJson(picture.layers_json, []);
    }
    return {
      uid: row.uid,
      res: { clover_point: row.clover, ticket: row.ticket },
      settings: {
        client: row.settings_json,
        push_switch: Boolean(row.push_switch),
        rank_switch: Boolean(row.rank_switch),
      },
      misc: {
        picture_cnt: this.countPostcards(row.account, 'album'),
        wx_push_reward: false,
        wx_my_reward: false,
        create_time: row.created_at,
      },
      frog: {
        name: row.frog_name,
        cur_achieve: row.current_achievement,
        achieves: achievements.map(item => item.id),
        achieves_time: achievements,
        status: 0,
        motion: 0,
        icon: row.icon,
        pic_show: currentPicture,
        decoration: [],
        taobao_data: null,
      },
    };
  }

  updateAccount(value, fields) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    const allowed = new Map([
      ['uid', 'uid'], ['frog_name', 'frog_name'], ['icon', 'icon'], ['current_achievement', 'current_achievement'],
      ['current_picture_id', 'current_picture_id'], ['clover', 'clover'], ['ticket', 'ticket'],
      ['push_switch', 'push_switch'], ['rank_switch', 'rank_switch'], ['settings_json', 'settings_json'],
      ['created_at', 'created_at'],
    ]);
    const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
    if (!entries.length) return;
    const assignments = entries.map(([key]) => `${allowed.get(key)} = ?`).join(', ');
    const values = entries.map(([, fieldValue]) => fieldValue);
    this.db.prepare(`UPDATE accounts SET ${assignments}, updated_at = ? WHERE account = ?`)
      .run(...values, Math.floor(Date.now() / 1000), account);
  }

  updateSettings(account, settingsJson) {
    const settings = parseJson(settingsJson, null);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
    this.updateAccount(account, { settings_json: JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }) });
    return true;
  }

  countPostcards(value, location) {
    const account = normalizeAccount(value);
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM postcards WHERE account = ? AND location = ?').get(account, location).count);
  }

  getPostcards(value, location = 'album', ids = null, start = null, count = null) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    let rows;
    if (Array.isArray(ids)) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => '?').join(',');
      rows = this.db.prepare(`SELECT * FROM postcards WHERE account = ? AND location = ? AND id IN (${placeholders}) ORDER BY id`)
        .all(account, location, ...ids.map(Number));
    } else if (start != null && count != null) {
      rows = this.db.prepare('SELECT * FROM postcards WHERE account = ? AND location = ? ORDER BY id LIMIT ? OFFSET ?')
        .all(account, location, Math.max(0, Number(count)), Math.max(0, Number(start) - 1));
    } else {
      rows = this.db.prepare('SELECT * FROM postcards WHERE account = ? AND location = ? ORDER BY id').all(account, location);
    }
    return rows.map(rowToPostcard);
  }

  movePostcard(value, id, from, to) {
    const account = normalizeAccount(value);
    const result = this.db.prepare(
      'UPDATE postcards SET location = ?, updated_at = ? WHERE account = ? AND id = ? AND location = ?',
    ).run(to, Math.floor(Date.now() / 1000), account, Number(id), from);
    return result.changes > 0;
  }

  deletePostcard(value, id, location) {
    return this.db.prepare('DELETE FROM postcards WHERE account = ? AND id = ? AND location = ?')
      .run(normalizeAccount(value), Number(id), location).changes > 0;
  }

  deleteGiftPostcard(value, id) {
    return this.db.prepare('DELETE FROM postcards WHERE account = ? AND id = ? AND location = ?')
      .run(normalizeAccount(value), Number(id), 'gift').changes > 0;
  }

  getMoments(value) {
    return this.db.prepare('SELECT moment_id FROM moments WHERE account = ? ORDER BY moment_id')
      .all(normalizeAccount(value)).map(row => row.moment_id);
  }

  unlockMoment(value, id) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    this.db.prepare('INSERT OR IGNORE INTO moments(account, moment_id, unlocked_at) VALUES (?, ?, ?)')
      .run(account, Number(id), Math.floor(Date.now() / 1000));
  }

  getTravelNotes(value) {
    return this.db.prepare('SELECT note_id AS id, is_read AS read, timestamp FROM travel_notes WHERE account = ? ORDER BY timestamp DESC, note_id')
      .all(normalizeAccount(value)).map(row => ({ ...row, read: Boolean(row.read) }));
  }

  markTravelNotesRead(value, ids) {
    const account = normalizeAccount(value);
    const list = Array.isArray(ids) ? ids : [ids];
    const update = this.db.prepare('UPDATE travel_notes SET is_read = 1 WHERE account = ? AND note_id = ?');
    this.transaction(() => list.forEach(id => update.run(account, Number(id))));
  }

  getStories(value) {
    return this.db.prepare('SELECT data_json FROM stories WHERE account = ? ORDER BY story_id')
      .all(normalizeAccount(value)).map(row => parseJson(row.data_json, {}));
  }

  getHandbook(value) {
    const account = normalizeAccount(value);
    const rows = this.db.prepare('SELECT kind, item_id FROM handbook WHERE account = ? ORDER BY item_id').all(account);
    return {
      collections: rows.filter(row => row.kind === 'collection').map(row => row.item_id),
      specialtys: rows.filter(row => row.kind === 'specialty').map(row => row.item_id),
    };
  }

  getEncyclopedia(value) {
    const account = normalizeAccount(value);
    const unlocks = this.db.prepare('SELECT entry_id AS id, description_ids_json FROM encyclopedia_unlocks WHERE account = ? ORDER BY entry_id').all(account);
    const showSub = this.db.prepare('SELECT entry_id AS id, sub_id FROM encyclopedia_show_sub WHERE account = ? ORDER BY entry_id').all(account);
    return {
      unlock_list: unlocks.map(row => row.id),
      unlock_desc: unlocks.map(row => ({ id: row.id, list: parseJson(row.description_ids_json, []) })),
      show_sub: showSub,
    };
  }

  setEncyclopediaShowSub(value, entryId, subId = entryId) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    this.db.prepare(`
      INSERT INTO encyclopedia_show_sub(account, entry_id, sub_id) VALUES (?, ?, ?)
      ON CONFLICT(account, entry_id) DO UPDATE SET sub_id = excluded.sub_id
    `).run(account, Number(entryId), Number(subId));
  }

  getGiftBox(value) {
    const account = normalizeAccount(value);
    return {
      pictures: this.getPostcards(account, 'gift'),
      specialtys: this.db.prepare('SELECT item_id, count FROM gift_specialties WHERE account = ? AND count > 0 ORDER BY item_id').all(account),
    };
  }

  exportAccount(value) {
    const account = normalizeAccount(value);
    const row = this.db.prepare('SELECT * FROM accounts WHERE account = ?').get(account);
    if (!row) throw new Error(`account not found: ${account}`);
    const encyclopedia = this.getEncyclopedia(account);
    return {
      format: 'travel-frog-save',
      version: 1,
      exported_at: Math.floor(Date.now() / 1000),
      account: {
        account: row.account,
        uid: row.uid,
        frog_name: row.frog_name,
        icon: row.icon,
        current_achievement: row.current_achievement,
        current_picture_id: row.current_picture_id,
        clover: row.clover,
        ticket: row.ticket,
        push_switch: Boolean(row.push_switch),
        rank_switch: Boolean(row.rank_switch),
        settings: parseJson(row.settings_json, DEFAULT_SETTINGS),
        created_at: row.created_at,
      },
      postcards: ['album', 'new', 'recycle', 'gift'].flatMap(location =>
        this.getPostcards(account, location).map(postcard => ({ ...postcard, location }))),
      moments: this.getMoments(account),
      travel_notes: this.getTravelNotes(account),
      stories: this.getStories(account),
      achievements: this.db.prepare(
        'SELECT achievement_id AS id, achieved_at AS time FROM achievements WHERE account = ? ORDER BY achievement_id',
      ).all(account),
      handbook: this.getHandbook(account),
      encyclopedia,
      gift_specialties: this.getGiftBox(account).specialtys,
    };
  }

  importAccount(snapshot, replace = true) {
    if (!snapshot || snapshot.format !== 'travel-frog-save' || snapshot.version !== 1) {
      throw new Error('unsupported save format');
    }
    const sourceAccount = typeof snapshot.account === 'string' ? { account: snapshot.account } : snapshot.account;
    const account = normalizeAccount(sourceAccount && sourceAccount.account);
    const now = Math.floor(Date.now() / 1000);
    this.ensureAccount(account, false);
    this.transaction(() => {
      if (replace) {
        for (const table of ['postcards', 'moments', 'travel_notes', 'stories', 'handbook', 'achievements',
          'encyclopedia_unlocks', 'encyclopedia_show_sub', 'gift_specialties']) {
          this.db.prepare(`DELETE FROM ${table} WHERE account = ?`).run(account);
        }
      }
      this.updateAccount(account, {
        uid: String(sourceAccount.uid || `local-${account}`),
        frog_name: String(sourceAccount.frog_name || '旅行青蛙'),
        icon: Number(sourceAccount.icon || 0),
        current_achievement: Number(sourceAccount.current_achievement ?? -1),
        current_picture_id: sourceAccount.current_picture_id == null ? null : Number(sourceAccount.current_picture_id),
        clover: Number(sourceAccount.clover || 0),
        ticket: Number(sourceAccount.ticket || 0),
        push_switch: sourceAccount.push_switch ? 1 : 0,
        rank_switch: sourceAccount.rank_switch ? 1 : 0,
        settings_json: stringify({ ...DEFAULT_SETTINGS, ...(sourceAccount.settings || {}) }, DEFAULT_SETTINGS),
        created_at: Number(sourceAccount.created_at || now),
      });

      const insertPostcard = this.db.prepare(`
        INSERT INTO postcards(account,id,pic_id,layers_json,for_ads,visit,location,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(account,id) DO UPDATE SET pic_id=excluded.pic_id,layers_json=excluded.layers_json,
          for_ads=excluded.for_ads,visit=excluded.visit,location=excluded.location,updated_at=excluded.updated_at
      `);
      for (const item of snapshot.postcards || []) {
        const location = ['album', 'new', 'recycle', 'gift'].includes(item.location) ? item.location : 'album';
        insertPostcard.run(account, Number(item.id), Number(item.pic_id), stringify(item.layers, []),
          item.for_ads ? 1 : 0, item.visit ? 1 : 0, location, now, now);
      }

      const insertMoment = this.db.prepare('INSERT OR IGNORE INTO moments(account,moment_id,unlocked_at) VALUES (?,?,?)');
      for (const id of snapshot.moments || []) insertMoment.run(account, Number(id), now);

      const insertNote = this.db.prepare(`
        INSERT INTO travel_notes(account,note_id,is_read,timestamp) VALUES (?,?,?,?)
        ON CONFLICT(account,note_id) DO UPDATE SET is_read=excluded.is_read,timestamp=excluded.timestamp
      `);
      for (const note of snapshot.travel_notes || []) insertNote.run(account, Number(note.id), note.read ? 1 : 0, Number(note.timestamp || 0));

      const insertStory = this.db.prepare(`
        INSERT INTO stories(account,story_id,data_json) VALUES (?,?,?)
        ON CONFLICT(account,story_id) DO UPDATE SET data_json=excluded.data_json
      `);
      for (const story of snapshot.stories || []) insertStory.run(account, Number(story.id), stringify(story, {}));

      const insertAchievement = this.db.prepare(`
        INSERT INTO achievements(account,achievement_id,achieved_at) VALUES (?,?,?)
        ON CONFLICT(account,achievement_id) DO UPDATE SET achieved_at=excluded.achieved_at
      `);
      for (const item of snapshot.achievements || []) {
        const id = typeof item === 'object' ? item.id : item;
        const achievedAt = typeof item === 'object' ? item.time : 0;
        insertAchievement.run(account, Number(id), Number(achievedAt || 0));
      }

      const insertHandbook = this.db.prepare('INSERT OR IGNORE INTO handbook(account,kind,item_id) VALUES (?,?,?)');
      for (const id of (snapshot.handbook && snapshot.handbook.collections) || []) insertHandbook.run(account, 'collection', Number(id));
      for (const id of (snapshot.handbook && snapshot.handbook.specialtys) || []) insertHandbook.run(account, 'specialty', Number(id));

      const insertUnlock = this.db.prepare(`
        INSERT INTO encyclopedia_unlocks(account,entry_id,description_ids_json) VALUES (?,?,?)
        ON CONFLICT(account,entry_id) DO UPDATE SET description_ids_json=excluded.description_ids_json
      `);
      for (const item of (snapshot.encyclopedia && snapshot.encyclopedia.unlock_desc) || []) {
        insertUnlock.run(account, Number(item.id), stringify(item.list, []));
      }
      const insertUnlockId = this.db.prepare(
        'INSERT OR IGNORE INTO encyclopedia_unlocks(account,entry_id,description_ids_json) VALUES (?,?,?)',
      );
      for (const id of (snapshot.encyclopedia && snapshot.encyclopedia.unlock_list) || []) {
        insertUnlockId.run(account, Number(id), '[]');
      }
      const insertShow = this.db.prepare(`
        INSERT INTO encyclopedia_show_sub(account,entry_id,sub_id) VALUES (?,?,?)
        ON CONFLICT(account,entry_id) DO UPDATE SET sub_id=excluded.sub_id
      `);
      for (const item of (snapshot.encyclopedia && snapshot.encyclopedia.show_sub) || []) {
        insertShow.run(account, Number(item.id), Number(item.sub_id));
      }

      const insertGift = this.db.prepare(`
        INSERT INTO gift_specialties(account,item_id,count) VALUES (?,?,?)
        ON CONFLICT(account,item_id) DO UPDATE SET count=excluded.count
      `);
      for (const item of snapshot.gift_specialties || []) insertGift.run(account, Number(item.item_id), Number(item.count || 0));
    });
    return this.exportAccount(account);
  }

  close() {
    this.db.close();
  }
}

module.exports = { FrogDatabase, DEFAULT_SETTINGS, normalizeAccount };
