'use strict';
const { PROJECT_ROOT } = require("../paths");


const fs = require('node:fs');
const path = require('node:path');

// XXTEA envelope used by the client's EAB and epng loaders. No APK code executes.
function decrypt(bytes, key) {
  const n = Math.ceil(bytes.length / 4), v = new Uint32Array(n), k = new Uint32Array(4);
  for (let i = 0; i < bytes.length; i++) v[i >>> 2] |= bytes[i] << ((i & 3) * 8);
  const kb = Buffer.from(key);
  for (let i = 0; i < Math.min(16, kb.length); i++) k[i >>> 2] |= kb[i] << ((i & 3) * 8);
  if (n < 2) throw Error('Invalid encrypted asset');
  const delta = 0x9e3779b9;
  let sum = (Math.floor(6 + 52 / n) * delta) >>> 0, y = v[0];
  while (sum) {
    const e = (sum >>> 2) & 3;
    for (let p = n - 1; p >= 0; p--) {
      const z = v[p === 0 ? n - 1 : p - 1];
      const mx = ((z >>> 5 ^ y << 2) + (y >>> 3 ^ z << 4)) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
      y = v[p] = (v[p] - mx) >>> 0;
    }
    sum = (sum - delta) >>> 0;
  }
  const length = v[n - 1];
  if (length < (n - 1) * 4 - 3 || length > (n - 1) * 4) throw Error('Invalid decrypted length');
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = (v[i >>> 2] >>> ((i & 3) * 8)) & 255;
  return out;
}

function readBundle(filename) {
  let bytes = fs.readFileSync(filename);
  if (bytes.subarray(0, 6).toString('hex') !== '894541420d0a') throw Error('Invalid EAB header');
  bytes = bytes[6] === 27 ? decrypt(bytes.subarray(8), 'ejoyassetbundle') : bytes.subarray(8);
  const length = bytes.readUInt32LE(0);
  const meta = JSON.parse(bytes.subarray(4, 4 + length).toString('utf8'));
  let offset = 4 + length;
  const result = {};
  for (const entry of meta) {
    if (entry.t === 'json') result[entry.n] = JSON.parse(bytes.subarray(offset, offset + entry.s).toString('utf8'));
    offset += entry.s;
  }
  return result;
}

function readBundleAsset(filename,name){
  let bytes=fs.readFileSync(filename);
  bytes=bytes[6]===27?decrypt(bytes.subarray(8),'ejoyassetbundle'):bytes.subarray(8);
  const length=bytes.readUInt32LE(0),meta=JSON.parse(bytes.subarray(4,4+length).toString('utf8'));
  let offset=4+length;
  for(const entry of meta){
    if(entry.n===name){const data=bytes.subarray(offset,offset+entry.s);return entry.t==='epng'?decrypt(data,'1234'):data;}
    offset+=entry.s;
  }
  throw Error('Asset not found in bundle: '+name);
}

function loadCatalog(root = process.env.FROG_ASSETS || path.join(PROJECT_ROOT, '..', '旅行青蛙·中国之旅', 'assets', 'game', 'resource', 'China')) {
  const filename = path.join(root, 'eab', 'config.eab');
  if (!fs.existsSync(filename)) return { available: false, config:{}, items: [], pictures: [], notes: [], resources: {}, furniture: [], furnitureShop: [], bench: [], neighbors: [], specialties: [], root };
  const config = readBundle(filename);
  return {
    available: true, root,
    config,
    items: Object.values(config.Item_json || {}),
    pictures: Object.values(config.Picture_json || {}),
    notes: Object.values(config.Note_json || {}),
    resources: config.resources_json || {},
    prizes: Object.values(config.Prize_json || {}),
    furniture: Object.values(config.furnitureData_json || {}),
    furnitureShop: Object.values(config.furnitureShopData_json || {}),
    bench: Object.values(config.benchData_json || {}),
    neighbors: config.Character_json?.data || [],
    specialties: Object.values(config.Specialty_json || {}),
  };
}

function resourceImage(catalog, id) {
  const resource = catalog.resources[id];
  if (!resource || !/^Picture\/[\w/]+$/.test(resource)) throw Error('Unknown picture resource');
  let filename = path.join(catalog.root, 'images', resource + '.png');
  if(!fs.existsSync(filename)){
    const config=JSON.parse(fs.readFileSync(path.join(catalog.root,'default.res.json'),'utf8'));
    const asset=config.resources.find(x=>x.name===path.basename(resource)+'_png');
    if(asset?.type==='image'&&/^images\/[\w/.-]+\.png$/.test(asset.url)&&!asset.url.includes('..'))filename=path.join(catalog.root,asset.url);
    const bundle=config.resources.find(x=>x.name===asset?.url&&x.type==='eab');
    if(bundle&&/^eab\/[\w.-]+\.eab$/.test(bundle.url))return readBundleAsset(path.join(catalog.root,bundle.url),asset.name);
  }
  const bytes = fs.readFileSync(filename);
  return bytes.subarray(0, 4).toString('hex') === '89504e47' ? bytes : decrypt(bytes, '1234');
}

module.exports = { loadCatalog, resourceImage, readBundle, readBundleAsset };
