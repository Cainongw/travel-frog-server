'use strict';

const crypto=require('node:crypto');
const {ModuleState}=require('../../core/module_state');
const {FurnitureService,exportFurnitureState,importFurnitureState}=require('../furniture/furniture');
const clone=value=>JSON.parse(JSON.stringify(value));
const list=value=>Array.isArray(value)?value:[];
const seconds=()=>Math.floor(Date.now()/1000);
class ActivityError extends Error{}
function requireValue(ok,message){if(!ok)throw new ActivityError(message);}
function int(value,min=1,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(value)&&value>=min&&value<=max;}
const COMMANDS=Object.freeze([
  'animpicture_load','animpicture_guide','animpicture_get_item','animpicture_select_pic','animpicture_add_pic','animpicture_remove_pic',
  'animpicture_open_album','animpicture_album_add_pic','animpicture_album_remove_pic','animpicture_use_item',
  'capsule_load','capsule_load_coin','capsule_load_task','capsule_twist','capsule_patch','capsule_fast_task','capsule_get_coin',
  'wishingpool_load','wishingpool_wish',
]);

/** Client shapes/config are observed; durations, probabilities and reward policies
 * are explicitly local. Events must be pushed after the native session reply. */
class ActivitiesService {
  constructor(database,catalog={},options={}){
    this.database=database;this.catalog=catalog;this.config=catalog.config||{};
    this.store=options.stateStore||new ModuleState(database);
    this.now=options.now||seconds;this.randomInt=options.randomInt||crypto.randomInt;
    this.photoSeconds=options.photoSeconds??1800;this.photoExp=options.photoExp??20;
    this.itemExp=options.itemExp||{8002:40,8003:80,8004:120};
    this.activitySeconds=options.activitySeconds??2592000;
    this.wishDailyCoins=options.wishDailyCoins??1;
    this.optionsWishRewards=options.wishRewards;
    for(const value of [this.photoSeconds,this.photoExp,this.activitySeconds])if(!int(value))throw Error('Invalid activity policy');
    if(!int(this.wishDailyCoins,0,100))throw Error('Invalid daily wish coins');
    this.items=new Map((catalog.items||Object.values(this.config.Item_json||{})).map(x=>[x.id,x]));
    this.animConfig=this.config.animpictureData_json||{base_info:{album_id:9002,album_num:4,page_id:9001},list:{},pic_map:{}};
    this.capsuleConfig=this.config.capsuleData_json||{reward:{},task_list:{},num_reward:{},fast_consume:30};
    this.furniture=options.furniture||new FurnitureService(database,catalog);
    this.handledCommands=new Set(COMMANDS);
  }
  read(account,module,factory){return this.store.get(account,module,factory);}
  save(account,module,value){return this.store.set(account,module,value);}
  original(account,cmd){return this.database.getOfficialArchive(account)?.protocols?.[cmd];}
  day(now){return Math.floor((now+28800)/86400);}
  choose(rows){requireValue(rows.length>0,'没有可领取的活动奖励');const index=this.randomInt(rows.length);requireValue(int(index,0,rows.length-1),'随机结果无效');return rows[index];}
  itemChange(account,id,delta,events){
    requireValue(this.items.has(id),'活动物品不在客户端配置中');
    if(delta<0)requireValue(this.database.getInventoryCount(account,id)>=-delta,'活动物品不足');
    const count=this.database.changeInventory(account,id,delta);events.push({cmd:'item_update',data:{item:{item_id:id,count}}});return count;
  }
  grantItem(account,id,count,events){
    requireValue(int(count),'活动奖励数量无效');
    if(id===200000||id===100000){const role=this.database.getRole(account);const clover=role.res.clover_point+count;this.database.updateAccount(account,{clover});events.push({cmd:'clover_update',data:{clover}});return;}
    if(id===200001||id===100001){const role=this.database.getRole(account);const ticket=role.res.ticket+count;this.database.updateAccount(account,{ticket});events.push({cmd:'item_update_ticket',data:{ticket}});return;}
    this.itemChange(account,id,count,events);
    // Event furniture items carry the same display name as their actual furniture.
    const item=this.items.get(id),furniture=(this.catalog.furniture||[]).find(x=>x.name===item?.name);
    if(furniture){this.furniture.getState(account,this.now());let state=exportFurnitureState(this.database,account);
      if(state&&!state.owned.includes(furniture.id)){state.owned.push(furniture.id);importFurnitureState(this.database,account,state);events.push({cmd:'furniture_load_furniture',data:this.furniture.getState(account,this.now())});}
    }
  }
  spendClover(account,count,events){
    requireValue(int(count,0),'活动价格无效');const balance=this.database.getRole(account).res.clover_point;
    requireValue(balance>=count,'三叶草不足');this.database.updateAccount(account,{clover:balance-count});events.push({cmd:'clover_update',data:{clover:balance-count}});
  }
  takePicture(account,id){
    requireValue(int(id),'照片编号无效');const picture=this.database.getPostcards(account,'album',[id])[0];
    requireValue(picture,'照片不在相册中');requireValue(this.database.deletePostcard(account,id,'album'),'照片已被使用');return picture;
  }
  returnPicture(account,picture){
    requireValue(int(picture?.id)&&Array.isArray(picture.layers),'活动中的照片数据不完整');
    const existing=this.database.db.prepare('SELECT 1 FROM postcards WHERE account=? AND id=?').get(account,picture.id);
    requireValue(!existing,'照片编号发生冲突，已取消操作以保留数据');this.database.addPostcard(account,picture,'album',this.now());
  }
  albumEvent(account,events){events.push({cmd:'album_load_all',data:{id_list:this.database.getPostcards(account,'album')}});events.push({cmd:'client_load_role',data:this.database.getRole(account)});}
  animState(account,now){
    const state=this.read(account,'animpicture',()=>{
      const raw=this.original(account,'animpicture_load')||{};
      return {guide:Number(raw.guide||0),page_num:Number(raw.page_num||0),item_num:Number(raw.item_num||0),pic_list:list(raw.pic_list).map(row=>({...clone(row),exp_pic:list(row.exp_pic),pictures:list(row.pictures),next_at:now+this.photoSeconds})),last_at:now};
    });
    state.page_num=Math.max(state.page_num,state.pic_list.length,this.database.getInventoryCount(account,Number(this.animConfig.base_info.page_id||9001)));
    return state;
  }
  animProtocol(state){return {guide:state.guide,page_num:state.page_num,item_num:state.item_num,pic_list:state.pic_list.map(({next_at,source_picture,...row})=>clone(row)),making_index:Math.max(0,state.pic_list.findIndex(x=>x.phase>0)+1)};}
  animRow(state,index){requireValue(int(index,1,state.pic_list.length),'动态照片页不存在');return state.pic_list[index-1];}
  related(row,picture){return list(this.animConfig.list?.[row.id]?.pic_list).includes(picture.pic_id);}
  addAnimExp(account,state,row,amount,events){
    const cfg=this.animConfig.list?.[row.id];requireValue(cfg&&list(cfg.phase_list).length,'动态照片配置不存在');
    row.exp+=amount;
    while(row.phase>0){
      const phase=cfg.phase_list[row.phase-1];requireValue(phase,'动态照片阶段无效');
      if(phase.exp>0&&row.exp<phase.exp)break;
      if(phase.exp>0)row.exp-=phase.exp;
      row.phase++;
      const next=cfg.phase_list[row.phase-1];
      if(!next||Number(next.exp)===0){
        row.phase=0;row.exp=0;state.item_num++;
        for(const picture of row.exp_pic)this.returnPicture(account,picture);row.exp_pic=[];
        this.albumEvent(account,events);break;
      }
    }
  }
  advanceAnim(account,state,now,events){
    let changed=false;
    for(const row of state.pic_list){if(row.phase<=0||!row.exp_pic.length)continue;
      if(!int(row.next_at,0))row.next_at=now+this.photoSeconds;
      while(row.phase>0&&row.exp_pic.length&&row.next_at<=now){
        row.exp_pic.shift();row.next_at+=this.photoSeconds;this.addAnimExp(account,state,row,this.photoExp,events);changed=true;
      }
    }
    if(changed){this.save(account,'animpicture',state);events.push({cmd:'animpicture_load',data:this.animProtocol(state)});}
    return changed;
  }
  capsuleState(account,now,events=[]){
    const state=this.read(account,'capsule',()=>{
      const raw=this.original(account,'capsule_load')||{};
      return {end_time:Number(raw.end_time||0),coin:Number(raw.coin||0),pre_coin:Number(raw.pre_coin||0),reward_list:list(raw.reward_list),task_list:list(raw.task_list),patch_num:Number(raw.patch_num||0),day:-1};
    });
    // Offline recreation runs an explicit local 30-day season, not the closed
    // official event calendar. History remains inspectable until the next cycle.
    if(state.end_time<=now){state.end_time=now+this.activitySeconds;state.day=-1;state.reward_list=[];state.task_list=[];state.patch_num=0;}
    const day=this.day(now);
    if(state.day!==day){state.day=day;state.patch_num=Math.min(32,state.patch_num+2);}
    const itemCoins=this.database.getInventoryCount(account,200005);
    if(itemCoins>0&&this.items.has(200005)){this.itemChange(account,200005,-itemCoins,events);state.coin+=itemCoins;}
    return state;
  }
  capsuleProtocol(state){const {day,...value}=state;return clone(value);}
  patchCapsule(state){
    if(state.task_list.length||state.patch_num<=0)return;
    const choices=Object.values(this.capsuleConfig.task_list||{}).map(x=>x.id).filter(x=>x!==4&&int(x));
    if(!choices.length)return;
    const count=Math.min(2,state.patch_num,choices.length);
    for(let n=0;n<count;n++){
      const id=this.choose(choices);state.task_list.push(id);choices.splice(choices.indexOf(id),1);
    }
    state.patch_num-=state.task_list.length;
  }
  wishState(account,now,events=[]){
    const state=this.read(account,'wishingpool',()=>{
      const raw=this.original(account,'wishingpool_load')||{};
      return {end_time:Number(raw.end_time||0),coin:Number(raw.coin||0),items:list(raw.items),day:-1};
    });
    if(state.end_time<=now){state.end_time=now+this.activitySeconds;state.day=-1;state.items=[];}
    if(!state.items.length){
      const rewards=this.optionsWishRewards||[201005,201006,201007,8002,10001,200001];
      state.items=rewards.filter(id=>id===200001||this.items.has(id)).map(id=>({id,num:1,limit:1}));
    }
    if(state.day!==this.day(now)){state.day=this.day(now);state.coin+=this.wishDailyCoins;}
    const openers=this.database.getInventoryCount(account,200016);
    if(openers>0&&this.items.has(200016)){this.itemChange(account,200016,-openers,events);state.coin+=openers*5;}
    return state;
  }
  wishProtocol(state){return {end_time:state.end_time,coin:state.coin,items:clone(state.items)};}
  loadEvent(account,module,state,events){
    if(module==='animpicture')events.push({cmd:'animpicture_load',data:this.animProtocol(state)});
    if(module==='capsule')events.push({cmd:'capsule_load',data:this.capsuleProtocol(state)});
    if(module==='wishingpool')events.push({cmd:'wishingpool_load',data:this.wishProtocol(state)});
  }
  initial(account){return this.database.transaction(()=>{
    const now=this.now(),events=[];
    const anim=this.animState(account,now);this.advanceAnim(account,anim,now,events);this.save(account,'animpicture',anim);
    const capsule=this.capsuleState(account,now,events);this.patchCapsule(capsule);this.save(account,'capsule',capsule);
    const wish=this.wishState(account,now,events);this.save(account,'wishingpool',wish);
    this.loadEvent(account,'animpicture',anim,events);this.loadEvent(account,'capsule',capsule,events);this.loadEvent(account,'wishingpool',wish,events);
    return events;
  });}
  advance(account,now=this.now()){return this.database.transaction(()=>{const events=[],state=this.animState(account,now);this.advanceAnim(account,state,now,events);return {events};});}
  handle(account,cmd,data={}){
    if(!this.handledCommands.has(cmd))return null;
    try{return this.database.transaction(()=>{
      this.database.ensureAccount(account);const now=this.now(),events=[];let response;
      if(cmd.startsWith('animpicture_')){
        const state=this.animState(account,now);this.advanceAnim(account,state,now,events);
        response=this.handleAnim(account,cmd,data,state,events,now);this.save(account,'animpicture',state);
        // The native success callback mutates the model before these full pushes.
        if(cmd!=='animpicture_load')this.loadEvent(account,'animpicture',state,events);
      }else if(cmd.startsWith('capsule_')){
        const state=this.capsuleState(account,now,events);response=this.handleCapsule(account,cmd,data,state,events);this.save(account,'capsule',state);
        if(!['capsule_load','capsule_load_coin','capsule_load_task'].includes(cmd))this.loadEvent(account,'capsule',state,events);
      }else{
        const state=this.wishState(account,now,events);response=this.handleWish(account,cmd,state,events);this.save(account,'wishingpool',state);
        if(cmd!=='wishingpool_load')this.loadEvent(account,'wishingpool',state,events);
      }
      return {response,events};
    });}catch(error){if(!(error instanceof ActivityError))throw error;
      return {response:{code:1,phase:-1,reward_id:0,id:0,task_list:[],message:error.message},events:[]};
    }
  }
  handleAnim(account,cmd,data,state,events,now){
    if(cmd==='animpicture_load')return this.animProtocol(state);
    if(cmd==='animpicture_guide'){state.guide=Math.min(6,state.guide+1);return {code:0};}
    if(cmd==='animpicture_get_item'){
      requireValue(state.item_num>0,'没有待领取的照片存储开启物');const count=state.item_num;state.item_num=0;
      this.itemChange(account,Number(this.animConfig.base_info.album_id||9002),count,events);return {code:0};
    }
    if(cmd==='animpicture_select_pic'){
      requireValue(state.pic_list.length<state.page_num,'请先购买动态相框');requireValue(!state.pic_list.some(x=>x.phase>0),'请先完成当前动态照片');
      const picture=this.database.getPostcards(account,'album',[data.id])[0];requireValue(picture,'照片不在相册中');
      const animId=Number(this.animConfig.pic_map?.[picture.pic_id]);const cfg=this.animConfig.list?.[animId];
      requireValue(cfg,'这张照片不能制作动态照片');requireValue(!state.pic_list.some(x=>x.id===animId),'该动态照片已开始或已完成');
      const source=this.takePicture(account,data.id),row={id:animId,put_num:0,pictures:[],exp_pic:[],phase:cfg.phase_list.length<=1?0:1,exp:0,source_picture:source,next_at:now+this.photoSeconds};
      while(row.phase>0&&cfg.phase_list[row.phase-1]?.exp===0)row.phase++;
      state.pic_list.push(row);this.albumEvent(account,events);return {code:0};
    }
    const row=this.animRow(state,data.anim_index??data.index);
    if(cmd==='animpicture_add_pic'){
      requireValue(row.phase>0,'动态照片已完成');requireValue(Array.isArray(data.ids)&&data.ids.length>0&&data.ids.length<=5,'请选择 1 至 5 张照片');
      requireValue(new Set(data.ids).size===data.ids.length&&row.exp_pic.length+data.ids.length<=5,'照片重复或超过五张');
      const pictures=data.ids.map(id=>this.database.getPostcards(account,'album',[id])[0]);
      requireValue(pictures.every(p=>p&&this.related(row,p)),'只能加入同一动态场景的相册照片');
      const empty=!row.exp_pic.length;for(const id of data.ids)row.exp_pic.push(this.takePicture(account,id));
      if(empty)row.next_at=now+this.photoSeconds;this.albumEvent(account,events);return {code:0};
    }
    if(cmd==='animpicture_remove_pic'||cmd==='animpicture_album_remove_pic'){
      requireValue(typeof data.is_delete==='boolean','请指定删除或取回');const pictures=cmd==='animpicture_remove_pic'?row.exp_pic:row.pictures;
      requireValue(int(data.pic_index,1,pictures.length),'照片位置无效');const picture=pictures[data.pic_index-1];requireValue(picture?.id>0,'该位置没有照片');
      if(!data.is_delete)this.returnPicture(account,picture);
      if(cmd==='animpicture_remove_pic')pictures.splice(data.pic_index-1,1);else pictures[data.pic_index-1]={id:0,pic_id:0,layers:[]};
      this.albumEvent(account,events);return {code:0};
    }
    if(cmd==='animpicture_open_album'){
      requireValue(row.phase===0,'请先完成动态照片');requireValue(row.pictures.length<Number(this.animConfig.base_info.album_num||4),'存储位置已全部开启');
      this.itemChange(account,Number(this.animConfig.base_info.album_id||9002),-1,events);row.pictures.push({id:0,pic_id:0,layers:[]});row.put_num=row.pictures.length;return {code:0};
    }
    if(cmd==='animpicture_album_add_pic'){
      requireValue(row.phase===0,'请先完成动态照片');requireValue(int(data.pic_index,1,row.pictures.length),'照片位置尚未开启');requireValue(!row.pictures[data.pic_index-1]?.id,'请先取出该位置的照片');
      const picture=this.database.getPostcards(account,'album',[data.pic_uid])[0];requireValue(picture&&this.related(row,picture),'只能放入同一动态场景的相册照片');
      row.pictures[data.pic_index-1]=this.takePicture(account,data.pic_uid);this.albumEvent(account,events);return {code:0};
    }
    if(cmd==='animpicture_use_item'){
      requireValue(row.phase>0,'动态照片已完成');requireValue(int(this.itemExp[data.item_id]),'只能使用客户端配置的显影液');
      this.itemChange(account,data.item_id,-1,events);this.addAnimExp(account,state,row,this.itemExp[data.item_id],events);return {code:0,phase:row.phase,exp:row.exp};
    }
    throw new ActivityError('动态照片操作未识别');
  }
  handleCapsule(account,cmd,data,state,events){
    if(cmd==='capsule_load')return this.capsuleProtocol(state);
    if(cmd==='capsule_load_coin')return {coin:state.coin,pre_coin:state.pre_coin};
    if(cmd==='capsule_load_task')return {task_list:clone(state.task_list)};
    if(cmd==='capsule_patch'){this.patchCapsule(state);return {task_list:clone(state.task_list)};}
    if(cmd==='capsule_get_coin'){
      requireValue(state.pre_coin>0,'没有待领取的扭蛋币');state.coin+=state.pre_coin;state.pre_coin=0;return {code:0};
    }
    if(cmd==='capsule_fast_task'){
      requireValue(int(data.index,1,state.task_list.length),'任务不存在');
      this.spendClover(account,Number(this.capsuleConfig.fast_consume||30),events);state.task_list.splice(data.index-1,1);state.pre_coin++;
      events.push({cmd:'capsule_load_task',data:{task_list:clone(state.task_list)}});events.push({cmd:'capsule_load_coin',data:{coin:state.coin,pre_coin:state.pre_coin}});return {code:0};
    }
    if(cmd==='capsule_twist'){
      requireValue(state.reward_list.length<16,'本期扭蛋次数已用完');
      if(state.coin<=0&&this.items.has(200005)&&this.database.getInventoryCount(account,200005)>0){this.itemChange(account,200005,-1,events);state.coin++;}
      requireValue(state.coin>0,'扭蛋币不足');
      const choices=Object.values(this.capsuleConfig.reward||{}).filter(x=>int(x.reward_id)&&int(x.num)&&(this.items.has(x.id)||[200000,200001].includes(x.id))&&!state.reward_list.includes(x.reward_id));
      const reward=this.choose(choices);state.coin--;state.reward_list.push(reward.reward_id);this.grantItem(account,reward.id,reward.num,events);
      const bonus=this.capsuleConfig.num_reward?.[state.reward_list.length];if(bonus)this.grantItem(account,bonus.item_id,bonus.item_num,events);
      return {code:0,reward_id:reward.reward_id};
    }
    throw new ActivityError('扭蛋操作未识别');
  }
  handleWish(account,cmd,state,events){
    if(cmd==='wishingpool_load')return this.wishProtocol(state);
    const available=state.items.filter(x=>x.limit>0&&int(x.id)&&int(x.num));
    if(state.coin<=0&&this.items.has(200016)&&this.database.getInventoryCount(account,200016)>0){this.itemChange(account,200016,-1,events);state.coin+=5;}
    requireValue(state.coin>0,'许愿次数不足');const reward=this.choose(available);state.coin--;reward.limit--;
    this.grantItem(account,reward.id,reward.num,events);return {code:0,id:reward.id};
  }
  /** Call only after a different, successfully committed native action. */
  observe(account,cmd,data={}){
    const map={clover_harvest:1,clover_harvest_resend:1,item_putin_bag:2,item_putin_desk:2,travel_bag_to_gift:2,item_buy:3,furniture_buy_shop:3,item_set_bag_completed:5,guest_lock_bag:5,guest_serve:6,item_gacha:7,album_save_new:8};
    const task=map[cmd];if(!task||(cmd==='item_set_bag_completed'&&!data.completed))return {events:[]};
    return this.database.transaction(()=>{const events=[],before=this.read(account,'capsule',()=>null),state=this.capsuleState(account,this.now(),events);let changed=false;
      state.task_list=state.task_list.filter(id=>{if(id===task){state.pre_coin++;changed=true;return false;}return true;});
      if(changed||JSON.stringify(before)!==JSON.stringify(state)){this.save(account,'capsule',state);if(changed)events.push({cmd:'capsule_load_task',data:{task_list:clone(state.task_list)}});events.push({cmd:'capsule_load_coin',data:{coin:state.coin,pre_coin:state.pre_coin}});}
      return {events};
    });
  }
}

module.exports={ActivitiesService,COMMANDS,ActivityError};
