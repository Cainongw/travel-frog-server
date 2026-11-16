'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FrogDatabase}=require('./database'),{ModuleState}=require('./module_state'),{ActivitiesService}=require('./activities');
const {exportFurnitureState}=require('./furniture');

const catalog={
 items:[{id:0,name:'food',type:0},{id:8002,type:8},{id:8003,type:8},{id:8004,type:8},{id:9001,type:9},{id:9002,type:9},{id:200005,type:14},{id:200016,type:14},{id:10001,type:10},{id:200001,type:14},{id:201005,name:'wish curtain',type:14}],
 furniture:[{id:1001,name:'default wall',type:1,style:1},{id:10101,name:'wish curtain',type:7,style:10}],
 config:{
  animpictureData_json:{base_info:{page_id:9001,album_id:9002,album_num:4},pic_map:{100:1,104:2},list:{1:{id:1,pic_list:[100],phase_list:[{phase:1,exp:20},{phase:2,exp:20},{phase:3,exp:0}]},2:{id:2,pic_list:[104],phase_list:[{phase:1,exp:20},{phase:2,exp:0}]}}},
  capsuleData_json:{fast_consume:30,task_list:{1:{id:1},2:{id:2},4:{id:4},5:{id:5}},reward:{101:{reward_id:101,id:10001,num:1,type:1},102:{reward_id:102,id:200001,num:1,type:2},103:{reward_id:103,id:201005,num:1,type:3}},num_reward:{3:{num:3,item_id:10001,item_num:5}}},
 },
};
const picture=(id,pic_id=100)=>({id,pic_id,layers:[{layer:[1,-0.5,2.5]}],for_ads:false,visit:false});
function setup(t,options={}){
 const database=new FrogDatabase(':memory:');t.after(()=>database.close());database.ensureAccount('frog');database.ensureAccount('other');
 let now=1000;const stateStore=new ModuleState(database);const service=new ActivitiesService(database,catalog,{stateStore,now:()=>now,randomInt:()=>0,photoSeconds:10,wishDailyCoins:0,wishRewards:[201005,10001,200001],...options});
 const call=(cmd,data={})=>service.handle('frog',cmd,data);return {database,stateStore,service,call,time:value=>now=value};
}

test('dynamic photo construction consumes one source, develops offline, grants storage once and never loses queued pictures',t=>{
 const {database,stateStore,service,call,time}=setup(t);
 database.changeInventory('frog',9001,1);database.addPostcard('frog',picture(1),'album');database.addPostcard('frog',picture(2),'album');database.addPostcard('frog',picture(3),'album');database.addPostcard('frog',picture(4),'album');
 assert.equal(call('animpicture_select_pic',{id:1}).response.code,0);
 assert.equal(call('animpicture_select_pic',{id:1}).response.code,1,'cannot select used source twice');
 assert.equal(call('animpicture_add_pic',{anim_index:1,ids:[2,2]}).response.code,1);
 assert.equal(database.countPostcards('frog','album'),3,'invalid request did not transfer anything');
 assert.equal(call('animpicture_add_pic',{anim_index:1,ids:[2,3,4]}).response.code,0);
 assert.equal(database.countPostcards('frog','album'),0);
 time(1009);service.advance('frog',1009);assert.equal(call('animpicture_load').response.pic_list[0].exp,0);
 time(1020);const completed=service.advance('frog',1020);assert.ok(completed.events.some(x=>x.cmd==='animpicture_load'));
 const state=call('animpicture_load').response;assert.equal(state.pic_list[0].phase,0);assert.equal(state.item_num,1);assert.equal(state.making_index,0);
 assert.deepEqual(database.getPostcards('frog','album').map(x=>x.id),[4],'unused queued picture returned with original ID');
 assert.deepEqual(database.getPostcards('frog','album')[0].layers,picture(4).layers,'fractional source layers preserved');
 assert.equal(stateStore.get('frog','animpicture').pic_list[0].source_picture.id,1,'initial source retained inside archive metadata');
 assert.equal(call('animpicture_get_item').response.code,0);assert.equal(database.getInventoryCount('frog',9002),1);
 assert.equal(call('animpicture_get_item').response.code,1);service.advance('frog',99999);assert.equal(database.getInventoryCount('frog',9002),1);
});

test('developer liquid, completed photo storage and native slot indexing enforce ownership without copying pictures',t=>{
 const {database,call}=setup(t);database.changeInventory('frog',9001,1);database.changeInventory('frog',8002,1);database.addPostcard('frog',picture(10),'album');database.addPostcard('frog',picture(11),'album');database.addPostcard('frog',picture(12,104),'album');
 call('animpicture_select_pic',{id:10});assert.equal(call('animpicture_use_item',{anim_index:1,item_id:8002}).response.phase,0);
 assert.equal(database.getInventoryCount('frog',8002),0);assert.equal(call('animpicture_use_item',{anim_index:1,item_id:8002}).response.code,1);
 call('animpicture_get_item');assert.equal(call('animpicture_open_album',{index:1}).response.code,0);assert.equal(database.getInventoryCount('frog',9002),0);
 assert.equal(call('animpicture_open_album',{index:1}).response.code,1,'no repeated opening without a storage item');
 assert.equal(call('animpicture_album_add_pic',{anim_index:1,pic_index:1,pic_uid:12}).response.code,1,'incompatible scene rejected');
 assert.equal(call('animpicture_album_add_pic',{anim_index:1,pic_index:1,pic_uid:11}).response.code,0);
 assert.equal(call('animpicture_album_add_pic',{anim_index:1,pic_index:1,pic_uid:11}).response.code,1);
 assert.equal(call('animpicture_album_remove_pic',{anim_index:1,pic_index:1,is_delete:false}).response.code,0);
 assert.equal(call('animpicture_album_remove_pic',{anim_index:1,pic_index:1,is_delete:false}).response.code,1);
 assert.equal(database.getPostcards('frog','album',[11]).length,1,'taking the photo out cannot duplicate it');
});

test('dynamic photo transfer is atomic and account-scoped even when persistence or return conflicts fail',t=>{
 const {database,stateStore,call}=setup(t);database.changeInventory('frog',9001,1);database.addPostcard('frog',picture(20),'album');
 const save=stateStore.set.bind(stateStore);stateStore.set=()=>{throw Error('write failure');};
 assert.throws(()=>call('animpicture_select_pic',{id:20}),/write failure/);assert.equal(database.getPostcards('frog','album',[20]).length,1);
 stateStore.set=save;call('animpicture_select_pic',{id:20});database.addPostcard('other',picture(21),'album');
 assert.equal(call('animpicture_add_pic',{anim_index:1,ids:[21]}).response.code,1,'cannot take another account photo');
 database.addPostcard('frog',picture(21),'album');call('animpicture_add_pic',{anim_index:1,ids:[21]});database.addPostcard('frog',picture(21,104),'album');
 assert.equal(call('animpicture_remove_pic',{anim_index:1,pic_index:1,is_delete:false}).response.code,1,'do not overwrite a conflicting owned photo');
 assert.equal(call('animpicture_load').response.pic_list[0].exp_pic.length,1,'conflict keeps archived source available');
});

test('capsule tasks follow successful gameplay actions and each completion/claim settles once',t=>{
 const {database,stateStore,service,call,time}=setup(t);service.initial('frog');
 let state=stateStore.get('frog','capsule');assert.deepEqual(state.task_list,[1,2]);assert.equal(state.patch_num,0);
 service.observe('frog','clover_harvest');service.observe('frog','clover_harvest');service.observe('frog','item_putin_bag');assert.equal(call('capsule_load_coin').response.pre_coin,2);
 assert.equal(call('capsule_get_coin').response.code,0);assert.equal(call('capsule_get_coin').response.code,1);assert.equal(call('capsule_load_coin').response.coin,2);
 assert.equal(call('capsule_twist').response.reward_id,101);assert.equal(database.getInventoryCount('frog',10001),1);
 assert.equal(call('capsule_twist').response.reward_id,102);assert.equal(database.getRole('frog').res.ticket,1);
 assert.equal(call('capsule_twist').response.code,1,'no free draw without a coin');
 database.changeInventory('frog',200005,1);assert.equal(call('capsule_twist').response.reward_id,103);
 assert.equal(database.getInventoryCount('frog',200005),0);assert.equal(database.getInventoryCount('frog',10001),6,'three-draw milestone is awarded with the third draw');
 assert.ok(exportFurnitureState(database,'frog').owned.includes(10101),'event furniture reward unlocks actual furniture');
 assert.equal(call('capsule_twist').response.code,1);assert.equal(database.getInventoryCount('frog',10001),6);
 time(1000+86400);call('capsule_load');state=stateStore.get('frog','capsule');assert.equal(state.patch_num,2,'one new local day offers two tasks');assert.equal(state.reward_list.length,3,'next day retains season history');
});

test('fast capsule task charges config price and rollback never spends grass without completing a task',t=>{
 const {database,stateStore,service,call}=setup(t);service.initial('frog');database.updateAccount('frog',{clover:60});
 assert.equal(call('capsule_fast_task',{index:0}).response.code,1);assert.equal(database.getRole('frog').res.clover_point,60);
 const original=stateStore.set.bind(stateStore);stateStore.set=()=>{throw Error('write failed');};assert.throws(()=>call('capsule_fast_task',{index:1}),/write failed/);assert.equal(database.getRole('frog').res.clover_point,60);
 stateStore.set=original;assert.equal(call('capsule_fast_task',{index:1}).response.code,0);assert.equal(database.getRole('frog').res.clover_point,30);assert.equal(call('capsule_load_coin').response.pre_coin,1);
});

test('wishing pool coins, limits and daily accounting do not duplicate on load or service restart',t=>{
 const {database,service,call,time}=setup(t,{wishDailyCoins:1});
 assert.equal(call('wishingpool_load').response.coin,1);assert.equal(call('wishingpool_load').response.coin,1);
 assert.equal(call('wishingpool_wish').response.id,201005);assert.ok(exportFurnitureState(database,'frog').owned.includes(10101));
 assert.equal(call('wishingpool_wish').response.code,1);database.changeInventory('frog',200016,1);assert.equal(call('wishingpool_wish').response.id,10001);assert.equal(database.getInventoryCount('frog',200016),0);
 assert.equal(call('wishingpool_wish').response.id,200001);assert.equal(call('wishingpool_wish').response.code,1,'empty pool is not refreshed on read');
 const before=call('wishingpool_load').response;assert.equal(before.coin,3);const reopened=new ActivitiesService(database,catalog,{now:()=>1000,randomInt:()=>0,wishDailyCoins:1});assert.deepEqual(reopened.handle('frog','wishingpool_load').response,before);
 time(1000+86400);assert.equal(call('wishingpool_load').response.coin,4);assert.equal(call('wishingpool_load').response.coin,4);assert.equal(call('wishingpool_load').response.items.filter(x=>x.limit>0).length,0);
});

test('official anim progress imports without invented resets and module state survives database reopen',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'frog-activities-')),file=path.join(directory,'test.sqlite');let db=new FrogDatabase(file);
 t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});db.ensureAccount('frog');
 const raw={animpicture_load:{guide:6,page_num:1,item_num:0,making_index:1,pic_list:[{id:1,phase:2,exp:7,exp_pic:[picture(40)],pictures:{},put_num:0}]}};
 db.db.prepare('INSERT INTO official_archives VALUES (?,?)').run('frog',JSON.stringify({mode:'active',protocols:raw}));
 let service=new ActivitiesService(db,catalog,{now:()=>1000,photoSeconds:10,randomInt:()=>0,wishDailyCoins:0});
 assert.equal(service.handle('frog','animpicture_load').response.pic_list[0].exp,7);db.close();db=new FrogDatabase(file);service=new ActivitiesService(db,catalog,{now:()=>1010,photoSeconds:10,randomInt:()=>0,wishDailyCoins:0});
 const state=service.handle('frog','animpicture_load').response;assert.equal(state.pic_list[0].phase,0);assert.equal(state.item_num,1);assert.equal(state.guide,6);
});

test('missing activity catalogs never debit currencies or invent rewards',t=>{
 const {database}=setup(t);const service=new ActivitiesService(database,{items:[]},{now:()=>1000,randomInt:()=>0,wishDailyCoins:0});database.updateAccount('frog',{clover:100});
 assert.equal(service.handle('frog','capsule_twist').response.code,1);assert.equal(service.handle('frog','wishingpool_wish').response.code,1);assert.equal(service.handle('frog','animpicture_select_pic',{id:1}).response.code,1);assert.equal(database.getRole('frog').res.clover_point,100);
});

test('account snapshots restore activity-owned photos and rewards together with normal game tables',t=>{
 const {database,service,call}=setup(t);const {SnapshotService}=require('./snapshots');
 database.changeInventory('frog',9001,1);database.changeInventory('frog',8002,1);database.addPostcard('frog',picture(100),'album');database.addPostcard('frog',picture(101),'album');
 call('animpicture_select_pic',{id:100});call('animpicture_add_pic',{anim_index:1,ids:[101]});service.initial('frog');const snapshots=new SnapshotService(database);const saved=snapshots.create('frog','before-liquid');
 call('animpicture_use_item',{anim_index:1,item_id:8002});call('animpicture_get_item');
 assert.equal(database.getInventoryCount('frog',9002),1);snapshots.restore('frog',saved.id,'frog');
 assert.equal(database.getInventoryCount('frog',8002),1);assert.equal(database.getInventoryCount('frog',9002),0);
 const restored=call('animpicture_load').response;assert.equal(restored.pic_list[0].phase,1);assert.equal(restored.pic_list[0].exp_pic[0].id,101);assert.equal(database.getPostcards('frog','album',[101]).length,0);
});

test('an unrelated successful action never discards newly granted capsule inventory coins',t=>{
 const {database,service,call}=setup(t);database.changeInventory('frog',200005,2);service.observe('frog','item_buy');
 assert.equal(database.getInventoryCount('frog',200005),0);assert.equal(call('capsule_load_coin').response.coin,2);
});
