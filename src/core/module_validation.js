'use strict';

// Import validation only: this must never reset, normalize, delete or seed a
// damaged save. Unknown future modules keep their JSON object for compatibility.
const MAX=Number.MAX_SAFE_INTEGER,COUNT=1000000000;
function bad(path,message){throw Error(`Invalid game module ${path}: ${message}`);}
function object(value,path){if(!value||typeof value!=='object'||Array.isArray(value))bad(path,'expected object');}
function integer(value,path,min=0,max=MAX){if(!Number.isSafeInteger(value)||value<min||value>max)bad(path,`expected integer ${min}..${max}`);}
function bool(value,path){if(typeof value!=='boolean')bad(path,'expected boolean');}
function text(value,path){if(typeof value!=='string'||value.length>1000000)bad(path,'expected string');}
function array(value,path,visit=()=>{},max=50000){if(!Array.isArray(value)||value.length>max)bad(path,'expected bounded array');value.forEach((item,i)=>visit(item,`${path}[${i}]`));}
const ids=(value,path,min=0)=>array(value,path,(n,p)=>integer(n,p,min));
function nums(value,path,keys,min=0,max=MAX){for(const key of keys)integer(value[key],path+'.'+key,min,max);}
function objects(value,path,keys){for(const key of keys)object(value[key],path+'.'+key);}
function arrays(value,path,keys){for(const key of keys)array(value[key],path+'.'+key);}
function flags(value,path,keys){for(const key of keys)bool(value[key],path+'.'+key);}
function optional(value,path,key,check){if(Object.hasOwn(value,key))check(value[key],path+'.'+key);}
function job(value,path,check){if(value===null)return;object(value,path);check(value,path);}
function json(value,path,depth=0,seen=new Set()){
 if(depth>32)bad(path,'nesting too deep');
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isFinite(value))bad(path,'non-finite number');return;}
 if(typeof value==='string'){text(value,path);return;}
 if(typeof value!=='object')bad(path,'not JSON data');
 if(seen.has(value))bad(path,'cyclic data');seen.add(value);
 if(Array.isArray(value)){if(value.length>50000)bad(path,'array too large');value.forEach((v,i)=>json(v,path+'['+i+']',depth+1,seen));}
 else{if(Object.keys(value).length>50000)bad(path,'object too large');for(const [key,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))bad(path,'unsafe property name');json(v,path+'.'+key,depth+1,seen);}}
 seen.delete(value);
}
function reward(value,path){object(value,path);integer(value.item_id??value.id,path+'.item_id',0);integer(value.count??value.num??value.item_num,path+'.count',0,COUNT);}
function picture(value,path){
 object(value,path);integer(value.id,path+'.id',0);integer(value.pic_id,path+'.pic_id',0);
 array(value.layers,path+'.layers',(entry,p)=>{
  object(entry,p);array(entry.layer,p+'.layer',(v,q)=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1000000000)bad(q,'invalid layer coordinate');},3);
  if(entry.layer.length!==3)bad(p+'.layer','expected resource,x,y');integer(entry.layer[0],p+'.resource',0);
 },64);
 if(value.id>0&&!value.layers.length)bad(path,'owned photo must retain layers');
}
function book(value,path){object(value,path);ids(value.unlock_list,path+'.unlock_list');array(value.unlock_desc,path+'.unlock_desc',(r,p)=>{object(r,p);integer(r.id,p+'.id',0);ids(r.list,p+'.list');});array(value.show_sub,path+'.show_sub',(r,p)=>{object(r,p);integer(r.id,p+'.id',0);integer(r.sub_id,p+'.sub_id',0);});}
function anim(value,path){
 nums(value,path,['guide','page_num','item_num']);array(value.pic_list,path+'.pic_list',(row,p)=>{
  object(row,p);nums(row,p,['id'],1);nums(row,p,['phase','exp','put_num']);array(row.exp_pic,p+'.exp_pic',picture,5);array(row.pictures,p+'.pictures',picture,1000);
  optional(row,p,'source_picture',picture);optional(row,p,'next_at',(v,q)=>integer(v,q));
 });optional(value,path,'last_at',(v,p)=>integer(v,p));
}
function capsule(value,path){nums(value,path,['end_time','coin','pre_coin','patch_num']);integer(value.day,path+'.day',-1);ids(value.reward_list,path+'.reward_list',1);ids(value.task_list,path+'.task_list',1);}
function wish(value,path){nums(value,path,['end_time','coin']);integer(value.day,path+'.day',-1);array(value.items,path+'.items',(r,p)=>{object(r,p);integer(r.id,p+'.id',1);nums(r,p,['num','limit']);});}
function card(value,path){
 nums(value,path,['end_time','stock_num','new_index','global_num','task_harvest','buy_num','can_buy_num','share_num','share_get','box_id']);integer(value.day,path+'.day',-1);
 flags(value,path,['task_login','task_share','can_reward']);objects(value,path,['card_info']);nums(value.card_info,path+'.card_info',['bg','bless']);ids(value.card_info.tags,path+'.card_info.tags');if(value.card_info.tags.length!==3)bad(path+'.card_info.tags','expected three sticker positions');
 array(value.items,path+'.items',(r,p)=>{object(r,p);integer(r.item_id,p+'.item_id',1);integer(r.num,p+'.num',0,COUNT);});ids(value.task_item,path+'.task_item',1);
 for(const key of ['send_list','get_list'])array(value[key],path+'.'+key,(r,p)=>{object(r,p);nums(r,p,['bg','bless']);ids(r.tags,p+'.tags');});
 array(value.reward_list,path+'.reward_list',reward);text(value.share_code,path+'.share_code');
 array(value.pending_replies,path+'.pending_replies',(r,p)=>{object(r,p);if(!['card','gift'].includes(r.kind))bad(p+'.kind','invalid reply kind');integer(r.at,p+'.at');if(r.kind==='card'){object(r.card,p+'.card');ids(r.card.tags,p+'.card.tags');}});
 array(value.share_codes,path+'.share_codes',(r,p)=>{object(r,p);text(r.code,p+'.code');integer(r.tags_id,p+'.tags_id',1);integer(r.expires,p+'.expires');if(r.claimed_by!==null)text(r.claimed_by,p+'.claimed_by');});
 optional(value,path,'feedback_mails',ids);optional(value,path,'thanked',ids);
}
function cake(value,path){
 nums(value,path,['end_time','cream','sugar','pre_cream','pre_sugar','wrong','pending_layer']);integer(value.cur_state,path+'.cur_state',0,6);integer(value.part,path+'.part',1,10000);integer(value.guest,path+'.guest',0,3);integer(value.answer_index,path+'.answer_index',0,3);integer(value.day,path+'.day',-1);
 ids(value.layers,path+'.layers',1);ids(value.share_get,path+'.share_get');ids(value.answer,path+'.answer');array(value.reward,path+'.reward',reward);
 array(value.task_list,path+'.task_list',(r,p)=>{object(r,p);integer(r.id,p+'.id',1);integer(r.count,p+'.count',0,COUNT);integer(r.is_done,p+'.is_done',0,1);});
}
function explore(value,path){
 nums(value,path,['end_time','inspire_num','inspire_time','cur_museum','compass','task_num','frog','next','left_num','desc_id','pic_id','moving_until','task_repeats']);integer(value.day,path+'.day',-1);bool(value.arrived,path+'.arrived');
 array(value.path,path+'.path',(r,p)=>{object(r,p);integer(r.grid,p+'.grid',1,35);integer(r.type,p+'.type',0,100);integer(r.style,p+'.style',0,100);},35);
 if(value.frog>value.next||value.next>value.path.length)bad(path,'frog/next inconsistent with path');
 for(const key of ['items','get_items'])array(value[key],path+'.'+key,reward);
 array(value.museum_list,path+'.museum_list',(r,p)=>{object(r,p);integer(r.id,p+'.id',1);optional(r,p,'items',(items,q)=>array(items,q,reward));});array(value.log_list,path+'.log_list',(r,p)=>object(r,p));
}
function lottery(value,path){
 nums(value,path,['last_phase','phase','egg_num','week','opened_phase','settle_at']);integer(value.state,path+'.state',0,3);ids(value.select_list,path+'.select_list');ids(value.answer,path+'.answer');
 array(value.right_flag,path+'.right_flag',(v,p)=>{if(v!==true&&v!==false)integer(v,p,0,1);});array(value.reward,path+'.reward',(r,p)=>{object(r,p);integer(r.id,p+'.id',1);integer(r.num,p+'.num',0,COUNT);integer(r.is_egg,p+'.is_egg',0,1);});
 reward(value.extra_item,path+'.extra_item');
}
function creative(value,path){
 objects(value,path,['drawing','pray','tumbler','compost','pocket','flowerpot']);
 const d=value.drawing,p=path+'.drawing';integer(d.state,p+'.state',0,4);integer(d.guest,p+'.guest',0,2);nums(d,p,['show_coll','next_invite','depart_at','returns_at','cycle']);text(d.pen_motion,p+'.pen_motion');ids(d.pages,p+'.pages',1);ids(d.colls,p+'.colls',1);ids(d.bag,p+'.bag',-1);if(d.bag.length!==4)bad(p+'.bag','expected four party slots');
 const pray=value.pray,q=path+'.pray';for(const key of ['wishs','stamps'])array(pray[key],q+'.'+key,(r,s)=>{object(r,s);integer(r.id,s+'.id',1);optional(r,s,'u_id',(v,t)=>integer(v,t));optional(r,s,'state',(v,t)=>integer(v,t));});array(pray.boxes,q+'.boxes',(r,s)=>{if(typeof r==='number')integer(r,s,1);else{object(r,s);integer(r.id??r.item_id,s+'.id',1);}});nums(pray,q,['next_at','sequence']);job(pray.job,q+'.job',(r,s)=>{integer(r.finish_at,s+'.finish_at');if(!['wish','stamp','box'].includes(r.kind))bad(s+'.kind','invalid craft job');if(r.kind==='box')integer(r.item_id,s+'.item_id',1);else{object(r.record,s+'.record');integer(r.record.id,s+'.record.id',1);}});
 const tumbler=value.tumbler,r=path+'.tumbler';nums(tumbler,r,['show_index','replace_index','next_at']);array(tumbler.tumbler_list,r+'.tumbler_list',(v,s)=>{object(v,s);integer(v.id,s+'.id',1);array(v.layers,s+'.layers',(e,t)=>{object(e,t);array(e.layer,t+'.layer',(n,u)=>{if(typeof n!=='number'||!Number.isFinite(n))bad(u,'invalid tumbler coordinate');},8);integer(e.layer[0],t+'.resource',1);});});job(tumbler.job,r+'.job',(j,s)=>{integer(j.id,s+'.id',1);integer(j.finish_at,s+'.finish_at');array(j.layers,s+'.layers');});
 const compost=value.compost,s=path+'.compost';nums(compost,s,['show_index','replace_index','box_index','last_decay']);integer(compost.state,s+'.state',0,4);ids(compost.compost_list,s+'.compost_list',1);ids(compost.box_list,s+'.box_list');if(compost.box_list.length!==6||compost.box_index>6)bad(s,'invalid compost slots');job(compost.job,s+'.job',(j,t)=>{nums(j,t,['item_id','finish_at'],1);integer(j.power,t+'.power',1,100);});
 const pocket=value.pocket,t=path+'.pocket';nums(pocket,t,['show_index','replace_index','clover','last_at']);ids(pocket.list,t+'.list',1);
 const pot=value.flowerpot,u=path+'.flowerpot';nums(pot,u,['show_index','replace_index','next_at']);ids(pot.list,u+'.list',1);array(pot.plant_list,u+'.plant_list',(plant,v)=>{object(plant,v);integer(plant.index,v+'.index',1,100);integer(plant.id,v+'.id');integer(plant.stage,v+'.stage',0,3);nums(plant,v,['started_at','finish_at']);});
 optional(value,path,'structure_next_at',(v,p)=>integer(v,p));optional(value,path,'structure_job',(v,p)=>job(v,p,(j,q)=>{if(!['compost','pocket','flowerpot'].includes(j.kind))bad(q+'.kind','invalid structure kind');nums(j,q,['id','finish_at'],1);}));
}
function life(value,path){
 objects(value,path,['cooking','story','observed']);const c=value.cooking,p=path+'.cooking';nums(c,p,['week','month_pro','refresh_time']);integer(c.month,p+'.month',1,12);integer(c.select,p+'.select',0,2);text(c.month_key,p+'.month_key');bool(c.complete,p+'.complete');array(c.claimed,p+'.claimed',text);object(c.refreshes,p+'.refreshes');if(c.claim_key!==null)text(c.claim_key,p+'.claim_key');
 array(c.task_list,p+'.task_list',(r,q)=>{object(r,q);integer(r.id,q+'.id',1);integer(r.pro,q+'.pro');bool(r.complete,q+'.complete');bool(r.refresh,q+'.refresh');});
 const s=value.story,q=path+'.story';nums(s,q,['new_story_id','next_unlock']);ids(s.acknowledged,q+'.acknowledged');object(s.pending,q+'.pending');for(const [id,r]of Object.entries(s.pending)){integer(Number(id),q+'.pending key',1);object(r,q+'.pending.'+id);integer(r.feedback_at,q+'.feedback_at');if(r.mail_id!==null)integer(r.mail_id,q+'.mail_id',1);bool(r.thanked,q+'.thanked');}
}
function daily(value,path){
 objects(value,path,['calendar','flags','counters','annual','touch','observed']);arrays(value,path,['tasks','guides','list_rewards','login_days']);array(value.list_rewards,path+'.list_rewards',(r,p)=>{if(typeof r==='number')integer(r,p,1);else{object(r,p);integer(r.id,p+'.id',1);integer(r.pro,p+'.pro');}});ids(value.login_days,path+'.login_days');
 const c=value.calendar,p=path+'.calendar';text(c.month_key,p+'.month_key');nums(c,p,['clover','redeem']);ids(c.new_flag,p+'.new_flag');if(c.new_flag.length!==7)bad(p+'.new_flag','expected seven beginner flags');ids(c.note_list,p+'.note_list');array(c.claimed,p+'.claimed',text);
 for(const key of ['lucky_days','st_days'])array(c[key],p+'.'+key,(r,q)=>{object(r,q);integer(r.day,q+'.day',1,31);integer(r.item_id,q+'.item_id');});array(c.task_list,p+'.task_list',(r,q)=>{object(r,q);integer(r.id,q+'.id',1);integer(r.pro,q+'.pro');bool(r.complete,q+'.complete');});
 for(const key of ['tasks','guides'])array(value[key],path+'.'+key,(r,q)=>{object(r,q);integer(r.id,q+'.id',1);integer(r.pro,q+'.pro');optional(r,q,'is_reward',bool);});
 integer(value.touch.cur,path+'.touch.cur');array(value.touch.list,path+'.touch.list');
}
function progression(value,path){
 for(const key of ['days','cities','event_ids'])optional(value,path,key,(v,p)=>array(v,p,text));
 for(const key of ['museum','acquired_items','seen_pic_ids'])optional(value,path,key,ids);
 for(const key of ['travel_book','plant_book'])optional(value,path,key,book);
 for(const key of ['flower_stages','plants','arrangements','special_titles'])optional(value,path,key,(v,p)=>{object(v,p);for(const [k,n]of Object.entries(v))if(typeof n!=='boolean')integer(n,p+'.'+k);});
 for(const key of ['juice_streak'])optional(value,path,key,(v,p)=>integer(v,p));for(const key of ['short_return','long_trip','anniversary'])optional(value,path,key,bool);
}
function travel(value,path){
 for(const key of ['depart_at','home_at','trip_number','durationSeconds','homeWaitSeconds'])optional(value,path,key,(v,p)=>integer(v,p));optional(value,path,'companionId',(v,p)=>integer(v,p,-1,2));
 optional(value,path,'route',(route,p)=>{object(route,p);integer(route.id,p+'.id');integer(route.picId,p+'.picId');text(route.destination,p+'.destination');});
 optional(value,path,'rewards',(rewards,p)=>{
  object(rewards,p);optional(rewards,p,'postcards',(v,q)=>integer(v,q,0,100));
  if(rewards.specialty!==undefined&&rewards.specialty!==null)reward(rewards.specialty,p+'.specialty');
  for(const key of ['noteId','collectionId'])if(rewards[key]!==undefined&&rewards[key]!==null)integer(rewards[key],p+'.'+key,0);
 });
 optional(value,path,'spending',(spending,p)=>{object(spending,p);for(const key of ['consumed','returned'])array(spending[key],p+'.'+key,(r,q)=>{object(r,q);integer(r.slot,q+'.slot',1,16);integer(r.item_id,q+'.item_id');integer(r.count,q+'.count',1,COUNT);});ids(spending.nextBag,p+'.nextBag',-1);});
 optional(value,path,'desk_loans',(v,p)=>array(v,p,(r,q)=>{object(r,q);integer(r.bag,q+'.bag',1,16);integer(r.desk,q+'.desk',1,16);integer(r.item_id,q+'.item_id');}));
}
const VALIDATORS={animpicture:anim,capsule,wishingpool:wish,greetcard:card,springcard:card,partycake:cake,museumday:explore,koto:explore,lottery,creative,life,daily,progression,'travel-plan':travel,world:(value,path)=>{optional(value,path,'weather_manual',bool);optional(value,path,'motion_period',(v,p)=>integer(v,p));optional(value,path,'borrowed',(v,p)=>array(v,p));}};
VALIDATORS.decoration=(value,path)=>{
 arrays(value,path,['has_list','stage_history','owned_history','discarded']);nums(value,path,['put_id','started_at','bloom_at','expires_at']);integer(value.status,path+'.status',0,2);
 array(value.has_list,path+'.has_list',(row,p)=>{object(row,p);nums(row,p,['id','num']);});ids(value.owned_history,path+'.owned_history');
 array(value.stage_history,path+'.stage_history',(row,p)=>{object(row,p);nums(row,p,['id','at']);integer(row.stage,p+'.stage',1,2);});
};
VALIDATORS.gifts=(value,path)=>{
 nums(value,path,['sequence','opened_count']);arrays(value,path,['queue','history']);
 array(value.queue,path+'.queue',(row,p)=>{object(row,p);nums(row,p,['uid']);integer(row.num,p+'.num',1,1000);array(row.items,p+'.items',reward);if(row.num>row.items.length)bad(p,'not enough selectable items');});
 array(value.history,path+'.history',(row,p)=>{object(row,p);optional(row,p,'rewards',(v,q)=>array(v,q,reward));});
};
function validateModules(modules){
 if(modules===undefined)return true;object(modules,'root');if(Object.keys(modules).length>200)bad('root','too many modules');json(modules,'root');
 for(const [name,value]of Object.entries(modules)){if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name))bad(name,'invalid module name');object(value,name);if(JSON.stringify(value).length>4000000)bad(name,'module too large');VALIDATORS[name]?.(value,name);}
 return true;
}
module.exports={validateModules};
