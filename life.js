'use strict';
const {ModuleState}=require('./module_state');
const clone=value=>JSON.parse(JSON.stringify(value));
const values=value=>Array.isArray(value)?value:Object.values(value||{});
const TASK_TYPES={login:1,feed:3,clover:4,travel:5,photo:6,redeem:7};
class LifeService {
  constructor(database,catalog={},options={}){
    this.db=database;this.storage=new ModuleState(database);this.config=catalog.config||{};this.items=new Map((catalog.items||values(this.config.Item_json)).map(x=>[x.id,x]));
    this.cooking=values(this.config.cookingData_json);this.tasks=values(this.config.cookingTaskData_json);this.stories=values(this.config.story_json?.story);
    this.clock=options.clock||(()=>Math.floor(Date.now()/1000));this.random=options.random||Math.random;
    this.feedbackSeconds=options.feedbackSeconds??600;this.storyCooldown=options.storyCooldown??3600;this.storyChance=options.storyChance??Number(this.config.story_json?.const?.friend_choice_percent??25)/100;
    for(const key of ['feedbackSeconds','storyCooldown'])if(!Number.isSafeInteger(this[key])||this[key]<1)throw Error('Invalid life duration');
    if(!Number.isFinite(this.storyChance)||this.storyChance<0||this.storyChance>1)throw Error('Invalid story chance');
    this.commands=new Set(['story_load','story_send_gift','story_feedback_gift','story_read_new_story','cooking_load_cooking','cooking_refresh_task','cooking_complete_task','cooking_start_cooking','cooking_select','cooking_look_ad','cooking_share']);
  }
  choose(list){return list.length?list[Math.min(list.length-1,Math.max(0,Math.floor(this.random()*list.length)))]:null;}
  period(now=this.clock()){
    const shifted=new Date((now+28800)*1000),year=shifted.getUTCFullYear(),month=shifted.getUTCMonth()+1,day=Math.floor((now+28800)/86400),week=Math.floor((day+3)/7);
    const nextMonth=Date.UTC(year,month,1)/1000-28800,nextWeek=((week+1)*7-3)*86400-28800;
    return {year,month,week,month_key:year+'-'+month,refresh_time:Math.min(nextMonth,nextWeek)};
  }
  taskSet(){return this.tasks.filter(x=>[1,3,4,5,6,7].includes(x.type)).slice(0,4).map(x=>({id:x.id,pro:x.type===1?Math.min(1,x.state):0,complete:false,refresh:false}));}
  observed(account){const role=this.db.ensureAccount(account),pending=this.db.getItemState(account).gacha||{},neighbor=this.db.db.prepare('SELECT served FROM neighbor_state WHERE account=?').get(account);return {clover:role.clover,trips:role.trip_count||0,pictures:this.db.db.prepare('SELECT count(*) AS n FROM postcards WHERE account=?').get(account).n,pending:pending.color_ball,draws:pending.draw_count||0,served:!!neighbor?.served};}
  state(account){this.db.ensureAccount(account);return this.storage.get(account,'life',()=>{
    const raw=this.db.getOfficialArchive(account)?.protocols||{},period=this.period(),cook=raw.cooking_load_cooking||{},story=raw.story_load||{};
    const current=cook.month===period.month,pending={};for(const record of this.db.getStories(account))if(record.gift>=0&&record.feedback===-1)pending[record.id]={feedback_at:this.clock()+this.feedbackSeconds,mail_id:null,thanked:false};
    return {cooking:{month:period.month,month_key:period.month_key,week:period.week,month_pro:current?Number(cook.month_pro)||0:0,complete:current&&!!cook.complete,select:current&&[1,2].includes(cook.select)?cook.select:0,refresh_time:period.refresh_time,
      task_list:current?values(cook.task_list).filter(x=>this.tasks.some(t=>t.id===x.id)):[],claimed:[],refreshes:{},claim_key:null},story:{new_story_id:story.new_story_id||0,pending,acknowledged:[],next_unlock:0},observed:this.observed(account)};
  });}
  save(account,state){return this.storage.set(account,'life',state);}
  cookingData(state){const {month,week,month_pro,complete,select,refresh_time,task_list}=state.cooking;return clone({month,week,month_pro,complete,select,refresh_time,task_list});}
  storyData(account,state){return {stories:this.db.getStories(account),new_story_id:state.story.new_story_id};}
  saveStory(account,record){this.db.db.prepare('INSERT INTO stories(account,story_id,data_json) VALUES (?,?,?) ON CONFLICT(account,story_id) DO UPDATE SET data_json=excluded.data_json').run(account,record.id,JSON.stringify(record));}
  pushes(account,state,changed){const events=[];if(changed.cooking)events.push({cmd:'cooking_load_cooking',data:this.cookingData(state)});if(changed.story)events.push({cmd:'story_load',data:this.storyData(account,state)});for(const item of changed.items||[])events.push({cmd:'item_update',data:{item}});for(const mail of changed.mails||[])events.push({cmd:'notify_new_mail',data:{mail}});for(const event of changed.events||[])events.push({cmd:'notify_new_event',data:{event}});return events;}
  changes(){return {items:[],mails:[],events:[]};}
  inventory(account,id,delta,changed){changed.items.push({item_id:id,count:this.db.changeInventory(account,id,delta)});}
  fail(message){return {response:{code:1,message},events:[]};}
  rollPeriod(state,now,changed){const period=this.period(now),c=state.cooking;
    if(c.month_key!==period.month_key){c.month=period.month;c.month_key=period.month_key;c.month_pro=0;c.complete=false;c.select=0;c.claim_key=null;c.claimed=[];c.task_list=[];c.refreshes={};changed.cooking=true;}
    if(c.week!==period.week||!c.task_list.length){c.week=period.week;c.task_list=this.taskSet();c.refreshes={};changed.cooking=true;}
    c.refresh_time=period.refresh_time;
  }
  progress(state,type,amount,changed){if(!Number.isFinite(amount)||amount<=0)return;for(const row of state.cooking.task_list){const definition=this.tasks.find(x=>x.id===row.id);if(!row.complete&&definition?.type===type){const next=Math.min(definition.state,row.pro+amount);if(next!==row.pro){row.pro=next;changed.cooking=true;}}}}
  observe(account,type,amount=1){return this.db.transaction(()=>{const state=this.state(account),changed=this.changes();this.rollPeriod(state,this.clock(),changed);const taskType=TASK_TYPES[type];if(taskType)this.progress(state,taskType,amount,changed);if(type==='travel')this.unlockStory(account,state,changed);state.observed=this.observed(account);this.save(account,state);return {changed:!!changed.cooking||!!changed.story,events:this.pushes(account,state,changed)};});}
  initial(account){const advanced=this.advance(account),state=this.state(account);return [...advanced.events.filter(x=>!['cooking_load_cooking','story_load'].includes(x.cmd)),{cmd:'cooking_load_cooking',data:this.cookingData(state)},{cmd:'story_load',data:this.storyData(account,state)}];}
  handle(account,cmd,data={}){cmd=cmd.replace('.','_');if(!this.commands.has(cmd))return null;
    return this.db.transaction(()=>{const state=this.state(account),changed=this.changes(),now=this.clock(),c=state.cooking;this.rollPeriod(state,now,changed);
      if(cmd==='story_load'){this.save(account,state);return {response:this.storyData(account,state),events:[]};}
      if(cmd==='cooking_load_cooking'){this.save(account,state);return {response:this.cookingData(state),events:[]};}
      if(cmd==='story_read_new_story'){state.story.new_story_id=0;changed.story=true;}
      else if(cmd==='story_send_gift'){
        const story=this.db.getStories(account).find(x=>x.id===data.id),item=this.items.get(data.gift);
        if(!story)return this.fail('故事记录不存在');
        if(story.gift!==-1)return story.gift===data.gift?{response:{code:0},events:[]} :this.fail('已经向这位伙伴赠礼');
        if(!item||item.type!==3||this.db.getInventoryCount(account,item.id)<1)return this.fail('请赠送拥有的特产');
        this.inventory(account,item.id,-1,changed);story.gift=item.id;this.saveStory(account,story);state.story.pending[story.id]={feedback_at:now+this.feedbackSeconds,mail_id:null,thanked:false};changed.story=true;
      }else if(cmd==='story_feedback_gift'){
        if(!Number.isSafeInteger(data.id))return this.fail('无效邮件编号');
        if(state.story.acknowledged.includes(data.id))return {response:{code:0},events:[]};
        const mail=this.db.db.prepare('SELECT * FROM mails WHERE account=? AND id=? AND type=6').get(account,data.id);
        if(!mail)return this.fail('赠礼邮件不存在');
        const pending=Object.values(state.story.pending).find(x=>x.mail_id===data.id);if(pending)pending.thanked=true;
        state.story.acknowledged.push(data.id);changed.events.push(this.db.enqueueEvent(account,10,0,[],[mail.title||'小伙伴']));
      }else if(cmd==='cooking_select'){
        if(!Number.isSafeInteger(data.index)||![1,2].includes(data.index)||!this.cooking.some(x=>x.month===c.month+12*(data.index-1)))return this.fail('未知节气食物主题');
        if(c.complete&&c.select!==data.index)return this.fail('本月食物已经完成，请等待下月');
        c.select=data.index;changed.cooking=true;
      }else if(cmd==='cooking_refresh_task'){
        const row=c.task_list.find(x=>x.id===data.id);if(!row||row.complete||c.refreshes[data.id])return this.fail('该任务本期无法再次刷新');
        const options=this.tasks.filter(x=>[1,3,4,5,6,7].includes(x.type)&&!c.task_list.some(y=>y.id===x.id)&&!c.claimed.includes(c.week+':'+x.id));const replacement=this.choose(options);if(!replacement)return this.fail('暂无其他任务');
        c.refreshes[data.id]=true;c.refreshes[replacement.id]=true;const task={id:replacement.id,pro:replacement.type===1?1:0,complete:false,refresh:true};c.task_list[c.task_list.indexOf(row)]=task;
        this.save(account,state);return {response:{code:0,task:clone(task)},events:[{cmd:'cooking_load_cooking',data:this.cookingData(state)}]};
      }else if(cmd==='cooking_complete_task'){
        const row=c.task_list.find(x=>x.id===data.id),definition=this.tasks.find(x=>x.id===data.id),key=c.week+':'+data.id;
        if(!row||!definition||row.pro<definition.state)return this.fail('任务尚未完成');
        if(row.complete||c.claimed.includes(key))return this.fail('任务奖励已领取');
        row.complete=true;c.claimed.push(key);c.month_pro++;changed.cooking=true;
      }else if(cmd==='cooking_start_cooking'){
        const definition=this.cooking.find(x=>x.month===c.month+12*((c.select||1)-1));
        if(!definition||!this.items.has(definition.item_id))return this.fail('节气食物配置不可用');
        if(![1,2].includes(c.select))return this.fail('请先选择本月食物');
        if(c.complete||c.claim_key===c.month_key)return this.fail('本月食物已领取');
        if(c.month_pro<definition.task_num)return this.fail('食材准备任务尚未完成');
        this.inventory(account,definition.item_id,1,changed);c.complete=true;c.claim_key=c.month_key;changed.cooking=true;
      }else if(cmd==='cooking_look_ad'||cmd==='cooking_share')return this.fail('私服不要求广告或平台分享，请完成普通任务');
      this.save(account,state);return {response:{code:0},events:this.pushes(account,state,changed)};
    });
  }
  unlockStory(account,state,changed){
    if(!this.stories.length||state.story.new_story_id||this.clock()<state.story.next_unlock||this.random()>=this.storyChance)return;
    const existing=this.db.getStories(account),known=new Set(existing.map(x=>x.id));const chosen=this.choose(this.stories.filter(x=>!known.has(x.storyid)));if(!chosen)return;
    const peers=['小豆','阿响','花花'];const record={id:chosen.storyid,gift:-1,feedback:-1,name:this.choose(peers),partner:1000000+chosen.storyid};
    this.saveStory(account,record);state.story.new_story_id=record.id;state.story.next_unlock=this.clock()+this.storyCooldown;changed.story=true;changed.events.push(this.db.enqueueEvent(account,8,record.id,[],[record.name]));
  }
  createFeedback(account,state,story,pending,changed){
    const gift=this.choose([...this.items.values()].filter(x=>x.type===3));if(!gift)return;
    const now=this.clock(),id=Math.max(now*1000,Number(this.db.db.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM mails WHERE account=?').get(account).id));
    this.db.db.prepare(`INSERT INTO mails(account,id,type,sender,timestamp,title,message,resource_json,items_json,pictures_json) VALUES (?,?,6,?,?,?,?,? ,?,'[]')`)
      .run(account,id,story.partner||0,now,story.name+'的回礼','谢谢你的特产，希望你也喜欢这份小礼物。','{}',JSON.stringify([{item_id:gift.id,count:1}]));
    pending.mail_id=id;pending.feedback_at=0;story.feedback=gift.id;this.saveStory(account,story);changed.story=true;changed.mails.push(this.db.getMail(account,id));changed.events.push(this.db.enqueueEvent(account,9,story.id,[],[story.name]));
  }
  advance(account){return this.db.transaction(()=>{
    const state=this.state(account),changed=this.changes(),now=this.clock();this.rollPeriod(state,now,changed);
    const before=state.observed,current=this.observed(account);
    if(before){if(current.clover>before.clover)this.progress(state,4,current.clover-before.clover,changed);if(current.trips>before.trips){this.progress(state,5,current.trips-before.trips,changed);this.unlockStory(account,state,changed);}if(current.pictures>before.pictures)this.progress(state,6,current.pictures-before.pictures,changed);if(!before.served&&current.served)this.progress(state,3,1,changed);if(before.pending>=0&&current.pending===-1&&current.draws>=before.draws)this.progress(state,7,1,changed);}
    state.observed=current;
    for(const [id,pending]of Object.entries(state.story.pending)){if(!pending.mail_id&&pending.feedback_at>0&&pending.feedback_at<=now){const story=this.db.getStories(account).find(x=>x.id===Number(id));if(story)this.createFeedback(account,state,story,pending,changed);}}
    this.save(account,state);const events=this.pushes(account,state,changed);return {changed:events.length>0,events};
  });}
}
module.exports={LifeService,TASK_TYPES};
