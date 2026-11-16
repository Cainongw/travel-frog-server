'use strict';
const { PROJECT_ROOT } = require("./paths");


// HTTP/WebSocket host: wires authentication, persistence and gameplay modules.
// Domain rules live under game/; this file coordinates protocol replies/pushes.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FrogDatabase, normalizeAccount } = require('./core/database');
const { SHOP_ITEMS } = require('./game/economy/game_data');
const { TRAVEL_ROUTES, selectTrip, makePostcard } = require('./game/travel/travel_data');
const { loadCatalog, resourceImage } = require('./core/catalog');
const { AdminService } = require('./admin/admin');
const { GameplayService } = require('./game/raffle/gameplay');
const { FurnitureService } = require('./game/furniture/furniture');
const { NeighborService, guestProtocol } = require('./game/neighbors/neighbors');
const { ProtocolDiagnostics, describe } = require('./observability/protocol_diagnostics');
const { AdminAuth } = require('./admin/admin_auth');
const { GameAuth } = require('./auth/game_auth');
const { ProgressionService } = require('./game/progression/progression');
const { ActivitiesService } = require('./game/activities/activities');
const { CreativeService } = require('./game/creative/creative');
const { PostcardGenerator } = require('./game/travel/postcard_generator');
const { TravelPolicy } = require('./game/travel/travel_policy');
const { CardsService } = require('./game/activities/cards');
const { LifeService } = require('./game/life/life');
const { ExplorationService } = require('./game/activities/exploration');
const { EconomyPolicy } = require('./game/economy/economy_policy');
const { DailyService } = require('./game/progression/daily');
const { WorldService } = require('./game/economy/world');
const { GiftsService } = require('./game/economy/gifts');
const { DecorationService } = require('./game/creative/decoration');
const { AnnouncementsService } = require('./admin/announcements');

const HOST = process.env.FROG_HOST || '0.0.0.0';
const PORT = Number(process.env.FROG_PORT || 8080);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const DATA_FILE = process.env.FROG_DATA || path.join(PROJECT_ROOT, 'data', 'postcards.json');
const DB_FILE = process.env.FROG_DB || path.join(PROJECT_ROOT, 'data', 'travel-frog.sqlite');
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
const diagnostics = new ProtocolDiagnostics(database);
const adminAuth = new AdminAuth(database);
const announcements=new AnnouncementsService(database);
const gameAuth = new GameAuth(database);
const GAME_AUTH_REQUIRED = process.env.FROG_GAME_AUTH_REQUIRED === '1';
const progression = new ProgressionService(database,catalog);
const activities = new ActivitiesService(database,catalog,{furniture});
const creative = new CreativeService(database,catalog);
const cards = new CardsService(database,catalog,{furniture});
const life = new LifeService(database,catalog);
const exploration = new ExplorationService(database,catalog,{furniture,pictureFactory:({account,pic_ids})=>{if(!policy())return null;const eligible=pic_ids.filter(id=>postcardGenerator.coverage().rows.some(x=>x.id===id&&x.available));return eligible.length?postcardGenerator.generate(database.nextPostcardId(account),{picId:eligible[0],preview:true}):null;}});
const economy=new EconomyPolicy({catalog});
const daily=new DailyService(database,catalog);
const world=new WorldService(database,catalog,{economy});
const gifts=new GiftsService(database,catalog);
const decoration=new DecorationService(database,catalog);
const undecoratedRole=database.getRole.bind(database);
database.getRole=account=>decoration.decorateRole(account,undecoratedRole(account));
furniture.shop=new Map([...furniture.shop].filter(([,row])=>gifts.supportsShopItem(row.item_id)));
if(catalog.config?.shopData_json&&process.env.FROG_TRAVEL_POLICY!=='legacy')database.economy=economy;
admin.services.creative=creative;
const gameModules = [world,gifts,decoration,progression,activities,cards,creative,life,exploration,daily];
let postcardGenerator,travelPolicy;
function policy(){
  if(catalog.pictures.length>20&&process.env.FROG_TRAVEL_POLICY!=='legacy'){
    if(!postcardGenerator){
      const samples=[];for(const row of database.db.prepare('SELECT data_json FROM official_archives').all()){
        const capture=JSON.parse(row.data_json).capture;for(const frames of Object.values(capture?.responses||{}))for(const frame of frames)for(const field of ['pic_list','pictures'])if(Array.isArray(frame.data?.[field]))samples.push(...frame.data[field]);
      }
      postcardGenerator=new PostcardGenerator({root:catalog.root,config:catalog.config,samples});
    }
    travelPolicy ||= new TravelPolicy({generator:postcardGenerator,config:catalog.config});
  }
  return travelPolicy;
}
function generateTravelPostcard(route,companion,id,context={}){
  if(policy())return postcardGenerator.generate(id,{picId:route.picId,companionId:companion,season:context.season,tools:(context.bag||[]).filter(x=>catalog.items.find(i=>i.id===x)?.type===2)});
  return makePostcard(route,companion,id);
}
function furnitureState(account){return creative.decorateFurnitureState(account,furniture.getState(account));}
function startPlannedTravel(account){
  const current=database.getItemState(account),context={bag:current.bag,season:database.getWeather(account).season,ownedNoteIds:database.getTravelNotes(account).map(x=>x.id),seenPicIds:database.getPostcards(account,'album').map(x=>x.pic_id)};
  if(process.env.FROG_TRIP_SECONDS)context.durationSeconds=TRIP_SECONDS;
  const plan=policy().select(context);
  return database.transaction(()=>{const started=database.startTravel(account,plan.route,plan.companionId,plan.durationSeconds);if(started.ok){const state=database.modules.get(account,'world',{});const desk_loans=(state.borrowed||[]).filter(x=>current.bag[x.bag-1]===x.item_id);state.borrowed=[];database.modules.set(account,'world',state);database.modules.set(account,'travel-plan',{...plan,desk_loans,trip_number:started.trip.trip_number});const progress=progression.record(account,'trip-start',{food:current.bag[0]});started.events=[...(progress.events||[]),...life.observe(account,'travel').events,...daily.observe(account,'travel',1,{food:current.bag[0],fullBag:current.bag.every(x=>x>=0)}).events];}return started;});
}
function advanceTravel(account){
  const result=database.advanceTravel(account,policy()?policy().routes():TRAVEL_ROUTES,generateTravelPostcard);
  if(result)progression.record(account,'trip-return',{duration:result.durationSeconds,place:catalog.pictures.find(x=>x.id===result.postcard.pic_id)?.place});
  if(!result&&policy()&&!database.getTravelState(account)&&database.getRole(account).frog.status===0){
    const pending=database.modules.get(account,'travel-plan',{}),now=nowSeconds();
    if(pending.depart_at&&pending.depart_at<=now&&database.getItemState(account).bag_completed){
      const started=startPlannedTravel(account);if(started.ok)for(const client of clients)if(client.synced&&client.account===account){sendEvent(client,'client_load_role',database.getRole(account));sendEvent(client,'item_load_items',database.getItemState(account));const event=database.getTravelEvents(account).find(x=>x.id===started.eventId);if(event)sendEvent(client,'notify_new_event',{event});moduleEvents(client,started);}
    }
  }
  return result;
}
function moduleEvents(client,result){for(const event of result?.events||[])sendEvent(client,event.cmd,event.cmd==='furniture_load_furniture'?creative.decorateFurnitureState(client.account,event.data):event.data);}
const ADMIN_TOKEN = process.env.FROG_ADMIN_TOKEN || '';
if (ADMIN_TOKEN && ADMIN_TOKEN.length < 24) throw Error('FROG_ADMIN_TOKEN must be at least 24 characters');
const UI_ROOT = path.join(PROJECT_ROOT, 'admin-ui', 'dist');

function hasAdminToken(req) {
  const received = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${ADMIN_TOKEN}`);
  return ADMIN_TOKEN && received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function pushAdminResult(result) {
  if (result.replayed) return;
  for (const client of clients) {
    if ((result.action === 'snapshot-restore' || result.activated) && client.account === result.account && !client.socket.destroyed) {
      client.synced = false;
      client.authed = false;
      client.invalidated = true;
      sendEvent(client,'notify_reload',{});
      client.socket.end();
      continue;
    }
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

function pushAnnouncements(client,rows){
  if(!client.synced||client.socket.destroyed)return;
  rows ||= announcements.active();
  client.seenAnnouncements ||= new Set();
  for(const row of rows)if(!client.seenAnnouncements.has(row.id)&&row.active&&(!row.expires_at||row.expires_at>nowSeconds())){
    sendEvent(client,'client_notice',{msg:`公告 · ${row.title}\n${row.body}`});client.seenAnnouncements.add(row.id);
  }
}

function pushInitialState(client) {
  const account = client.account;
  const official=database.getOfficialArchive(account);
  if(official && official.mode!=='active'){
    // Preserve official-only modules without inventing their server-side timers.
    for(const [cmd,data]of Object.entries(official.protocols)){
      if(cmd==='client_hello'||cmd==='client_load_all_info'||cmd==='album_load_by_id_list'||!cmd.includes('load'))continue;
      sendEvent(client,cmd,data);
    }
    return;
  }
  const sent = new Set();
  database.normalizeEquipment(account);
  progression.record(account,'login');
  const moduleInitial=new Map(gameModules.flatMap(service=>service.initial(account)).map(x=>[x.cmd,x.data]));
  // Module advancement may award inventory before a trip settles. The complete
  // baseline below must always win over those earlier absolute resource pushes.
  const liveBaseline=new Set(['client_load_role','item_load_items','album_load_all','album_load_new','album_load_recover','travel_load_gift','travel_load_note','mail_load','weather_load','clover_load_clovers','client_load_events','item_load_handbook','furniture_load_furniture']);
  function emit(cmd,data,retainOriginal=false){
    sent.add(cmd);
    sendEvent(client,cmd,!liveBaseline.has(cmd)&&moduleInitial.has(cmd)?moduleInitial.get(cmd):retainOriginal && Object.hasOwn(official?.protocols||{},cmd)?official.protocols[cmd]:data);
  }
  advanceTravel(account);
  if(!creative.isBenchLocked(account))furniture.advance(account);
  database.getVisitorState(account, nowSeconds(), VISIT_SECONDS);
  neighbors.sync(account);
  emit('weather_load', database.getWeather(account));
  emit('client_load_events', database.getTravelEvents(account));
  emit('client_load_role', database.getRole(account));
  emit('client_load_decorate', { has_list: [], put_id: 0, status: 0 },true);
  emit('clover_load_clovers', database.getCloverPlots(account));
  emit('item_load_items', database.getItemState(account));
  emit('item_load_handbook', database.getHandbook(account));
  emit('item_load_shop_info', { purchased: database.getShopPurchases(account) });
  emit('album_load_all', { id_list: database.getPostcards(account, 'album') });
  emit('album_load_new', {
    pictures: database.getPostcards(account, 'new'), visted_pic: [], has_ads: false, is_share: false,
  });
  emit('album_load_recover', { pictures: database.getPostcards(account, 'recycle') });
  emit('travel_load_gift', database.getGiftBox(account));
  emit('travel_load_note', { note_list: database.getTravelNotes(account) });
  emit('mail_load', database.getMails(account));
  emit('story_load', { stories: database.getStories(account), new_story_id: 0 });
  emit('misc_moment_load', { list: database.getMoments(account) });
  emit('encyclopedia_load', database.getEncyclopedia(account));
  emit('visit_load', database.getVisitorState(account, nowSeconds(), VISIT_SECONDS));
  emit('furniture_load_furniture', furnitureState(account));
  emit('guest_load', guestProtocol(neighbors.state(account)));
  emit('furniture_load_tumbler', { show_index: 0, replace_index: 0, tumbler_list: [] },true);
  emit('furniture_load_compost', {
    show_index: 0, replace_index: 0, compost_list: [], state: 0, box_index: 0, box_list: [],
  },true);
  emit('furniture_load_pocket', { show_index: 0, replace_index: 0, list: [], clover: 0 },true);
  emit('recharge_load', { water: 0, change: 0, field: [], sack: [] },true);
  emit('task_load', { tasks: [], list: [] },true);
  emit('task_load_list', { reward: [] },true);
  emit('share_load', { pic_list: [] },true);
  emit('pray_load_grays', [],true);
  emit('museum_load', { museum_list: [] },true);
  emit('wishingpool_load', {},true);
  emit('adsmgr_load', { can_pop: false, can_banner: false, day_left: 0, gift_id: 0, gift_time: 0, gift_can_get: 0, gift_get: 0, item_list: [] });
  for(const [cmd,data]of moduleInitial)if(!sent.has(cmd)&&!['clover_update','item_update','item_update_ticket','notify_new_mail'].includes(cmd))emit(cmd,data);
  for(const [cmd,data]of Object.entries(official?.protocols||{})){
    if(sent.has(cmd)||cmd==='client_load_all_info'||cmd==='album_load_by_id_list'||!cmd.includes('load'))continue;
    sendEvent(client,cmd,data);
  }
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
  sendEvent(client, 'furniture_load_furniture', furnitureState(client.account));
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
    try{
    if(database.isOfficialReadOnly(account))continue;
    for(const service of gameModules)if(service.advance){
      try{const result=service.advance(account);if(service===creative&&result.changed)result.events.push({cmd:'furniture_load_furniture',data:furnitureState(account)});for(const client of accountClients)moduleEvents(client,result);}
      catch(error){console.error('Module advance failed:',service.constructor.name,error.message);diagnostics.record(account,'internal_module_advance',{module:service.constructor.name},'handler_error');}
    }
    const result = advanceTravel(account);
    if (result) for (const client of accountClients) pushTravelCompletion(client, result);
    const made = creative.isBenchLocked(account)?{changed:false}:furniture.advance(account);
    if (made.changed) for (const client of accountClients) pushFurnitureState(client,made);
    const neighbor = neighborAction(account,()=>neighbors.sync(account));
    if (neighbor.changed) for (const client of accountClients) pushNeighborState(client,neighbor);
    }catch(error){console.error('Account advance failed:',account,error.message);diagnostics.record(account,'internal_account_advance',{},'handler_error');}
  }
}

function commandData(client, request) {
  const data = request.data || {};
  const account = client.account;
  const official=database.getOfficialArchive(account);
  if(official&&official.mode!=='active'&&!request.cmd.startsWith('hall_')&&request.cmd!=='client_hello'&&request.cmd!=='client_load_all_info'){
    if(request.cmd==='album_load_by_id_list')return {pic_list:database.getPostcards(account,'album',data.id_list||[])};
    if(request.cmd==='album_load')return {start:Number(data.start||1),total:database.countPostcards(account,'album'),pictures:database.getPostcards(account,'album',null,data.start||1,data.count||20)};
    if(request.cmd.includes('load')&&Object.hasOwn(official.protocols,request.cmd))return official.protocols[request.cmd];
    if(['client_confirm_event','travel_read_note','story_read_new_story','mail_read'].includes(request.cmd))return {code:0};
    if(/^(client_set_|client_switch_)/.test(request.cmd))return {code:0};
    return unsupported(client,request,'archive_readonly');
  }
  for(const service of gameModules)if((service.commands||service.handledCommands).has(request.cmd)){
    const result=service.handle(account,request.cmd,data);
    afterGameReply(client,()=>{moduleEvents(client,result);const progress=progression.sync(account);moduleEvents(client,progress);if(progress.earned.length)sendEvent(client,'client_load_role',database.getRole(account));});
    return result.response;
  }
  switch (request.cmd) {
    case 'client_load_role':return database.getRole(account);
    case 'client_load_events':return database.getTravelEvents(account);
    case 'client_load_all_info':
    case 'client_set_ads':
    case 'client_set_channel':
    case 'client_set_channel_id':
    case 'client_set_client_envinfo':
    case 'hall_report_remote_addr':return {code:0};
    case 'furniture_load_furniture':
      return furnitureState(account);
    case 'furniture_putin_bench':
    case 'furniture_takeout_bench':
    case 'furniture_buy_shop':
    case 'furniture_replace_fur': {
      if(['furniture_putin_bench','furniture_takeout_bench'].includes(request.cmd)&&creative.isBenchLocked(account))return {code:1,message:'不倒翁正在制作，工作台已锁定'};
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
      if(GAME_AUTH_REQUIRED){
        const account=gameAuth.resolve(data.account);
        if(!account)throw Error('请先使用账号密码登录');
        client.account=account;client.token=data.account;
        return {token:client.token};
      }
      client.account = normalizeAccount(data.account);
      client.token = `local-${client.account}`;
      return { token: client.token };
    case 'hall_login':
    case 'hall_reconnect':
      if(GAME_AUTH_REQUIRED){
        const account=gameAuth.resolve(data.token);
        if(!account)throw Error('登录已失效，请重新输入账号密码');
        client.account=account;client.token=data.token;client.uid=database.ensureAccount(account).uid;client.authed=true;
        return {code:0,account};
      }
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
      const shopItem = database.economy?economy.shop.get(Number(data.shop_id)):SHOP_ITEMS.get(Number(data.shop_id));
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
      if(policy()){
        const state=database.modules.get(account,'travel-plan',{});
        if(!data.completed){delete state.depart_at;database.modules.set(account,'travel-plan',state);return {code:0};}
        if(catalog.items.find(x=>x.id===database.getItemState(account).bag[0])?.type!==0){database.setBagCompleted(account,false);return {code:1,message:'请准备旅行食物'};}
        if(!state.depart_at)database.modules.set(account,'travel-plan',{depart_at:nowSeconds()+policy().homeWait()});
        return {code:0};
      }
      if (data.completed) {
        const selection = selectTrip(database.getTripCount(account) + 1);
      const tripFood=database.getItemState(account).bag[0];
        const started = database.startTravel(account, selection.route, selection.companionId, TRIP_SECONDS);
        if (!started.ok) {
          database.setBagCompleted(account, false);
          sendEvent(client, 'item_load_items', database.getItemState(account));
          return { code: 1, message: started.reason };
        }
        progression.record(account,'trip-start',{food:tripFood});
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
      if(request.cmd.includes('load')&&Object.hasOwn(official?.protocols||{},request.cmd)){
        diagnostics.record(account,request.cmd,data,'snapshot_read_only');
        return official.protocols[request.cmd];
      }
      return unsupported(client,request);
  }
}

function unsupported(client,request,reason='unimplemented'){
  diagnostics.record(client.account,request.cmd,request.data||{},reason);
  const last=client.unsupportedNotices ||= new Map(),now=Date.now();
  if(now-(last.get(request.cmd)||0)>30000){
    last.set(request.cmd,now);
    sendEvent(client,'client_notice',{msg:`暂未支持此功能（${request.cmd}），已记录到服务器日志。`});
  }
  return {code:1,supported:false,message:'功能尚未实现，已记录',command:request.cmd};
}

function handleMessage(client, text) {
  if (client.invalidated) return;
  let request;
  try { request = JSON.parse(text); } catch (_) { return; }
  if (!request || typeof request.cmd !== 'string') return;
  const cmd = request.cmd.replace('.', '_');
  request.cmd = cmd;
  if(GAME_AUTH_REQUIRED&&!['client_hello','hall_gen_token','hall_login','hall_reconnect'].includes(cmd)&&(!client.authed||!gameAuth.resolve(client.token))){
    sendResponse(client,request,{code:1,message:'请先登录'});return;
  }
  console.log(`[${client.remote}] ${cmd}${request.data ? ` ${JSON.stringify(describe(request.data))}` : ''}`);
  let replied=false;
  try {
    const observedActions=new Set(['clover_harvest','clover_harvest_resend','item_putin_bag','item_putin_desk','travel_bag_to_gift','item_buy','furniture_buy_shop','item_set_bag_completed','guest_lock_bag','guest_serve','item_gacha','item_redeem_prize','album_save_new']);
    const fingerprint=()=>JSON.stringify({role:database.db.prepare('SELECT clover,ticket,trip_count,bag_completed,bag_json,desk_json FROM accounts WHERE account=?').get(client.account),items:database.getItemState(client.account),pictures:database.db.prepare('SELECT id,location FROM postcards WHERE account=? ORDER BY id').all(client.account),plots:database.getCloverPlots(client.account),creative:database.modules.get(client.account,'creative',{})});
    const before=client.authed&&observedActions.has(cmd)?fingerprint():null;
    const previousClover=before?database.ensureAccount(client.account).clover:null;
    const response = commandData(client, request);
    if (cmd === 'client_load_all_info') {
      // Push state before acknowledging the synchronization request so the
      // client has season/role data before it starts loading scene resources.
      pushInitialState(client);
      client.synced = true;
      sendResponse(client, request, response);
      setTimeout(()=>pushAnnouncements(client),1000).unref();
      return;
    }
    sendResponse(client, request, response);
    replied=true;
    for (const callback of client.afterResponse || []) callback();
    client.afterResponse = [];
    let committed=before!==null&&before!==fingerprint()&&(response?.code===0||Array.isArray(response));
    if(committed&&cmd==='guest_lock_bag')committed=JSON.parse(before).creative?.drawing?.state===2&&database.modules.get(client.account,'creative',{}).drawing?.state===3;
    if(committed&&cmd==='item_set_bag_completed')committed=!JSON.parse(before).role.bag_completed&&!!request.data?.completed;
    if(client.authed&&(committed||cmd==='hall_login'&&response?.code===0)){
      for(const service of [activities,cards,exploration])moduleEvents(client,service.observe(client.account,cmd,request.data||{}));
      const lifeType={hall_login:'login',guest_serve:'feed',album_save_new:'photo',item_redeem_prize:'redeem'}[cmd];if(lifeType)moduleEvents(client,life.observe(client.account,lifeType));
      const dailyType={guest_serve:'feed',item_redeem_prize:'redeem',item_putin_desk:'desk'}[cmd];if(dailyType)moduleEvents(client,daily.observe(client.account,dailyType,1,{guest:request.data?.id,full:database.getItemState(client.account).desk.every(x=>x>=0)}));
      const earnedClover=previousClover===null?0:database.ensureAccount(client.account).clover-previousClover;if(earnedClover>0)moduleEvents(client,life.observe(client.account,'clover',earnedClover));
      if(earnedClover>0)moduleEvents(client,daily.observe(client.account,'clover',earnedClover));
      const progress=progression.sync(client.account);moduleEvents(client,progress);if(progress.earned.length)sendEvent(client,'client_load_role',database.getRole(client.account));
    }
  } catch (error) {
    client.afterResponse = [];
    console.error(`[${client.remote}] ${cmd} failed: ${error.message}`);
    diagnostics.record(client.account,cmd,request.data||{},replied?'post_reply_error':'handler_error');
    if(!replied)sendResponse(client, request, { code: 1, message: error.message });
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
  if(await adminAuth.handle(req,res,url,sendHttpJson))return;
  if(['/api/game/login','/api/game/refresh'].includes(url.pathname)&&req.method==='POST'){
    try{
      if(!(req.headers['content-type']||'').startsWith('application/json'))throw Error('Expected application/json');
      const body=await readJsonBody(req);const result=url.pathname.endsWith('/refresh')?gameAuth.refresh(body.refresh_token):await gameAuth.login(body.username,body.password,req.socket.remoteAddress);
      sendHttpJson(res,200,result);
    }catch(e){sendHttpJson(res,401,{error:e.message});}return;
  }
  if (url.pathname === '/health') {
    sendHttpJson(res, 200, { ok: true, version: require('../package.json').version });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (adminAuth.mode==='oidc') {
      if(!adminAuth.authorize(req)){sendHttpJson(res,401,{error:'请通过 Authentik 登录，或刷新页面后重试。'});return;}
    } else {
    if (url.pathname.startsWith('/api/admin/') && !ADMIN_TOKEN) {
      sendHttpJson(res, 503, { error: '请设置 FROG_ADMIN_TOKEN（至少 24 字符）后重启服务器' }); return;
    }
    if (ADMIN_TOKEN ? !hasAdminToken(req) : !isLoopback(req.socket.remoteAddress) || !!req.headers.origin) {
      sendHttpJson(res, 401, { error: 'Invalid or missing management token' }); return;
    }
    }
  }
  try {
    if (url.pathname.startsWith('/api/admin/')) {
      const route = url.pathname.slice('/api/admin/'.length);
      const account = url.searchParams.get('account');
      if (req.method === 'GET') {
        if(route==='announcements'){sendHttpJson(res,200,announcements.list());return;}
        if(route==='game-users'){sendHttpJson(res,200,{users:gameAuth.list(),accounts:database.getAccounts().map(({account,frog_name})=>({account,frog_name}))});return;}
        if (route === 'status') {
          sendHttpJson(res, 200, { version: require('../package.json').version, schema: database.db.prepare('PRAGMA user_version').get().user_version,
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
        if (route === 'unsupported') {
          sendHttpJson(res,200,{calls:diagnostics.list(account)}); return;
        }
        if (route === 'snapshots') {
          sendHttpJson(res,200,admin.snapshots.list(account,url.searchParams.has('before')?Number(url.searchParams.get('before')):null)); return;
        }
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
        if(route==='announcements'){
          const actor=adminAuth.mode==='oidc'?adminAuth.session(req).user.sub:'token-admin';
          const result=announcements.mutate(await readJsonBody(req),actor,req.headers['idempotency-key']);
          sendHttpJson(res,200,result);
          if(result.action==='publish'&&!result.replayed)for(const client of clients)pushAnnouncements(client,[result.announcement]);
          return;
        }
        if(route==='game-users'){sendHttpJson(res,200,gameAuth.manage(await readJsonBody(req),adminAuth.mode==='oidc'?adminAuth.session(req).user.sub:'token-admin'));return;}
        if(route==='game-credentials'){
          admin.requireAccount(account);const body=await readJsonBody(req);
          const result=gameAuth.setPassword(body.username,body.password,account);
          sendHttpJson(res,200,{ok:true,...result});return;
        }
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
    if(process.env.FROG_ADMIN_UI_ORIGIN){
      const target=new URL(url.pathname+url.search,process.env.FROG_ADMIN_UI_ORIGIN);
      const outgoing=http.request(target,{method:'GET',headers:{host:req.headers.host||target.host}},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});
      outgoing.setTimeout(15000,()=>outgoing.destroy());outgoing.on('error',()=>{if(!res.headersSent)sendHttpJson(res,502,{error:'管理界面暂时不可用'});else res.destroy();});outgoing.end();return;
    }
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
