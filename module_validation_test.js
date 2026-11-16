'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validateModules}=require('./module_validation');
const photo={id:2,pic_id:100,layers:[{layer:[1,-0.5,2.5]}]};
function anim(){return {guide:6,page_num:1,item_num:0,pic_list:[{id:1,phase:1,exp:0,put_num:0,exp_pic:[structuredClone(photo)],pictures:[],next_at:1800000000,source_picture:{...structuredClone(photo),id:1}}],last_at:1800000000};}
test('known corrupted modules are rejected before use and valid floating-point photo layers survive unchanged',()=>{
 for(const name of ['animpicture','capsule','wishingpool','greetcard','springcard','partycake','museumday','koto','lottery','creative','life','daily'])assert.throws(()=>validateModules({[name]:{}}),/Invalid game module/);
 const valid={animpicture:anim()},before=structuredClone(valid);assert.equal(validateModules(valid),true);assert.deepEqual(valid,before);
 for(const mutate of [s=>s.pic_list=null,s=>s.pic_list[0].exp=-1,s=>s.pic_list[0].exp_pic[0].layers=[],s=>s.pic_list[0].pictures=[{id:8,pic_id:100,layers:[{layer:[1,NaN,0]}]}],s=>s.pic_list[0].source_picture.id=-1]){const broken=anim();mutate(broken);assert.throws(()=>validateModules({animpicture:broken}),/Invalid game module/);}
});
test('empty deferred travel/world and future JSON modules remain compatible, with bounded finite JSON',()=>{
 const valid={'travel-plan':{},world:{},progression:{},future_event:{version:1,rows:[{ratio:0.5,values:['text',true,null]}]}};
 assert.equal(validateModules(valid),true);assert.equal(validateModules(undefined),true);
 assert.throws(()=>validateModules({future_event:{balance:Infinity}}),/non-finite/);assert.throws(()=>validateModules({future_event:{fn:()=>0}}),/JSON/);assert.throws(()=>validateModules({future_event:[]}),/object/);assert.throws(()=>validateModules({'BAD MODULE':{}}),/name/);
 const cycle={};cycle.self=cycle;assert.throws(()=>validateModules({future_event:cycle}),/cyclic/);
 const deep={};let at=deep;for(let i=0;i<35;i++){at.next={};at=at.next;}assert.throws(()=>validateModules({future_event:deep}),/deep/);
 assert.throws(()=>validateModules({'travel-plan':{rewards:{specialty:{item_id:3000,count:-1}}}}),/count/);assert.throws(()=>validateModules({progression:{acquired_items:['invalid-id']}}),/integer/);
});
test('lottery reward amounts and exploration path indices cannot import invalid claims or impossible routes',()=>{
 const {FrogDatabase}=require('./database'),{ExplorationService}=require('./exploration');const db=new FrogDatabase(':memory:');try{
  db.ensureAccount('validation');const service=new ExplorationService(db,{items:[{id:0,type:0}],config:{}},{now:()=>1000,randomInt:()=>0});
  const lottery=service.lotteryState('validation',1000);assert.equal(validateModules({lottery}),true);
  lottery.reward=[{id:200001,num:-1,is_egg:0}];assert.throws(()=>validateModules({lottery}),/num/);
  const explore=service.exploreState('validation','museumday',1000);assert.equal(validateModules({museumday:explore}),true);explore.path=[{grid:1,type:0,style:0}];explore.frog=2;explore.next=1;assert.throws(()=>validateModules({museumday:explore}),/inconsistent/);
 }finally{db.close();}
});
test('actual captured account initializes all known modules that pass validation and JSON round trip',t=>{
 const root=path.join(__dirname,'exports/oneplus-official-20261114-live/assets'),filename=path.join(__dirname,'exports/oneplus-official-20261114-live/converted-save.json');if(!fs.existsSync(filename)||!fs.existsSync(path.join(root,'eab/config.eab'))){t.skip('capture/assets optional');return;}
 const {FrogDatabase}=require('./database'),{loadCatalog,readBundle}=require('./catalog');const db=new FrogDatabase(':memory:');t.after(()=>db.close());const original=JSON.parse(fs.readFileSync(filename,'utf8')),account=original.account.account,catalog={...loadCatalog(root),config:readBundle(path.join(root,'eab/config.eab'))},now=2000000000;db.importAccount(original,true);
 for(const [file,name,options]of [['creative','CreativeService',{clock:()=>now,random:()=>0}],['activities','ActivitiesService',{now:()=>now,randomInt:()=>0}],['cards','CardsService',{now:()=>now,randomInt:()=>0}],['exploration','ExplorationService',{now:()=>now,randomInt:()=>0}],['life','LifeService',{clock:()=>now,random:()=>0}],['daily','DailyService',{clock:()=>now}],['progression','ProgressionService',{clock:()=>now}]])new (require('./'+file)[name])(db,catalog,options).initial(account);
 const modules=db.modules.export(account),before=JSON.stringify(modules);assert.equal(validateModules(modules),true);assert.equal(JSON.stringify(modules),before,'validation never normalizes or resets live state');assert.equal(validateModules(JSON.parse(before)),true);
});
