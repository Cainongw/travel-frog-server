'use strict';

const crypto = require('node:crypto');

// Exact database rows, not export/import defaults. This also preserves the
// original official payloads and counters without reinterpreting game data.
const SAVE_TABLES = Object.freeze([
  'accounts', 'postcards', 'moments', 'travel_notes', 'stories', 'handbook',
  'achievements', 'encyclopedia_unlocks', 'encyclopedia_show_sub', 'gift_specialties',
  'inventory', 'shop_purchases', 'clover_plots', 'mails', 'travel_trips', 'travel_events',
  'visitor_state', 'visitor_acquire', 'gacha_state', 'furniture_state', 'neighbor_state',
  'official_archives',
]);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

class SnapshotService {
  constructor(database) {
    this.database = database;
    this.sql = database.db;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS admin_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('manual','before_restore')),
      source_snapshot_id INTEGER,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_snapshots_account ON admin_snapshots(account,id DESC);`);
  }

  requireAccount(account) {
    if (typeof account !== 'string' || !account || account.trim() !== account ||
        !this.sql.prepare('SELECT 1 FROM accounts WHERE account=?').get(account)) throw Error('Account not found');
  }

  capture(account) {
    this.requireAccount(account);
    const tables = {};
    for (const table of SAVE_TABLES) tables[table] = this.sql.prepare(`SELECT * FROM ${table} WHERE account=?`).all(account);
    return { format: 'frog-account-snapshot', version: 1, account,
      schema: this.sql.prepare('PRAGMA user_version').get().user_version, tables };
  }

  metadata(row) {
    return { id: row.id, account: row.account, label: row.label, kind: row.kind,
      source_snapshot_id: row.source_snapshot_id, created_at: row.created_at,
      sha256: row.sha256, summary: JSON.parse(row.summary_json) };
  }

  list(account, beforeId = null) {
    this.requireAccount(account);
    if (beforeId !== null && (!Number.isSafeInteger(beforeId) || beforeId < 1)) throw Error('Invalid snapshot cursor');
    const rows = this.sql.prepare(`SELECT id,account,label,kind,source_snapshot_id,created_at,sha256,summary_json
      FROM admin_snapshots WHERE account=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT 101`)
      .all(account,beforeId,beforeId);
    return { snapshots: rows.slice(0,100).map(row=>this.metadata(row)),
      next_cursor: rows.length > 100 ? rows[99].id : null };
  }

  latestVerified(account) {
    this.requireAccount(account);
    const row=this.sql.prepare('SELECT id,payload_json,sha256 FROM admin_snapshots WHERE account=? ORDER BY id DESC LIMIT 1').get(account);
    if(!row || hash(row.payload_json)!==row.sha256)throw Error('请先创建一份有效快照再启用玩法');
    return row.id;
  }

  create(account, label = '', kind = 'manual', sourceId = null) {
    if (typeof label !== 'string' || label.length > 100) throw Error('Snapshot name must be at most 100 characters');
    return this.database.transaction(() => {
      const payload = this.capture(account), role = payload.tables.accounts[0];
      const summary = { frog_name:role.frog_name, clover:role.clover, ticket:role.ticket,
        postcards:payload.tables.postcards.length, inventory:payload.tables.inventory.filter(x=>x.count>0).length,
        notes:payload.tables.travel_notes.length, official:payload.tables.official_archives.length>0 };
      const json = JSON.stringify(payload), now = Math.floor(Date.now()/1000);
      const result = this.sql.prepare(`INSERT INTO admin_snapshots
        (account,label,kind,source_snapshot_id,created_at,payload_json,sha256,summary_json) VALUES (?,?,?,?,?,?,?,?)`)
        .run(account,label.trim() || '手动快照',kind,sourceId,now,json,hash(json),JSON.stringify(summary));
      return this.metadata(this.sql.prepare('SELECT * FROM admin_snapshots WHERE id=?').get(Number(result.lastInsertRowid)));
    });
  }

  restore(account, id, confirmation) {
    if (!Number.isSafeInteger(id) || id < 1) throw Error('Invalid snapshot id');
    if (confirmation !== account) throw Error('请输入完整账号标识以确认回档');
    return this.database.transaction(() => {
      this.requireAccount(account);
      const source = this.sql.prepare('SELECT * FROM admin_snapshots WHERE id=? AND account=?').get(id,account);
      if (!source) throw Error('Snapshot not found for this account');
      if (hash(source.payload_json) !== source.sha256) throw Error('Snapshot checksum mismatch; restore refused');
      const payload = JSON.parse(source.payload_json);
      if (payload.format !== 'frog-account-snapshot' || payload.version !== 1 || payload.account !== account ||
          Object.keys(payload.tables || {}).length !== SAVE_TABLES.length || payload.tables.accounts?.length !== 1) throw Error('Unsupported snapshot structure');
      const columns = new Map();
      for (const table of SAVE_TABLES) {
        const names = this.sql.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name);
        columns.set(table,names);
        if (!Array.isArray(payload.tables[table])) throw Error('Incomplete snapshot');
        for (const row of payload.tables[table]) {
          if (row.account !== account || Object.keys(row).length !== names.length || names.some(name=>!Object.hasOwn(row,name))) {
            throw Error('Snapshot schema/account mismatch; restore refused');
          }
        }
      }
      // This backup, the restore and the caller's audit record commit together.
      const safety = this.create(account,`回档前自动保护 · 恢复 #${id}`,'before_restore',id);
      for (const table of SAVE_TABLES.slice(1)) this.sql.prepare(`DELETE FROM ${table} WHERE account=?`).run(account);
      const accountColumns = columns.get('accounts').filter(name=>name!=='account');
      this.sql.prepare(`UPDATE accounts SET ${accountColumns.map(name=>`"${name}"=?`).join(',')} WHERE account=?`)
        .run(...accountColumns.map(name=>payload.tables.accounts[0][name]),account);
      for (const table of SAVE_TABLES.slice(1)) {
        const names = columns.get(table);
        const insert = this.sql.prepare(`INSERT INTO ${table} (${names.map(x=>`"${x}"`).join(',')}) VALUES (${names.map(()=>'?').join(',')})`);
        for (const row of payload.tables[table]) insert.run(...names.map(name=>row[name]));
      }
      return { snapshot_id:id, safety_snapshot_id:safety.id, snapshot:this.metadata(source), safety_snapshot:safety };
    });
  }
}

module.exports = { SnapshotService, SAVE_TABLES };
