'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');const {FrogDatabase}=require('./database'),{ModuleState}=require('./module_state'),{ExplorationService}=require('./exploration');
const catalog={items:[...[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(id=>({id,type:0})),{id:3000,type:3},{id:3001,type:3},{id:3002,type:3},{id:10001,type:10},{id:8002,type:8},{id:1017,type:1},{id:1018,type:1},{id:200001,type:14},{id:200002,type:14}],neighbors:[{id:0,taste:[99,60,10]}],specialties:[{itemId:3000},{itemId:3001},{itemId:3002}],config:{museumData_json:{1:{id:1,collection_id:'34,35',pic_id:[2109]},2:{id:2,collection_id:'38',pic_id:[2111]}},museumDayData_json:{1:{id:1,name:'museum1'},2:{id:2,name:'museum2'}},museumDayCommon_json:{restart_clover:{v1:'100,200'},base:{v1:'2'},inspire:{v1:2}}}};
function setup(t,options={}){const database=new FrogDatabase(':memory:');t.after(()=>database.close());database.ensureAccount('frog');database.ensureAccount('other');let now=1000;const store=new ModuleState(database),service=new ExplorationService(database,catalog,{now:()=>now,stateStore:store,randomInt:()=>0,moveSeconds:10,lotterySeconds:10,dailyCompasses:10,...options}),call=(cmd,data={},account='frog')=>service.handle(account,cmd,data);return {database,store,service,call,time:value=>now=value};}

test('museum route has legal visible tiles and plans movement without instant/duplicate rewards',t=>{
 const {database,call,service,time}=setup(t);assert.equal(call('museumday_refresh').response.code,0);let state=call('museumday_load').response;
 assert.ok(state.path.length>1);assert.equal(state.frog,1);assert.equal(state.next,1);const grids=state.path.map(x=>x.grid);assert.equal(new Set(grids).size,grids.length);assert.ok(grids.every(n=>n>=1&&n<=35));
 for(let i=1;i<grids.length;i++){assert.ok([1,7].includes(Math.abs(grids[i]-grids[i-1])));if(Math.abs(grids[i]-grids[i-1])===1)assert.equal(Math.floor((grids[i]-1)/7),Math.floor((grids[i-1]-1)/7),'horizontal edge cannot wrap');}
 assert.equal(call('museumday_refresh').response.code,1,'refresh count consumed once');assert.equal(call('museumday_arrive').response.code,1);
 assert.equal(call('museumday_random_compass').response.next,2);state=call('museumday_load').response;assert.equal(state.frog,1);assert.equal(state.compass,9);assert.equal(call('museumday_get_items').response.code,1);
 time(1009);service.advance('frog');assert.equal(call('museumday_load').response.frog,1);time(1010);service.advance('frog');assert.equal(call('museumday_load').response.frog,2);
 assert.equal(call('museumday_get_items').response.code,0);assert.equal(database.getInventoryCount('frog',10001),1);assert.equal(call('museumday_get_items').response.code,1);service.advance('frog',1010);assert.equal(database.getInventoryCount('frog',10001),1);
});

test('route completion grants one ticket, collection and generated picture, and arrival retains history',t=>{
 const {database,store,call,service,time}=setup(t,{pictureFactory:()=>({pic_id:2109,layers:[{layer:[1,-0.5,2.5]}]})});call('museumday_refresh');
 const raw=store.get('frog','museumday');raw.path=[{grid:1,type:0,style:0},{grid:2,type:1,style:1}];store.set('frog','museumday',raw);
 call('museumday_random_compass');time(1010);service.advance('frog');assert.equal(call('museumday_load').response.frog,2);assert.equal(database.countPostcards('frog','new'),1);service.advance('frog');assert.equal(database.countPostcards('frog','new'),1);
 assert.equal(call('museumday_arrive').response.code,0);assert.equal(database.getInventoryCount('frog',1017),1);assert.ok(database.getHandbook('frog').collections.includes(34));assert.equal(call('museumday_arrive').response.code,1);
 const final=call('museumday_load').response;assert.equal(final.cur_museum,0);assert.equal(final.museum_list.length,1);assert.equal(final.museum_list[0].pic_id,2109);assert.equal(call('museum_load').response.museum_list[0].id,1);
});

test('direction validation and forced write failures roll back compass, grass and pending rewards',t=>{
 const {database,store,call}=setup(t);call('museumday_refresh');let state=call('museumday_load').response;assert.equal(state.path[1].grid,2);
 assert.equal(call('museumday_dir_compass',{dir:3}).response.code,1);assert.equal(call('museumday_load').response.compass,10,'bad direction cannot spend a compass');
 const original=store.set.bind(store);store.set=()=>{throw Error('persist failure');};assert.throws(()=>call('museumday_dir_compass',{dir:4}),/persist failure/);store.set=original;assert.equal(call('museumday_load').response.compass,10);
 database.updateAccount('frog',{clover:90});assert.equal(call('museumday_start_advance',{id:2}).response.code,1);assert.equal(database.getRole('frog').res.clover_point,90);
});

test('compass daily generation, inventory conversion, gameplay tasks and inspire do not repeat on load',t=>{
 const {database,call,store,service,time}=setup(t);database.changeInventory('frog',200002,2);assert.equal(call('museumday_load').response.compass,12);assert.equal(database.getInventoryCount('frog',200002),0);assert.equal(call('museumday_load').response.compass,12);
 service.observe('frog','clover_harvest');service.observe('frog','clover_harvest');assert.equal(call('museumday_info').response.compass,13);assert.equal(call('museumday_info').response.task_num,0);
 call('museumday_refresh');assert.equal(call('museumday_inspire').response.code,1);call('museumday_random_compass');call('museumday_random_compass');assert.equal(call('museumday_load').response.inspire_num,1);assert.equal(call('museumday_inspire').response.code,0);assert.equal(call('museumday_load').response.inspire_num,0);
 time(87400);assert.equal(call('museumday_load').response.compass,21);assert.equal(call('museumday_load').response.compass,21);
});

test('koto retains independent progression while using the explicitly local shared exploration engine',t=>{
 const {call}=setup(t);assert.equal(call('koto_refresh').response.code,0);assert.equal(call('koto_random_compass').response.code,0);assert.equal(call('koto_load').response.next,2);assert.equal(call('museumday_load').response.cur_museum,0);
});

test('lottery open, five-item choice, offline settlement and reward claim are phase-scoped',t=>{
 const {database,call,service,time}=setup(t);assert.equal(call('lottery_open').response.code,0);assert.equal(database.getRole('frog').res.ticket,1);assert.equal(call('lottery_open').response.code,1);
 assert.equal(call('lottery_select',{list:[0,0,1,2,3]}).response.code,1);assert.equal(call('lottery_select',{list:[0,1,2,3,9999]}).response.code,1);
 assert.equal(call('lottery_select',{list:[0,1,2,3,4]}).response.code,0);assert.equal(call('lottery_load').response.state,2);assert.equal(call('lottery_confirm_reward').response.code,1);
 time(1010);service.advance('frog');const result=call('lottery_load').response;assert.equal(result.state,3);assert.equal(result.right_flag.length,5);assert.equal(result.reward[0].num,5);
 assert.equal(call('lottery_confirm_reward').response.code,0);assert.equal(database.getRole('frog').res.ticket,6);assert.equal(database.getInventoryCount('frog',8002),1);assert.equal(call('lottery_confirm_reward').response.code,1);assert.equal(call('lottery_open').response.code,1,'cannot repeatedly claim opening reward within a week');
 time(1000+604800);assert.equal(call('lottery_open').response.code,0);assert.equal(database.getRole('frog').res.ticket,7);
});

test('old museum and lottery capture fields import without discarding originals or selected answers',t=>{
 const {database,call,service,time}=setup(t);const raw={museum_load:{museum_list:[{id:1,collections:[35],pic_list:[2109]}]},lottery_load:{phase:180,last_phase:179,state:2,answer:[0,1,2,3,4],select_list:[0,1,2,3,4,5],right_flag:{},reward:{},egg_num:0,extra_item:{item_id:0,count:0}},museumday_load:{cur_museum:0,frog:0,next:0,items:{},get_items:{},museum_list:{},path:{},log_list:{},left_num:1}};
 database.db.prepare('INSERT INTO official_archives VALUES (?,?)').run('frog',JSON.stringify({mode:'active',protocols:raw}));
 assert.equal(call('museum_load').response.museum_list[0].collections[0],35);assert.deepEqual(call('lottery_load').response.answer,[0,1,2,3,4]);time(1010);service.advance('frog');assert.equal(call('lottery_load').response.state,3);assert.equal(database.getOfficialArchive('frog').protocols.lottery_load.state,2);
});

test('module snapshots recover in-flight route and waiting lottery without duplicate settlement',t=>{
 const {database,store,call,time}=setup(t);const {SnapshotService}=require('./snapshots');call('museumday_refresh');call('museumday_random_compass');call('lottery_open');call('lottery_select',{list:[0,1,2,3,4]});const snapshots=new SnapshotService(database),saved=snapshots.create('frog','before-exploration');
 time(1010);call('museumday_load');call('lottery_confirm_reward');assert.equal(database.getRole('frog').res.ticket,6);snapshots.restore('frog',saved.id,'frog');
 assert.equal(database.getRole('frog').res.ticket,1);assert.equal(store.get('frog','museumday').frog,1);assert.equal(store.get('frog','lottery').state,2);assert.equal(call('lottery_confirm_reward').response.code,0);assert.equal(call('lottery_confirm_reward').response.code,1);
});

test('timer advancement retains newly granted compass inventory even without a moving frog',t=>{
 const {database,service,call}=setup(t);database.changeInventory('frog',200002,2);service.advance('frog');
 assert.equal(database.getInventoryCount('frog',200002),0);assert.equal(call('museumday_load').response.compass,12);
});
