'use strict';

const crypto=require('node:crypto');
const {ActivitiesService,ActivityError}=require('./activities');
const clone=v=>JSON.parse(JSON.stringify(v)),array=v=>Array.isArray(v)?v:[];
const integer=(v,min=1,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
class CardError extends Error{}
function check(condition,message){if(!condition)throw new CardError(message);}
const CARD_COMMANDS=['greetcard_load','greetcard_load_count','greetcard_buy','greetcard_change_bg','greetcard_change_bless','greetcard_put_tags','greetcard_send','greetcard_get_reward','greetcard_get_task_item','greetcard_get_task_reward','greetcard_send_gift','greetcard_feedback_gift','greetcard_read_new','greetcard_stock',
 'springcard_load','springcard_load_count','springcard_buy','springcard_change_bg','springcard_change_bless','springcard_put_tags','springcard_send','springcard_get_reward','springcard_get_task_item','springcard_get_task_reward','springcard_share_tags','springcard_get_share_tags',
 'partycake_load','partycake_load_mate','partycake_load_task','partycake_load_qa','partycake_get_mate','partycake_make','partycake_reward_make','partycake_answer','partycake_reward_qa','partycake_light','partycake_reward_light','partycake_reward_share'];

class CardsService extends ActivitiesService{
 constructor(database,catalog,options={}){
  super(database,catalog,options);this.handledCommands=new Set(CARD_COMMANDS);
  this.cardConfigs={greetcard:this.config.greetCard_json||{},springcard:this.config.springCard_json||{}};
  this.cakeConfig=this.config.PartyCakeData_json||{cake:{},task_list:{}};
  this.cardReplySeconds=options.cardReplySeconds??3600;
  this.springRewardIds=options.springRewardIds||[200001,8002,10001];
 }
 weighted(rows,key){const choices=rows.filter(x=>Number(x[key]??1)>0),total=choices.reduce((n,x)=>n+Number(x[key]??1),0);check(integer(total),'没有配置可用的贴纸');let roll=this.randomInt(total);for(const row of choices){roll-=Number(row[key]??1);if(roll<0)return row;}throw new CardError('贴纸随机结果无效');}
 cardItem(state,id){return state.items.find(x=>x.item_id===id)?.num||0;}
 changeCardItem(state,id,delta){let row=state.items.find(x=>x.item_id===id);check(delta>=0||this.cardItem(state,id)>=-delta,'贺卡材料不足');if(!row){row={item_id:id,num:0};state.items.push(row);}row.num+=delta;}
 freshCard(){return {bg:0,bless:0,tags:[0,0,0]};}
 cardState(account,module,now){
  const state=this.read(account,module,()=>{
   const raw=this.original(account,module+'_load')||{};
   return {end_time:Number(raw.end_time||0),card_info:{...this.freshCard(),...raw.card_info,tags:[...array(raw.card_info?.tags),0,0,0].slice(0,3)},items:array(raw.items),task_item:array(raw.task_item),
    send_list:array(raw.send_list),get_list:array(raw.get_list),stock_num:Number(raw.stock_num||0),task_login:!!raw.task_login,task_share:!!raw.task_share,new_index:Number(raw.new_index||0),can_reward:!!raw.can_reward,
    global_num:Number(this.original(account,module+'_load_count')?.count||0),task_harvest:Number(raw.task_harvest||0),buy_num:Number(raw.buy_num||0),can_buy_num:Number(raw.can_buy_num||0),share_num:Number(raw.share_num||0),share_get:Number(raw.share_get||0),box_id:Number(raw.box_id||0),share_code:raw.share_code||'',reward_list:array(raw.reward_list),day:-1,pending_replies:[],share_codes:[]};
  });
  if(state.end_time<=now)state.end_time=now+this.activitySeconds;
  const cfg=this.cardConfigs[module],tags=array(cfg.tags);
  if(state.day!==this.day(now)){
   state.day=this.day(now);state.task_login=true;state.task_share=false;state.task_harvest=0;state.buy_num=0;state.can_buy_num=3;state.share_get=0;state.share_num=0;
   // A daily login supplies one sticker of each of three distinct types so
   // the isolated/offline activity can always be completed without sharing.
   const types=[...new Set(tags.map(x=>x.type))];
   for(const type of types.slice(0,3))state.task_item.push(this.weighted(tags.filter(x=>x.type===type),'task_weight').id);
  }
  return state;
 }
 cardProtocol(state,module){
  const common={end_time:state.end_time,card_info:clone(state.card_info),items:clone(state.items),task_item:[...state.task_item],global_num:state.global_num};
  return module==='greetcard'?{...common,send_list:clone(state.send_list),get_list:clone(state.get_list),stock_num:state.stock_num,task_login:state.task_login,task_share:state.task_share,new_index:state.new_index,can_reward:state.can_reward}:
   {...common,task_harvest:state.task_harvest,buy_num:state.buy_num,can_buy_num:state.can_buy_num,share_num:state.share_num,share_get:state.share_get,box_id:state.box_id,share_code:state.share_code,reward_list:clone(state.reward_list)};
 }
 cardTask(state,module){return module==='greetcard'?{list:[...state.task_item]}:{list:[...state.task_item],task_harvest:state.task_harvest,share_num:state.share_num};}
 cardEvents(module,state,events){events.push({cmd:module+'_load',data:this.cardProtocol(state,module)});events.push({cmd:module==='greetcard'?'greetcard_get_task_item':'springcard_load_task_item',data:this.cardTask(state,module)});}
 advanceCardReplies(account,state,now,events){
  const ready=state.pending_replies.filter(x=>x.at<=now);if(!ready.length)return false;
  state.pending_replies=state.pending_replies.filter(x=>x.at>now);
  for(const reply of ready){
   if(reply.kind==='card'){state.get_list.push({...clone(reply.card),name:'远方的小伙伴',id:1000,gift:0});state.new_index=state.get_list.length;}
   if(reply.kind==='gift'){
    const id=Math.max(now*1000,Number(this.database.db.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM mails WHERE account=?').get(account).id));
    this.database.db.prepare(`INSERT INTO mails(account,id,type,sender,timestamp,title,message,resource_json,items_json,pictures_json) VALUES (?,?,14,0,?,'小伙伴的回礼','谢谢你随贺卡寄来的礼物！',?,'[]','[]')`).run(account,id,now,JSON.stringify({clover_point:30,ticket:0}));
    state.feedback_mails||=[];state.feedback_mails.push(id);events.push({cmd:'notify_new_mail',data:{mail:this.database.getMail(account,id)}});
   }
  }
  return true;
 }
 cakeState(account,now){
  const state=this.read(account,'partycake',()=>{
   const raw=this.original(account,'partycake_load')||{},qa=this.original(account,'partycake_load_qa')||{};
   return {end_time:Number(raw.end_time||0),cream:Number(raw.cream||0),sugar:Number(raw.sugar||0),pre_cream:Number(raw.pre_cream||0),pre_sugar:Number(raw.pre_sugar||0),cur_state:Number(raw.cur_state||0),part:Number(raw.part||1),layers:array(raw.layers),task_list:array(raw.task_list),share_get:array(raw.share_get).length?raw.share_get:[0,0],guest:Number(qa.guest||0),wrong:Number(qa.wrong||0),answer:array(qa.answer),reward:array(qa.reward),day:-1,answer_index:0,pending_layer:0};
  });
  if(state.end_time<=now)state.end_time=now+this.activitySeconds;
  if(state.day!==this.day(now)){state.day=this.day(now);state.task_list=Object.entries(this.cakeConfig.task_list||{}).map(([id])=>({id:Number(id),is_done:0,count:0}));}
  return state;
 }
 cakeProtocol(state){const {day,answer_index,pending_layer,...data}=state;return clone(data);}
 cakeQA(state){return {guest:state.guest,wrong:state.wrong,answer:[...state.answer],reward:clone(state.reward)};}
 nextCakePart(state){const current=this.cakeConfig.cake?.[state.part];if(current&&state.layers.length>=Object.keys(current.layers||{}).length){state.part++;state.layers=[];}state.cur_state=this.cakeConfig.cake?.[state.part]?0:4;}
 createQuestion(state){
  const guests=this.catalog.neighbors||[],specialties=this.catalog.specialties||[],choices=[...this.items.values()].filter(x=>x.type===3&&specialties.some(s=>s.itemId===x.id));
  check(choices.length>=3,'答题需要至少三种已知特产');state.guest=guests.length?this.choose(guests).id:0;
  const selected=[];while(selected.length<3){const remaining=choices.filter(x=>!selected.includes(x));selected.push(this.choose(remaining));}
  const taste=id=>{const i=specialties.findIndex(x=>x.itemId===id);return Number(guests.find(x=>x.id===state.guest)?.taste?.[i]||0);};
  state.answer=selected.map(x=>x.id);state.answer_index=state.answer.reduce((best,id,index)=>taste(id)>taste(state.answer[best])?index:best,0)+1;state.wrong=0;state.reward=[];state.cur_state=2;
 }
 initial(account){return this.database.transaction(()=>{
  const now=this.now(),events=[];
  for(const module of ['greetcard','springcard']){const state=this.cardState(account,module,now);if(module==='greetcard')this.advanceCardReplies(account,state,now,events);this.save(account,module,state);this.cardEvents(module,state,events);}
  const cake=this.cakeState(account,now);this.save(account,'partycake',cake);events.push({cmd:'partycake_load',data:this.cakeProtocol(cake)},{cmd:'partycake_load_qa',data:this.cakeQA(cake)});return events;
 });}
 advance(account,now=this.now()){return this.database.transaction(()=>{const events=[],state=this.cardState(account,'greetcard',now);if(this.advanceCardReplies(account,state,now,events)){this.save(account,'greetcard',state);this.cardEvents('greetcard',state,events);}return {events};});}
 handle(account,cmd,data={}){
  if(!this.handledCommands.has(cmd))return null;
  try{return this.database.transaction(()=>{
   const now=this.now(),events=[];let response;
   if(cmd.startsWith('partycake_')){const state=this.cakeState(account,now);response=this.handleCake(account,cmd,data,state,events);this.save(account,'partycake',state);if(!cmd.startsWith('partycake_load'))events.push({cmd:'partycake_load',data:this.cakeProtocol(state)},{cmd:'partycake_load_qa',data:this.cakeQA(state)});}
   else{const module=cmd.startsWith('springcard_')?'springcard':'greetcard',state=this.cardState(account,module,now);if(module==='greetcard')this.advanceCardReplies(account,state,now,events);response=this.handleCard(account,module,cmd.slice(module.length+1),data,state,events,now);this.save(account,module,state);if(!['load','load_count','get_task_item'].includes(cmd.slice(module.length+1)))this.cardEvents(module,state,events);}
   return {response,events};
  });}catch(error){if(!(error instanceof CardError)&&!(error instanceof ActivityError))throw error;
   // Cake callbacks use state equality rather than code for failure; -1 would
   // make the native client deduct ingredients and enter an invalid state.
   const cakeState=cmd.startsWith('partycake_')?this.cakeState(account,this.now()).cur_state:-1;
   return {response:{code:1,state:cakeState,id:0,num:0,box_id:0,tags_id:0,list:[],message:error.message},events:[]};
  }
 }
 handleCard(account,module,action,data,state,events,now){
  const cfg=this.cardConfigs[module],spring=module==='springcard',background=id=>array(cfg.bg_list).find(x=>x.id===id),tag=id=>array(cfg.tags).find(x=>x.id===id);
  if(action==='load')return this.cardProtocol(state,module);
  if(action==='load_count')return {count:state.global_num};
  if(action==='get_task_item')return this.cardTask(state,module);
  if(action==='get_task_reward'){check(state.task_item.length>0,'没有待领取的贴纸');for(const id of state.task_item)this.changeCardItem(state,id,1);state.task_item=[];return {code:0};}
  if(action==='buy'){
   if(spring){check(state.buy_num<state.can_buy_num,'今日贴纸购买次数已用完');this.spendClover(account,Number(cfg.tags_price||20),events);const selected=this.weighted(array(cfg.tags),'buy_weight');state.buy_num++;this.changeCardItem(state,selected.id,1);return {code:0,tags_id:selected.id};}
   check(background(data.id)||tag(data.id),'未知贺卡商品');
   if(background(data.id))check(!state.items.some(x=>x.item_id===data.id),'本轮已经购买过该背景');
   const price=background(data.id)?cfg.bg_price?.[state.stock_num]:cfg.tags_price;check(integer(price,0),'贺卡价格未配置');this.spendClover(account,price,events);this.changeCardItem(state,data.id,1);return {code:0};
  }
  if(action==='change_bg'){
   check(background(data.id),'背景不存在');if(state.card_info.bg===data.id)return {code:0};
   if(!spring){this.changeCardItem(state,data.id,-1);if(state.card_info.bg>0)this.changeCardItem(state,state.card_info.bg,1);}state.card_info.bg=data.id;return {code:0};
  }
  if(action==='change_bless'){check(array(cfg.bless).some(x=>x.id===data.id),'祝福语不存在');state.card_info.bless=data.id;return {code:0};}
  if(action==='put_tags'){
   check(integer(data.pos,1,3)&&tag(data.id),'贴纸或位置无效');const slot=data.pos-1,previous=state.card_info.tags[slot];if(previous===data.id)return {code:0};
   check(!state.card_info.tags.some((id,index)=>index!==slot&&id>0&&tag(id)?.type===tag(data.id).type),'同一贺卡不能放相同类别的贴纸');
   this.changeCardItem(state,data.id,-1);if(previous>0)this.changeCardItem(state,previous,1);state.card_info.tags[slot]=data.id;return {code:0};
  }
  if(action==='send'){
   check(background(state.card_info.bg)&&state.card_info.tags.every(id=>tag(id)),'请先选择背景并放入三种贴纸');
   check(new Set(state.card_info.tags.map(id=>tag(id).type)).size===3,'请放入三种不同类别的贴纸');
   check(spring?!state.box_id:!state.can_reward,'请先领取上一张贺卡的奖励');
   const card=clone(state.card_info);state.send_list.push(card);state.card_info=this.freshCard();state.global_num++;
   if(spring){state.box_id=card.tags.every(id=>Number(tag(id).buy_weight||100)<100)?Number(cfg.big_box_id||200010):Number(cfg.small_box_id||200009);return {code:0,box_id:state.box_id};}
   state.can_reward=true;state.pending_replies.push({kind:'card',at:now+this.cardReplySeconds,card});return {code:0};
  }
  if(action==='get_reward'){
   if(spring){check(state.box_id>0,'没有待开启的新春礼盒');const ids=this.springRewardIds.filter(id=>this.items.has(id));check(ids.length,'礼盒奖励未配置');const id=this.choose(ids);this.grantItem(account,id,1,events);state.box_id=0;state.reward_list.push({item_id:id,num:1});return {code:0,id,num:1};}
   check(state.can_reward,'没有待领取的贺卡奖励');check(array(cfg.send_reward?.select_list).includes(data.id),'请选择客户端配置的奖励');const randoms=array(cfg.send_reward?.random_list).filter(id=>this.items.has(id));check(this.items.has(data.id)&&randoms.length,'贺卡奖励配置缺失');const rewards=[data.id,this.choose(randoms)];for(const id of rewards)this.grantItem(account,id,1,events);state.can_reward=false;return {code:0,list:rewards};
  }
  if(action==='stock'&&!spring){
   check(!state.card_info.bg&&state.stock_num<array(cfg.bg_price).length-1,'无法补货');check(array(cfg.bg_list).length>0&&array(cfg.bg_list).every(x=>state.items.some(i=>i.item_id===x.id&&i.num===0)),'需要用完本轮所有背景');state.stock_num++;state.items=state.items.filter(x=>x.item_id>=100);return {code:0};
  }
  if(action==='read_new'&&!spring){state.new_index=0;return {code:0};}
  if(action==='send_gift'&&!spring){
   check(integer(data.index,1,state.get_list.length),'收到的贺卡不存在');const card=state.get_list[data.index-1];check(!card.gift,'已经为这张贺卡赠礼');check(this.items.get(data.gift)?.type===3,'只能赠送持有的特产');this.itemChange(account,data.gift,-1,events);card.gift=data.gift;state.pending_replies.push({kind:'gift',at:now+this.cardReplySeconds});return {code:0};
  }
  if(action==='feedback_gift'&&!spring){check(array(state.feedback_mails).includes(data.id),'回礼邮件不存在');state.thanked||=[];if(!state.thanked.includes(data.id))state.thanked.push(data.id);return {code:0};}
  if(action==='share_tags'&&spring){
   check(state.share_num<Number(cfg.tags_share_limit||3),'今日赠送贴纸次数已用完');check(tag(data.tags_id),'贴纸不存在');this.changeCardItem(state,data.tags_id,-1);
   const code=crypto.randomBytes(9).toString('base64url');state.share_num++;state.share_code=code;state.share_codes.push({code,tags_id:data.tags_id,expires:now+86400,claimed_by:null});return {code:0,share_code:code};
  }
  if(action==='get_share_tags'&&spring){
   check(typeof data.share_code==='string'&&data.share_code.length>=8&&data.share_code.length<=64,'贴纸交换码无效');check(state.share_get<Number(cfg.tags_share_limit||3),'今日交换次数已用完');
   const rows=this.database.db.prepare("SELECT account,state_json FROM game_module_state WHERE module='springcard'").all();let owner,entry,other;
   for(const row of rows){const value=JSON.parse(row.state_json),found=array(value.share_codes).find(x=>x.code===data.share_code);if(found){owner=row.account;entry=found;other=value;break;}}
   check(entry&&owner!==account&&!entry.claimed_by&&entry.expires>now,'交换码无效、过期或已使用，不能领取自己的贴纸');
   entry.claimed_by=account;this.save(owner,'springcard',other);state.share_get++;this.changeCardItem(state,entry.tags_id,1);return {code:0,tags_id:entry.tags_id};
  }
  throw new CardError('贺卡操作未识别');
 }
 handleCake(account,cmd,data,state,events){
  const C={making:0,make_reward:1,qa:2,qa_reward:3,light:4,light_reward:5,complete:6};
  if(cmd==='partycake_load')return this.cakeProtocol(state);
  if(cmd==='partycake_load_mate')return {pre_cream:state.pre_cream,pre_sugar:state.pre_sugar};
  if(cmd==='partycake_load_task')return {tasks:clone(state.task_list),task:clone(state.task_list[0]||{id:1,is_done:0,count:0})};
  if(cmd==='partycake_load_qa')return this.cakeQA(state);
  if(cmd==='partycake_get_mate'){check(state.pre_cream>0||state.pre_sugar>0,'没有待领取的蛋糕材料');state.cream+=state.pre_cream;state.sugar+=state.pre_sugar;state.pre_cream=state.pre_sugar=0;return {code:0};}
  if(cmd==='partycake_make'){
   check(state.cur_state===C.making,'请先完成当前步骤');const part=this.cakeConfig.cake?.[state.part],layer=part?.layers?.[data.layer];check(layer&&integer(data.layer),'蛋糕部位不存在');check(this.now()>=Number(part.time||0),'该部位尚未开放');check(!state.layers.includes(data.layer),'该部位已制作');check(state.cream>=layer.cream&&state.sugar>=layer.sugar,'蛋糕材料不足');
   state.cream-=layer.cream;state.sugar-=layer.sugar;state.layers.push(data.layer);state.pending_layer=data.layer;state.cur_state=C.make_reward;return {code:0,state:state.cur_state};
  }
  if(cmd==='partycake_reward_make'){
   check(state.cur_state===C.make_reward,'没有待领取的制作奖励');const part=this.cakeConfig.cake?.[state.part],layer=part?.layers?.[state.pending_layer||state.layers.at(-1)];check(layer,'制作奖励不存在');this.grantItem(account,layer.item_id,layer.item_num,events);state.pending_layer=0;
   if(state.layers.length>=Object.keys(part.layers).length)this.createQuestion(state);else state.cur_state=C.making;return {code:0,state:state.cur_state};
  }
  if(cmd==='partycake_answer'){
   check(state.cur_state===C.qa&&integer(data.index,1,3),'当前不能回答');
   if(!state.answer_index)this.createQuestion(state);
   const correct=data.index===state.answer_index;state.wrong+=Number(!correct);
   if(correct||state.wrong>=2){state.cur_state=C.qa_reward;state.reward=[{item_id:200001,count:1}];if(correct)state.reward.push({item_id:10001,count:1});}
   events.push({cmd:'partycake_load_qa',data:this.cakeQA(state)});return {code:0,state:state.cur_state};
  }
  if(cmd==='partycake_reward_qa'){check(state.cur_state===C.qa_reward,'没有待领取的答题奖励');for(const reward of state.reward)this.grantItem(account,reward.item_id,reward.count,events);this.nextCakePart(state);return {code:0,state:state.cur_state};}
  if(cmd==='partycake_light'){check(state.cur_state===C.light,'请先制作全部蛋糕部位');state.cur_state=C.light_reward;return {code:0,state:state.cur_state};}
  if(cmd==='partycake_reward_light'){check(state.cur_state===C.light_reward,'蜡烛奖励不可领取');const reward=this.cakeConfig.light_reward;check(reward,'缺少蜡烛奖励配置');this.grantItem(account,reward.item_id,reward.item_num,events);state.cur_state=C.complete;return {code:0,state:state.cur_state};}
  if(cmd==='partycake_reward_share')throw new CardError('分享平台未接入，不发放无法验证的分享奖励');
  throw new CardError('蛋糕操作未识别');
 }
 observe(account,cmd,data={}){return this.database.transaction(()=>{
  const events=[],now=this.now();
  if(['clover_harvest','clover_harvest_resend'].includes(cmd)){
   const spring=this.cardState(account,'springcard',now),cfg=this.cardConfigs.springcard;spring.task_harvest++;
   if(spring.task_harvest<=3&&array(cfg.tags).length)spring.task_item.push(this.weighted(array(cfg.tags),'task_weight').id);
   this.save(account,'springcard',spring);events.push({cmd:'springcard_load_task_item',data:this.cardTask(spring,'springcard')});
  }
  const map={hall_login:1,item_buy:2,furniture_buy_shop:2,item_gacha:3,item_set_bag_completed:6,guest_lock_bag:6},id=map[cmd];if(!id||(cmd==='item_set_bag_completed'&&!data.completed))return {events};
  const cake=this.cakeState(account,now),task=cake.task_list.find(x=>x.id===id),cfg=this.cakeConfig.task_list?.[id];
  if(task&&cfg&&!task.is_done){task.count=Math.min(Number(cfg.total),task.count+1);if(task.count>=Number(cfg.total)){task.is_done=1;cake.pre_cream+=Number(cfg.cream||0);cake.pre_sugar+=Number(cfg.sugar||0);}this.save(account,'partycake',cake);events.push({cmd:'partycake_load_task',data:{task:clone(task)}},{cmd:'partycake_load_mate',data:{pre_cream:cake.pre_cream,pre_sugar:cake.pre_sugar}});}
  return {events};
 });}
}

module.exports={CardsService,CARD_COMMANDS};
