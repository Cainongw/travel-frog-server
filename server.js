'use strict';

// Minimal, dependency-free WebSocket server for the local TestChannel build.
// It implements the login handshake and enough state for the album screen.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = process.env.FROG_HOST || '0.0.0.0';
const PORT = Number(process.env.FROG_PORT || 8080);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const DATA_FILE = process.env.FROG_DATA || path.join(__dirname, 'data', 'postcards.json');

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

function roleData(client) {
  return {
    uid: client.uid,
    res: { clover_point: 0, ticket: 0 },
    settings: {
      client: JSON.stringify({ guideStep: 'Complete', bgSound: 1, effectSound: 1 }),
      push_switch: false,
      rank_switch: false,
    },
    misc: { picture_cnt: pictures.length, wx_push_reward: false, wx_my_reward: false, create_time: nowSeconds() },
    frog: {
      name: '旅行青蛙', cur_achieve: -1, achieves: [], achieves_time: [], status: 0,
      motion: 0, icon: 0, pic_show: [], decoration: [], taobao_data: null,
    },
  };
}

function pushInitialState(client) {
  // Season 41 is bundled in the APK. Without this event the client keeps its
  // default season 00 and asks the resource loader for files that do not exist.
  sendEvent(client, 'weather_load', { season: 4, hours_type: 1, weather: 0 });
  sendEvent(client, 'client_load_events', []);
  sendEvent(client, 'client_load_role', roleData(client));
  sendEvent(client, 'client_load_decorate', { has_list: [], put_id: 0, status: 0 });
  sendEvent(client, 'clover_load_clovers', []);
  sendEvent(client, 'item_load_items', {
    house: [], bag: [-1, -1, -1, -1, -1], desk: [-1, -1, -1],
    bag_completed: false, bag_conflict: false, desk_conflict: false, gacha: { color_ball: -1 },
  });
  sendEvent(client, 'item_load_handbook', { collections: [], specialtys: [] });
  sendEvent(client, 'item_load_shop_info', { purchased: [] });
  sendEvent(client, 'album_load_all', { id_list: pictures });
  sendEvent(client, 'album_load_new', { pictures: [], visted_pic: [], has_ads: false, is_share: false });
  sendEvent(client, 'album_load_recover', { pictures: [] });
  sendEvent(client, 'travel_load_gift', { pictures: [], specialtys: [] });
  sendEvent(client, 'travel_load_note', { note_list: [] });
  sendEvent(client, 'mail_load', []);
  sendEvent(client, 'story_load', { stories: [], new_story_id: 0 });
  sendEvent(client, 'visit_load', { visitor: null });
  sendEvent(client, 'furniture_load_furniture', {
    has_fur: [], put_fur: [], replace_fur: [],
    shop: { shop_list: [], start_time: 0, leave_time: 0 },
  });
  sendEvent(client, 'furniture_load_tumbler', { list: [] });
  sendEvent(client, 'furniture_load_compost', { list: [] });
  sendEvent(client, 'furniture_load_pocket', { list: [] });
  sendEvent(client, 'recharge_load', { water: 0, change: 0, field: [], sack: [] });
  sendEvent(client, 'task_load', { tasks: [], list: [] });
  sendEvent(client, 'task_load_list', { reward: [] });
  sendEvent(client, 'share_load', { pic_list: [] });
  sendEvent(client, 'pray_load_grays', []);
  sendEvent(client, 'museum_load', { museum_list: [] });
  sendEvent(client, 'wishingpool_load', {});
  sendEvent(client, 'adsmgr_load', { can_pop: false, can_banner: false, day_left: 0, gift_id: 0, gift_time: 0, gift_can_get: 0, gift_get: 0, item_list: [] });
}

function commandData(client, request) {
  const data = request.data || {};
  switch (request.cmd) {
    case 'client_hello':
      return { timestamp: nowSeconds() };
    case 'hall_gen_token':
      client.account = String(data.account || 'guest');
      client.token = `local-${client.account}`;
      return { token: client.token };
    case 'hall_login':
    case 'hall_reconnect':
      client.token = String(data.token || client.token || 'local-guest');
      client.account = client.token.startsWith('local-') ? client.token.slice(6) : (client.account || 'guest');
      client.uid = `local-${client.account}`;
      client.authed = true;
      return { code: 0, account: client.account };
    case 'hall_enter_game':
      return { code: 0 };
    case 'album_load_all':
      return { id_list: pictures };
    case 'album_load':
      return { start: Number(data.start || 1), total: pictures.length, pictures };
    case 'album_load_by_id_list':
      return { pic_list: pictures };
    case 'album_load_new':
      return { pictures: [], visted_pic: [], has_ads: false, is_share: false };
    case 'album_load_recover':
      return { pictures: [] };
    case 'travel_load_gift':
      return { pictures: [], specialtys: [] };
    case 'travel_load_note':
      return { note_list: [] };
    case 'mail_load':
      return [];
    case 'mail_load_mails':
      return { start: Number(data.start || 1), count: 0, total: 0, mails: [] };
    case 'item_load_items':
      return { house: [], bag: [-1, -1, -1, -1, -1], desk: [-1, -1, -1], bag_completed: false, gacha: { color_ball: -1 } };
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
  const response = commandData(client, request);
  if (cmd === 'client_load_all_info') {
    // Push state before acknowledging the synchronization request so the
    // client has season/role data before it starts loading scene resources.
    pushInitialState(client);
    sendResponse(client, request, response);
    return;
  }
  sendResponse(client, request, response);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('travel frog private server\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);

  const client = { socket, remote: req.socket.remoteAddress, buffer: Buffer.alloc(0), account: 'guest', uid: 'local-guest', authed: false };
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
  socket.on('close', () => console.log(`[${client.remote}] disconnected`));
  console.log(`[${client.remote}] connected`);
});

server.listen(PORT, HOST, () => {
  console.log(`travel frog private server listening on ws://${HOST}:${PORT}`);
  console.log(`loaded ${pictures.length} postcard(s) from ${DATA_FILE}`);
});
