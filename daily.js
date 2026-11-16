'use strict';
const {ModuleState}=require('./module_state');
const {SHOP_ITEMS}=require('./game_data');
const values=v=>Array.isArray(v)?v:Object.values(v||{}),clone=v=>JSON.parse(JSON.stringify(v));
const MOTIONS={0:'dokusyo_ie',1:'inemuri_ie',2:'LW_writing',3:'sagyou_ie',4:'syokuzi_ie',5:'saw',6:'brush',7:'knock',8:'knit',9:'cut',10:'sleep_1',11:'sleep_2',12:'sleep_3',13:'sleep_4'};
const EGGS={zongzi:4,egg_1_dress:1,egg_2_eat:2,egg_3_cook:3,egg_5_chixigua:5,egg_6_jiaoshui:6,egg_7_linyu:7,egg_101_rain_dd:101,egg_102_rain_tt:102,egg_103_rain_kk:103,egg_104_rain_pp:104};
class DailyService{
  constructor(database,catalog={},options={}){
    this.db=database;this.storage=new ModuleState(database);this.config=catalog.config||{};this.items=new Map((catalog.items||values(this.config.Item_json)).map(x=>[x.id,x]));this.tasks=values(this.config.taskData_json?.task_list);this.guides=values(this.config.taskData_json?.list_map);this.groups=this.config.taskData_json?.list_type||{};this.notes=values(this.config.calendarData_json?.note).filter(x=>Number.isSafeInteger(x.id));this.beginner=this.config.calendarData_json?.beginner||{};this.moments=values(this.config.momentData_json?.list);this.clock=options.clock||(()=>Math.floor(Date.now()/1000));
    this.commands=new Set(['calendar_load','calendar_load_note','calendar_task_update','calendar_get_beginer_reward','calendar_get_code_reward','calendar_get_st_reward','calendar_get_luck_reward','task_load','task_load_list','task_get_reward','task_get_list_reward','task_client_pro','annual_load','annual_share','other_load_touch','other_req_touch','misc_moment_load','misc_moment_unlock']);
  }
  date(now=this.clock()){const d=new Date((now+28800)*1000);return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),key:d.getUTCFullYear()+'-'+(d.getUTCMonth()+1),dayKey:Math.floor((now+28800)/86400),days:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()};}
  defaultCalendar(account,date){
    const foods=values(this.config.cookingData_json),food=foods.find(x=>x.month===date.month+12)||foods.find(x=>x.month===date.month),pool=[...this.items.values()].filter(x=>[0,1,3,10,11].includes(x.type));
    let seed=0;for(const char of account+date.key)seed=(seed*31+char.charCodeAt(0))>>>0;
    const days=[5+seed%7,20+seed%Math.max(1,date.days-20)],lucky=days.map((day,index)=>({day,item_id:pool.length?pool[(seed+index)%pool.length].id:0})).filter(x=>this.items.has(x.item_id));
    const notes=Array.from({length:date.days},(_,index)=>this.notes.length?this.notes[(seed+index)%this.notes.length].id:0);
    return {month_key:date.key,new_flag:Array(7).fill(0),lucky_days:lucky,st_days:food&&this.items.has(food.item_id)?[{day:22,item_id:food.item_id}]:[],task_list:[{id:1,pro:1,complete:true},{id:2,pro:0,complete:false},{id:3,pro:0,complete:false}],note_list:notes,claimed:[],clover:0,redeem:0};
  }
  state(account){this.db.ensureAccount(account);return this.storage.get(account,'daily',()=>{
    const raw=this.db.getOfficialArchive(account)?.protocols||{},cal=raw.calendar_load,defaults=this.defaultCalendar(account,this.date()),tasks=raw.task_load||{},annual=raw.annual_load||{};
    if(cal){defaults.new_flag=Array.from({length:7},(_,i)=>Number(cal.new_flag?.[i])||0);defaults.lucky_days=values(cal.lucky_days);defaults.st_days=values(cal.st_days);defaults.task_list=values(cal.task_list).length===3?clone(values(cal.task_list)):defaults.task_list;defaults.task_list[0]={id:1,pro:1,complete:true};defaults.note_list=values(raw.calendar_load_note?.list).length?values(raw.calendar_load_note.list):defaults.note_list;}
    return {calendar:defaults,tasks:values(tasks.tasks),guides:values(tasks.list),list_rewards:values(raw.task_load_list?.reward),flags:{annual_seen:!!annual.is_share},counters:{clover:0,feed:0,travel:0,return:0,photo:0,redeem:0},annual:clone(annual),login_days:[],touch:{cur:Number(raw.other_load_touch?.cur)||0,list:values(raw.other_load_touch?.list)},observed:this.metrics(account)};
  });}
  save(account,state){return this.storage.set(account,'daily',state);}
  metrics(account){const row=this.db.ensureAccount(account),items=this.db.getItemState(account),handbook=this.db.getHandbook(account),creative=this.storage.get(account,'creative',()=>({})),life=this.storage.get(account,'life',()=>({})),furniture=this.db.db.prepare('SELECT state_json FROM furniture_state WHERE account=?').get(account),room=furniture?JSON.parse(furniture.state_json):null;return {clover:row.clover,ticket:row.ticket,trips:row.trip_count||0,returnCount:Math.max(0,(row.trip_count||0)-(this.db.getTravelState(account)?1:0)),pictures:this.db.db.prepare('SELECT count(*) AS n FROM postcards WHERE account=?').get(account).n,notes:this.db.getTravelNotes(account).length,friendNotes:this.db.getTravelNotes(account).filter(note=>values(this.config.Note_json).some(x=>x.id===note.id&&x.type===2)).length,stories:this.db.getStories(account).length,collections:handbook.collections.length,specialties:handbook.specialtys.length,foods:items.house.filter(x=>this.items.get(x.item_id)?.type===3).reduce((n,x)=>n+x.count,0),materials:items.house.filter(x=>[10,11].includes(this.items.get(x.item_id)?.type)).reduce((n,x)=>n+x.count,0),tools:items.house.filter(x=>this.items.get(x.item_id)?.type===12).length,purchases:this.db.getShopPurchases(account).reduce((n,x)=>n+x.count,0),furniture:(room?.owned||[]).filter(id=>!values(this.config.furnitureData_json).some(x=>x.id===id&&x.style===1)).length,owned:room?.owned||[],placed:room?.placed||[],drawing:creative.drawing||{},wishs:creative.pray?.wishs||[],stamps:creative.pray?.stamps||[],tumbler:creative.tumbler?.tumbler_list||[],compost:creative.compost?.compost_list||[],cooking:life.cooking||{},gacha:items.gacha?.color_ball??-1};}
  changes(){return {items:[],events:[]};}
  calendarData(state){const {new_flag,lucky_days,st_days,task_list}=state.calendar;return clone({new_flag,lucky_days,st_days,task_list});}
  taskData(state){return {tasks:clone(state.tasks),list:clone(state.guides)};}
  touchData(account,state){const list=new Set([0,...state.touch.list]);for(const row of [...this.items.values()].filter(x=>x.id>=205001&&x.id<=205008))if(this.db.getInventoryCount(account,row.id)>0)list.add(row.id-205000);return {cur:state.touch.cur,list:[...list].sort((a,b)=>a-b)};}
  annualData(account,state){const metric=this.metrics(account),raw=state.annual,creative=metric.drawing;return {...raw,theme:raw.theme||2,is_share:!!state.flags.annual_seen,create_time:this.db.ensureAccount(account).created_at,travel_num:Math.max(raw.travel_num||0,metric.trips),pic_num:Math.max(raw.pic_num||0,metric.pictures),story_num:Math.max(raw.story_num||0,metric.stories),note_num:Math.max(raw.note_num||0,metric.notes),col_num:Math.max(raw.col_num||0,metric.collections),spe_num:Math.max(raw.spe_num||0,metric.specialties),fur_num:Math.max(raw.fur_num||0,metric.furniture),wish_num:Math.max(raw.wish_num||0,metric.wishs.length),stamp_num:Math.max(raw.stamp_num||0,metric.stamps.length),roll_num:Math.max(raw.roll_num||0,state.counters.redeem),login_day:Math.max(raw.login_day||0,state.login_days.length),visit_num:Math.max(raw.visit_num||0,creative.cycle||0),page_num:Math.max(raw.page_num||0,creative.pages?.length||0),first_guest:raw.first_guest??-1,first_col:raw.first_col||0,first_story:raw.first_story||this.db.getStories(account)[0]?.name||'',clover:(raw.clover||0)+state.counters.clover};}
  pushes(account,state,changed){const events=[];if(changed.calendar)events.push({cmd:'calendar_load',data:this.calendarData(state)},{cmd:'calendar_load_note',data:{list:clone(state.calendar.note_list)}});if(changed.task)events.push({cmd:'task_load',data:this.taskData(state)},{cmd:'task_load_list',data:{reward:clone(state.list_rewards)}});if(changed.touch)events.push({cmd:'other_load_touch',data:this.touchData(account,state)});if(changed.moments)events.push({cmd:'misc_moment_load',data:{list:this.db.getMoments(account)}});if(changed.role)events.push({cmd:'client_load_role',data:this.db.getRole(account)});for(const item of changed.items)events.push({cmd:'item_update',data:{item}});return events;}
  rollover(account,state,changed){const date=this.date();if(state.calendar.month_key!==date.key){const flags=state.calendar.new_flag;state.calendar=this.defaultCalendar(account,date);state.calendar.new_flag=flags;changed.calendar=true;}if(!state.login_days.includes(date.dayKey)){state.login_days.push(date.dayKey);state.calendar.task_list[0]={id:1,pro:1,complete:true};changed.calendar=true;}}
  progress(state,id,value,guide=false){const list=guide?state.guides:state.tasks;let row=list.find(x=>x.id===id);if(!row){row=guide?{id,pro:0}:{id,pro:0,is_reward:false};list.push(row);}const previous=row.pro;row.pro=Math.max(row.pro||0,Number(value)||0);return row.pro!==previous;}
  updateProgress(account,state,changed){const m=this.metrics(account),has=id=>this.db.getInventoryCount(account,id)>0,style=id=>values(this.config.furnitureData_json).find(x=>x.id===id)?.style;
    const task={1:m.returnCount,2:m.returnCount,3:m.foods,4:m.foods,5:m.collections,6:m.collections,7:m.pictures,8:m.pictures,9:m.stories,101:m.notes,102:m.notes,103:m.friendNotes,104:m.stories,105:this.db.getVisitorAcquire(account).length,201:Number(has(7000)),202:m.wishs.length,203:m.wishs.length,204:m.stamps.length,205:m.stamps.length,301:m.tools,302:m.purchases,303:m.furniture,304:Number(m.placed.length>=27&&new Set(m.placed.map(x=>style(x.id))).size===1&&style(m.placed[0]?.id)>1),401:Number(has(7001)),402:m.drawing.pages?.length||0,403:m.drawing.colls?.length||0,901:m.clover,902:m.ticket,903:Number(m.cooking.complete),904:this.db.getShopPurchases(account).filter(x=>SHOP_ITEMS.get(x.item_id)?.itemId===9000).reduce((n,x)=>n+x.count,0)};
    for(const definition of this.tasks)if(task[definition.id]!==undefined)changed.task=this.progress(state,definition.id,task[definition.id])||changed.task;
    const guides={102:m.trips,103:Number(state.flags.Map),201:state.counters.feed,202:state.counters.clover,203:Number(this.db.getRole(account).frog.decoration?.length>0),204:Number(state.flags.letter),301:Number(this.db.getItemState(account).house.some(x=>this.items.get(x.item_id)?.type===2)),306:Number(state.flags.NoteFriend),401:m.stories,402:Number(this.db.getStories(account).some(x=>x.gift>=0)),403:m.drawing.cycle||0,407:Number(state.calendar.claimed.some(x=>x.startsWith('st:'))),501:Number([1017,1018,1019,1020,1021,1104].some(has)),601:m.materials,629:m.tumbler.length,630:m.compost.length};
    for(const [id,value]of Object.entries(guides))if(this.guides.some(x=>x.id===Number(id)))changed.task=this.progress(state,Number(id),value,true)||changed.task;
    for(const row of m.wishs)if(this.guides.some(x=>x.id===504+row.id))changed.task=this.progress(state,504+row.id,1,true)||changed.task;
    for(const row of m.stamps){const definition=values(this.config.stampData_json).find(x=>x.id===row.id);const id=501+(definition?.type||1);if(this.guides.some(x=>x.id===id))changed.task=this.progress(state,id,1,true)||changed.task;}
    for(let type=1;type<=27;type++){const id=601+type;if(this.guides.some(x=>x.id===id)&&(has(10300+type)||m.owned.some(owned=>values(this.config.furnitureData_json).some(x=>x.id===owned&&x.type===type&&x.style!==1))))changed.task=this.progress(state,id,1,true)||changed.task;}
    const cal=state.calendar;const rows=[{id:1,pro:1,complete:true},{id:2,pro:Math.min(30,cal.clover),complete:cal.clover>=30},{id:3,pro:Math.min(1,cal.redeem),complete:cal.redeem>=1}];if(JSON.stringify(rows)!==JSON.stringify(cal.task_list)){cal.task_list=rows;changed.calendar=true;}
  }
  reward(account,id,count,changed){if(id===200000||id===100000){const role=this.db.getRole(account);this.db.updateAccount(account,{clover:role.res.clover_point+count});changed.role=true;return;}if(id===200001||id===100001){const role=this.db.getRole(account);this.db.updateAccount(account,{ticket:role.res.ticket+count});changed.role=true;return;}if(!this.items.has(id))throw Error('奖励物品配置不可用');changed.items.push({item_id:id,count:this.db.changeInventory(account,id,count)});}
  momentAllowed(account,definition){const role=this.db.getRole(account),raw=this.db.getOfficialArchive(account)?.protocols||{},eggs=values(raw.easteregg_load?.egg_list),weather=this.db.getWeather(account),neighbor=this.db.db.prepare('SELECT id FROM neighbor_state WHERE account=?').get(account);
    if(definition.type===1)return role.frog.status===0&&MOTIONS[role.frog.motion]===definition.param;
    if(definition.type===2)return role.frog.status===0&&eggs.includes(EGGS[definition.param]);
    if(definition.type===3){if(['wugui','maotouying3','songshu'][neighbor?.id]===definition.param)return true;return eggs.includes(EGGS[definition.param]);}
    if(definition.type===4){if(definition.param!=='drummer')return eggs.includes(EGGS[definition.param]);const row=this.db.db.prepare('SELECT state_json FROM furniture_state WHERE account=?').get(account);if(!row)return false;const shop=JSON.parse(row.state_json);return shop.shop_start<=this.clock()&&shop.shop_end>this.clock();}
    return definition.type===5&&eggs.includes(definition.param);
  }
  observe(account,type,amount=1,details={}){return this.db.transaction(()=>{const state=this.state(account),changed=this.changes();this.rollover(account,state,changed);if(Number.isFinite(amount)&&amount>0){state.counters[type]=(state.counters[type]||0)+amount;if(type==='clover')state.calendar.clover+=amount;if(type==='redeem')state.calendar.redeem+=amount;}
    if(type==='travel'){const foodGuide={0:101,1:205,2:302,3:303,4:408,5:409,15:410,16:411,33:412}[details.food];if(foodGuide)changed.task=this.progress(state,foodGuide,1,true)||changed.task;if(details.fullBag)changed.task=this.progress(state,304,1,true)||changed.task;}if(type==='desk'&&details.full)changed.task=this.progress(state,305,1,true)||changed.task;
    if(type==='feed'&&[0,1,2].includes(details.guest))changed.task=this.progress(state,404+details.guest,1,true)||changed.task;if(type==='letter')state.flags.letter=true;
    this.updateProgress(account,state,changed);state.observed=this.metrics(account);this.save(account,state);return {changed:!!changed.task||!!changed.calendar,events:this.pushes(account,state,changed)};});}
  initial(account){const advanced=this.advance(account),state=this.state(account);return [...advanced.events.filter(x=>!['calendar_load','calendar_load_note','task_load','task_load_list','other_load_touch','misc_moment_load'].includes(x.cmd)),{cmd:'calendar_load',data:this.calendarData(state)},{cmd:'calendar_load_note',data:{list:clone(state.calendar.note_list)}},{cmd:'task_load',data:this.taskData(state)},{cmd:'task_load_list',data:{reward:clone(state.list_rewards)}},{cmd:'other_load_touch',data:this.touchData(account,state)},{cmd:'misc_moment_load',data:{list:this.db.getMoments(account)}}];}
  fail(message){return {response:{code:1,message},events:[]};}
  handle(account,cmd,data={}){cmd=cmd.replace('.','_');if(!this.commands.has(cmd))return null;return this.db.transaction(()=>{
    const state=this.state(account),changed=this.changes();this.rollover(account,state,changed);this.updateProgress(account,state,changed);
    const output=()=>{this.save(account,state);return {response:{code:0},events:this.pushes(account,state,changed)};};
    if(cmd==='calendar_load'){this.save(account,state);return {response:this.calendarData(state),events:[]};}
    if(cmd==='calendar_load_note')return {response:{list:clone(state.calendar.note_list)},events:[]};
    if(cmd==='calendar_task_update')return {response:{task:clone(state.calendar.task_list[0])},events:[]};
    if(cmd==='task_load')return {response:this.taskData(state),events:[]};
    if(cmd==='task_load_list')return {response:{reward:clone(state.list_rewards)},events:[]};
    if(cmd==='annual_load')return {response:this.annualData(account,state),events:[]};
    if(cmd==='other_load_touch')return {response:this.touchData(account,state),events:[]};
    if(cmd==='misc_moment_load')return {response:{list:this.db.getMoments(account)},events:[]};
    if(cmd==='calendar_get_beginer_reward'||cmd==='calendar_get_code_reward'){
      const created=Math.floor((this.db.ensureAccount(account).created_at+28800)/86400),age=this.date().dayKey-created+1,day=cmd==='calendar_get_code_reward'?data.day:age;
      if(!Number.isSafeInteger(day)||day<1||day>7||!this.beginner[day]||state.calendar.new_flag[day-1])return this.fail('新呱奖励不可领取或已领取');
      if(cmd==='calendar_get_beginer_reward'&&(age<1||age>7)||cmd==='calendar_get_code_reward'&&age<=7)return this.fail('该奖励尚未开放');
      const gift=this.beginner[day];this.reward(account,gift.item_id,gift.num,changed);state.calendar.new_flag[day-1]=1;changed.calendar=true;const result=output();result.response.day=day;return result;
    }
    if(cmd==='calendar_get_luck_reward'||cmd==='calendar_get_st_reward'){
      const today=this.date().day,list=cmd==='calendar_get_luck_reward'?state.calendar.lucky_days:state.calendar.st_days,index=list.findIndex(x=>cmd==='calendar_get_luck_reward'?x.day===today:x.day<=today);
      if(index<0)return this.fail('今天没有可领取的日历奖励');if(cmd==='calendar_get_st_reward'&&!state.calendar.task_list.every(x=>x.complete))return this.fail('节气任务尚未完成');
      const gift=list[index];this.reward(account,gift.item_id,1,changed);list.splice(index,1);state.calendar.claimed.push((cmd==='calendar_get_st_reward'?'st:':'luck:')+gift.day);changed.calendar=true;
      if(cmd==='calendar_get_st_reward'){state.calendar.clover=0;state.calendar.redeem=0;state.calendar.task_list[0].complete=false;}return output();
    }
    if(cmd==='task_client_pro'){if(!['Map','NoteFriend'].includes(data.param))return this.fail('不接受未知客户端进度');state.flags[data.param]=true;changed.task=true;this.updateProgress(account,state,changed);return output();}
    if(cmd==='task_get_reward'){
      const definition=this.tasks.find(x=>x.id===data.id),progress=state.tasks.find(x=>x.id===data.id);if(!definition||!progress||progress.pro<definition.count||progress.is_reward)return this.fail('任务奖励尚未完成或已领取');
      this.reward(account,definition.reward_id,definition.num,changed);progress.is_reward=true;changed.task=true;return output();
    }
    if(cmd==='task_get_list_reward'){
      if(!Number.isSafeInteger(data.id))return this.fail('无效清单奖励');const type=Math.floor(data.id/100),stage=data.id%100,group=this.groups[type],previous=state.list_rewards.find(x=>x.id===type)?.pro||0;
      const complete=state.guides.filter(x=>this.guides.some(d=>d.id===x.id&&d.type===type&&x.pro>=d.count)).length;
      if(!group||stage!==previous+1||stage<1||stage>group.target.length||complete<group.target[stage-1])return this.fail('清单目标未完成或奖励已领取');
      this.reward(account,group.reward[stage-1],1,changed);let record=state.list_rewards.find(x=>x.id===type);if(record)record.pro=stage;else state.list_rewards.push({id:type,pro:stage});changed.task=true;return output();
    }
    if(cmd==='annual_share'){state.flags.annual_seen=true;return output();}
    if(cmd==='other_req_touch'){if(!Number.isSafeInteger(data.id)||!this.touchData(account,state).list.includes(data.id))return this.fail('尚未拥有该点击特效');state.touch.cur=data.id;changed.touch=true;return output();}
    if(cmd==='misc_moment_unlock'){
      const definition=this.moments.find(x=>x.id===data.id);if(!definition)return this.fail('未知美好瞬间');if(this.db.getMoments(account).includes(data.id))return output();if(!this.momentAllowed(account,definition))return this.fail('当前场景不满足拍摄条件');this.db.unlockMoment(account,data.id);changed.moments=true;return output();
    }
    return this.fail('未知日常功能');
  });}
  advance(account){return this.db.transaction(()=>{const state=this.state(account),changed=this.changes();this.rollover(account,state,changed);const current=this.metrics(account),before=state.observed;
    if(before&&current.clover>before.clover){state.counters.clover+=current.clover-before.clover;state.calendar.clover+=current.clover-before.clover;}if(before&&before.gacha>=0&&current.gacha===-1){state.counters.redeem++;state.calendar.redeem++;}
    this.updateProgress(account,state,changed);
    const owned=new Set(this.db.getMoments(account));for(const definition of this.moments)if(definition.is_show&&!owned.has(definition.id)&&this.momentAllowed(account,definition)){this.db.unlockMoment(account,definition.id);changed.moments=true;}
    const touch=this.touchData(account,state);if(!touch.list.includes(state.touch.cur))state.touch.cur=0;if(JSON.stringify(touch.list)!==JSON.stringify(state.touch.list)){state.touch.list=touch.list;changed.touch=true;}
    state.observed=current;this.save(account,state);const events=this.pushes(account,state,changed);return {changed:events.length>0,events};
  });}
}
module.exports={DailyService,MOTIONS};
