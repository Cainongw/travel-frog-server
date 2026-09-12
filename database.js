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
    `);

    this.ensureColumn('accounts', 'bag_json', "TEXT NOT NULL DEFAULT '[-1,-1,-1,-1,-1]' ");
    this.ensureColumn('accounts', 'desk_json', "TEXT NOT NULL DEFAULT '[-1,-1,-1]' ");
    this.ensureColumn('accounts', 'bag_completed', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('accounts', 'season', 'INTEGER NOT NULL DEFAULT 4');
    this.ensureColumn('accounts', 'hours_type', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('accounts', 'weather', 'INTEGER NOT NULL DEFAULT 0');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inventory (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        item_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
        PRIMARY KEY (account, item_id)
      );

      CREATE TABLE IF NOT EXISTS shop_purchases (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        shop_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
        PRIMARY KEY (account, shop_id)
      );

      CREATE TABLE IF NOT EXISTS clover_plots (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        clover_id INTEGER NOT NULL,
        element INTEGER NOT NULL DEFAULT 0,
        sprite INTEGER NOT NULL DEFAULT 1,
        last_harvest INTEGER NOT NULL DEFAULT 0,
        rebirth_span INTEGER NOT NULL DEFAULT 7200,
        PRIMARY KEY (account, clover_id)
      );

      CREATE TABLE IF NOT EXISTS mails (
        account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,
        id INTEGER NOT NULL,
        type INTEGER NOT NULL DEFAULT 3,
        sender INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        expire INTEGER NOT NULL DEFAULT 0,
        auto_open INTEGER NOT NULL DEFAULT 0,
        is_read INTEGER NOT NULL DEFAULT 0,
        opened INTEGER NOT NULL DEFAULT 0,
        resource_json TEXT NOT NULL DEFAULT '{}',
        items_json TEXT NOT NULL DEFAULT '[]',
        pictures_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (account, id)
      );
      CREATE INDEX IF NOT EXISTS mails_opened ON mails(account, opened, timestamp DESC);

      PRAGMA user_version = 2;
    `);

    for (const row of this.db.prepare('SELECT account FROM accounts').all()) this.seedBasicState(row.account);
  }

  ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(item => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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
        this.seedBasicState(account);
      }
    });
    row = this.db.prepare('SELECT * FROM accounts WHERE account = ?').get(account);
    return row;
  }

  seedBasicState(value) {
    const account = normalizeAccount(value);
    const insertPlot = this.db.prepare(`
      INSERT OR IGNORE INTO clover_plots(account,clover_id,element,sprite,last_harvest,rebirth_span)
      VALUES (?,?,?,?,0,7200)
    `);
    for (let id = 1; id <= 20; id++) {
      insertPlot.run(account, id, id === 20 ? 1 : 0, id % 2 === 0 ? 2 : 1);
    }

    const resource = { ticket: 0, clover_point: 500, reward_gacha: 0, ads_id: '', share_id: '' };
    const items = [{ item_id: 0, count: 1 }];
    this.db.prepare(`
      INSERT OR IGNORE INTO mails
        (account,id,type,sender,timestamp,title,message,resource_json,items_json,pictures_json)
      VALUES (?,9000001,3,0,?,'本地存档已启用','领取一些三叶草和旅行食品，开始离线生活。',?,?, '[]')
    `).run(account, Math.floor(Date.now() / 1000), JSON.stringify(resource), JSON.stringify(items));
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
      ['created_at', 'created_at'], ['bag_json', 'bag_json'], ['desk_json', 'desk_json'],
      ['bag_completed', 'bag_completed'], ['season', 'season'], ['hours_type', 'hours_type'],
      ['weather', 'weather'],
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

  getItemState(value) {
    const row = this.ensureAccount(value);
    return {
      house: this.db.prepare('SELECT item_id, count FROM inventory WHERE account = ? AND count > 0 ORDER BY item_id').all(row.account),
      bag: parseJson(row.bag_json, [-1, -1, -1, -1, -1]),
      desk: parseJson(row.desk_json, [-1, -1, -1]),
      bag_completed: Boolean(row.bag_completed),
      bag_conflict: false,
      desk_conflict: false,
      gacha: { color_ball: -1 },
    };
  }

  getInventoryCount(value, itemId) {
    const row = this.db.prepare('SELECT count FROM inventory WHERE account = ? AND item_id = ?')
      .get(normalizeAccount(value), Number(itemId));
    return row ? Number(row.count) : 0;
  }

  changeInventory(value, itemId, delta) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    const next = Math.max(0, this.getInventoryCount(account, itemId) + Number(delta));
    this.db.prepare(`
      INSERT INTO inventory(account,item_id,count) VALUES (?,?,?)
      ON CONFLICT(account,item_id) DO UPDATE SET count=excluded.count
    `).run(account, Number(itemId), next);
    return next;
  }

  placeItem(value, kind, position, itemId) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    const column = kind === 'bag' ? 'bag_json' : kind === 'desk' ? 'desk_json' : null;
    if (!column) throw new Error(`invalid equipment kind: ${kind}`);
    const index = Number(position) - 1;
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT ${column} AS slots FROM accounts WHERE account = ?`).get(account);
      const defaults = kind === 'bag' ? [-1, -1, -1, -1, -1] : [-1, -1, -1];
      const slots = parseJson(row.slots, defaults);
      if (!Number.isInteger(index) || index < 0 || index >= slots.length) return { ok: false, conflict: true };
      const nextItem = Number(itemId);
      const previousItem = Number(slots[index]);
      if (previousItem === nextItem) return { ok: true, conflict: false, changes: [] };
      const stock = this.getInventoryCount(account, nextItem);
      if (stock <= 0) return { ok: false, conflict: true, changes: [] };
      const changes = [{ item_id: nextItem, count: this.changeInventory(account, nextItem, -1) }];
      if (previousItem >= 0) changes.push({ item_id: previousItem, count: this.changeInventory(account, previousItem, 1) });
      slots[index] = nextItem;
      this.db.prepare(`UPDATE accounts SET ${column} = ?, updated_at = ? WHERE account = ?`)
        .run(JSON.stringify(slots), Math.floor(Date.now() / 1000), account);
      return { ok: true, conflict: false, changes };
    });
  }

  takeItem(value, kind, position) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    const column = kind === 'bag' ? 'bag_json' : kind === 'desk' ? 'desk_json' : null;
    if (!column) throw new Error(`invalid equipment kind: ${kind}`);
    const index = Number(position) - 1;
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT ${column} AS slots FROM accounts WHERE account = ?`).get(account);
      const defaults = kind === 'bag' ? [-1, -1, -1, -1, -1] : [-1, -1, -1];
      const slots = parseJson(row.slots, defaults);
      if (!Number.isInteger(index) || index < 0 || index >= slots.length) return { ok: false, conflict: true, changes: [] };
      const previousItem = Number(slots[index]);
      const changes = [];
      if (previousItem >= 0) changes.push({ item_id: previousItem, count: this.changeInventory(account, previousItem, 1) });
      slots[index] = -1;
      this.db.prepare(`UPDATE accounts SET ${column} = ?, updated_at = ? WHERE account = ?`)
        .run(JSON.stringify(slots), Math.floor(Date.now() / 1000), account);
      return { ok: true, conflict: false, changes };
    });
  }

  setBagCompleted(value, completed) {
    this.updateAccount(value, { bag_completed: completed ? 1 : 0 });
  }

  getShopPurchases(value) {
    return this.db.prepare('SELECT shop_id AS item_id, count FROM shop_purchases WHERE account = ? AND count > 0 ORDER BY shop_id')
      .all(normalizeAccount(value));
  }

  purchase(value, shopItem) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    return this.transaction(() => {
      const role = this.db.prepare('SELECT clover FROM accounts WHERE account = ?').get(account);
      const purchase = this.db.prepare('SELECT count FROM shop_purchases WHERE account = ? AND shop_id = ?')
        .get(account, shopItem.id);
      const purchased = purchase ? Number(purchase.count) : 0;
      if (shopItem.limit > 0 && purchased >= shopItem.limit) return { ok: false, reason: 'purchase limit reached' };
      if (shopItem.requires != null) {
        const prerequisite = this.db.prepare('SELECT count FROM shop_purchases WHERE account = ? AND shop_id = ?')
          .get(account, shopItem.requires);
        if (!prerequisite || prerequisite.count <= 0) return { ok: false, reason: 'prerequisite not purchased' };
      }
      if (role.clover < shopItem.price) return { ok: false, reason: 'not enough clover' };
      const clover = Number(role.clover) - shopItem.price;
      this.db.prepare('UPDATE accounts SET clover = ?, updated_at = ? WHERE account = ?')
        .run(clover, Math.floor(Date.now() / 1000), account);
      const itemCount = this.changeInventory(account, shopItem.itemId, 1);
      this.db.prepare(`
        INSERT INTO shop_purchases(account,shop_id,count) VALUES (?,?,1)
        ON CONFLICT(account,shop_id) DO UPDATE SET count=count+1
      `).run(account, shopItem.id);
      return { ok: true, clover, item_id: shopItem.itemId, item_count: itemCount, purchased: purchased + 1 };
    });
  }

  getCloverPlots(value) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    return this.db.prepare(`
      SELECT clover_id, element, sprite, last_harvest, rebirth_span
      FROM clover_plots WHERE account = ? ORDER BY clover_id
    `).all(account);
  }

  harvestClover(value, cloverId, timestamp = null) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    return this.transaction(() => {
      const plot = this.db.prepare('SELECT * FROM clover_plots WHERE account = ? AND clover_id = ?')
        .get(account, Number(cloverId));
      if (!plot) return { ok: false, reason: 'clover plot not found' };
      const now = Number(timestamp) > 0 ? Math.min(Number(timestamp), Math.floor(Date.now() / 1000)) : Math.floor(Date.now() / 1000);
      if (plot.last_harvest > 0 && plot.last_harvest + plot.rebirth_span > now) {
        return { ok: false, duplicate: true, clover_id: plot.clover_id };
      }
      this.db.prepare('UPDATE clover_plots SET last_harvest = ? WHERE account = ? AND clover_id = ?')
        .run(now, account, plot.clover_id);
      let item = null;
      let clover = this.db.prepare('SELECT clover FROM accounts WHERE account = ?').get(account).clover;
      if (plot.element === 0) {
        clover = Number(clover) + 1;
        this.db.prepare('UPDATE accounts SET clover = ?, updated_at = ? WHERE account = ?').run(clover, now, account);
      } else if (plot.element === 1) {
        item = { item_id: 1000, count: this.changeInventory(account, 1000, 1) };
      } else if (plot.element === 2) {
        item = { item_id: plot.sprite, count: this.changeInventory(account, plot.sprite, 1) };
      }
      return { ok: true, clover_id: plot.clover_id, clover: Number(clover), item };
    });
  }

  getWeather(value) {
    const row = this.ensureAccount(value);
    return { season: row.season, hours_type: row.hours_type, weather: row.weather };
  }

  setWeather(value, weather) {
    this.updateAccount(value, {
      season: Math.max(1, Math.min(4, Number(weather.season || 4))),
      hours_type: Math.max(1, Math.min(4, Number(weather.hours_type || 1))),
      weather: Math.max(0, Number(weather.weather || 0)),
    });
    return this.getWeather(value);
  }

  rowToMail(row) {
    return {
      id: row.id,
      type: row.type,
      sender: row.sender,
      timestamp: row.timestamp,
      title: row.title,
      message: row.message,
      expire: row.expire,
      auto_open: Boolean(row.auto_open),
      read: Boolean(row.is_read),
      opened: Boolean(row.opened),
      resource: { ticket: 0, clover_point: 0, reward_gacha: 0, ads_id: '', share_id: '', ...parseJson(row.resource_json, {}) },
      items: parseJson(row.items_json, []),
      pictures: parseJson(row.pictures_json, []),
    };
  }

  getMails(value, start = null, count = null) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    let rows;
    if (start != null && count != null) {
      rows = this.db.prepare('SELECT * FROM mails WHERE account = ? AND opened = 0 ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?')
        .all(account, Math.max(0, Number(count)), Math.max(0, Number(start) - 1));
    } else {
      rows = this.db.prepare('SELECT * FROM mails WHERE account = ? AND opened = 0 ORDER BY timestamp DESC, id DESC').all(account);
    }
    return rows.map(row => this.rowToMail(row));
  }

  countMails(value) {
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM mails WHERE account = ? AND opened = 0')
      .get(normalizeAccount(value)).count);
  }

  readMail(value, id) {
    return this.db.prepare('UPDATE mails SET is_read = 1 WHERE account = ? AND id = ? AND opened = 0')
      .run(normalizeAccount(value), Number(id)).changes > 0;
  }

  openMail(value, id) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM mails WHERE account = ? AND id = ? AND opened = 0').get(account, Number(id));
      if (!row) return { ok: false, reason: 'mail not found' };
      const mail = this.rowToMail(row);
      this.db.prepare('UPDATE mails SET opened = 1, is_read = 1 WHERE account = ? AND id = ?').run(account, Number(id));
      const role = this.db.prepare('SELECT clover, ticket FROM accounts WHERE account = ?').get(account);
      const clover = Number(role.clover) + Number(mail.resource.clover_point || 0);
      const ticket = Number(role.ticket) + Number(mail.resource.ticket || 0);
      this.db.prepare('UPDATE accounts SET clover = ?, ticket = ?, updated_at = ? WHERE account = ?')
        .run(clover, ticket, Math.floor(Date.now() / 1000), account);
      const itemChanges = [];
      for (const item of mail.items) {
        itemChanges.push({ item_id: Number(item.item_id), count: this.changeInventory(account, item.item_id, item.count) });
      }
      return { ok: true, mail, clover, ticket, itemChanges };
    });
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

  moveInventoryToGift(value, itemId) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    return this.transaction(() => {
      if (this.getInventoryCount(account, itemId) <= 0) return { ok: false };
      const inventoryCount = this.changeInventory(account, itemId, -1);
      this.db.prepare(`
        INSERT INTO gift_specialties(account,item_id,count) VALUES (?,?,1)
        ON CONFLICT(account,item_id) DO UPDATE SET count=count+1
      `).run(account, Number(itemId));
      return { ok: true, inventoryCount };
    });
  }

  moveGiftToInventory(value, itemId) {
    const account = normalizeAccount(value);
    this.ensureAccount(account);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT count FROM gift_specialties WHERE account = ? AND item_id = ?')
        .get(account, Number(itemId));
      if (!row || row.count <= 0) return { ok: false };
      this.db.prepare('UPDATE gift_specialties SET count = count - 1 WHERE account = ? AND item_id = ?')
        .run(account, Number(itemId));
      return { ok: true, inventoryCount: this.changeInventory(account, itemId, 1) };
    });
  }

  exportAccount(value) {
    const account = normalizeAccount(value);
    const row = this.db.prepare('SELECT * FROM accounts WHERE account = ?').get(account);
    if (!row) throw new Error(`account not found: ${account}`);
    const encyclopedia = this.getEncyclopedia(account);
    return {
      format: 'travel-frog-save',
      version: 2,
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
      items: this.getItemState(account),
      shop_purchases: this.getShopPurchases(account),
      clover_plots: this.getCloverPlots(account),
      mails: this.db.prepare('SELECT * FROM mails WHERE account = ? ORDER BY timestamp DESC, id DESC')
        .all(account).map(mail => this.rowToMail(mail)),
      weather: this.getWeather(account),
    };
  }

  importAccount(snapshot, replace = true) {
    if (!snapshot || snapshot.format !== 'travel-frog-save' || ![1, 2].includes(snapshot.version)) {
      throw new Error('unsupported save format');
    }
    const sourceAccount = typeof snapshot.account === 'string' ? { account: snapshot.account } : snapshot.account;
    const account = normalizeAccount(sourceAccount && sourceAccount.account);
    const now = Math.floor(Date.now() / 1000);
    this.ensureAccount(account, false);
    this.transaction(() => {
      if (replace) {
        for (const table of ['postcards', 'moments', 'travel_notes', 'stories', 'handbook', 'achievements',
          'encyclopedia_unlocks', 'encyclopedia_show_sub', 'gift_specialties', 'inventory', 'shop_purchases',
          'clover_plots', 'mails']) {
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
        bag_json: stringify(snapshot.items && snapshot.items.bag, [-1, -1, -1, -1, -1]),
        desk_json: stringify(snapshot.items && snapshot.items.desk, [-1, -1, -1]),
        bag_completed: snapshot.items && snapshot.items.bag_completed ? 1 : 0,
        season: Number((snapshot.weather && snapshot.weather.season) || 4),
        hours_type: Number((snapshot.weather && snapshot.weather.hours_type) || 1),
        weather: Number((snapshot.weather && snapshot.weather.weather) || 0),
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

      const insertInventory = this.db.prepare(`
        INSERT INTO inventory(account,item_id,count) VALUES (?,?,?)
        ON CONFLICT(account,item_id) DO UPDATE SET count=excluded.count
      `);
      for (const item of (snapshot.items && snapshot.items.house) || []) {
        insertInventory.run(account, Number(item.item_id), Math.max(0, Number(item.count || 0)));
      }

      const insertPurchase = this.db.prepare(`
        INSERT INTO shop_purchases(account,shop_id,count) VALUES (?,?,?)
        ON CONFLICT(account,shop_id) DO UPDATE SET count=excluded.count
      `);
      for (const item of snapshot.shop_purchases || []) {
        insertPurchase.run(account, Number(item.item_id), Math.max(0, Number(item.count || 0)));
      }

      const insertPlot = this.db.prepare(`
        INSERT INTO clover_plots(account,clover_id,element,sprite,last_harvest,rebirth_span) VALUES (?,?,?,?,?,?)
        ON CONFLICT(account,clover_id) DO UPDATE SET element=excluded.element,sprite=excluded.sprite,
          last_harvest=excluded.last_harvest,rebirth_span=excluded.rebirth_span
      `);
      for (const plot of snapshot.clover_plots || []) {
        insertPlot.run(account, Number(plot.clover_id), Number(plot.element || 0), Number(plot.sprite || 1),
          Number(plot.last_harvest || 0), Math.max(1, Number(plot.rebirth_span || 7200)));
      }

      const insertMail = this.db.prepare(`
        INSERT INTO mails(account,id,type,sender,timestamp,title,message,expire,auto_open,is_read,opened,
          resource_json,items_json,pictures_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(account,id) DO UPDATE SET type=excluded.type,sender=excluded.sender,timestamp=excluded.timestamp,
          title=excluded.title,message=excluded.message,expire=excluded.expire,auto_open=excluded.auto_open,
          is_read=excluded.is_read,opened=excluded.opened,resource_json=excluded.resource_json,
          items_json=excluded.items_json,pictures_json=excluded.pictures_json
      `);
      for (const mail of snapshot.mails || []) {
        insertMail.run(account, Number(mail.id), Number(mail.type || 3), Number(mail.sender || 0),
          Number(mail.timestamp || 0), String(mail.title || ''), String(mail.message || ''), Number(mail.expire || 0),
          mail.auto_open ? 1 : 0, mail.read ? 1 : 0, mail.opened ? 1 : 0, stringify(mail.resource, {}),
          stringify(mail.items, []), stringify(mail.pictures, []));
      }

      this.seedBasicState(account);
    });
    return this.exportAccount(account);
  }

  close() {
    this.db.close();
  }
}

module.exports = { FrogDatabase, DEFAULT_SETTINGS, normalizeAccount };
