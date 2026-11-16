'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {TravelPolicy}=require('./travel_policy'),{PostcardGenerator}=require('./postcard_generator');
function random(seed){return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};}
function fixtures(){
 const pictures=[{id:100,type:'Normal',name:'roof',location:'',backImage:['base'],frontImage:[],frogPose:'',frogPose_s:''},{id:2000,type:'Goal',name:'beijing1',place:1,location:'北京·故宫',backImage:['base'],frontImage:[],frogPose:'',frogPose_s:''},{id:2001,type:'Goal',name:'hangzhou1',place:6,location:'浙江·杭州',backImage:['base'],frontImage:[],frogPose:'',frogPose_s:''},{id:1001,type:'Tools',name:'wet1',backImage:['base'],frontImage:[],frogPose:'',frogPose_s:''}];
 const config={Picture_json:pictures,Item_json:[{id:0,type:0,spend:1},{id:2,type:0,spend:1},{id:1001,type:1,spend:0},{id:1002,type:1,spend:1,info:'往东走或许有好事发生'},{id:2003,type:2,spend:0}],Specialty_json:[{itemId:3000,place:'华北地区'},{itemId:3001,place:'华东地区'}],Note_json:{1000:{id:1000,factorType:'Drop',factorData:15},2000:{id:2000,factorType:'Drop',factorData:100,factorType2:'Friends',factorData2:0}},Collection_json:[{id:1,place:'华北地区'},{id:2,place:'华东地区'}]};
 config.Item_json.push({id:3000,type:3,spend:1},{id:3001,type:3,spend:1});
 const header=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.writeUInt32BE(500,16);header.writeUInt32BE(350,20);
 const generator=new PostcardGenerator({config,resources:{1:'Picture/Normal/base',2:'Picture/Goal/base',3:'Picture/Tools/base'},loadImage:()=>header});
 return {config,generator};
}
test('spending follows client spend flags and retains actual bag size, not a fixed five-slot template',()=>{
 const policy=new TravelPolicy(fixtures());
 assert.deepEqual(policy.spending([0,1001,2003,-1]),{consumed:[{slot:1,item_id:0,count:1}],returned:[{slot:2,item_id:1001,count:1},{slot:3,item_id:2003,count:1}],nextBag:[-1,-1,-1,-1]});
 assert.deepEqual(policy.spending([2,1002,-1,-1]).consumed.map(x=>x.item_id),[2,1002]);
 assert.throws(()=>policy.spending([0,9999]),/Unknown/);assert.throws(()=>policy.select({bag:[1001,-1,-1,-1]}),/food/);
});
test('route identity retains historic 0–4 trips and new routes remain stable across generator instances',()=>{
 const a=new TravelPolicy({...fixtures(),random:random(4)}),b=new TravelPolicy({...fixtures(),random:random(4)});
 assert.equal(a.route(0).picId,100);assert.equal(a.route(12000).picId,2000);assert.deepEqual(a.routes(),b.routes());
 const selected=a.select({bag:[0,-1,-1,-1],durationSeconds:1,homeRange:[1,1]});assert.equal(selected.durationSeconds,1);assert.equal(selected.homeWaitSeconds,1);assert.ok(a.route(selected.route.id));
 assert.equal(selected.rewards.specialty.item_id,selected.route.specialtyId);assert.ok([1000,2000].includes(selected.route.noteId));
});
test('food and direction change weighted outcomes without deterministic route/companion rotation',()=>{
 const short=new TravelPolicy({...fixtures(),random:random(9)}),far=new TravelPolicy({...fixtures(),random:random(9)}),east=new TravelPolicy({...fixtures(),random:random(9)});
 let shortGoals=0,farGoals=0,eastGoals=0,westGoals=0;const seen=new Set();
 for(let i=0;i<400;i++){
  const a=short.select({bag:[0,-1,-1,-1]});if(a.route.pictureType==='Goal')shortGoals++;
  const b=far.select({bag:[2,-1,-1,-1]});if(b.route.pictureType==='Goal')farGoals++;seen.add(b.route.id);
  const c=east.select({bag:[2,1002,-1,-1],nearFar:'far'});if(c.route.region==='华东地区')eastGoals++;else westGoals++;
 }
 assert.ok(farGoals>shortGoals+100,'substantial food-based near/far tendency');assert.ok(eastGoals>westGoals*1.5,'east bell weights eastern scenes');assert.ok(seen.size>1,'route is sampled rather than fixed');
});
test('tool scenes require their tool, note prerequisites are checked and invalid policy inputs fail',()=>{
 const policy=new TravelPolicy({...fixtures(),random:random(22)});
 assert.throws(()=>policy.select({bag:[0,-1,-1,-1],picId:1001}),/eligible/);
 assert.equal(policy.select({bag:[0,-1,2003,-1],picId:1001}).route.picId,1001);
 assert.deepEqual(policy.notePool({},-1).map(x=>x.id),[1000]);assert.deepEqual(policy.notePool({},0).map(x=>x.id),[1000,2000]);
 assert.throws(()=>new TravelPolicy({...fixtures(),timing:{near:[30,1]}}),/timing/);assert.throws(()=>new TravelPolicy({...fixtures(),weights:{friend:2}}),/probability/);
 assert.throws(()=>policy.select({bag:[0,-1,-1,-1],durationSeconds:-1}),/duration/);assert.throws(()=>policy.homeWait({homeRange:[4,2]}),/range/);
});
test('real-catalog policy reaches eligible non-demo routes, valid loot and scene-supported companions',t=>{
 const root=process.env.FROG_ASSETS||path.join(__dirname,'exports/oneplus-official-20261114-live/assets');if(!fs.existsSync(path.join(root,'eab/config.eab'))){t.skip('client assets are optional');return;}
 const generator=new PostcardGenerator({root,random:random(33)}),policy=new TravelPolicy({generator,random:random(44)}),seen=new Set();
 for(let i=0;i<800;i++){
  const selected=policy.select({bag:[2,1002,2003,2000],season:1});const p=generator.generate(i+1,{picId:selected.route.picId,companionId:selected.companionId,season:1,tools:[2003,2000]});
  assert.equal(p.pic_id,selected.route.picId);assert.ok(policy.items.has(selected.route.specialtyId));assert.ok(selected.durationSeconds>=1&&selected.durationSeconds<=86400);seen.add(p.pic_id);
 }
 assert.ok(seen.size>80,'samples across a broad catalog rather than five fixtures');assert.ok(policy.routes().length>300);
});
