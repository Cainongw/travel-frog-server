'use strict';
const { PROJECT_ROOT } = require("../src/paths");

const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path');
const {FrogDatabase}=require('../src/core/database'),{DecorationService}=require('../src/game/creative/decoration'),{SnapshotService}=require('../src/core/snapshots');
const config={decoration_json:{100:{id:100,name:'蜡梅',achieve:'DECO_LM',icon:'plum_icon',pic:['plum_bud','plum_bloom']},101:{id:101,name:'木槿',achieve:'DECO_MJ',icon:'hibiscus_icon',pic:['hibiscus_bud','hibiscus_bloom']}},encyclopedia_json:{list:{3010101:{long_id:3010101,pic_img:'plum_icon'},3010102:{long_id:3010102,pic_img:'plum_bud'},3010103:{long_id:3010103,pic_img:'plum_bloom'}}}};
const items=[{id:202101,name:'蜡梅',type:14},{id:202102,name:'木槿',type:14},{id:1,name:'Other',type:0}];
function setup(t){const db=new FrogDatabase(':memory:');db.ensureAccount('frog');let now=100;const make=database=>new DecorationService(database,{config,items},{clock:()=>now,bloomSeconds:10,lifeSeconds:30});const service=make(db);t.after(()=>db.close());return {db,service,make,setTime:v=>now=v};}
const cmd=(s,name,data={})=>s.handle('frog',name,data);
test('flower inventory moves into floral ownership once and original flower records remain intact',t=>{
 const {db,service:s}=setup(t);db.db.prepare('INSERT INTO official_archives(account,data_json) VALUES (?,?)').run('frog',JSON.stringify({mode:'active',protocols:{client_load_decorate:{has_list:[{id:101,num:2}],put_id:0,status:0}}}));
 db.changeInventory('frog',202101,2);const updates=s.initial('frog');assert.equal(db.getInventoryCount('frog',202101),0);assert.deepEqual(cmd(s,'client_load_decorate').response.has_list,[{id:101,num:2},{id:100,num:2}]);s.advance('frog');assert.equal(s.state('frog').has_list.find(x=>x.id===100).num,2);assert.ok(updates.some(x=>x.cmd==='item_update'&&x.data.item.count===0));
 assert.equal(db.getOfficialArchive('frog').protocols.client_load_decorate.has_list[0].num,2,'raw capture unchanged');
});
test('inserting, flowering, replacing and expiring consume only genuine owned flowers and record natural stages',t=>{
 const {db,service:s,setTime}=setup(t);db.changeInventory('frog',202101,1);db.changeInventory('frog',202102,1);s.advance('frog');
 assert.equal(cmd(s,'client_change_decorate',{id:100}).response.code,0);let state=s.state('frog');assert.equal(state.status,1);assert.equal(state.has_list.find(x=>x.id===100).num,1,'selected flower stays represented until discarded');assert.deepEqual(s.encyclopediaObservations('frog'),[3010101,3010102]);
 assert.equal(cmd(s,'client_change_decorate',{id:100}).response.code,0);assert.equal(s.state('frog').stage_history.length,1,'retry does not restart growth or duplicate stage');
 setTime(110);s.advance('frog');state=s.state('frog');assert.equal(state.status,2);assert.ok(state.stage_history.some(x=>x.id===100&&x.stage===2&&x.at===110));assert.deepEqual(s.encyclopediaObservations('frog'),[3010101,3010102,3010103]);
 assert.equal(cmd(s,'client_change_decorate',{id:101}).response.code,0);state=s.state('frog');assert.equal(state.has_list.some(x=>x.id===100),false);assert.equal(state.put_id,101);assert.equal(state.status,1);assert.equal(state.discarded[0].reason,'replaced');
 setTime(140);s.advance('frog');state=s.state('frog');assert.equal(state.put_id,0);assert.equal(state.status,0);assert.equal(state.has_list.length,0);assert.ok(state.stage_history.some(x=>x.id===101&&x.stage===2),'offline expiry still records actual elapsed flowering phase');
 assert.equal(cmd(s,'client_change_decorate',{id:100}).response.code,1,'discarded flowers cannot be selected again');
});
test('unknown or unowned flower selection leaves the actual flower in place',t=>{
 const {db,service:s}=setup(t);db.changeInventory('frog',202101,1);cmd(s,'client_change_decorate',{id:100});assert.equal(cmd(s,'client_change_decorate',{id:101}).response.code,1);assert.equal(cmd(s,'client_change_decorate',{id:9999}).response.code,1);assert.equal(s.state('frog').put_id,100);assert.equal(s.state('frog').has_list[0].num,1);
 const role=s.decorateRole('frog',db.getRole('frog'));assert.deepEqual(role.frog.decoration,[{id:100,num:1}]);
});
test('reopened service and full snapshot retain absolute flowering time, ownership and stage history',t=>{
 const {db,service:s,make,setTime}=setup(t);db.changeInventory('frog',202101,1);cmd(s,'client_change_decorate',{id:100});const snapshots=new SnapshotService(db),snapshot=snapshots.create('frog');
 setTime(120);const reopened=make(db);reopened.advance('frog');assert.equal(reopened.state('frog').status,2);assert.equal(reopened.state('frog').bloom_at,110);
 snapshots.restore('frog',snapshot.id,'frog');assert.equal(reopened.state('frog').status,1);reopened.advance('frog');assert.equal(reopened.state('frog').status,2);assert.equal(reopened.state('frog').stage_history.filter(x=>x.id===100&&x.stage===2).length,1);
});
test('inventory conversion and replacement roll back atomically if persistent write fails',t=>{
 const {db,service:s}=setup(t);db.changeInventory('frog',202101,1);const save=s.save.bind(s);s.save=()=>{throw Error('disk full');};assert.throws(()=>cmd(s,'client_change_decorate',{id:100}),/disk full/);assert.equal(db.getInventoryCount('frog',202101),1);s.save=save;assert.equal(s.state('frog').has_list.length,0);assert.equal(cmd(s,'client_change_decorate',{id:100}).response.code,0);
});
test('actual configuration maps every flower material and plum/hibiscus stages to real encyclopedia pictures',t=>{
 const p=path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/assets/eab/config.eab');if(!fs.existsSync(p)){t.skip('private assets optional');return;}const c=require('../src/core/catalog').readBundle(p),db=new FrogDatabase(':memory:');t.after(()=>db.close());db.ensureAccount('frog');const s=new DecorationService(db,{config:c,items:Object.values(c.Item_json)},{clock:()=>100});assert.equal(s.definitions.size,32);assert.equal(s.mapping.size,32);db.changeInventory('frog',202101,1);s.handle('frog','client_change_decorate',{id:100});assert.ok(s.encyclopediaObservations('frog').includes(3010102));assert.equal(s.state('frog').stage_history[0].stage,1);
});
