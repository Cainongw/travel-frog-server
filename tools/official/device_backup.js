'use strict';
const { PROJECT_ROOT } = require("../../src/paths");


// Read-only device capture. adb exec-out bytes go straight to a file, never
// through PowerShell's text redirection. Credentials stay in the local backup.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
const adb = process.env.FROG_ADB || 'G:/platform-tools/adb.exe';
const serial = process.env.FROG_DEVICE;
const pkg = 'com.ali.croak.mi';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function shell(command) {
  if (!serial) throw Error('Set FROG_DEVICE to the adb device serial before capturing');
  const result = spawnSync(adb, ['-s', serial, 'shell', 'su -c ' + quote(command)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw Error(result.stderr || result.stdout || 'adb failed');
  return result.stdout;
}
async function capture(command, destination) {
  if (!serial) throw Error('Set FROG_DEVICE to the adb device serial before capturing');
  const fd = fs.openSync(destination + '.stderr.txt', 'wx');
  const child = spawn(adb, ['-s', serial, 'exec-out', 'su -c ' + quote(command)], { stdio: ['ignore','pipe',fd] });
  const ended = new Promise((resolve, reject) => { child.once('error',reject); child.once('exit',resolve); });
  const hash = crypto.createHash('sha256');
  child.stdout.on('data', bytes => hash.update(bytes));
  await pipeline(child.stdout, fs.createWriteStream(destination, { flags:'wx' }));
  const code = await ended;
  fs.closeSync(fd);
  return { file:path.basename(destination), bytes:fs.statSync(destination).size, sha256:hash.digest('hex'), exit_code:code, stderr:fs.readFileSync(destination+'.stderr.txt','utf8') };
}
async function main() {
  if(process.argv.includes('--check')){console.log(JSON.stringify({checked:true,projectRoot:PROJECT_ROOT,adb,deviceConfigured:!!serial}));return;}
  if (process.argv[2] === 'inspect') { process.stdout.write(shell(process.argv[3])); return; }
  if (!serial) throw Error('Set FROG_DEVICE to the adb device serial before capturing');
  const root=path.resolve(PROJECT_ROOT,process.argv[2] || path.join('exports','device-'+new Date().toISOString().replace(/[:.]/g,'-')));
  fs.mkdirSync(root,{recursive:true});
  const roots=[`/data/user/0/${pkg}`,`/data/user_de/0/${pkg}`,`/sdcard/Android/data/${pkg}`,`/sdcard/Android/obb/${pkg}`,`/sdcard/Android/media/${pkg}`];
  const present=roots.filter(p=>shell(`if [ -d ${quote(p)} ]; then echo yes; fi`).trim()==='yes');
  fs.writeFileSync(path.join(root,'directories.txt'),shell(present.map(p=>`ls -la ${quote(p)}`).join('; ')),{flag:'wx'});
  fs.writeFileSync(path.join(root,'file-inventory.txt'),shell(`find ${present.map(quote).join(' ')} -type f`),{flag:'wx'});
  fs.writeFileSync(path.join(root,'package.txt'),shell(`dumpsys package ${pkg}`),{flag:'wx'});
  const apk=shell(`pm path ${pkg}`).trim().split(/\r?\n/).map(x=>x.replace(/^package:/,''));
  const results=[];
  for(const [i,p] of present.entries()) results.push(await capture(`tar -C ${quote(p)} -cf - .`,path.join(root,`data-${i}.tar`)));
  for(const [i,p] of apk.entries()) results.push(await capture(`cat ${quote(p)}`,path.join(root,`package-${i}.apk`)));
  const pid=shell(`pidof ${pkg} || true`).trim();
  const manifest={device:serial,package:pkg,captured_at:new Date().toISOString(),consistency:pid?'live copy; application was running':'application not running at end of capture',roots:present,apk_paths:apk,archives:results};
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  console.log(JSON.stringify({root,...manifest},null,2));
  if(results.some(x=>x.exit_code!==0)) process.exitCode=1;
}
if(require.main===module) main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={shell,capture};
