'use strict';

const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const { FrogDatabase }=require('./database');
const { AdminService }=require('./admin');
const { SnapshotService, SAVE_TABLES }=require('./snapshots');
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(t){
  const db=new FrogDatabase(':memory:'); t.after(()=>db.close());
  db.ensureAccount('a');db.ensureAccount('b');
  const admin=new AdminService(db,{items:[],pictures:[],notes:[],resources:{}});
  return {db,admin,snapshots:admin.snapshots};
}

test('snapshot covers every current account game table and restores exact rows, not seeded defaults',t=>{
  const {db,admin,snapshots}=fixture(t);
  const tables=db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name)
    .filter(name=>!name.startsWith('admin_')&&db.db.prepare(`PRAGMA table_info(${name})`).all().some(c=>c.name==='account'));
  assert.deepEqual(tables.sort(),[...SAVE_TABLES].sort());
  db.updateAccount('a',{frog_name:'快照蛙',clover:70,ticket:3,bag_json:'[0,-1,-1,-1]',desk_json:'[-1,-1,-1,-1,-1,-1,-1,-1]'});
  db.changeInventory('a',0,2);
  db.addPostcard('a',{id:db.nextPostcardId('a'),pic_id:100,layers:[{layer:[1,-0.5,3.5]}]},'album');
  db.db.prepare('DELETE FROM clover_plots WHERE account=?').run('a');
  db.db.prepare('DELETE FROM mails WHERE account=?').run('a');
  const before=plain(snapshots.capture('a')),other=plain(snapshots.capture('b'));
  const saved=admin.mutate('a','snapshot-create',{label:'出发前'},'create-1');
  const id=saved.snapshot.id;
  db.updateAccount('a',{clover:10,ticket:0}); db.changeInventory('a',0,9); db.nextPostcardId('a');
  db.addPostcard('a',{id:20,pic_id:101,layers:[]},'new');
  const changed=plain(snapshots.capture('a'));
  const result=admin.mutate('a','snapshot-restore',{snapshot_id:id,confirm_account:'a'},'restore-1');
  assert.deepEqual(plain(snapshots.capture('a')),before);
  assert.deepEqual(plain(snapshots.capture('b')),other);
  assert.equal(snapshots.list('a').snapshots.length,2);
  assert.equal(snapshots.list('a').snapshots[0].kind,'before_restore');
  assert.equal(admin.audit('a').length,2,'audit history survives restore');
  snapshots.restore('a',result.safety_snapshot_id,'a');
  assert.deepEqual(plain(snapshots.capture('a')),changed,'can undo rollback using safety snapshot');
});

test('snapshot creation and restoration are idempotent, account-scoped and confirmed',t=>{
  const {db,admin,snapshots}=fixture(t);
  const saved=admin.mutate('a','snapshot-create',{label:'同名'},'c1');
  assert.equal(admin.mutate('a','snapshot-create',{label:'同名'},'c1').replayed,true);
  assert.equal(snapshots.list('a').snapshots.length,1);
  assert.throws(()=>admin.mutate('a','snapshot-create',{label:'不同'},'c1'),/already used/);
  assert.throws(()=>snapshots.create('missing'),/not found/);
  assert.throws(()=>snapshots.create('a','x'.repeat(101)),/100/);
  assert.throws(()=>snapshots.restore('b',saved.snapshot.id,'b'),/not found/);
  assert.throws(()=>snapshots.restore('a',saved.snapshot.id,'b'),/确认/);
  assert.throws(()=>snapshots.restore('a',0,'a'),/Invalid/);
  const restored=admin.mutate('a','snapshot-restore',{snapshot_id:saved.snapshot.id,confirm_account:'a'},'r1');
  db.updateAccount('a',{clover:888});
  const replay=admin.mutate('a','snapshot-restore',{snapshot_id:saved.snapshot.id,confirm_account:'a'},'r1');
  assert.equal(replay.replayed,true);
  assert.equal(replay.safety_snapshot_id,restored.safety_snapshot_id);
  assert.equal(db.getRole('a').res.clover_point,888,'retry does not rewind again');
  assert.equal(snapshots.list('a').snapshots.length,2);
});

test('corruption or an insertion failure rolls back the restore, safety copy and audit',t=>{
  const {db,admin,snapshots}=fixture(t);
  db.changeInventory('a',0,2);
  const saved=snapshots.create('a');
  db.changeInventory('a',0,5);
  const before=plain(snapshots.capture('a'));
  db.db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON inventory WHEN NEW.count=2 BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  assert.throws(()=>admin.mutate('a','snapshot-restore',{snapshot_id:saved.id,confirm_account:'a'},'fail'),/simulated failure/);
  assert.deepEqual(plain(snapshots.capture('a')),before);
  assert.equal(snapshots.list('a').snapshots.length,1);
  assert.equal(admin.audit('a').length,0);
  db.db.exec('DROP TRIGGER fail_restore');
  db.db.prepare('UPDATE admin_snapshots SET payload_json=? WHERE id=?').run('{}',saved.id);
  assert.throws(()=>snapshots.restore('a',saved.id,'a'),/checksum/);
  assert.deepEqual(plain(snapshots.capture('a')),before);
  assert.equal(snapshots.list('a').snapshots.length,1);
});

test('official raw archive and fractional coordinates survive snapshot and restart without catalog',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frog-snapshots-')),file=path.join(dir,'db.sqlite');
  let db=new FrogDatabase(file);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.ensureAccount('official');
  const raw=JSON.stringify({mode:'preserved',protocols:{activity_load:{unknown:[1,2.5]}},capture:{original:'unchanged'}});
  db.db.prepare('INSERT INTO official_archives(account,data_json) VALUES (?,?)').run('official',raw);
  db.addPostcard('official',{id:1,pic_id:0,layers:[{layer:[0,-0.5,9.5]}]},'gift');
  let admin=new AdminService(db,{});
  const before=plain(admin.snapshots.capture('official'));
  const saved=admin.mutate('official','snapshot-create',{},'official-create');
  db.updateAccount('official',{clover:999});db.close();db=new FrogDatabase(file);admin=new AdminService(db,{});
  admin.snapshots.restore('official',saved.snapshot.id,'official');
  assert.deepEqual(plain(admin.snapshots.capture('official')),before);
  assert.equal(db.db.prepare('SELECT data_json FROM official_archives WHERE account=?').get('official').data_json,raw);
});

test('official snapshot activation keeps its original checkpoint and rollback remains playable',t=>{
  const {db,admin}=fixture(t);
  const archive={mode:'preserved',protocols:{client_load_role:{frog:{status:3}},activity_load:{state:4}},capture:{raw:'original'}};
  db.db.prepare('INSERT INTO official_archives(account,data_json) VALUES (?,?)').run('a',JSON.stringify(archive));
  db.updateAccount('a',{frog_status:3,frog_motion:-1,clover:70});
  assert.throws(()=>admin.mutate('a','archive-activate',{},'no-checkpoint'),/快照/);
  assert.throws(()=>admin.mutate('a','role',{clover:50},'locked'),/快照/);
  const saved=admin.mutate('a','snapshot-create',{},'unlock');
  assert.equal(saved.activated,true);assert.equal(db.isOfficialReadOnly('a'),false);
  assert.equal(db.getRole('a').frog.status,0);assert.equal(db.getRole('a').frog.motion,0);
  assert.deepEqual(db.getOfficialArchive('a').capture,archive.capture);
  const payload=JSON.parse(db.db.prepare('SELECT payload_json FROM admin_snapshots WHERE id=?').get(saved.snapshot.id).payload_json);
  assert.equal(payload.tables.accounts[0].frog_status,3,'original status remains in checkpoint');
  admin.mutate('a','role',{clover:10},'edit');
  const restored=admin.mutate('a','snapshot-restore',{snapshot_id:saved.snapshot.id,confirm_account:'a'},'restore-unlock');
  assert.equal(restored.activated,true);assert.equal(db.getRole('a').res.clover_point,70);assert.equal(db.isOfficialReadOnly('a'),false);
  admin.mutate('a','role',{clover:60},'edit-after-restore');assert.equal(db.getRole('a').res.clover_point,60);
});

test('snapshot listing pages older records without exposing other accounts or payloads',t=>{
  const {snapshots}=fixture(t);
  for(let i=0;i<102;i++)snapshots.create('a',String(i));
  snapshots.create('b','other');
  const first=snapshots.list('a'),second=snapshots.list('a',first.next_cursor);
  assert.equal(first.snapshots.length,100);assert.equal(second.snapshots.length,2);assert.equal(second.next_cursor,null);
  assert.equal(new Set([...first.snapshots,...second.snapshots].map(x=>x.id)).size,102);
  assert.ok(first.snapshots.every(x=>x.account==='a'&&!Object.hasOwn(x,'payload_json')));
});
