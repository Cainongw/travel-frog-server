'use strict';

const crypto = require('node:crypto');
const { TRAVEL_ROUTES, makePostcard } = require('./travel_data');
const { validateFurnitureState } = require('./furniture');

function integer(value, name, min = 0, max = 999999) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`${name}: expected integer ${min}..${max}`);
  return value;
}
function string(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${name}: required text, max ${max}`);
  return value.trim();
}

class AdminService {
  constructor(database, catalog, services = {}) {
    this.db = database;
    this.catalog = catalog;
    this.services = services;
    database.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE NOT NULL,
        fingerprint TEXT NOT NULL, account TEXT NOT NULL, action TEXT NOT NULL,
        result_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL,
        save_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
  }

  requireAccount(account) {
    string(account, 'account', 128);
    if (account !== account.trim()) throw Error('Account cannot contain leading or trailing whitespace');
    if (!this.db.db.prepare('SELECT 1 FROM accounts WHERE account = ?').get(account)) throw Error('Account not found');
  }

  validatePostcard(picture) {
    if (!picture || !this.catalog.pictures.some(x => x.id === picture.pic_id)) throw Error('Unknown pic_id in APK catalog');
    if (!Array.isArray(picture.layers) || !picture.layers.length || picture.layers.length > 64) throw Error('Expected 1..64 layers');
    const layers = picture.layers.map(x => {
      if (!Array.isArray(x?.layer) || x.layer.length !== 3) throw Error('Each layer must be [resource_id, x, y]');
      const [id, px, py] = x.layer;
      if (!this.catalog.resources[id]) throw Error('Unknown picture resource');
      integer(id, 'resource_id'); integer(px, 'x', -2000, 2000); integer(py, 'y', -2000, 2000);
      return { layer: [id, px, py] };
    });
    return { pic_id: picture.pic_id, layers, for_ads: false, visit: false };
  }

  createMail(account, input, pictureIds = []) {
    const now = Math.floor(Date.now() / 1000);
    const id = Math.max(now * 1000, Number(this.db.db.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM mails WHERE account=?').get(account).id));
    const title = string(input.title, 'title', 100), message = string(input.message || '来自本地邮局的礼物。', 'message', 2000);
    const resource = { clover_point: integer(input.clover || 0, 'clover'), ticket: integer(input.ticket || 0, 'ticket', 0, 999), reward_gacha: 0, ads_id: '', share_id: '' };
    if (!Array.isArray(input.items || []) || (input.items || []).length > 100) throw Error('Invalid items');
    const items = (input.items || []).map(x => {
      if (!this.catalog.items.some(i => i.id === x.item_id)) throw Error('Unknown item_id in APK catalog');
      return { item_id: x.item_id, count: integer(x.count, 'count', 1, 99) };
    });
    this.db.db.prepare(`INSERT INTO mails(account,id,type,sender,timestamp,title,message,resource_json,items_json,pictures_json)
      VALUES (?,?,?,0,?,?,?,?,?,?)`).run(account, id, pictureIds.length ? 11 : 3, now, title, message,
      JSON.stringify(resource), JSON.stringify(items), JSON.stringify(pictureIds));
    return this.db.getMail(account, id);
  }

  mutate(account, action, body, requestId) {
    string(requestId, 'Idempotency-Key', 128);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Expected a JSON object');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ account, action, body })).digest('hex');
    return this.db.transaction(() => {
      const prior = this.db.db.prepare('SELECT * FROM admin_operations WHERE request_id=?').get(requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('Idempotency-Key already used for a different operation');
        return { ...JSON.parse(prior.result_json), replayed: true };
      }
      if (action !== 'create') this.requireAccount(account);
      let result = {};
      switch (action) {
        case 'furniture-put':
        case 'furniture-take':
        case 'furniture-buy':
        case 'furniture-replace':
        case 'furniture-advance':
        case 'furniture-finish': {
          const service=this.services.furniture;
          if (!service) throw Error('Furniture service unavailable');
          result=action==='furniture-put'?service.put(account,body.pos,body.id)
            :action==='furniture-take'?service.take(account,body.pos)
            :action==='furniture-buy'?service.buy(account,body.shop_id)
            :action==='furniture-replace'?service.replace(account,body.id)
            :action==='furniture-finish'?service.finish(account):service.advance(account);
          if (!result.ok) throw Error(result.reason || 'Furniture operation failed');
          break;
        }
        case 'neighbor-arrive':
        case 'neighbor-depart': {
          const service=this.services.neighbors;
          if (!service) throw Error('Neighbor service unavailable');
          result=action==='neighbor-arrive'?service.forceArrive(account):service.forceDepart(account);
          if (!result.ok) throw Error(result.reason || 'Neighbor operation failed');
          if (result.changed) result.event=this.db.enqueueEvent(account,6);
          break;
        }
        case 'create': {
          string(account, 'account', 128);
          if (account !== account.trim()) throw Error('Account cannot contain leading or trailing whitespace');
          if (this.db.db.prepare('SELECT 1 FROM accounts WHERE account=?').get(account)) throw Error('Account already exists');
          this.db.ensureAccount(account);
          break;
        }
        case 'postcards': {
          let picture;
          if (body.template_id !== undefined) {
            const route = TRAVEL_ROUTES.find(x => x.id === body.template_id);
            if (!route) throw Error('Unknown template');
            picture = makePostcard(route, integer(body.companion_id ?? -1, 'companion', -1, 2), 0);
          } else picture = body.picture;
          picture = this.validatePostcard(picture);
          picture.id = this.db.nextPostcardId(account);
          this.db.addPostcard(account, picture, 'new');
          result = { picture, mail: this.createMail(account, { ...body, title: body.title || '一封新的明信片' }, [picture.id]) };
          break;
        }
        case 'mail': result = { mail: this.createMail(account, body) }; break;
        case 'role': {
          const fields = {};
          for (const key of Object.keys(body)) {
            if (key === 'frog_name') fields[key] = string(body[key], key, 5);
            else if (key === 'clover' || key === 'ticket') fields[key] = integer(body[key], key, 0, key === 'ticket' ? 999 : 999999);
            else throw Error('Unsupported role field');
          }
          this.db.updateAccount(account, fields);
          break;
        }
        case 'weather':
          integer(body.season, 'season', 1, 4); integer(body.hours_type, 'hours_type', 1, 4); integer(body.weather, 'weather', 1, 9);
          this.db.setWeather(account, body); break;
        case 'notes':
          if (!this.catalog.notes.some(x => x.id === body.id)) throw Error('Unknown note id');
          this.db.db.prepare('INSERT OR IGNORE INTO travel_notes(account,note_id,is_read,timestamp) VALUES (?,?,0,?)')
            .run(account, body.id, Math.floor(Date.now()/1000)); break;
        case 'visitor-depart':
          this.db.db.prepare("UPDATE visitor_state SET visitor_json=json_set(visitor_json,'$.expire_time',?) WHERE account=? AND visitor_json IS NOT NULL")
            .run(Math.floor(Date.now()/1000), account); break;
        case 'import': {
          if (!body.save || body.save.account?.account !== account) throw Error('Snapshot account must match selected account');
          this.validateSave(body.save);
          const before = this.db.exportAccount(account);
          const backup = this.db.db.prepare('INSERT INTO admin_backups(account,save_json,created_at) VALUES (?,?,?)')
            .run(account, JSON.stringify(before), Math.floor(Date.now()/1000));
          this.db.importAccount(body.save, true);
          result = { backup_id: Number(backup.lastInsertRowid) }; break;
        }
        default: throw Error('Unknown management action');
      }
      result = { ok: true, account, action, ...result };
      this.db.db.prepare('INSERT INTO admin_operations(request_id,fingerprint,account,action,result_json,created_at) VALUES (?,?,?,?,?,?)')
        .run(requestId, fingerprint, account, action, JSON.stringify(result), Math.floor(Date.now()/1000));
      return result;
    });
  }

  audit(account) {
    return this.db.db.prepare('SELECT id,account,action,created_at,request_id FROM admin_operations WHERE account=? ORDER BY id DESC LIMIT 100').all(account);
  }

  validateSave(save) {
    if (save.format !== 'travel-frog-save' || ![1,2,3,4,5,6].includes(save.version)) throw Error('Unsupported save format');
    validateFurnitureState(save.furniture,this.catalog);
    const role = save.account;
    for (const key of ['clover','ticket','trip_count','created_at','icon','postcard_sequence']) {
      if (role[key] !== undefined) integer(role[key], key, 0, Number.MAX_SAFE_INTEGER);
    }
    if (role.frog_name !== undefined) string(role.frog_name, 'frog_name', 64);
    for (const key of ['postcards','travel_notes','mails','stories','achievements','clover_plots','shop_purchases','gift_specialties','moments']) {
      if (save[key] !== undefined && (!Array.isArray(save[key]) || save[key].length > 50000)) throw Error(`Invalid ${key} array`);
    }
    const ids = new Set();
    for (const p of save.postcards || []) {
      integer(p.id, 'postcard id', 1, Number.MAX_SAFE_INTEGER);
      if (ids.has(p.id)) throw Error('Duplicate postcard id'); ids.add(p.id);
      this.validatePostcard(p);
      if (p.location && !['album','new','recycle','gift'].includes(p.location)) throw Error('Invalid postcard location');
    }
    const validateItem = x => {
      if (!x || !this.catalog.items.some(item => item.id === x.item_id)) throw Error('Unknown item in snapshot');
      integer(x.count, 'inventory count', 0, Number.MAX_SAFE_INTEGER);
    };
    if (save.items) {
      if (!Array.isArray(save.items.house)) throw Error('Invalid house inventory');
      save.items.house.forEach(validateItem);
      for (const key of ['bag','desk']) {
        if (!Array.isArray(save.items[key]) || save.items[key].length > 16) throw Error(`Invalid ${key}`);
        for (const id of save.items[key]) if (id !== -1 && !this.catalog.items.some(item => item.id === id)) throw Error(`Unknown ${key} item`);
      }
    }
    for (const x of save.gift_specialties || []) validateItem(x);
    for (const mail of save.mails || []) {
      integer(mail.id, 'mail id', 1, Number.MAX_SAFE_INTEGER);
      for (const key of ['clover_point','ticket','reward_gacha']) if (mail.resource?.[key] !== undefined) integer(mail.resource[key], key);
      if (!Array.isArray(mail.items || []) || !Array.isArray(mail.pictures || [])) throw Error('Invalid mail rewards');
      (mail.items || []).forEach(validateItem);
      for (const id of mail.pictures || []) integer(id, 'mail picture', 1, Number.MAX_SAFE_INTEGER);
    }
    for (const note of save.travel_notes || []) {
      if (!this.catalog.notes.some(x => x.id === note.id)) throw Error('Unknown note in snapshot');
      integer(note.timestamp || 0, 'note timestamp', 0, Number.MAX_SAFE_INTEGER);
    }
    const trip = save.travel?.current;
    if (trip) {
      if (trip.state !== 'traveling' || role.frog_status !== 1 || !TRAVEL_ROUTES.some(x=>x.id===trip.route_id)) throw Error('Inconsistent travel state');
      integer(trip.trip_number, 'trip_number', 1); integer(trip.companion_id, 'companion', -1, 2);
      integer(trip.started_at, 'started_at', 0, Number.MAX_SAFE_INTEGER); integer(trip.returns_at, 'returns_at', trip.started_at, Number.MAX_SAFE_INTEGER);
    } else if (role.frog_status) throw Error('Traveling frog requires a trip');
    if (save.weather) {
      integer(save.weather.season, 'season', 1, 4); integer(save.weather.hours_type, 'hours_type', 1, 4); integer(save.weather.weather, 'weather', 0, 9);
    }
    if (save.visitor?.current) {
      const v = save.visitor.current;
      string(v.city, 'visitor city', 100); string(v.name, 'visitor name', 64);
      integer(v.expire_time, 'visitor expiry', 0, Number.MAX_SAFE_INTEGER); integer(v.carpet, 'carpet', 0, 8);
      integer(v.gift?.count, 'visitor gift count', 0, 99);
    }
  }
  backups(account) {
    return this.db.db.prepare('SELECT id,account,created_at FROM admin_backups WHERE account=? ORDER BY id DESC LIMIT 50').all(account);
  }
}

module.exports = { AdminService };
