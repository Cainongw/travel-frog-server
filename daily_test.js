'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DailyService}=require('./daily'),{FrogDatabase}=require('./database'),{ModuleState}=require('./module_state'),{SnapshotService}=require('./snapshots');
const items=[{id:1000,type:1},{id:20,type:0},{id:1201,type:1},{id:10001,type:10},{id:205001,type:14},{id:7001,type:7}];
const config={Item_json:items,calendarData_json:{beginner:{1:{id:1,item_id:1201,num:1,code:'first'},2:{id:2,item_id:1000,num:1,code:'second'}},note:{1001:{id:1001,pic:'test'},1002:{id:1002,pic:'test2'}}},cookingData_json:{1:{month:1,item_id:20}},taskData_json:{task_list:{1:{id:1,count:1,reward_id:200000,num:10,type:1},7:{id:7,count:1,reward_id:1000,num:1,type:1},901:{id:901,count:200,reward_id:1000,num:1,type:9}},list_map:{101:{id:101,count:1,type:1},102:{id:102,count:1,type:1},103:{id:103,count:1,type:1},201:{id:201,count:1,type:2}},list_type:{1:{target:[1,2],reward:[1000,20]},2:{target:[1],reward:[1000]}}},momentData_json:{list:{1:{id:1,type:1,param:'dokusyo_ie',is_show:1},5:{id:5,type:1,param:'syokuzi_ie',is_show:1},102:{id:102,type:3,param:'wugui',is_show:1}}}};
function setup(t){const db=new FrogDatabase(':memory:');db.ensureAccount('frog');let now=Date.UTC(2026,0,5)/1000;const s=new DailyService(db,{config,items},{clock:()=>now});t.after(()=>db.close());return {db,s,setTime:v=>now=v,getTime:()=>now};}
const cmd=(s,name,data={})=>s.handle('frog',name,data);
test('beginner rewards enforce age, remember claimed days and allow old-account recovery codes once',t=>{
 const {db,s,getTime,setTime}=setup(t);db.updateAccount('frog',{created_at:getTime()});s.initial('frog');let result=cmd(s,'calendar_get_beginer_reward');assert.equal(result.response.day,1);assert.equal(db.getInventoryCount('frog',1201),1);assert.equal(cmd(s,'calendar_get_beginer_reward').response.code,1);
 assert.equal(cmd(s,'calendar_get_code_reward',{day:2}).response.code,1);setTime(getTime()+8*86400);result=cmd(s,'calendar_get_code_reward',{day:2});assert.equal(result.response.day,2);assert.equal(db.getInventoryCount('frog',1000),1);assert.equal(cmd(s,'calendar_get_code_reward',{day:2}).response.code,1);
});
test('calendar tasks use login replacement plus real clover and redemption, and prizes cannot be repeated',t=>{
 const {db,s}=setup(t);s.initial('frog');const state=s.state('frog');state.calendar.st_days=[{day:1,item_id:20}];state.calendar.lucky_days=[{day:5,item_id:1000}];s.save('frog',state);
 assert.equal(cmd(s,'calendar_get_st_reward').response.code,1);s.observe('frog','clover',30);assert.equal(cmd(s,'calendar_get_st_reward').response.code,1);s.observe('frog','redeem');assert.equal(cmd(s,'calendar_get_st_reward').response.code,0);assert.equal(db.getInventoryCount('frog',20),1);assert.equal(cmd(s,'calendar_get_st_reward').response.code,1);
 assert.equal(cmd(s,'calendar_get_luck_reward').response.code,0);assert.equal(cmd(s,'calendar_get_luck_reward').response.code,1);assert.equal(db.getInventoryCount('frog',1000),1);
});
test('task rewards and ordered list milestones require authoritative progress and survive snapshot rollback',t=>{
 const {db,s}=setup(t);s.initial('frog');assert.equal(cmd(s,'task_get_reward',{id:1}).response.code,1);db.updateAccount('frog',{trip_count:1});s.advance('frog');const before=db.getRole('frog').res.clover_point;assert.equal(cmd(s,'task_get_reward',{id:1}).response.code,0);assert.equal(db.getRole('frog').res.clover_point,before+10);assert.equal(cmd(s,'task_get_reward',{id:1}).response.code,1);
 assert.equal(cmd(s,'task_get_list_reward',{id:102}).response.code,1);assert.equal(cmd(s,'task_get_list_reward',{id:101}).response.code,0);assert.equal(cmd(s,'task_get_list_reward',{id:101}).response.code,1);
 const snapshot=new SnapshotService(db),saved=snapshot.create('frog');assert.equal(cmd(s,'task_client_pro',{param:'Map'}).response.code,0);s.advance('frog');assert.equal(cmd(s,'task_get_list_reward',{id:102}).response.code,0);assert.equal(db.getInventoryCount('frog',20),1);
 snapshot.restore('frog',saved.id,'frog');assert.equal(db.getInventoryCount('frog',20),0);assert.equal(cmd(s,'task_get_list_reward',{id:102}).response.code,1);
 assert.equal(cmd(s,'task_client_pro',{param:901}).response.code,1);assert.equal(cmd(s,'task_get_reward',{id:901}).response.code,1,'client cannot forge balance task');
});
test('annual report follows persisted counts, login days and imported historical maximums',t=>{
 const {db,s,setTime,getTime}=setup(t);s.initial('frog');db.updateAccount('frog',{trip_count:5});s.observe('frog','clover',30);s.observe('frog','redeem',2);let report=cmd(s,'annual_load').response;assert.equal(report.travel_num,5);assert.equal(report.clover,30);assert.equal(report.roll_num,2);assert.equal(report.login_day,1);
 setTime(getTime()+86400);s.advance('frog');report=cmd(s,'annual_load').response;assert.equal(report.login_day,2);cmd(s,'annual_share');assert.equal(cmd(s,'annual_load').response.is_share,true);
});
test('touch effects require ownership and moment unlocks require a known configuration and matching scene',t=>{
 const {db,s}=setup(t);db.updateAccount('frog',{frog_status:0,frog_motion:0});s.initial('frog');assert.ok(db.getMoments('frog').includes(1));assert.equal(cmd(s,'misc_moment_unlock',{id:5}).response.code,1);assert.equal(cmd(s,'misc_moment_unlock',{id:9999}).response.code,1);db.updateAccount('frog',{frog_motion:4});assert.equal(cmd(s,'misc_moment_unlock',{id:5}).response.code,0);assert.equal(cmd(s,'misc_moment_unlock',{id:5}).response.code,0);
 assert.equal(cmd(s,'other_req_touch',{id:1}).response.code,1);db.changeInventory('frog',205001,1);s.advance('frog');assert.deepEqual(cmd(s,'other_load_touch').response.list,[0,1]);assert.equal(cmd(s,'other_req_touch',{id:1}).response.code,0);assert.equal(cmd(s,'other_load_touch').response.cur,1);assert.equal(cmd(s,'other_req_touch',{id:99}).response.code,1);
});
test('month rollover refreshes calendar dates and notes without reopening beginner or task rewards',t=>{
 const {db,s,setTime,getTime}=setup(t);db.updateAccount('frog',{created_at:getTime()});s.initial('frog');cmd(s,'calendar_get_beginer_reward');const before=s.state('frog');before.tasks=[{id:1,pro:1,is_reward:true}];s.save('frog',before);setTime(Date.UTC(2026,1,1)/1000);s.advance('frog');const after=s.state('frog');assert.equal(after.calendar.new_flag[0],1);assert.equal(after.calendar.note_list.length,28);assert.equal(after.tasks.find(x=>x.id===1).is_reward,true);assert.equal(cmd(s,'calendar_load_note').response.list.length,28);
});
test('daily award writes roll back claim flags, inventory and balance together',t=>{
 const {db,s,getTime}=setup(t);db.updateAccount('frog',{created_at:getTime()});s.initial('frog');const original=s.save.bind(s);s.save=()=>{throw Error('disk failure');};assert.throws(()=>cmd(s,'calendar_get_beginer_reward'),/disk failure/);assert.equal(db.getInventoryCount('frog',1201),0);s.save=original;assert.equal(cmd(s,'calendar_get_beginer_reward').response.day,1);
});
test('actual local calendar and guide configurations resolve all current task rewards',t=>{
 const p=path.join(__dirname,'exports/oneplus-official-20261114-live/assets/eab/config.eab');if(!fs.existsSync(p)){t.skip('private assets optional');return;}const c=require('./catalog').readBundle(p),db=new FrogDatabase(':memory:');t.after(()=>db.close());const s=new DailyService(db,{config:c,items:Object.values(c.Item_json)});assert.equal(s.notes.length,887);assert.ok(s.tasks.every(x=>s.items.has(x.reward_id)||[200000,200001].includes(x.reward_id)));assert.equal(Object.keys(s.beginner).length,7);assert.equal(s.moments.length,30);
});
