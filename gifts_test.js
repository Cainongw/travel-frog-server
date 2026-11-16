'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{FrogDatabase}=require('./database'),{GiftsService}=require('./gifts'),{SnapshotService}=require('./snapshots');
function setup(t){const db=new FrogDatabase(':memory:');db.ensureAccount('frog');t.after(()=>db.close());const items=[{id:5001,type:5},{id:5101,type:5},{id:5601,type:5},{id:5602,type:5},{id:5502,type:5},{id:10201,type:12},{id:10202,type:12},{id:20101,type:15,sub_type:2},{id:20102,type:15,sub_type:2},{id:10001,type:10},{id:10101,type:11},{id:0,type:0},{id:1001,type:1},{id:3000,type:3}];const service=new GiftsService(db,{items,config:{GiftData_json:{5001:{id:5001,item_id:[10201,10202],item_num:[1,2]}}}},{clock:()=>1000,randomInt:()=>0});return {db,service,call:(cmd,data)=>service.handle('frog',cmd,data)};}
test('fixed packs and two-seed blind boxes unpack once with exact configured amounts and persisted outcomes',t=>{
 const {db,service}=setup(t);db.changeInventory('frog',5001,1);db.changeInventory('frog',5101,2);const first=service.advance('frog');assert.equal(first.changed,true);
 assert.equal(db.getInventoryCount('frog',5001),0);assert.equal(db.getInventoryCount('frog',10201),1);assert.equal(db.getInventoryCount('frog',10202),2);assert.equal(db.getInventoryCount('frog',20101),4);assert.ok(first.events.some(e=>e.cmd==='item_gift_open'));
 const before=db.exportAccount('frog');service.advance('frog');assert.deepEqual(db.exportAccount('frog'),before);assert.equal(service.state('frog').opened_count,3);assert.equal(service.state('frog').history[0].rewards.length,2);
});
test('original selection queue is preserved, uses native one-based indices and failed picks restore the shifted client queue',t=>{
 const {db,service,call}=setup(t);const original={list:[{num:2,items:[{item_id:0,count:3},{item_id:1001,count:1},{item_id:3000,count:2}]}]};db.db.prepare('INSERT INTO official_archives VALUES (?,?)').run('frog',JSON.stringify({mode:'active',protocols:{item_load_select_gift:original}}));
 assert.deepEqual(service.initial('frog').at(-1).data,original);
 const bad=call('item_select_gift',{index_list:[1,1]});assert.equal(bad.response.code,1);assert.deepEqual(bad.events.at(-1).data,original);assert.equal(db.getInventoryCount('frog',0),0);
 const good=call('item_select_gift',{index_list:[1,3]});assert.equal(good.response.code,0);assert.deepEqual(good.response.items,[{item_id:0,count:3},{item_id:3000,count:2}]);assert.equal(db.getInventoryCount('frog',0),3);assert.equal(call('item_select_gift',{index_list:[1,3]}).response.code,1);assert.deepEqual(db.getOfficialArchive('frog').protocols.item_load_select_gift,original);
});
test('self-selected gifts reserve one package, retain outstanding queue and snapshots recover choices without copying contents',t=>{
 const {db,service,call}=setup(t);db.changeInventory('frog',5601,1);service.advance('frog');assert.equal(db.getInventoryCount('frog',5601),0);assert.equal(call('item_load_select_gift').response.list[0].num,2);
 const snapshots=new SnapshotService(db),point=snapshots.create('frog','gift pending');assert.equal(call('item_select_gift',{index_list:[1,2]}).response.code,0);const after=db.getInventoryCount('frog',0);snapshots.restore('frog',point.id,'frog');assert.equal(db.getInventoryCount('frog',0),0);assert.equal(service.state('frog').queue.length,1);assert.equal(call('item_select_gift',{index_list:[1,2]}).response.code,0);assert.equal(db.getInventoryCount('frog',0),after);
});
test('gift write failures roll back both reservation and rewards, and non-gift compose recipe is never silently consumed',t=>{
 const {db,service}=setup(t);db.changeInventory('frog',5001,1);db.changeInventory('frog',5502,1);const save=service.save.bind(service);service.save=()=>{throw Error('test save failure');};assert.throws(()=>service.advance('frog'),/save failure/);assert.equal(db.getInventoryCount('frog',5001),1);assert.equal(db.getInventoryCount('frog',10201),0);service.save=save;service.advance('frog');assert.equal(db.getInventoryCount('frog',5502),1);
 assert.equal(service.supportsShopItem(5001),true);assert.equal(service.supportsShopItem(5502),false);assert.equal(service.supportsShopItem(0),true);
});
