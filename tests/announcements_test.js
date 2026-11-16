'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FrogDatabase}=require('../src/core/database'),{AnnouncementsService}=require('../src/admin/announcements'),{SnapshotService}=require('../src/core/snapshots');
function setup(t){const database=new FrogDatabase(':memory:');let now=100;const service=new AnnouncementsService(database,{clock:()=>now});t.after(()=>database.close());return {database,service,setTime:value=>now=value};}
test('published notices are immediately visible, expire at their exact boundary and can be disabled',t=>{
  const {database,service:s,setTime}=setup(t);
  const timed=s.mutate({action:'publish',title:'维护预告',body:'今晚可能重启一次。',expires_at:120},'admin-1','publish-1');
  const permanent=s.mutate({action:'publish',title:'欢迎回来',body:'存档已经迁移完成。'},'admin-2','publish-2');
  assert.deepEqual(s.active().map(x=>x.id),[timed.announcement.id,permanent.announcement.id]);assert.equal(timed.announcement.active,true);assert.equal(timed.announcement.author,'admin-1');
  setTime(119);assert.equal(s.active().length,2);setTime(120);assert.deepEqual(s.active().map(x=>x.id),[permanent.announcement.id]);assert.equal(s.list().announcements.length,2,'expired notices stay available to management');
  const disabled=s.mutate({action:'disable',id:permanent.announcement.id},'admin-2','disable-1');assert.equal(disabled.announcement.active,false);assert.deepEqual(s.active(),[]);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM admin_announcement_operations').get().n,3);
});
test('publication and disabling are idempotent and a delayed retry does not republish an expired notice',t=>{
  const {database,service:s,setTime}=setup(t),input={action:'publish',title:'test',body:'once',expires_at:110};
  const original=s.mutate(input,'admin','publish-key');assert.equal(s.mutate(input,'admin','publish-key').replayed,true);
  setTime(120);const replay=s.mutate(input,'admin','publish-key');assert.equal(replay.replayed,true);assert.equal(replay.announcement.id,original.announcement.id);assert.deepEqual(s.active(),[]);
  assert.throws(()=>s.mutate({...input,body:'different'},'admin','publish-key'),/Idempotency-Key/);assert.throws(()=>s.mutate(input,'another-admin','publish-key'),/Idempotency-Key/);
  const disabled=s.mutate({action:'disable',id:original.announcement.id},'admin','disable-key');assert.equal(disabled.announcement.active,false);assert.equal(s.mutate({action:'disable',id:original.announcement.id},'admin','disable-key').replayed,true);
  assert.equal(s.list().announcements.length,1);assert.equal(database.db.prepare('SELECT count(*) AS n FROM admin_announcement_operations').get().n,2);
});
test('title, body, expiry, authenticated author and idempotency key are validated without partial records',t=>{
  const {database,service:s}=setup(t),valid={action:'publish',title:'Title',body:'Body'};
  for(const body of [null,[],{...valid,title:''},{...valid,title:'x'.repeat(101)},{...valid,body:' '},{...valid,body:'x'.repeat(2001)},{...valid,expires_at:100},{...valid,expires_at:-1},{...valid,expires_at:101.5},{action:'disable',id:0},{action:'delete',id:1}])assert.throws(()=>s.mutate(body,'admin','id'));
  assert.throws(()=>s.mutate(valid,'','id'));assert.throws(()=>s.mutate(valid,'admin',''));assert.throws(()=>s.mutate({action:'disable',id:1},'admin','missing'),/不存在/);
  assert.equal(s.list().announcements.length,0);assert.equal(database.db.prepare('SELECT count(*) AS n FROM admin_announcement_operations').get().n,0);
});
test('an audit insertion failure rolls back the publication and disable together with operation history',t=>{
  const {database,service:s}=setup(t);
  const first=s.mutate({action:'publish',title:'existing',body:'visible'},'admin','first');
  database.db.exec("CREATE TRIGGER fail_announcement_audit BEFORE INSERT ON admin_announcement_operations BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>s.mutate({action:'publish',title:'new',body:'not saved'},'admin','second'),/audit unavailable/);
  assert.throws(()=>s.mutate({action:'disable',id:first.announcement.id},'admin','disable'),/audit unavailable/);
  assert.equal(s.list().announcements.length,1);assert.equal(s.active().length,1);assert.equal(database.db.prepare('SELECT count(*) AS n FROM admin_announcement_operations').get().n,1);
});
test('extra credential payload fields are not retained in publication audit or idempotency records',t=>{
  const {database,service:s}=setup(t);
  s.mutate({action:'publish',title:'safe',body:'visible',password:'private-password',token:'private-token',client_secret:'private-secret',author:'forged-author'},'real-admin','safe-key');
  const notices=JSON.stringify(s.list()),operations=JSON.stringify(database.db.prepare('SELECT * FROM admin_announcement_operations').all());
  for(const privateText of ['private-password','private-token','private-secret','forged-author']){assert.ok(!notices.includes(privateText));assert.ok(!operations.includes(privateText));}
  assert.ok(operations.includes('real-admin'));
});
test('notices and operations survive service/database reopen and account snapshot restore',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'frog-announcements-')),file=path.join(directory,'server.sqlite');let database=new FrogDatabase(file);
  t.after(()=>{database.close();fs.rmSync(directory,{recursive:true,force:true});});database.ensureAccount('frog');const snapshots=new SnapshotService(database),snapshot=snapshots.create('frog','before notices');
  let s=new AnnouncementsService(database,{clock:()=>100});const published=s.mutate({action:'publish',title:'persistent',body:'server wide'},'admin','publish');database.close();
  database=new FrogDatabase(file);s=new AnnouncementsService(database,{clock:()=>100});assert.equal(s.active()[0].title,'persistent');
  new SnapshotService(database).restore('frog',snapshot.id,'frog');assert.equal(s.active()[0].id,published.announcement.id);assert.equal(s.mutate({action:'publish',title:'persistent',body:'server wide'},'admin','publish').replayed,true);
});
