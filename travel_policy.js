'use strict';

// Config-driven offline travel choices. Durations, weights and reward rates
// below are explicit local approximations, not recovered server algorithms.
const clone=value=>JSON.parse(JSON.stringify(value));
const LEGACY_IDS=new Map([[100,0],[103,1],[105,2],[107,3],[109,4]]);
const DEFAULT_TIMING=Object.freeze({near:[1800,14400],far:[14400,86400],home:[900,7200]});
const REGIONS=Object.freeze([
 ['华南地区',/广东|广州|广西|桂林|海南|江门|南越/],['华东地区',/浙江|杭州|江苏|苏州|上海|福建|江西|安徽|山东|青岛|吴文化/],
 ['华北地区',/北京|天津|河北|山西|内蒙古/],['西南地区',/四川|成都|重庆|贵州|云南|西藏|拉萨/],
 ['东北地区',/辽宁|吉林|哈尔滨|长白山/],['西北地区',/陕西|西安|甘肃|酒泉|宁夏|青海|新疆/],
 ['华中地区',/河南|洛阳|郑州|湖北|武汉|湖南|张家界|凤凰/],['台湾地区',/台湾/],['港澳地区',/香港|澳门/],
]);
const FOOD_PLACES=Object.freeze({101:[1],102:[2],103:[3],104:[4],105:[5],106:[6],107:[7],108:[8],109:[9,10],110:[12],111:[18],112:[21],113:[22],114:[25],115:[16],116:[13],117:[24],118:[19],119:[20],120:[11],121:[23],122:[5],123:[15],124:[25],125:[26],126:[27],127:[28],128:[29],129:[30],130:[31],131:[32],132:[33],133:[35],134:[34]});
const REGION_DIRECTION=Object.freeze({'华东地区':'东','台湾地区':'东','西南地区':'西','西北地区':'西','华南地区':'南','港澳地区':'南','华北地区':'北','东北地区':'北'});

class TravelPolicy{
  constructor(options={}){
    if(!options.generator)throw Error('TravelPolicy requires a PostcardGenerator');
    this.generator=options.generator;this.config=options.config||options.generator.config||{};
    this.random=options.random||Math.random;
    this.items=new Map((options.catalog?.items||this.config.Item_json||[]).map(x=>[x.id,x]));
    this.notes=Object.values(this.config.Note_json||{});
    this.specialties=Object.values(this.config.Specialty_json||[]).filter(x=>this.items.get(x.itemId)?.type===3);
    this.collections=Object.values(this.config.Collection_json||[]);
    this.goals=new Map(Object.values(this.config.GoalNumber_json||[]).map(x=>[x.id,x]));
    this.timing={...DEFAULT_TIMING,...options.timing};
    for(const [key,value]of Object.entries(this.timing))if(!Array.isArray(value)||value.length!==2||value.some(x=>!Number.isSafeInteger(x)||x<1)||value[1]<value[0])throw Error('Invalid travel timing '+key);
    this.weights={normal:0.55,goal:0.35,tools:0.1,friend:0.6,collection:0.18,note:0.45,...options.weights};
    for(const [key,value]of Object.entries(this.weights))if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Invalid travel weight '+key);
    const typeWeights=['normal','goal','tools'].reduce((n,k)=>n+this.weights[k],0);if(!typeWeights)throw Error('At least one travel type must have a positive weight');
    for(const key of ['friend','collection','note'])if(this.weights[key]>1)throw Error('Invalid travel probability '+key);
    this.allRoutes=new Map();
    for(const def of this.generator.definitions.values())if(def.available){
      const p=def.picture,id=LEGACY_IDS.has(p.id)?LEGACY_IDS.get(p.id):10000+p.id;
      const region=REGIONS.find(([,pattern])=>pattern.test(p.location||''))?.[0]||null;
      const specialty=this.specialties.find(x=>region&&x.place===region)||this.specialties[0];
      const note=this.notes.find(x=>x.factorType==='Drop'&&!x.factorType2)||this.notes[0];
      this.allRoutes.set(id,{id,picId:p.id,pictureType:p.type,place:p.place??null,destination:p.location||this.goals.get(p.place)?.name||this.label(p),region,
        specialtyId:specialty?.itemId??null,noteId:note?.id??null,companions:def.companions.flatMap((a,i)=>a.length?[i]:[])});
    }
  }
  label(p){const known={100:'屋顶',101:'屋顶',102:'海边',103:'海边',104:'海边',105:'树枝',106:'树枝',107:'竹林',108:'竹林',109:'麦田',110:'麦田'};return known[p.id]||p.name;}
  roll(){const value=this.random();if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=1)throw Error('Random source must return [0,1)');return value;}
  pick(values){if(!values.length)return null;return values[Math.floor(this.roll()*values.length)];}
  weighted(entries){const total=entries.reduce((n,x)=>n+x.weight,0);if(!total)throw Error('No eligible travel route');let target=this.roll()*total;for(const entry of entries){target-=entry.weight;if(target<0)return entry.value;}return entries.at(-1).value;}
  interval(range){return range[0]+Math.floor(this.roll()*(range[1]-range[0]+1));}
  routes(){return [...this.allRoutes.values()].map(clone);}
  route(id){return this.allRoutes.has(id)?clone(this.allRoutes.get(id)):null;}
  direction(item){return String(item?.info||'').match(/往([东西南北])走/)?.[1]||null;}
  spending(bag){
    if(!Array.isArray(bag)||bag.length<1||bag.length>16)throw Error('Expected travel bag slots');
    const consumed=[],returned=[];
    bag.forEach((id,index)=>{
      if(id===-1)return;if(!Number.isSafeInteger(id)||!this.items.has(id))throw Error('Unknown travel bag item');
      const item=this.items.get(id),record={slot:index+1,item_id:id,count:1};
      if(item.spend===1)consumed.push(record);else returned.push(record);
    });
    return {consumed,returned,nextBag:Array(bag.length).fill(-1)};
  }
  homeWait(context={}){
    const range=context.homeRange||this.timing.home;
    if(!Array.isArray(range)||range.length!==2||!range.every(x=>Number.isSafeInteger(x)&&x>0)||range[1]<range[0])throw Error('Invalid home wait range');
    return this.interval(range);
  }
  routeWeight(route,context,typeCounts){
    const food=this.items.get(context.bag[0]),info=food?.info||'';
    const type=route.pictureType;
    let near=this.weights.normal,far=this.weights.goal,tool=this.weights.tools;
    if(food?.id===0){near=0.75;far=0.15;tool=0.1;}
    if(food?.id===1){near=0.45;far=0.45;tool=0.1;}
    if(food?.id===2){near=0.2;far=0.7;tool=0.1;}
    if(food?.id===3){near=0.8;far=0.1;tool=0.1;}
    let weight=({Normal:near,Goal:far,Tools:tool,Unique:0.03}[type]||0)/(typeCounts[type]||1);
    const amulet=this.items.get(context.bag[1]),direction=this.direction(amulet);
    if(direction&&REGION_DIRECTION[route.region]===direction)weight*=3;
    if(FOOD_PLACES[food?.id]?.includes(route.place))weight*=12;
    if(/水乡/.test(info)&&/杭州|江苏|苏州|上海|武汉/.test(route.destination))weight*=4;
    if(/海边/.test(info)&&/海南|台湾|香港|澳门|青岛|海边/.test(route.destination))weight*=4;
    if(/沙漠/.test(info)&&/酒泉|宁夏|新疆|西北/.test(route.destination))weight*=4;
    if(/雪地/.test(info)&&/哈尔滨|吉林|长白山|西藏|拉萨|青海/.test(route.destination))weight*=4;
    const seen=new Set(context.seenPicIds||[]);
    if(/新地点/.test(amulet?.info||'')&&!seen.has(route.picId))weight*=3;
    if(context.nearFar==='near'&&type==='Goal')weight=0;
    if(context.nearFar==='far'&&type!=='Goal')weight=0;
    return weight;
  }
  notePool(context,companionId){
    const owned=new Set(context.ownedNoteIds||[]);
    return this.notes.filter(note=>note.factorType==='Drop'&&(!note.factorType2||(note.factorType2==='Friends'&&note.factorData2===companionId)||(note.factorType2==='Own_Note'&&owned.has(note.factorData2))));
  }
  duration(route,context){
    if(context.durationSeconds!==undefined){if(!Number.isSafeInteger(context.durationSeconds)||context.durationSeconds<1)throw Error('Invalid trip duration override');return context.durationSeconds;}
    let range=route.pictureType==='Goal'?this.timing.far:this.timing.near;
    // Basic food descriptions establish a tendency, not these time values.
    const food=context.bag[0];
    if(food===0&&route.pictureType!=='Goal')range=[Math.min(range[0],900),Math.min(range[1],5400)];
    if(food===1&&route.pictureType!=='Goal')range=[Math.min(range[0],5400),Math.min(range[1],14400)];
    if(food===3)range=[Math.min(range[0],600),Math.min(range[1],2700)];
    return this.interval(range);
  }
  select(context={}){
    const bag=context.bag;
    if(!Array.isArray(bag)||this.items.get(bag[0])?.type!==0)throw Error('Known travel food is required in the first bag slot');
    const spending=this.spending(bag),tools=bag.filter(id=>this.items.get(id)?.type===2);
    const definitions=this.generator.eligible({...context,tools});
    const routes=definitions.map(def=>this.route(LEGACY_IDS.has(def.picture.id)?LEGACY_IDS.get(def.picture.id):10000+def.picture.id));
    const typeCounts=routes.reduce((m,r)=>(m[r.pictureType]=(m[r.pictureType]||0)+1,m),{});
    const route=this.weighted(routes.map(value=>({value,weight:this.routeWeight(value,context,typeCounts)})));
    let companionId=-1;
    if(context.companionId!==undefined){
      if(!Number.isInteger(context.companionId)||context.companionId< -1||context.companionId>2)throw Error('Invalid travel companion');
      if(context.companionId>=0&&route.companions.includes(context.companionId))companionId=context.companionId;
    }else if(route.companions.length&&this.roll()<this.weights.friend)companionId=this.pick(route.companions);
    const specialtyPool=this.specialties.filter(x=>!route.region||x.place===route.region);
    route.specialtyId=this.pick(specialtyPool.length?specialtyPool:this.specialties)?.itemId??null;
    const notes=this.notePool(context,companionId);
    const note=notes.length?this.weighted(notes.map(value=>({value,weight:Math.max(1,Number(value.factorData)||1)}))):null;
    route.noteId=note?.id??null;
    const collectionPool=this.collections.filter(x=>!route.region||x.place===route.region);
    const collection=this.roll()<this.weights.collection?this.pick(collectionPool):null;
    const durationSeconds=this.duration(route,context);
    return {route,companionId,durationSeconds,spending,homeWaitSeconds:this.homeWait(context),
      rewards:{postcards:1,specialty:route.specialtyId===null?null:{item_id:route.specialtyId,count:1},noteId:note&&this.roll()<this.weights.note?note.id:null,collectionId:collection?.id??null},
      provenance:{selection:'local-weighted-policy',itemSpending:'client-Item.spend',coordinates:'PostcardGenerator',timing:'local-configurable-range'}};
  }
}
module.exports={TravelPolicy,DEFAULT_TIMING};
