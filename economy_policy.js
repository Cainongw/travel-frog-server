'use strict';
const crypto=require('node:crypto');

const SLOT_TYPES=Object.freeze({bag:Object.freeze([0,1,2,2]),desk:Object.freeze([0,0,1,1,2,2,2,2])});
const positive=(n,label)=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid '+label);return n;};
const list=value=>Array.isArray(value)?value:Object.values(value||{});
const clone=value=>JSON.parse(JSON.stringify(value));
class EconomyPolicy{
  constructor(options={}){
    this.config=options.config||options.catalog?.config||{};this.items=new Map((options.catalog?.items||list(this.config.Item_json)).map(x=>[x.id,x]));this.random=options.random||Math.random;
    this.albumBase=positive(options.albumBase??60,'base album capacity');
    this.shop=new Map();
    for(const row of list(this.config.shopData_json)){
      if(!Number.isSafeInteger(row.id)||row.id<0||!this.items.has(row.itemId)||!Number.isSafeInteger(row.price)||row.price<0||!Number.isSafeInteger(row.limit)||row.limit<0)continue;
      const before=row.before_buy||[];
      if(!Array.isArray(before)||before.length&&!(before[0]==='shop'&&Number.isSafeInteger(Number(before[1]))))continue;
      this.shop.set(row.id,{id:row.id,itemId:row.itemId,price:row.price,limit:row.limit,requires:before.length?Number(before[1]):null,hideBefore:!!row.is_hide_before,hideSoldOut:!!row.is_sold_out_hide,name:row.name||this.items.get(row.itemId).name||String(row.id),order:Number(row.order)||0});
    }
    this.provinces=list(this.config.visitors_json?.provinceList).filter(x=>typeof x.Province==='string'&&Number.isSafeInteger(x.ID)&&Number.isSafeInteger(x.OtherGiftID)&&Number.isSafeInteger(x.CountFloor)&&Number.isSafeInteger(x.CountUpper)&&x.CountFloor>=0&&x.CountUpper>=x.CountFloor);
    this.visitorFoods=list(this.config.visitors_json?.actionList).map(x=>x.FoodID).filter(id=>this.items.get(id)?.type===0);
  }
  roll(){const n=this.random();if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>=1)throw Error('Invalid random source');return n;}
  pick(values){if(!values.length)throw Error('Required client configuration unavailable');return values[Math.floor(this.roll()*values.length)];}
  slotTypes(kind){if(!Object.hasOwn(SLOT_TYPES,kind))throw Error('Unknown equipment kind');return [...SLOT_TYPES[kind]];}
  allowsSlot(kind,position,itemId){const types=this.slotTypes(kind);return Number.isSafeInteger(position)&&position>=1&&position<=types.length&&(itemId===-1||this.items.get(itemId)?.type===types[position-1]);}
  normalizedSlots(kind,input){
    const types=this.slotTypes(kind),out=Array(types.length).fill(-1),overflow=[];
    for(let i=0;i<(Array.isArray(input)?input.length:0);i++){
      const id=input[i];if(id===-1)continue;
      if(i<types.length&&this.allowsSlot(kind,i+1,id))out[i]=id;else overflow.push({slot:i+1,item_id:id,count:1});
    }
    return {slots:out,overflow};
  }
  heldCount(itemId,context={}){
    const inventory=context.inventory instanceof Map?context.inventory:new Map((context.inventory||[]).map(x=>[x.item_id,x.count]));
    return Number(inventory.get(itemId)||0)+[...(context.bag||[]),...(context.desk||[])].filter(id=>id===itemId).length;
  }
  purchaseCount(id,input={}){if(input instanceof Map)return Number(input.get(id)||0);if(Array.isArray(input))return Number(input.find(x=>(x.item_id??x.shop_id)===id)?.count||0);return Number(input[id]||0);}
  checkPurchase(shopId,context={}){
    const row=this.shop.get(shopId);if(!row)return {ok:false,reason:'Unknown shop item'};
    const bought=this.purchaseCount(shopId,context.purchases),item=this.items.get(row.itemId);
    if(row.limit>0&&bought>=row.limit)return {ok:false,reason:'Shop purchase limit reached'};
    if(row.requires!==null&&this.purchaseCount(row.requires,context.purchases)<1)return {ok:false,reason:'Prerequisite purchase required'};
    const held=this.heldCount(row.itemId,context),limit=Number(item.own_num)||0;
    // The client limits persistent tools by total ownership, including equipped
    // slots, rather than warehouse count alone. Never discard existing overflow.
    if(item.spend!==1&&limit>0&&held>=limit)return {ok:false,reason:'Item ownership limit reached'};
    if(Number(context.clover||0)<row.price)return {ok:false,reason:'Not enough clover'};
    return {ok:true,row:clone(row),clover:Number(context.clover)-row.price,item_id:row.itemId,count:1,effects:this.specialEffects(row.itemId,1)};
  }
  visibleShop(context={}){return [...this.shop.values()].filter(row=>!(row.hideBefore&&row.requires!==null&&this.purchaseCount(row.requires,context.purchases)<1)&&!(row.hideSoldOut&&row.limit>0&&this.purchaseCount(row.id,context.purchases)>=row.limit)).sort((a,b)=>a.order-b.order||a.id-b.id).map(clone);}
  specialEffects(itemId,count=1){
    positive(count,'effect count');const out={};
    if(itemId===9000)Object.assign(out,{albumPagesDelta:count,albumSlotsDelta:count*6});
    if(itemId===9001)out.dynamicFramesDelta=count;
    if(itemId===9002)out.dynamicAlbumTokensDelta=count;
    if(itemId===7000)out.handcraftUnlocked=true;
    if(itemId===7001)out.drawingUnlocked=true;
    return out;
  }
  inferAlbumBase(originalCount,originalExpansions=0){positive(originalCount,'original album count');positive(originalExpansions,'original expansions');return Math.max(this.albumBase,Math.ceil(originalCount/6)*6-originalExpansions*6);}
  albumCapacity(expansions=0,context={}){positive(expansions,'album expansions');const baseline=positive(context.baseline??this.albumBase,'album baseline');return Math.max(baseline+expansions*6,positive(context.preservedCount??0,'preserved picture count'));}
  provinceVisitor(context={}){
    const now=positive(context.now??Math.floor(Date.now()/1000),'visitor time'),duration=positive(context.durationSeconds??1800,'visitor duration');
    const acquired=new Set(context.acquired||[]);let candidates=this.provinces;
    if(context.preferredProvince)candidates=candidates.filter(x=>x.Province===context.preferredProvince);
    // Favor an uncollected flower, with repeats still possible. The multiplier
    // is local policy; names, flowers and repeat-gift bounds come from config.
    const weighted=candidates.flatMap(p=>Array(acquired.has(p.Province)?1:2).fill(p)),province=this.pick(weighted);
    const partner=Math.floor(this.roll()*3),names=['壁虎','刺猬','萤火虫'];
    const count=province.CountFloor+Math.floor(this.roll()*(province.CountUpper-province.CountFloor+1));
    return {partner,name:names[partner],title:0,expire_time:now+Math.max(1,duration),city:province.Province+'_'+province.Province,food:this.pick(this.visitorFoods),first:!acquired.has(province.Province),gift:{item_id:province.OtherGiftID,count},carpet:0};
  }
  weatherAt(timestamp,options={}){
    positive(timestamp,'weather timestamp');const offset=options.offsetMinutes??480;if(!Number.isFinite(offset)||Math.abs(offset)>840)throw Error('Invalid time-zone offset');
    const local=new Date((timestamp+offset*60)*1000),month=local.getUTCMonth()+1,hour=local.getUTCHours();
    const season=month>=3&&month<=5?1:month>=6&&month<=8?2:month>=9&&month<=11?3:4;
    const hours_type=hour>=6&&hour<17?1:hour>=17&&hour<19?2:hour>=19&&hour<24?3:4;
    // A stable three-hour weather period prevents every poll/login from rolling
    // different weather. Seasonal weights are an explicit local approximation.
    const table=season===4?[[1,40],[2,25],[6,10],[8,20],[9,5]]:season===2?[[1,50],[2,20],[3,15],[4,10],[7,5]]:[[1,50],[2,25],[3,15],[5,5],[7,5]];
    const digest=crypto.createHash('sha256').update(String(options.seed||'travel-frog-weather')+':'+Math.floor(timestamp/10800)).digest();let value=digest.readUInt32BE(0)%100,weather=1;
    for(const [id,weight]of table){value-=weight;if(value<0){weather=id;break;}}
    return {season,hours_type,weather};
  }
}
module.exports={EconomyPolicy,SLOT_TYPES};
