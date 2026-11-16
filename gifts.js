'use strict';
const crypto=require('node:crypto');
const {ModuleState}=require('./module_state');
const clone=value=>JSON.parse(JSON.stringify(value)),values=v=>Array.isArray(v)?v:Object.values(v||{});
const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
class GiftError extends Error{}
const check=(ok,message)=>{if(!ok)throw new GiftError(message);};

/** Unpacks configured gifts once, retaining the outcome in account module state. */
class GiftsService{
 constructor(database,catalog={},options={}){
  this.db=database;this.catalog=catalog;this.config=catalog.config||{};this.store=options.stateStore||new ModuleState(database);
  this.clock=options.clock||(()=>Math.floor(Date.now()/1000));this.randomInt=options.randomInt||crypto.randomInt;
  this.maxOpen=options.maxOpen??50;check(integer(this.maxOpen,1,1000),'Invalid gift batch size');
  this.items=new Map((catalog.items||values(this.config.Item_json)).map(x=>[x.id,x]));
  this.fixed=new Map(values(this.config.GiftData_json).map(row=>[row.id,row]));
  this.commands=new Set(['item_load_select_gift','item_select_gift']);
 }
 state(account){
  return this.store.get(account,'gifts',()=>{
   const original=this.db.getOfficialArchive(account)?.protocols?.item_load_select_gift||{};
   const queue=values(original.list).map((entry,i)=>{
    check(integer(entry?.num,1)&&Array.isArray(entry.items),'原始自选礼包数据不完整');
    const items=entry.items.map(reward=>{this.validateReward(reward);return clone(reward);});
    check(items.length>=entry.num,'原始自选礼包选项不足');
    return {uid:i+1,source_item:null,num:entry.num,items};
   });
   return {queue,sequence:queue.length,opened_count:0,history:[]};
  });
 }
 save(account,state){return this.store.set(account,'gifts',state);}
 protocol(state){return {list:state.queue.map(({num,items})=>({num,items:clone(items)}))};}
 validateReward(reward){check(reward&&integer(reward.item_id,0)&&integer(reward.count,1,1000000)&&(this.items.has(reward.item_id)||[100000,100001,200000,200001].includes(reward.item_id)),'礼包奖励配置无效');}
 choose(rows){check(rows.length,'礼包产物配置不可用');const n=this.randomInt(rows.length);check(integer(n,0,rows.length-1),'礼包随机结果无效');return rows[n];}
 inventory(account,id,delta,events){
  check(this.items.has(id),'礼包物品不在客户端配置中');if(delta<0)check(this.db.getInventoryCount(account,id)>=-delta,'礼包库存不足');
  const count=this.db.changeInventory(account,id,delta);events.push({cmd:'item_update',data:{item:{item_id:id,count}}});
 }
 grant(account,reward,events){
  this.validateReward(reward);const {item_id:id,count}=reward;
  if([100000,200000].includes(id)){const clover=this.db.getRole(account).res.clover_point+count;this.db.updateAccount(account,{clover});events.push({cmd:'clover_update',data:{clover}});}
  else if([100001,200001].includes(id)){const ticket=this.db.getRole(account).res.ticket+count;this.db.updateAccount(account,{ticket});events.push({cmd:'item_update_ticket',data:{ticket}});}
  else this.inventory(account,id,count,events);
 }
 pool(id){
  const all=[...this.items.values()];
  if([5101,5102].includes(id))return all.filter(x=>x.type===15&&x.sub_type===2);
  if(id===5103){const names=new Set(values(this.config.decoration_json).filter(x=>x.id>=1000).map(x=>x.name));return all.filter(x=>x.type===14&&x.sub_type===6&&(!names.size||names.has(x.name)));}
  if(id===5104)return all.filter(x=>x.type===10);
  if(id===5105)return all.filter(x=>x.type===11);
  if(id===5501)return all.filter(x=>x.type===16);
  if(id===5601)return all.filter(x=>[0,1,2,3].includes(x.type));
  if(id===5602)return all.filter(x=>[10,11].includes(x.type));
  return [];
 }
 supported(id){return this.fixed.has(id)||[5101,5102,5103,5104,5105,5501,5601,5602].includes(id);}
 // Furniture may sell all these ordinary goods; Gift rows must go through
 // this service after purchase instead of becoming unusable warehouse entries.
 supportsShopItem(id){const item=this.items.get(id);return !!item&&([0,1,2,3,7,8,9,10,11,12,13,15,16].includes(item.type)||item.type===14&&item.sub_type===6||item.type===5&&this.supported(id));}
 unpack(id){
  const fixed=this.fixed.get(id);
  if(fixed){
   check(Array.isArray(fixed.item_id)&&fixed.item_id.length>0&&Array.isArray(fixed.item_num)&&fixed.item_num.length===fixed.item_id.length,'固定礼包配置不完整');
   const rewards=fixed.item_id.map((item_id,index)=>({item_id,count:fixed.item_num[index]}));rewards.forEach(x=>this.validateReward(x));return {rewards};
  }
  const pool=this.pool(id);check(pool.length,'礼包没有可用的产物');
  if(id===5601||id===5602){const num=id===5601?2:1;check(pool.length>=num,'自选礼包的可选物品不足');return {selection:{num,items:pool.map(x=>({item_id:x.id,count:1}))}};}
  const count=id===5101?2:1,rewards=[];
  for(let n=0;n<count;n++){const item_id=this.choose(pool).id,previous=rewards.find(x=>x.item_id===item_id);if(previous)previous.count++;else rewards.push({item_id,count:1});}
  return {rewards};
 }
 process(account,state,events){
  let opened=0,queueChanged=false;
  const inventory=this.db.getItemState(account).house.filter(row=>this.items.get(row.item_id)?.type===5&&this.supported(row.item_id));
  for(const row of inventory){
   for(let count=0;count<row.count&&opened<this.maxOpen;count++){
    // Resolve and validate the complete outcome before reserving the gift.
    const outcome=this.unpack(row.item_id);this.inventory(account,row.item_id,-1,events);
    const uid=++state.sequence;state.opened_count++;opened++;
    if(outcome.selection){state.queue.push({uid,source_item:row.item_id,...outcome.selection});queueChanged=true;}
    else{for(const reward of outcome.rewards)this.grant(account,reward,events);events.push({cmd:'item_gift_open',data:{items:clone(outcome.rewards)}});}
    state.history.push({uid,source_item:row.item_id,at:this.clock(),rewards:clone(outcome.rewards||[]),selection:!!outcome.selection});state.history=state.history.slice(-200);
   }
   if(opened>=this.maxOpen)break;
  }
  if(queueChanged)events.push({cmd:'item_load_select_gift',data:this.protocol(state)});
  return opened;
 }
 initial(account){return this.db.transaction(()=>{this.db.ensureAccount(account);const state=this.state(account),events=[];this.process(account,state,events);this.save(account,state);return [...events.filter(e=>e.cmd!=='item_load_select_gift'),{cmd:'item_load_select_gift',data:this.protocol(state)}];});}
 advance(account){return this.db.transaction(()=>{this.db.ensureAccount(account);const state=this.state(account),events=[];const opened=this.process(account,state,events);this.save(account,state);return {changed:opened>0,events};});}
 handle(account,cmd,data={}){
  if(!this.commands.has(cmd))return null;
  try{return this.db.transaction(()=>{
   this.db.ensureAccount(account);const state=this.state(account),events=[];this.process(account,state,events);
   if(cmd==='item_load_select_gift'){this.save(account,state);return {response:this.protocol(state),events};}
   const selection=state.queue[0];check(selection,'没有待领取的自选礼包');const indices=data.index_list;
   check(Array.isArray(indices)&&indices.length===selection.num&&new Set(indices).size===indices.length&&indices.every(i=>integer(i,1,selection.items.length)),'请选择规定数量的不同物品');
   const rewards=indices.map(i=>clone(selection.items[i-1]));for(const reward of rewards)this.grant(account,reward,events);
   state.queue.shift();const record=state.history.find(x=>x.uid===selection.uid);if(record){record.rewards=clone(rewards);record.claimed_at=this.clock();}this.save(account,state);
   events.push({cmd:'item_load_select_gift',data:this.protocol(state)});return {response:{code:0,items:rewards},events};
  });}catch(error){if(!(error instanceof GiftError))throw error;
   // The client shifts its head before it receives a response. Re-push the
   // authoritative queue on failure so a rejected choice never hides a gift.
   return {response:{code:1,items:[],message:error.message},events:[{cmd:'item_load_select_gift',data:this.protocol(this.state(account))}]};
  }
 }
}
module.exports={GiftsService};
