'use strict';
const { PROJECT_ROOT } = require("./src/paths");


const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assetConfig=path.join(PROJECT_ROOT,'data','assets.local.json');
if(!process.env.FROG_ASSETS&&fs.existsSync(assetConfig))process.env.FROG_ASSETS=JSON.parse(fs.readFileSync(assetConfig,'utf8')).root;

// Keep a per-install secret outside Git. This launcher defaults to local-only;
// FROG_HOST=0.0.0.0 explicitly enables remote HTTP management.
const tokenFile = path.join(PROJECT_ROOT, 'data', 'admin.token');
fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
if (process.env.FROG_ADMIN_AUTH!=='oidc' && !process.env.FROG_ADMIN_TOKEN) {
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  process.env.FROG_ADMIN_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
  console.log(`Management token file: ${tokenFile}`);
}
process.env.FROG_HOST ||= '127.0.0.1';
console.log(`Management UI: http://127.0.0.1:${process.env.FROG_PORT || 8080}/admin/`);
require('./src/server');
