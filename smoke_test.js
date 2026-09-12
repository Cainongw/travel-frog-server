'use strict';

const net = require('net');
const crypto = require('crypto');

const socket = net.connect(8080, '127.0.0.1');
let buffer = Buffer.alloc(0);
let upgraded = false;
let session = 1;

function clientFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length >= 126) throw new Error('smoke payload too long');
  const mask = crypto.randomBytes(4);
  const encoded = Buffer.from(payload);
  for (let i = 0; i < encoded.length; i++) encoded[i] ^= mask[i % 4];
  return Buffer.concat([Buffer.from([0x81, 0x80 | encoded.length]), mask, encoded]);
}

function send(cmd, data) {
  socket.write(clientFrame(JSON.stringify({ cmd, session: session++, timestamp: Math.floor(Date.now() / 1000), data })));
}

socket.on('connect', () => {
  const key = crypto.randomBytes(16).toString('base64');
  socket.write(
    `GET / HTTP/1.1\r\nHost: localhost:8080\r\nUpgrade: websocket\r\n` +
    `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
});

socket.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  if (!upgraded) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    if (!buffer.subarray(0, headerEnd).toString().includes('101 Switching Protocols')) throw new Error('upgrade failed');
    buffer = buffer.subarray(headerEnd + 4);
    upgraded = true;
    send('hall_gen_token', { account: 'smoke' });
    send('hall_login', { token: 'local-smoke' });
    send('hall_enter_game', {});
    send('client_load_all_info', {});
  }
  while (buffer.length >= 2) {
    let length = buffer[1] & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length < 4) break;
      length = buffer.readUInt16BE(2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length < 10) break;
      length = Number(buffer.readBigUInt64BE(2));
      headerLength = 10;
    }
    if (buffer.length < length + headerLength) break;
    console.log(JSON.parse(buffer.subarray(headerLength, headerLength + length).toString('utf8')));
    buffer = buffer.subarray(headerLength + length);
  }
});

setTimeout(() => socket.end(), 250);
