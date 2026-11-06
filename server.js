'use strict';

// Minimal, dependency-free WebSocket server for the local TestChannel build.
// It implements the login handshake and enough state for the album screen.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FrogDatabase, normalizeAccount } = require('./database');
const { SHOP_ITEMS } = require('./game_data');
const { TRAVEL_ROUTES, selectTrip, makePostcard } = require('./travel_data');
const { loadCatalog, resourceImage } = require('./catalog');
const { AdminService } = require('./admin');
const { GameplayService } = require('./gameplay');
const { FurnitureService } = require('./furniture');
const { NeighborService, guestProtocol } = require('./neighbors');

const HOST = process.env.FROG_HOST || '0.0.0.0';
const PORT = Number(process.env.FROG_PORT || 8080);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const DATA_FILE = process.env.FROG_DATA || path.join(__dirname, 'data', 'postcards.json');
const DB_FILE = process.env.FROG_DB || path.join(__dirname, 'data', 'travel-frog.sqlite');
const TRIP_SECONDS = Math.max(1, Number(process.env.FROG_TRIP_SECONDS || 60));
const VISIT_SECONDS = Math.max(60, Number(process.env.FROG_VISIT_SECONDS || 1800));

function loadPictures() {
  const value = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${DATA_FILE} must contain a JSON array`);
  for (const [index, picture] of value.entries()) {
    if (!picture || picture.id == null || picture.pic_id == null || !Array.isArray(picture.layers)) {
      throw new Error(`invalid postcard at index ${index}`);
    }
  }
  return value;
}

const pictures = loadPictures();
const database = new FrogDatabase(DB_FILE, pictures);
const clients = new Set();
const catalog = loadCatalog();
const gameplay = new GameplayService(database, catalog);
const furniture = new FurnitureService(database, catalog, {craftSeconds:Number(process.env.FROG_CRAFT_SECONDS || 60)});
const neighbors = new NeighborService(database, catalog, {durationSeconds:Number(process.env.FROG_NEIGHBOR_SECONDS || 1800),cooldownSeconds:Number(process.env.FROG_NEIGHBOR_COOLDOWN || 21600)});
const admin = new AdminService(database, catalog, { furniture, neighbors });
const ADMIN_TOKEN = process.env.FROG_ADMIN_TOKEN || '';
if (ADMIN_TOKEN && ADMIN_TOKEN.length < 24) throw Error('FROG_ADMIN_TOKEN must be at least 24 characters');
const UI_ROOT = path.join(__dirname, 'admin-ui', 'dist');

function hasAdminToken(req) {
  const received = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${ADMIN_TOKEN}`);
  return ADMIN_TOKEN && received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function pushAdminResult(result) {
  if (result.replayed) return;
  for (const client of clients) {
    if (!client.synced || client.account !== result.account || client.socket.destroyed) continue;
    const account = client.account;
    if (result.mail) sendEvent(client, 'notify_new_mail', { mail: result.mail });
    if (result.action.startsWith('furniture-')) pushFurnitureState(client, result);
    if (result.action.startsWith('neighbor-')) pushNeighborState(client, {...result,mail:null});
    if (result.picture) sendEvent(client, 'album_load_new', { pictures: database.getPostcards(account, 'new'), visted_pic: [], has_ads: false, is_share: false });
    if (result.action === 'role') sendEvent(client, 'client_load_role', database.getRole(account));
    if (result.action === 'notes') sendEvent(client, 'travel_load_note', { note_list: database.getTravelNotes(account) });
    if (result.action === 'visitor-depart') sendEvent(client, 'visit_load', database.getVisitorState(account));
    if (result.action === 'import' || result.action === 'weather') sendEvent(client, 'client_notice', { msg: '存档或季节已更新，请重新进入游戏加载。' });
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function frameText(text) {
  const body = Buffer.from(text, 'utf8');
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x81, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

function framePong(payload) {
  const body = payload || Buffer.alloc(0);
  if (body.length >= 126) return Buffer.from([0x8a, 0]);
  return Buffer.concat([Buffer.from([0x8a, body.length]), body]);
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('frame too large');
      length = Number(bigLength);
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;
    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    frames.push({ opcode, fin: (first & 0x80) !== 0, payload });
    offset += frameLength;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function sendJson(client, value) {
  if (!client.socket.destroyed) client.socket.write(frameText(JSON.stringify(value)));
}

function sendResponse(client, request, data) {
  if (request.session !== undefined && request.session !== null) {
    sendJson(client, { session: request.session, data });
  }
}

function sendEvent(client, cmd, data) {
  sendJson(client, { cmd, data });
}

function pushInitialState(client) {
  const account = client.account;
  database.advanceTravel(account, TRAVEL_ROUTES, makePostcard);
  furniture.advance(account);
  database.getVisitorState(account, nowSeconds(), VISIT_SECONDS);
  neighbors.sync(account);
  sendEvent(client, 'weather_load', database.getWeather(account));
  sendEvent(client, 'client_load_events', database.getTravelEvents(account));
  sendEvent(client, 'client_load_role', database.getRole(account));
  sendEvent(client, 'client_load_decorate', { has_list: [], put_id: 0, status: 0 });
  sendEvent(client, 'clover_load_clovers', database.getCloverPlots(account));
  sendEvent(client, 'item_load_items', database.getItemState(account));
  sendEvent(client, 'item_load_handbook', database.getHandbook(account));
  sendEvent(client, 'item_load_shop_info', { purchased: database.getShopPurchases(account) });
  sendEvent(client, 'album_load_all', { id_list: database.getPostcards(account, 'album') });
  sendEvent(client, 'album_load_new', {
    pictures: database.getPostcards(account, 'new'), visted_pic: [], has_ads: false, is_share: false,
  });
  sendEvent(client, 'album_load_recover', { pictures: database.getPostcards(account, 'recycle') });
  sendEvent(client, 'travel_load_gift', database.getGiftBox(account));
  sendEvent(client, 'travel_load_note', { note_list: database.getTravelNotes(account) });
  sendEvent(client, 'mail_load', database.getMails(account));
  sendEvent(client, 'story_load', { stories: database.getStories(account), new_story_id: 0 });
  sendEvent(client, 'misc_moment_load', { list: database.getMoments(account) });
  sendEvent(client, 'encyclopedia_load', database.getEncyclopedia(account));
  sendEvent(client, 'visit_load', database.getVisitorState(account, nowSeconds(), VISIT_SECONDS));
  sendEvent(client, 'furniture_load_furniture', furniture.getState(account));
  sendEvent(client, 'guest_load', guestProtocol(neighbors.state(account)));
  sendEvent(client, 'furniture_load_tumbler', { show_index: 0, replace_index: 0, tumbler_list: [] });
  sendEvent(client, 'furniture_load_compost', {
    show_index: 0, replace_index: 0, compost_list: [], state: 0, box_index: 0, box_list: [],
  });
  sendEvent(client, 'furniture_load_pocket', { show_index: 0, replace_index: 0, list: [], clover: 0 });
  sendEvent(client, 'recharge_load', { water: 0, change: 0, field: [], sack: [] });
  sendEvent(client, 'task_load', { tasks: [], list: [] });
  sendEvent(client, 'task_load_list', { reward: [] });
  sendEvent(client, 'share_load', { pic_list: [] });
  sendEvent(client, 'pray_load_grays', []);
  sendEvent(client, 'museum_load', { museum_list: [] });
  sendEvent(client, 'wishingpool_load', {});
  sendEvent(client, 'adsmgr_load', { can_pop: false, can_banner: false, day_left: 0, gift_id: 0, gift_time: 0, gift_can_get: 0, gift_get: 0, item_list: [] });
}

function pushItemChanges(client, changes) {
  for (const item of changes || []) sendEvent(client, 'item_update', { item });
}

function pushRoleResources(client, state) {
  if (state.clover != null) sendEvent(client, 'clover_update', { clover: state.clover });
  if (state.ticket != null) sendEvent(client, 'item_update_ticket', { ticket: state.ticket });
  pushItemChanges(client, state.itemChanges || (state.item ? [state.item] : []));
}

function pushFurnitureState(client, result) {
  pushRoleResources(client, result);
  sendEvent(client, 'furniture_load_furniture', furniture.getState(client.account));
  if (result.event) sendEvent(client, 'notify_new_event', {event:result.event});
}

function pushNeighborState(client, result) {
  pushItemChanges(client, result.itemChanges);
  sendEvent(client, 'guest_load', result.guest || guestProtocol(neighbors.state(client.account)));
  // guest_load only assigns data; RoleEventType.loadRole resets the courtyard.
  sendEvent(client, 'client_load_role', database.getRole(client.account));
  if (result.mail) sendEvent(client, 'notify_new_mail', {mail:result.mail});
  if (result.event) sendEvent(client, 'notify_new_event', {event:result.event});
}

function neighborAction(account, callback) {
  return database.transaction(()=>{
    const result=callback();
    if (result.changed) result.event=database.enqueueEvent(account,6);
    return result;
  });
}

function afterGameReply(client, callback) {
  (client.afterResponse ||= []).push(callback);
}

function pushTravelCompletion(client, result) {
  sendEvent(client, 'client_load_role', database.getRole(client.account));
  sendEvent(client, 'item_load_items', database.getItemState(client.account));
  pushItemChanges(client, result.itemChanges);
  sendEvent(client, 'item_load_handbook', database.getHandbook(client.account));
  sendEvent(client, 'travel_load_note', { note_list: database.getTravelNotes(client.account) });
  sendEvent(client, 'album_load_new', {
    pictures: database.getPostcards(client.account, 'new'), visted_pic: [], has_ads: false, is_share: false,
  });
  const mail = database.getMail(client.account, result.mailId);
  if (mail) sendEvent(client, 'notify_new_mail', { mail });
  const events = database.getTravelEvents(client.account);
  for (const eventId of result.eventIds) {
    const event = events.find(item => item.id === eventId);
    if (event) sendEvent(client, 'notify_new_event', { event });
  }
  sendEvent(client, 'visit_load', database.getVisitorState(client.account, nowSeconds(), VISIT_SECONDS));
}

function settleConnectedTrips() {
  const accounts = new Map();
  for (const client of clients) {
    if (client.synced && !client.socket.destroyed) {
      if (!accounts.has(client.account)) accounts.set(client.account, []);
      accounts.get(client.account).push(client);
    }
  }
  for (const [account, accountClients] of accounts) {
    const result = database.advanceTravel(account, TRAVEL_ROUTES, makePostcard);
    if (result) for (const client of accountClients) pushTravelCompletion(client, result);
    const made = furniture.advance(account);
    if (made.changed) for (const client of accountClients) pushFurnitureState(client,made);
    const neighbor = neighborAction(account,()=>neighbors.sync(account));
    if (neighbor.changed) for (const client of accountClients) pushNeighborState(client,neighbor);
  }
}

function commandData(client, request) {
  const data = request.data || {};
  const account = client.account;
  switch (request.cmd) {
    case 'furniture_load_furniture':
      return furniture.getState(account);
    case 'furniture_putin_bench':
    case 'furniture_takeout_bench':
    case 'furniture_buy_shop':
    case 'furniture_replace_fur': {
      const result = request.cmd === 'furniture_putin_bench' ? furniture.put(account,data.pos,data.id)
        : request.cmd === 'furniture_takeout_bench' ? furniture.take(account,data.pos)
        : request.cmd === 'furniture_buy_shop' ? furniture.buy(account,data.shop_id) : furniture.replace(account,data.id);
      afterGameReply(client,()=>pushFurnitureState(client,result));
      return {code:result.code};
    }
    case 'guest_load':
      return guestProtocol(neighbors.state(account));
    case 'guest_confirm':
    case 'guest_serve':
    case 'guest_set_expire_time':
    case 'guest_finish': {
      const result = neighborAction(account,()=>request.cmd==='guest_confirm' ? neighbors.confirm(account,data.id)
        : request.cmd==='guest_serve' ? neighbors.serve(account,data.id,data.item_id)
        : request.cmd==='guest_set_expire_time' ? neighbors.setExpire(account,data.time) : neighbors.finish(account));
      afterGameReply(client,()=>pushNeighborState(client,result));
      return {code:result.ok?0:1};
    }
    case 'client_hello':
      return { timestamp: nowSeconds() };
    case 'hall_gen_token':
      client.account = normalizeAccount(data.account);
      client.token = `local-${client.account}`;
      return { token: client.token };
    case 'hall_login':
    case 'hall_reconnect':
      client.token = String(data.token || client.token || 'local-guest');
      client.account = client.token.startsWith('local-') ? client.token.slice(6) : (client.account || 'guest');
      client.account = normalizeAccount(client.account);
      client.uid = database.ensureAccount(client.account).uid;
      client.authed = true;
      return { code: 0, account: client.account };
    case 'hall_enter_game':
      return { code: 0 };
    case 'weather_load':
      return database.getWeather(account);
    case 'client_set_client':
      database.updateSettings(account, data.client);
      return { code: 0 };
    case 'client_set_name':
      database.updateAccount(account, { frog_name: String(data.name || '旅行青蛙').slice(0, 64) });
      return { code: 0, name: String(data.name || '旅行青蛙') };
    case 'client_rename_cost':
      return { code: 0, cost: 0 };
    case 'client_set_icon':
      database.updateAccount(account, { icon: Number(data.id || 0) });
      return { code: 0 };
    case 'client_set_achieve':
      database.updateAccount(account, { current_achievement: Number(data.id ?? -1) });
      return { code: 0 };
    case 'client_set_pic_show':
      database.updateAccount(account, { current_picture_id: Number(data.id) });
      return { code: 0 };
    case 'client_switch_push':
      database.updateAccount(account, { push_switch: data.turnon ? 1 : 0 });
      return { code: 0, push_switch: Boolean(data.turnon) };
    case 'client_switch_rank':
      database.updateAccount(account, { rank_switch: data.turnon ? 1 : 0 });
      return { code: 0, rank_switch: Boolean(data.turnon) };
    case 'album_load_all':
      return { id_list: database.getPostcards(account, 'album') };
    case 'album_load':
      return {
        start: Number(data.start || 1),
        total: database.countPostcards(account, 'album'),
        pictures: database.getPostcards(account, 'album', null, data.start || 1, data.count || 20),
      };
    case 'album_load_by_id_list':
      return { pic_list: database.getPostcards(account, 'album', data.id_list || []) };
    case 'album_load_new':
      return { pictures: database.getPostcards(account, 'new'), visted_pic: [], has_ads: false, is_share: false };
    case 'album_load_recover':
      return { pictures: database.getPostcards(account, 'recycle') };
    case 'album_delete':
      return { code: database.movePostcard(account, data.id, 'album', 'recycle') ? 0 : 1 };
    case 'album_recover':
      return { code: database.movePostcard(account, data.id, 'recycle', 'album') ? 0 : 1 };
    case 'album_save_new':
      return { code: database.movePostcard(account, data.id, 'new', 'album') ? 0 : 1 };
    case 'album_delete_new':
      return { code: database.deletePostcard(account, data.id, 'new') ? 0 : 1 };
    case 'travel_load_gift':
      return database.getGiftBox(account);
    case 'travel_album_to_gift':
      return { code: database.movePostcard(account, data.picture_id, 'album', 'gift') ? 0 : 1 };
    case 'travel_gift_to_album':
      return { code: database.movePostcard(account, data.picture_id, 'gift', 'album') ? 0 : 1 };
    case 'travel_gift_delete_album':
      return { code: database.deleteGiftPostcard(account, data.id) ? 0 : 1 };
    case 'travel_bag_to_gift': {
      const moved = database.moveInventoryToGift(account, data.item_id);
      if (moved.ok) pushItemChanges(client, [{ item_id: Number(data.item_id), count: moved.inventoryCount }]);
      return { code: moved.ok ? 0 : 1 };
    }
    case 'travel_gift_to_bag': {
      const moved = database.moveGiftToInventory(account, data.item_id);
      if (moved.ok) pushItemChanges(client, [{ item_id: Number(data.item_id), count: moved.inventoryCount }]);
      return { code: moved.ok ? 0 : 1 };
    }
    case 'travel_load_note':
      return { note_list: database.getTravelNotes(account) };
    case 'travel_read_note':
      database.markTravelNotesRead(account, data.id);
      return { code: 0 };
    case 'visit_load':
      return database.getVisitorState(account, nowSeconds(), VISIT_SECONDS);
    case 'visit_set_carpet':
      database.setVisitorField(account, 'carpet', data.id);
      return { code: 0 };
    case 'visit_set_expire_time':
      database.setVisitorField(account, 'expire_time', data.time);
      return { code: 0 };
    case 'visit_open': {
      const opened = database.openVisitor(account, VISIT_SECONDS);
      if (opened.ok) {
        const role = database.getRole(account);
        pushRoleResources(client, { clover: role.res.clover_point, ticket: role.res.ticket,
          itemChanges: opened.reward.item_id > 0 && opened.reward.item_id < 100000 ? [{ item_id: opened.reward.item_id, count: database.getInventoryCount(account, opened.reward.item_id) }] : [] });
        sendEvent(client, 'visit_load', { visitor: null, acquire: opened.acquire });
      }
      return { code: opened.ok ? 0 : 1 };
    }
    case 'client_confirm_event':
      database.confirmTravelEvent(account, data.id);
      return { code: 0 };
    case 'story_load':
      return { stories: database.getStories(account), new_story_id: 0 };
    case 'misc_moment_load':
      return { list: database.getMoments(account) };
    case 'misc_moment_unlock':
      database.unlockMoment(account, data.id);
      return { code: 0 };
    case 'item_load_handbook':
      return database.getHandbook(account);
    case 'encyclopedia_load':
      return database.getEncyclopedia(account);
    case 'encyclopedia_set_show_sub':
      database.setEncyclopediaShowSub(account, data.long_id);
      return { code: 0 };
    case 'mail_load':
      return database.getMails(account);
    case 'mail_load_mails':
      return {
        start: Number(data.start || 1),
        count: Number(data.count || 5),
        total: database.countMails(account),
        mails: database.getMails(account, data.start || 1, data.count || 5),
      };
    case 'mail_read':
      database.readMail(account, data.id);
      return { code: 0 };
    case 'mail_open': {
      const reward = database.openMail(account, data.id);
      if (reward.ok) {
        pushRoleResources(client, reward);
        if (reward.mail.pictures.length) sendEvent(client, 'album_load_new', {
          pictures: database.getPostcards(account, 'new'), visted_pic: [], has_ads: false, is_share: false,
        });
      }
      return { code: reward.ok ? 0 : 1 };
    }
    case 'item_load_items':
      return database.getItemState(account);
    case 'item_load_shop_info':
      return { purchased: database.getShopPurchases(account) };
    case 'item_gacha': {
      const result = gameplay.draw(account, data.is_reward ?? false);
      sendEvent(client, 'item_update_ticket', { ticket: result.ticket_balance });
      if (!result.ok) sendEvent(client, 'client_notice', { msg: result.reason });
      return { code: result.ok ? 0 : 1, ticket: result.rank };
    }
    case 'item_redeem_prize': {
      const result = gameplay.redeem(account, data.prize_id);
      pushRoleResources(client, { ticket: result.ticket_balance, itemChanges: result.itemChanges });
      return { code: result.ok ? 0 : 1 };
    }
    case 'item_buy': {
      const shopItem = SHOP_ITEMS.get(Number(data.shop_id));
      if (!shopItem) return false;
      const purchase = database.purchase(account, shopItem);
      if (!purchase.ok) return false;
      pushRoleResources(client, {
        clover: purchase.clover,
        itemChanges: [{ item_id: purchase.item_id, count: purchase.item_count }],
      });
      return { code: 0, ticket: 0, ads_id: '', share_id: '' };
    }
    case 'item_putin_bag': {
      const result = database.placeItem(account, 'bag', data.pos, data.item_id);
      pushItemChanges(client, result.changes);
      return { code: result.ok ? 0 : 1, conflict: result.conflict };
    }
    case 'item_takeout_bag': {
      const result = database.takeItem(account, 'bag', data.pos);
      pushItemChanges(client, result.changes);
      return { code: result.ok ? 0 : 1, conflict: result.conflict };
    }
    case 'item_putin_desk': {
      const result = database.placeItem(account, 'desk', data.pos, data.item_id);
      pushItemChanges(client, result.changes);
      return { code: result.ok ? 0 : 1, conflict: result.conflict };
    }
    case 'item_takeout_desk': {
      const result = database.takeItem(account, 'desk', data.pos);
      pushItemChanges(client, result.changes);
      return { code: result.ok ? 0 : 1, conflict: result.conflict };
    }
    case 'item_set_bag_completed': {
      if (database.getTravelState(account)) return { code: 0 };
      database.setBagCompleted(account, data.completed);
      if (data.completed) {
        const selection = selectTrip(database.getTripCount(account) + 1);
        const started = database.startTravel(account, selection.route, selection.companionId, TRIP_SECONDS);
        if (!started.ok) {
          database.setBagCompleted(account, false);
          sendEvent(client, 'item_load_items', database.getItemState(account));
          return { code: 1, message: started.reason };
        }
        sendEvent(client, 'client_load_role', database.getRole(account));
        sendEvent(client, 'item_load_items', database.getItemState(account));
        const event = database.getTravelEvents(account).find(item => item.id === started.eventId);
        if (event) sendEvent(client, 'notify_new_event', { event });
      }
      return { code: 0 };
    }
    case 'clover_load_clovers':
      return database.getCloverPlots(account);
    case 'clover_harvest': {
      const result = database.harvestClover(account, data.clover_id);
      if (result.ok) pushRoleResources(client, result);
      return { clover_id: Number(data.clover_id), code: result.ok || result.duplicate ? 0 : 1 };
    }
    case 'clover_harvest_resend': {
      for (const item of data.list || []) {
        const result = database.harvestClover(account, item.clover_id, item.time);
        if (result.ok) pushRoleResources(client, result);
      }
      return database.getCloverPlots(account);
    }
    default:
      return { code: 0 };
  }
}

function handleMessage(client, text) {
  let request;
  try { request = JSON.parse(text); } catch (_) { return; }
  if (!request || typeof request.cmd !== 'string') return;
  const cmd = request.cmd.replace('.', '_');
  request.cmd = cmd;
  console.log(`[${client.remote}] ${cmd}${request.data ? ` ${JSON.stringify(request.data)}` : ''}`);
  try {
    const response = commandData(client, request);
    if (cmd === 'client_load_all_info') {
      // Push state before acknowledging the synchronization request so the
      // client has season/role data before it starts loading scene resources.
      pushInitialState(client);
      client.synced = true;
      sendResponse(client, request, response);
      return;
    }
    sendResponse(client, request, response);
    for (const callback of client.afterResponse || []) callback();
    client.afterResponse = [];
  } catch (error) {
    client.afterResponse = [];
    console.error(`[${client.remote}] ${cmd} failed: ${error.message}`);
    sendResponse(client, request, { code: 1, message: error.message });
  }
}

function sendHttpJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        reject(new Error('request body exceeds 10 MiB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    sendHttpJson(res, 200, { ok: true, version: require('./package.json').version });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/admin/') && !ADMIN_TOKEN) {
      sendHttpJson(res, 503, { error: '请设置 FROG_ADMIN_TOKEN（至少 24 字符）后重启服务器' }); return;
    }
    if (ADMIN_TOKEN ? !hasAdminToken(req) : !isLoopback(req.socket.remoteAddress) || !!req.headers.origin) {
      sendHttpJson(res, 401, { error: 'Invalid or missing management token' }); return;
    }
  }
  try {
    if (url.pathname.startsWith('/api/admin/')) {
      const route = url.pathname.slice('/api/admin/'.length);
      const account = url.searchParams.get('account');
      if (req.method === 'GET') {
        if (route === 'status') {
          sendHttpJson(res, 200, { version: require('./package.json').version, schema: database.db.prepare('PRAGMA user_version').get().user_version,
            accounts: database.getAccounts().length, online: [...clients].filter(x => x.synced).length, catalog: catalog.available }); return;
        }
        if (route === 'accounts') {
          sendHttpJson(res, 200, { accounts: database.getAccounts().map(x => ({ ...x, online: [...clients].some(c => c.synced && c.account === x.account) })) }); return;
        }
        if (route === 'catalog') {
          sendHttpJson(res, 200, { available: catalog.available, items: catalog.items.map(({id,name,type}) => ({id,name,type})),
            furniture: furniture.getCatalog().furniture, furnitureShop: furniture.getCatalog().shop,
            allFurniture: furniture.getCatalog().allFurniture, neighbors: catalog.neighbors.map(({id,name})=>({id,name})),
            pictures: catalog.pictures.map(({id,name}) => ({id,name})), notes: catalog.notes.map(({id,type})=>({id,type})), resources: catalog.resources,
            templates: TRAVEL_ROUTES.map(x => ({ id: x.id, name: x.destination, picture: makePostcard(x, -1, 0),
              variants: [-1,0,1,2].map(companion_id => ({ companion_id, picture: makePostcard(x, companion_id, 0) })) })) }); return;
        }
        if (/^image\/\d+$/.test(route)) {
          const bytes = resourceImage(catalog, Number(route.split('/')[1]));
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }); res.end(bytes); return;
        }
        admin.requireAccount(account);
        if (route === 'garden') {
          sendHttpJson(res,200,{furniture:furniture.peekState(account),neighbor:neighbors.state(account),inventory:database.getItemState(account).house}); return;
        }
        if (route === 'account' || route === 'export') { sendHttpJson(res, 200, database.exportAccount(account)); return; }
        if (route === 'audit') { sendHttpJson(res, 200, { operations: admin.audit(account), backups: admin.backups(account) }); return; }
        if (route === 'backup') {
          const backup = database.db.prepare('SELECT save_json FROM admin_backups WHERE id=? AND account=?').get(Number(url.searchParams.get('id')), account);
          if (!backup) throw Error('Backup not found');
          sendHttpJson(res, 200, JSON.parse(backup.save_json)); return;
        }
      }
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Error('Expected application/json');
        const result = admin.mutate(account, route, await readJsonBody(req), req.headers['idempotency-key']);
        pushAdminResult(result);
        sendHttpJson(res, 200, result); return;
      }
      sendHttpJson(res, 404, { error: 'Unknown management route' }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/accounts') {
      sendHttpJson(res, 200, { accounts: database.getAccounts() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/export') {
      const account = normalizeAccount(url.searchParams.get('account'));
      sendHttpJson(res, 200, database.exportAccount(account), {
        'content-disposition': `attachment; filename="${account.replace(/[^a-zA-Z0-9._-]/g, '_')}.json"`,
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/import') {
      if (ADMIN_TOKEN) { sendHttpJson(res, 409, { error: 'Use audited /api/admin/import when administration is enabled' }); return; }
      const body = await readJsonBody(req);
      const snapshot = body.save || body;
      const imported = database.importAccount(snapshot, body.replace !== false);
      sendHttpJson(res, 200, { ok: true, account: imported.account.account });
      return;
    }
    if (url.pathname === '/api/weather') {
      const account = normalizeAccount(url.searchParams.get('account'));
      if (req.method === 'GET') {
        sendHttpJson(res, 200, database.getWeather(account));
        return;
      }
      if (req.method === 'POST') {
        if (ADMIN_TOKEN) { sendHttpJson(res, 409, { error: 'Use audited /api/admin/weather' }); return; }
        sendHttpJson(res, 200, database.setWeather(account, await readJsonBody(req)));
        return;
      }
    }
  } catch (error) {
    sendHttpJson(res, 400, { error: error.message });
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) {
    const relative = url.pathname.replace(/^\/admin\/?/, '') || 'index.html';
    const filename = path.resolve(UI_ROOT, relative);
    if (!filename.startsWith(UI_ROOT + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      sendHttpJson(res, 404, { error: 'Build the management UI with npm run admin:build' }); return;
    }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' });
    fs.createReadStream(filename).pipe(res); return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('travel frog private server\nhealth: /health\narchive API: /api/accounts, /api/export, /api/import, /api/weather\n');
});

server.on('upgrade', (req, socket) => {
  if (!isLoopback(req.socket.remoteAddress) && process.env.FROG_ALLOW_REMOTE_GAME !== '1') {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);

  const client = { socket, remote: req.socket.remoteAddress, buffer: Buffer.alloc(0), account: 'guest', uid: 'local-guest', authed: false };
  clients.add(client);
  socket.on('data', chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    let parsed;
    try { parsed = parseFrames(client.buffer); } catch (error) { console.error(error.message); socket.destroy(); return; }
    client.buffer = parsed.rest;
    for (const frame of parsed.frames) {
      if (frame.opcode === 0x8) { socket.end(); return; }
      if (frame.opcode === 0x9) { socket.write(framePong(frame.payload)); continue; }
      if (frame.opcode === 0x1) handleMessage(client, frame.payload.toString('utf8'));
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    clients.delete(client);
    console.log(`[${client.remote}] disconnected`);
  });
  console.log(`[${client.remote}] connected`);
});

server.listen(PORT, HOST, () => {
  console.log(`travel frog private server listening on ws://${HOST}:${PORT}`);
  console.log(`SQLite archive: ${DB_FILE}`);
});

const travelTimer = setInterval(settleConnectedTrips, 1000);
travelTimer.unref();

function shutdown() {
  clearInterval(travelTimer);
  for (const client of clients) client.socket.destroy();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
