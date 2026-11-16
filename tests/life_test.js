'use strict';
const { PROJECT_ROOT } = require("../src/paths");

const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {LifeService}=require('../src/game/life/life'),{FrogDatabase}=require('../src/core/database'),{ModuleState}=require('../src/core/module_state');
const config={cookingData_json:{1:{month:1,item_id:20,task_num:6},13:{month:13,item_id:35,task_num:6},2:{month:2,item_id:21,task_num:6}},cookingTaskData_json:{1:{id:1,type:1,state:1},2:{id:2,type:2,state:1},3:{id:3,type:3,state:1},4:{id:4,type:4,state:80},5:{id:5,type:5,state:1},6:{id:6,type:6,state:1},7:{id:7,type:7,state:1},8:{id:8,type:8,state:1}},story_json:{const:{friend_choice_percent:25},story:[{storyid:1,name:'Crayon'},{storyid:2,name:'Letter'},{storyid:3,name:'Book'}]}};
const items=[{id:20,type:0},{id:21,type:0},{id:35,type:0},{id:3000,type:3},{id:3001,type:3},{id:1000,type:1}];
function setup(t){const db=new FrogDatabase(':memory:');db.ensureAccount('frog');let now=Date.UTC(2026,0,5)/1000;const create=database=>new LifeService(database,{config,items},{clock:()=>now,random:()=>0,feedbackSeconds:10,storyCooldown:5,storyChance:1});const s=create(db);t.after(()=>db.close());return {db,s,create,setTime:v=>now=v,getTime:()=>now};}
function cmd(s,name,data={}){return s.handle('frog',name,data);}
function addStory(db,record){db.db.prepare('INSERT INTO stories(account,story_id,data_json) VALUES (?,?,?)').run('frog',record.id,JSON.stringify(record));}
test('cooking native fields, task observation, refresh, weekly progress and once-only monthly food',t=>{
 const {db,s,setTime,getTime}=setup(t);s.initial('frog');let c=cmd(s,'cooking_load_cooking').response;assert.equal(c.month,1);assert.equal(c.select,0);assert.equal(c.task_list.length,4);assert.ok(!c.task_list.some(x=>[2,8].includes(x.id)),'no advertisement or platform sharing tasks');
 assert.equal(cmd(s,'cooking_start_cooking').response.code,1);assert.equal(cmd(s,'cooking_select',{index:2}).response.code,0);
 s.observe('frog','feed');s.observe('frog','clover',80);s.observe('frog','travel');
 for(const id of [1,3,4,5])assert.equal(cmd(s,'cooking_complete_task',{id}).response.code,0);
 assert.equal(cmd(s,'cooking_complete_task',{id:1}).response.code,1);assert.equal(cmd(s,'cooking_load_cooking').response.month_pro,4);
 setTime(getTime()+7*86400);s.advance('frog');s.observe('frog','feed');for(const id of [1,3])assert.equal(cmd(s,'cooking_complete_task',{id}).response.code,0);
 const result=cmd(s,'cooking_start_cooking');assert.equal(result.response.code,0);assert.equal(db.getInventoryCount('frog',35),1);assert.ok(result.events.some(x=>x.cmd==='item_update'&&x.data.item.item_id===35));
 assert.equal(cmd(s,'cooking_start_cooking').response.code,1);assert.equal(cmd(s,'cooking_select',{index:1}).response.code,1);assert.equal(db.getInventoryCount('frog',20),0);
 setTime(Date.UTC(2026,1,1)/1000);s.advance('frog');c=cmd(s,'cooking_load_cooking').response;assert.equal(c.month,2);assert.equal(c.month_pro,0);assert.equal(c.complete,false);assert.equal(c.select,0);
});
test('refresh replaces a task once with a distinct configured non-ad task and rejects invented progress',t=>{
 const {s}=setup(t);s.initial('frog');assert.equal(cmd(s,'cooking_complete_task',{id:4}).response.code,1);
 const refreshed=cmd(s,'cooking_refresh_task',{id:4});assert.equal(refreshed.response.code,0);assert.equal(refreshed.response.task.id,6);assert.equal(refreshed.response.task.refresh,true);assert.equal(cmd(s,'cooking_refresh_task',{id:6}).response.code,1);
 assert.equal(cmd(s,'cooking_look_ad').response.code,1);assert.equal(cmd(s,'cooking_share').response.code,1);
 assert.equal(cmd(s,'cooking_complete_task',{id:6}).response.code,1);s.observe('frog','photo');assert.equal(cmd(s,'cooking_complete_task',{id:6}).response.code,0);
});
test('story gift consumes once, timed feedback creates native mail, opening and thanking are separate one-time operations',t=>{
 const {db,s,setTime,getTime}=setup(t);addStory(db,{id:1,gift:-1,feedback:-1,name:'Friend',partner:1234,custom:'preserved'});db.changeInventory('frog',3000,1);
 assert.equal(cmd(s,'story_send_gift',{id:1,gift:1000}).response.code,1);
 assert.equal(cmd(s,'story_send_gift',{id:1,gift:3000}).response.code,0);assert.equal(db.getInventoryCount('frog',3000),0);assert.equal(cmd(s,'story_send_gift',{id:1,gift:3000}).response.code,0);assert.equal(db.getInventoryCount('frog',3000),0);
 setTime(getTime()+9);s.advance('frog');assert.equal(db.getMails('frog').filter(x=>x.type===6).length,0);setTime(getTime()+1);let result=s.advance('frog');const mail=db.getMails('frog').find(x=>x.type===6);assert.ok(mail);assert.equal(db.getInventoryCount('frog',3000),0,'reply item remains unclaimed in native mail');
 assert.ok(result.events.some(x=>x.cmd==='notify_new_mail'));s.advance('frog');assert.equal(db.getMails('frog').filter(x=>x.type===6).length,1);
 assert.equal(cmd(s,'story_feedback_gift',{id:1}).response.code,1,'protocol parameter is mail id, not story id');
 result=cmd(s,'story_feedback_gift',{id:mail.id});assert.equal(result.response.code,0);assert.ok(result.events.some(x=>x.cmd==='notify_new_event'&&x.data.event.evt_type===10));
 assert.equal(cmd(s,'story_feedback_gift',{id:mail.id}).events.length,0);assert.equal(db.openMail('frog',mail.id).ok,true);assert.equal(db.openMail('frog',mail.id).ok,false);assert.equal(db.getInventoryCount('frog',3000),1);assert.equal(db.getStories('frog')[0].custom,'preserved');
});
test('new stories follow real travel observations and reading does not erase collected stories',t=>{
 const {db,s,setTime,getTime}=setup(t);s.initial('frog');const events=s.observe('frog','travel').events;let story=cmd(s,'story_load').response;assert.equal(story.stories.length,1);assert.equal(story.new_story_id,1);assert.ok(events.some(x=>x.cmd==='notify_new_event'&&x.data.event.evt_type===8));
 s.observe('frog','travel');assert.equal(db.getStories('frog').length,1,'unread story blocks overwriting the new-story pointer');cmd(s,'story_read_new_story');assert.equal(cmd(s,'story_load').response.new_story_id,0);setTime(getTime()+5);s.observe('frog','travel');assert.equal(db.getStories('frog').length,2);
});
test('imported stories and cooking progress seed safely and continue pending gift feedback after restart',t=>{
 const {db,s,create,setTime,getTime}=setup(t);addStory(db,{id:2,gift:3001,feedback:-1,name:'Imported',partner:9000});
 db.db.prepare('INSERT INTO official_archives(account,data_json) VALUES (?,?)').run('frog',JSON.stringify({mode:'active',protocols:{story_load:{new_story_id:2},cooking_load_cooking:{month:12,month_pro:6,complete:true,select:1,task_list:{}}}}));
 const initial=s.initial('frog');assert.equal(initial.find(x=>x.cmd==='story_load').data.stories[0].gift,3001);assert.equal(initial.find(x=>x.cmd==='cooking_load_cooking').data.month_pro,0,'stale month does not carry completed food into a new month');
 const {SnapshotService}=require('../src/core/snapshots'),snapshots=new SnapshotService(db),before=snapshots.create('frog','before feedback');const reopened=create(db);setTime(getTime()+10);reopened.advance('frog');assert.equal(db.getMails('frog').filter(x=>x.type===6).length,1);
 snapshots.restore('frog',before.id,'frog');reopened.advance('frog');assert.equal(db.getMails('frog').filter(x=>x.type===6).length,1,'account snapshot restores pending metadata and mail rows together');
});
test('gift and monthly reward transactions roll back inventory and metadata together',t=>{
 const {db,s}=setup(t);addStory(db,{id:1,gift:-1,feedback:-1,name:'Friend',partner:1});db.changeInventory('frog',3000,1);const original=s.save.bind(s);s.save=()=>{throw Error('write failed');};
 assert.throws(()=>cmd(s,'story_send_gift',{id:1,gift:3000}),/write failed/);assert.equal(db.getInventoryCount('frog',3000),1);assert.equal(db.getStories('frog')[0].gift,-1);s.save=original;
 s.initial('frog');const state=s.state('frog');state.cooking.select=1;state.cooking.month_pro=6;s.save('frog',state);s.save=()=>{throw Error('write failed');};assert.throws(()=>cmd(s,'cooking_start_cooking'),/write failed/);assert.equal(db.getInventoryCount('frog',20),0);
});
test('database observations provide task progress fallback without duplicating explicit observations',t=>{
 const {db,s}=setup(t);s.initial('frog');db.updateAccount('frog',{clover:80,trip_count:1});s.advance('frog');let cooking=cmd(s,'cooking_load_cooking').response;assert.equal(cooking.task_list.find(x=>x.id===4).pro,80);assert.equal(cooking.task_list.find(x=>x.id===5).pro,1);
 s.observe('frog','clover',10);s.advance('frog');cooking=cmd(s,'cooking_load_cooking').response;assert.equal(cooking.task_list.find(x=>x.id===4).pro,80,'progress clamps to exact configured maximum');
});
test('actual local configuration defines all cooking output items and story records',t=>{
 const file=path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/assets/eab/config.eab');if(!fs.existsSync(file)){t.skip('private APK assets optional');return;}
 const c=require('../src/core/catalog').readBundle(file),db=new FrogDatabase(':memory:');t.after(()=>db.close());const s=new LifeService(db,{config:c,items:Object.values(c.Item_json)});assert.equal(s.cooking.length,24);assert.equal(s.stories.length,25);assert.ok(s.cooking.every(x=>s.items.has(x.item_id)));assert.ok(s.tasks.filter(x=>![2,8].includes(x.type)).every(x=>x.state>0));
});
