'use strict';
const { PROJECT_ROOT } = require("../src/paths");

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PostcardGenerator}=require('../src/game/travel/postcard_generator');

function png(width,height){const bytes=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;}
function fixtures(){
 const pictures=[
  {id:100,type:'Goal',name:'beijing1',backImage:['back_g_beijing1'],frontImage:[],frogPose:'pose_beijing1',frogPose_s:'pose_beijing1',frogPos:{x:-86,y:-75},frogPos_s:{x:-86,y:-75},travelerPose:['pose_beijing1','',''],travelerPos:[{x:131,y:-118},{x:0,y:0},{x:0,y:0}],place:1},
  {id:101,type:'Goal',name:'missing',backImage:['not_packaged'],frontImage:[],frogPose:'',frogPose_s:''},
  {id:102,type:'Normal',name:'back_n_redleaves1',backImage:['leaves_back'],frontImage:[],frogPose:'',frogPose_s:''},
  {id:1001,type:'Tools',name:'wet1',backImage:['wet_back'],frontImage:[],frogPose:'pose_wet1',frogPose_s:'pose_wet1',frogPos:{x:0,y:0},frogPos_s:{x:0,y:0},travelerPose:[]},
  {id:202,type:'Normal',name:'back_n_chuisihaitang1',backImage:['chuisihaitang_back'],frontImage:[],frogPose:'',frogPose_s:'pose_chuisihaitang_mt',frogPos_s:{x:0,y:-94},travelerPose:['pose_chuisihaitang_mt','',''],travelerPos:[{x:0,y:-94}]},
 ];
 const resources={0:'Picture/photo_frame',1:'Picture/Goal/g_beijing1',2:'Picture/Goal/BJ1_QW',3:'Picture/Goal/BJ1_BH',4:'Picture/Normal/leaves_back',5:'Picture/Tools/wet_back',6:'Picture/Tools/wet1',7:'Picture/Normal/chuisihaitang_back',8:'Picture/Normal/chuisihaitang_mt_pose_qw',9:'Picture/Normal/chuisihaitang_mt_pose_bh'};
 const loadImage=id=>[2,3,6,8,9].includes(id)?png(40,30):png(500,350);
 return {pictures,resources,loadImage,random:()=>0};
}
test('configured scene anchors generate exact pixels and distinguish solo/composite companion sprites',()=>{
 const g=new PostcardGenerator(fixtures());const solo=g.generate(1,{picId:100,companionId:-1});
 assert.deepEqual(solo.layers,[{layer:[1,0,0]},{layer:[2,144,235]},{layer:[0,0,0]}]);
 const withFriend=g.generate(2,{picId:100,companionId:0});assert.equal(withFriend.layers.filter(x=>[2,3].includes(x.layer[0])).length,2);
 const combined=g.generate(3,{picId:202,companionId:0});assert.ok(combined.layers.some(x=>x.layer[0]===9));assert.ok(!combined.layers.some(x=>x.layer[0]===8),'companion artwork already includes frog');
 assert.ok(g.generate(4,{picId:202,companionId:-1}).layers.some(x=>x.layer[0]===8));
});
test('observed layout coordinates and order remain coherent, fractional pixels survive and samples are not mutated',()=>{
 const sample={id:90,pic_id:100,layers:[{layer:[1,-0.5,1.5]},{layer:[2,144,235]},{layer:[0,0,0]}]};const before=structuredClone(sample);
 const g=new PostcardGenerator({...fixtures(),samples:[sample,sample]});
 assert.equal(g.samples.get(100).length,1);assert.deepEqual(g.generate(5,{picId:100,companionId:-1}).layers,sample.layers);assert.deepEqual(sample,before);
 g.generate(6,{picId:100,companionId:-1}).layers[0].layer[1]=123;assert.deepEqual(sample,before,'generated records do not alias source save');
});
test('season and carried-tool gating applies to selection; explicit preview never invents missing assets',()=>{
 const g=new PostcardGenerator(fixtures());assert.equal(g.eligible({season:1}).some(x=>x.picture.id===102),false);assert.equal(g.eligible({season:3}).some(x=>x.picture.id===102),true);
 assert.throws(()=>g.generate(7,{picId:1001}),/No matching/);assert.equal(g.generate(7,{picId:1001,tools:[2003]}).pic_id,1001);assert.equal(g.generate(8,{picId:1001,preview:true}).pic_id,1001);
 assert.throws(()=>g.generate(9,{picId:101,preview:true}),/No matching/);assert.equal(g.coverage().rows.find(x=>x.id===101).available,false);
 assert.throws(()=>g.generate(0,{picId:100}),/positive/);assert.throws(()=>g.generate(1,{picId:100,companionId:10}),/companion/);assert.throws(()=>g.generate(1,{picId:100,season:0}),/season/);
});
test('seeded generators reproduce layouts and invalid random/PNG resources fail explicitly',()=>{
 const a=new PostcardGenerator(fixtures()),b=new PostcardGenerator(fixtures());assert.deepEqual(a.generate(1,{picId:100,companionId:0}),b.generate(1,{picId:100,companionId:0}));
 a.random=()=>1;assert.throws(()=>a.generate(1,{picId:100}),/Random source/);
 const broken=new PostcardGenerator({...fixtures(),loadImage:()=>Buffer.from('not a png')});assert.equal(broken.coverage().available,0);assert.throws(()=>broken.generate(1),/No matching/);
});
test('optional real client catalog generates every available scene and actor combination using readable PNG resources',t=>{
 const root=process.env.FROG_ASSETS||path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/assets');if(!fs.existsSync(path.join(root,'eab/config.eab'))){t.skip('client assets are optional and not redistributed');return;}
 const capture=path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/converted-save.json');const samples=fs.existsSync(capture)?JSON.parse(fs.readFileSync(capture,'utf8')).postcards:[];
 const g=new PostcardGenerator({root,samples,random:()=>0.4}),coverage=g.coverage();assert.ok(coverage.available>300,'should cover substantially more than five demo scenes');
 let count=0;for(const row of coverage.rows.filter(x=>x.available))for(const companionId of [-1,...row.companions]){
  const picture=g.generate(++count,{picId:row.id,companionId,preview:true});assert.equal(picture.pic_id,row.id);assert.equal(g.validate(picture),true);assert.ok(picture.layers.every(x=>g.assets.has(x.layer[0])));
 }
 assert.ok(count>900);assert.ok(coverage.rows.filter(x=>!x.available).every(x=>x.unresolved.length));
});

test('configuration-derived Goal character coordinates agree with captured official postcard layers',t=>{
 const root=process.env.FROG_ASSETS||path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/assets');
 const filename=path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/converted-save.json');
 if(!fs.existsSync(path.join(root,'eab/config.eab'))||!fs.existsSync(filename)){t.skip('official capture is optional and not redistributed');return;}
 const samples=JSON.parse(fs.readFileSync(filename,'utf8')).postcards;
 const g=new PostcardGenerator({root,samples,random:()=>0.4});let compared=0;
 for(const sample of samples){
  const def=g.definitions.get(sample.pic_id);if(!def?.available||def.picture.type!=='Goal')continue;
  const present=[-1,...def.companions.flatMap((a,i)=>a.length?[i]:[])].find(ci=>ci<0
   ? def.companions.every(values=>values.every(sprite=>!sample.layers.some(x=>x.layer[0]===sprite.id)))
   : def.companions[ci].some(sprite=>sample.layers.some(x=>x.layer[0]===sprite.id)));
  if(present===undefined)continue;
  const generated=g.generate(1,{picId:sample.pic_id,companionId:present,preview:true});
  for(const layer of generated.layers){
   if(!/(?:^|_)(?:qw|bh|cw|yhc)$/i.test(g.assets.get(layer.layer[0]).base))continue;
   const observed=sample.layers.find(x=>x.layer[0]===layer.layer[0]);
   if(observed){assert.deepEqual(layer,observed,`official coordinate mismatch for pic ${sample.pic_id}, resource ${layer.layer[0]}`);compared++;}
  }
 }
 assert.ok(compared>=30,'must compare substantial official evidence rather than one synthetic fixture');
});

function retiredFixture(){
 const pictures=[
  {id:2033,type:'Goal',name:'xianggang3',location:'香港',backImage:['retired-hk'],frontImage:[],frogPose:'',frogPose_s:''},
  {id:2031,type:'Goal',name:'xianggang1',location:'维多利亚港',place:11,backImage:['hk1'],frontImage:[],frogPose:'pose_hk1',frogPose_s:'pose_hk1',frogPos:{x:0,y:0},frogPos_s:{x:0,y:0},travelerPose:[]},
  {id:2032,type:'Goal',name:'xianggang2',location:'香港·怪兽大厦',place:11,backImage:['hk2'],frontImage:[],frogPose:'pose_hk2',frogPose_s:'pose_hk2',frogPos:{x:20,y:-10},frogPos_s:{x:20,y:-10},travelerPose:[]},
  {id:2040,type:'Goal',name:'changbaishan1',location:'吉林·长白山',backImage:['retired-cbs'],frontImage:[],frogPose:'',frogPose_s:''},
  {id:2126,type:'Goal',name:'jilin1',location:'吉林·长白山·天池',place:30,backImage:['cbs1'],frontImage:[],frogPose:'pose_jilin1',frogPose_s:'pose_jilin1',frogPos:{x:0,y:0},frogPos_s:{x:0,y:0},travelerPose:[]},
 ];
 const resources={0:'Picture/photo_frame',1:'Picture/Goal/hk1',2:'Picture/Goal/hk1_qw',3:'Picture/Goal/hk2',4:'Picture/Goal/hk2_qw',5:'Picture/Goal/cbs1',6:'Picture/Goal/jilin1_qw'};
 return {pictures,resources,loadImage:id=>[2,4,6].includes(id)?png(40,30):png(500,350),random:()=>0};
}

test('retired scenes use a complete verified same-place composition and expose all missing-source evidence',()=>{
 const options=retiredFixture(),original=structuredClone(options.pictures),g=new PostcardGenerator(options),picture=g.generate(20,{picId:2033,place:11,companionId:-1});
 assert.equal(picture.pic_id,2033);assert.deepEqual(picture.layers,[{layer:[1,0,0]},{layer:[2,230,160]},{layer:[0,0,0]}]);assert.equal(g.validate(picture),true);
 const coverage=g.coverage().rows.find(x=>x.id===2033);assert.equal(coverage.layout,'approximate-retired-scene');assert.deepEqual(coverage.unresolved,['retired-hk']);assert.deepEqual(coverage.fallback_source.map(x=>x.pic_id),[2031,2032]);assert.ok(coverage.fallback_source.every(x=>x.place===11));assert.deepEqual(options.pictures,original,'fallback metadata must not mutate supplied game configuration');
 assert.equal(g.generate(21,{picId:2040,place:30}).pic_id,2040);
 const disabled=new PostcardGenerator({...retiredFixture(),enableRetiredFallbacks:false});assert.throws(()=>disabled.generate(1,{picId:2033,preview:true}),/No matching/);assert.equal(disabled.coverage().rows.find(x=>x.id===2033).layout,'configured-or-observed');
});

test('fallback never crosses place, never chains broken definitions and preserves source season constraints',()=>{
 const bad=retiredFixture();bad.pictures.find(x=>x.id===2031).place=1;bad.pictures.find(x=>x.id===2032).backImage=['also-missing'];bad.pictures.find(x=>x.id===2126).location='吉林·另一个城市';
 const denied=new PostcardGenerator(bad);assert.throws(()=>denied.generate(1,{picId:2033,preview:true}),/No matching/);assert.throws(()=>denied.generate(1,{picId:2040,preview:true}),/No matching/);
 const gated=retiredFixture();gated.pictures.filter(x=>[2031,2032].includes(x.id)).forEach(x=>x.seasons=[4]);const g=new PostcardGenerator(gated);assert.throws(()=>g.generate(1,{picId:2033,season:1}),/No matching/);assert.equal(g.generate(1,{picId:2033,season:4}).pic_id,2033);assert.equal(g.generate(1,{picId:2033,season:1,preview:true}).pic_id,2033);
});

test('exact retired-scene samples beat replacements and sampled fallback sources beat unobserved sources',()=>{
 const sample={pic_id:2032,layers:[{layer:[3,-0.5,1.5]},{layer:[4,250,170]},{layer:[0,0,0]}]};
 const g=new PostcardGenerator({...retiredFixture(),samples:[sample]});assert.deepEqual(g.generate(1,{picId:2033,companionId:-1}).layers,sample.layers,'prefer the coherent observed same-place source');
 const exact={pic_id:2033,layers:[{layer:[5,-12,3.5]},{layer:[0,0,0]}]};const observed=new PostcardGenerator({...retiredFixture(),samples:[sample,exact]});assert.deepEqual(observed.generate(2,{picId:2033}).layers,exact.layers);assert.equal(observed.coverage().rows.find(x=>x.id===2033).layout,'observed-retired-scene');
});

test('all seven supplied retired scenes have explicit same-destination replacements with real readable layers',t=>{
 const root=process.env.FROG_ASSETS||path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/assets'),save=path.join(PROJECT_ROOT,'exports/oneplus-official-20261114-live/converted-save.json');if(!fs.existsSync(path.join(root,'eab/config.eab'))){t.skip('Local client assets optional');return;}
 const samples=fs.existsSync(save)?JSON.parse(fs.readFileSync(save,'utf8')).postcards:[],g=new PostcardGenerator({root,samples,random:()=>0.4}),coverage=g.coverage();
 const replacements=coverage.rows.filter(x=>x.layout==='approximate-retired-scene');assert.deepEqual(replacements.map(x=>x.id),[2033,2035,2040,2041,2042,2075,2076]);assert.equal(coverage.available,coverage.total);
 for(const row of replacements){
  assert.ok(row.unresolved.length);assert.ok(row.fallback_source.length);assert.ok(row.fallback_source.every(source=>source.place===row.fallback_place));
  if([2040,2041,2042].includes(row.id))assert.ok(row.fallback_source.every(source=>source.location.startsWith('吉林·长白山')));
  for(const companionId of [-1,...row.companions]){const picture=g.generate(row.id,{picId:row.id,companionId,preview:true});assert.equal(picture.pic_id,row.id);assert.ok(picture.layers.every(x=>g.assets.has(x.layer[0])));g.validate(picture);}
 }
});
