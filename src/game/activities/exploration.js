'use strict';
const {ActivitiesService,ActivityError}=require('./activities');
const clone=v=>JSON.parse(JSON.stringify(v)),array=v=>Array.isArray(v)?v:[],integer=(v,min=1,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
class ExploreError extends Error{}
const check=(condition,message)=>{if(!condition)throw new ExploreError(message);};
const EXPLORE_COMMANDS=['museum_load','museumday_load','museumday_refresh','museumday_random_compass','museumday_dir_compass','museumday_get_items','museumday_arrive','museumday_start_advance','museumday_load_path','museumday_info','museumday_inspire',
 'koto_load','koto_refresh','koto_random_compass','koto_dir_compass','koto_get_items','koto_arrive','koto_start_advance','koto_load_path','koto_info','lottery_load','lottery_open','lottery_select','lottery_confirm_reward'];

class ExplorationService extends ActivitiesService{
 constructor(database,catalog,options={}){super(database,catalog,options);this.handledCommands=new Set(EXPLORE_COMMANDS);this.moveSeconds=options.moveSeconds??300;this.lotterySeconds=options.lotterySeconds??3600;this.pictureFactory=options.pictureFactory;this.dailyCompasses=options.dailyCompasses??3;if(!integer(this.moveSeconds)||!integer(this.lotterySeconds)||!integer(this.dailyCompasses,0,100))throw Error('Invalid exploration options');}
 museumConfig(){return Object.values(this.config.museumData_json||{});}
 routeMuseums(){return Object.values(this.config.museumDayData_json||{});}
 path(){
  // Self-avoiding orthogonal walk on the client's 7-column / 5-row grid.
  const cells=[],seen=new Set();let grid=1+this.randomInt(35);
  for(let i=0;i<14;i++){
   cells.push({grid,type:i===0?0:1+this.randomInt(4),style:1});seen.add(grid);
   const x=(grid-1)%7,y=Math.floor((grid-1)/7),next=[];
   if(x>0)next.push(grid-1);if(x<6)next.push(grid+1);if(y>0)next.push(grid-7);if(y<4)next.push(grid+7);
   const choices=next.filter(n=>!seen.has(n));if(!choices.length)break;grid=this.choose(choices);
  }
  return cells;
 }
 exploreState(account,module,now,events=[]){
  const state=this.read(account,module,()=>{
   const raw=this.original(account,module+'_load')||{};
   return {end_time:Number(raw.end_time||0),inspire_num:Number(raw.inspire_num||0),inspire_time:Number(raw.inspire_time||0),museum_list:array(raw.museum_list),cur_museum:Number(raw.cur_museum||0),compass:Number(raw.compass||0),task_num:Number(raw.task_num||0),frog:Number(raw.frog||0),next:Number(raw.next||0),left_num:Number(raw.left_num??1),desc_id:Number(raw.desc_id||0),pic_id:Number(raw.pic_id||0),items:array(raw.items),get_items:array(raw.get_items),log_list:array(raw.log_list),path:array(raw.path),day:-1,moving_until:0,arrived:false,task_repeats:0};
  });
  if(state.end_time<=now)state.end_time=now+this.activitySeconds;
  if(state.day!==this.day(now)){state.day=this.day(now);state.compass+=this.dailyCompasses;state.task_num=0;state.left_num=Math.max(state.left_num,1);}
  const coins=this.database.getInventoryCount(account,200002);
  if(module==='museumday'&&coins>0&&this.items.has(200002)){this.itemChange(account,200002,-coins,events);state.compass+=coins;}
  return state;
 }
 exploreProtocol(state){const {day,moving_until,arrived,task_repeats,...raw}=state;return clone(raw);}
 info(state){return {compass:state.compass,task_num:state.task_num};}
 startRoute(account,module,state,id,now,events,paid){
  const routes=this.routeMuseums();check(routes.length,'探索地图配置缺失');check(!state.items.length,'请先领取上次探索的物品');
  check(!state.cur_museum||state.next<=1,'冒险开始后不能重新选择路线');
  const target=id?routes.find(x=>x.id===id):routes.find(x=>!state.museum_list.some(m=>m.id===x.id))||this.choose(routes);check(target,'博物馆不存在');
  if(paid){const fees=String(this.config.museumDayCommon_json?.restart_clover?.v1||'100,200,200').split(',').map(Number);const repeats=Math.max(0,state.museum_list.length-routes.length);this.spendClover(account,fees[Math.min(repeats,fees.length-1)],events);}
  state.cur_museum=target.id;state.path=this.path();state.path[0].type=0;state.path[0].style=0;state.frog=state.next=1;state.desc_id=state.pic_id=0;state.log_list=[];state.items=[];state.get_items=[];state.moving_until=0;state.arrived=false;
 }
 stepReward(account,module,state,now,events){
  const rewards=[10001,8002,200001].filter(id=>this.items.has(id));if(rewards.length){const id=this.choose(rewards);const existing=state.items.find(x=>x.item_id===id);if(existing)existing.num++;else state.items.push({item_id:id,num:1});state.log_list.push({time:now,desc:1,item_id:id,item_num:1});}
 }
 museumCompletion(account,module,state,now,events){
  const cfg=this.museumConfig().find(x=>x.id===state.cur_museum);state.desc_id=401;
  const ticket=1016+state.cur_museum;if(this.items.has(ticket)){const current=state.items.find(x=>x.item_id===ticket);if(current)current.num++;else state.items.push({item_id:ticket,num:1});}
  const collections=String(cfg?.collection_id||'').split(',').map(Number).filter(x=>integer(x));if(collections.length){
   const id=this.choose(collections);this.database.db.prepare('INSERT OR IGNORE INTO handbook(account,kind,item_id) VALUES (?,\'collection\',?)').run(account,id);
   events.push({cmd:'item_load_handbook',data:this.database.getHandbook(account)});
  }
  if(this.pictureFactory&&cfg){const picture=this.pictureFactory({account,module,museum_id:cfg.id,pic_ids:array(cfg.pic_id)});if(picture){check(array(cfg.pic_id).includes(picture.pic_id)&&Array.isArray(picture.layers)&&picture.layers.length,'探索图片生成结果无效');picture.id=this.database.nextPostcardId(account);this.database.addPostcard(account,picture,'new',now);state.pic_id=picture.pic_id;events.push({cmd:'album_load_new',data:{pictures:this.database.getPostcards(account,'new'),visted_pic:[],has_ads:false,is_share:false}});}}
  events.push({cmd:'museum_load',data:this.museumState(account)});
 }
 advanceRoute(account,module,state,now,events){
  let changed=false;
  while(state.cur_museum>0&&state.frog<state.next&&state.moving_until>0&&state.moving_until<=now){
   const at=state.moving_until;state.frog++;this.stepReward(account,module,state,at,events);changed=true;
   if(state.frog===state.path.length&&!state.arrived){state.arrived=true;this.museumCompletion(account,module,state,at,events);}
   state.moving_until=state.frog<state.next?at+this.moveSeconds:0;
  }
  return changed;
 }
 museumState(account){
  const original=array(this.original(account,'museum_load')?.museum_list),byId=new Map(original.map(x=>[x.id,{...clone(x),collections:array(x.collections),pic_list:array(x.pic_list)}]));
  const handbook=this.database.getHandbook(account),pictures=['album','new','recycle','gift'].flatMap(location=>this.database.getPostcards(account,location));
  for(const cfg of this.museumConfig()){
   const ticketOwned=this.database.getInventoryCount(account,1016+cfg.id)>0,completed=['museumday','koto'].some(module=>this.read(account,module,()=>({})).museum_list?.some(x=>x.id===cfg.id));
   const collectionIds=String(cfg.collection_id||'').split(',').map(Number),owned=handbook.collections.filter(id=>collectionIds.includes(id)),pic_list=[...new Set(pictures.filter(p=>array(cfg.pic_id).includes(p.pic_id)).map(p=>p.pic_id))];
   if(ticketOwned||completed||owned.length||pic_list.length){const before=byId.get(cfg.id)||{id:cfg.id,collections:[],pic_list:[]};byId.set(cfg.id,{id:cfg.id,collections:[...new Set([...before.collections,...owned])],pic_list:[...new Set([...before.pic_list,...pic_list])]});}
  }
  return {museum_list:[...byId.values()].sort((a,b)=>a.id-b.id)};
 }
 lotteryState(account,now){
  const week=Math.floor((now+28800)/604800),state=this.read(account,'lottery',()=>{
   const raw=this.original(account,'lottery_load')||{};return {last_phase:Number(raw.last_phase||0),phase:Number(raw.phase||week+1),state:Number(raw.state||0),select_list:array(raw.select_list),answer:array(raw.answer),extra_item:raw.extra_item||{item_id:0,count:0},right_flag:array(raw.right_flag),egg_num:Number(raw.egg_num||0),reward:array(raw.reward),week,opened_phase:raw.state?Number(raw.phase):0,settle_at:raw.state===2?now+this.lotterySeconds:0};
  });
  if(state.week<week&&state.state===0){state.phase+=week-state.week;state.week=week;state.select_list=[];state.answer=[];state.reward=[];state.right_flag=[];}
  if(!state.select_list.length){const choices=[...this.items.values()].filter(x=>[0,1,3].includes(x.type)).map(x=>x.id);const selected=[];while(choices.length&&selected.length<15){const value=this.choose(choices);selected.push(value);choices.splice(choices.indexOf(value),1);}state.select_list=selected;}
  if(state.state===2&&state.settle_at>0&&state.settle_at<=now){
   const who=(state.phase-1)%4,guest=(this.catalog.neighbors||[]).find(x=>x.id===who),specialties=this.catalog.specialties||[];
   state.right_flag=state.answer.map(id=>{const index=specialties.findIndex(x=>x.itemId===id);return index>=0&&guest?Number(guest.taste?.[index]||0)>=60:this.randomInt(100)<50;}).map(Number);
   const correct=state.right_flag.filter(Boolean).length;state.egg_num=correct;state.reward=[{id:200001,num:Math.max(1,correct),is_egg:0}];if(correct>=3&&this.items.has(8002))state.reward.push({id:8002,num:1,is_egg:1});state.last_phase=state.phase;state.state=3;
  }
  return state;
 }
 lotteryProtocol(state){const {week,opened_phase,settle_at,...value}=state;return clone(value);}
 initial(account){return this.database.transaction(()=>{
  const events=[],now=this.now();for(const module of ['museumday','koto']){const state=this.exploreState(account,module,now,events);this.advanceRoute(account,module,state,now,events);this.save(account,module,state);events.push({cmd:module+'_load',data:this.exploreProtocol(state)});}
  const lottery=this.lotteryState(account,now);this.save(account,'lottery',lottery);events.push({cmd:'lottery_load',data:this.lotteryProtocol(lottery)},{cmd:'museum_load',data:this.museumState(account)});return events;
 });}
 advance(account,now=this.now()){return this.database.transaction(()=>{const events=[];for(const module of ['museumday','koto']){const previous=this.read(account,module,()=>null),state=this.exploreState(account,module,now,events);this.advanceRoute(account,module,state,now,events);if(JSON.stringify(previous)!==JSON.stringify(state)){this.save(account,module,state);events.push({cmd:module+'_load',data:this.exploreProtocol(state)});}}const previous=this.read(account,'lottery',()=>null);if(previous){const state=this.lotteryState(account,now);if(state.state!==previous.state||state.phase!==previous.phase){this.save(account,'lottery',state);events.push({cmd:'lottery_load',data:this.lotteryProtocol(state)});}}return {events};});}
 handle(account,cmd,data={}){
  if(!this.handledCommands.has(cmd))return null;
  try{return this.database.transaction(()=>{
   const events=[],now=this.now();let response;
   if(cmd==='museum_load')return {response:this.museumState(account),events};
   if(cmd.startsWith('lottery_')){const state=this.lotteryState(account,now);response=this.handleLottery(account,cmd,data,state,events);this.save(account,'lottery',state);if(cmd!=='lottery_load')events.push({cmd:'lottery_load',data:this.lotteryProtocol(state)});}
   else{const module=cmd.startsWith('koto_')?'koto':'museumday',state=this.exploreState(account,module,now,events);this.advanceRoute(account,module,state,now,events);response=this.handleRoute(account,module,cmd.slice(module.length+1),data,state,events,now);this.save(account,module,state);if(!['load','load_path','info'].includes(cmd.slice(module.length+1)))events.push({cmd:module+'_load',data:this.exploreProtocol(state)},{cmd:module+'_info',data:this.info(state)});}
   return {response,events};
  });}catch(error){if(!(error instanceof ExploreError)&&!(error instanceof ActivityError))throw error;
    const module=cmd.startsWith('koto_')?'koto':'museumday';const state=this.read(account,module,()=>({next:0,inspire_num:0}));
    return {response:{code:1,left_num:-1,next:state.next,inspire:state.inspire_num,message:error.message},events:[]};}
 }
 handleRoute(account,module,action,data,state,events,now){
  if(action==='load')return this.exploreProtocol(state);
  if(action==='load_path')return {path:clone(state.path)};
  if(action==='info')return this.info(state);
  if(action==='refresh'){
   check(state.left_num>0,'没有剩余换地图次数');check(!state.cur_museum||state.next<=1,'开始冒险后不能换地图');this.startRoute(account,module,state,0,now,events,false);state.left_num--;return {code:0,left_num:state.left_num};
  }
  if(action==='start_advance'){
   check(integer(data.id)&&state.cur_museum===0,'请先完成当前冒险');this.startRoute(account,module,state,data.id,now,events,true);return {code:0};
  }
  if(action==='random_compass'||action==='dir_compass'||action==='inspire'){
   check(state.cur_museum>0&&state.path.length>1&&state.next<state.path.length,'没有可以规划的路线');
   if(action==='inspire'){check(state.inspire_num>0&&now>=state.inspire_time,'鼓舞次数不足或尚未开放');state.inspire_num--;}
   else{check(state.compass>0,'罗盘不足');state.compass--;state.task_repeats++;const every=Number(this.config.museumDayCommon_json?.inspire?.v1||8);if(state.task_repeats%every===0)state.inspire_num++;}
   let steps=action==='inspire'?3:1+this.randomInt(3);
   if(action==='dir_compass'){
    check(integer(data.dir,1,4),'方向无效');const from=state.path[state.next-1].grid,next=state.path[state.next].grid,delta=next-from,dir=delta===-7?1:delta===7?2:delta===-1?3:4;check(data.dir===dir,'该方向不通向下一路线格');steps=1;
   }
   state.next=Math.min(state.path.length,state.next+steps);if(!state.moving_until)state.moving_until=now+this.moveSeconds;
   return {code:0,next:state.next,inspire:state.inspire_num};
  }
  if(action==='get_items'){
   check(state.items.length>0,'没有待领取的探索奖励');for(const reward of state.items){if(reward.item_id===200002)state.compass+=reward.num;else this.grantItem(account,reward.item_id,reward.num,events);const old=state.get_items.find(x=>x.item_id===reward.item_id);if(old)old.num+=reward.num;else state.get_items.push(clone(reward));}state.items=[];return {code:0};
  }
  if(action==='arrive'){
   check(state.cur_museum>0&&state.arrived&&state.frog===state.path.length,'尚未到达目的地');
   if(state.items.length)this.handleRoute(account,module,'get_items',{},state,events,now);
   state.museum_list.push({id:state.cur_museum,desc_id:state.desc_id,pic_id:state.pic_id,time:now,items:clone(state.get_items)});state.cur_museum=0;state.path=[];state.frog=state.next=0;state.arrived=false;events.push({cmd:'museum_load',data:this.museumState(account)});return {code:0};
  }
  throw new ExploreError('探索操作未识别');
 }
 handleLottery(account,cmd,data,state,events){
  if(cmd==='lottery_load')return this.lotteryProtocol(state);
  if(cmd==='lottery_open'){
   check(state.state===0&&state.opened_phase!==state.phase,'本期尚不可开启或已经领取开场奖励');check(state.select_list.length>=5,'挑选活动的物品配置不足');
   state.opened_phase=state.phase;state.state=1;const item={item_id:200001,count:1};this.grantItem(account,item.item_id,item.count,events);return {code:0,open_item:item,extra_item:{item_id:0,count:0}};
  }
  if(cmd==='lottery_select'){
   check(state.state===1,'当前不能提交选择');check(Array.isArray(data.list)&&data.list.length===5&&new Set(data.list).size===5&&data.list.every(id=>state.select_list.includes(id)),'请选择五种不同的候选物品');state.answer=[...data.list];state.state=2;state.settle_at=this.now()+this.lotterySeconds;return {code:0};
  }
  if(cmd==='lottery_confirm_reward'){
   check(state.state===3,'挑选奖励尚未结算或已领取');for(const reward of state.reward)this.grantItem(account,reward.id,reward.num,events);state.state=0;state.answer=[];state.reward=[];state.right_flag=[];return {code:0};
  }
  throw new ExploreError('挑选活动操作未识别');
 }
 observe(account,cmd,data={}){
  if(!['item_set_bag_completed','guest_lock_bag','clover_harvest','clover_harvest_resend'].includes(cmd)||(cmd==='item_set_bag_completed'&&!data.completed))return {events:[]};
  return this.database.transaction(()=>{const events=[];for(const module of ['museumday','koto']){const state=this.exploreState(account,module,this.now(),events);state.task_num++;const every=Number(this.config.museumDayCommon_json?.base?.v1||8);if(state.task_num>=every){state.task_num=0;state.compass++;}this.save(account,module,state);events.push({cmd:module+'_info',data:this.info(state)});}return {events};});
 }
}
module.exports={ExplorationService,EXPLORE_COMMANDS};
