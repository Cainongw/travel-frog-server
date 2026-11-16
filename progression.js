'use strict';
const {ModuleState}=require('./module_state');
const rows=value=>Object.values(value||{}),array=value=>Array.isArray(value)?value:[];
const unique=value=>[...new Set(value)];
const day=seconds=>new Date((seconds+28800)*1000).toISOString().slice(0,10);
const NAME_ALIASES={'苏州西瓜子':'西瓜子','蜜柑':'桔子','桃子':'蜜桃','莜面':'莜面栲栳栳'};
const canonical=value=>NAME_ALIASES[String(value||'')]||String(value||'').replace(/腊梅/g,'蜡梅');
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const blankBook=()=>({unlock_list:[],unlock_desc:[],show_sub:[]});

class ProgressionService{
 constructor(database,catalog,options={}){
  this.db=database;this.catalog=catalog;this.config=catalog.config||{};this.store=options.stateStore||new ModuleState(database);this.clock=options.clock||(()=>Math.floor(Date.now()/1000));
  this.achievements=rows(this.config.Achieve_json);this.items=new Map((catalog.items||rows(this.config.Item_json)).map(x=>[x.id,x]));
  this.collections=new Map(rows(this.config.Collection_json).map(x=>[x.id,x]));
  this.museumCollections=new Set(rows(this.config.Collection_json).filter(x=>x.type===3).map(x=>x.id));
  for(const museum of rows(this.config.museumData_json))for(const id of String(museum.collection_id||'').split(',').map(Number))if(integer(id))this.museumCollections.add(id);
  this.commands=new Set(['encytravel_load','encytravel_set_show_sub','encyclopedia_load','encyclopedia_set_show_sub']);
  this.conditions=new Map(this.achievements.map(row=>[row.id,this.condition(row)]));
  this.cityGroups=rows(this.config.GoalNumber_json).filter(x=>x.id>0&&x.id<100).map(goal=>{
   const tag=rows(this.config.PictureTag_json).find(x=>x.Tag===goal.tag),names=new Set(array(tag?.picNames));
   return {name:goal.name,ids:new Set((catalog.pictures||rows(this.config.Picture_json)).filter(x=>names.has(x.name)).map(x=>x.id))};
  }).filter(x=>x.ids.size);
 }
 state(account){
  const fresh={days:[],juice_streak:0,short_return:false,long_trip:false,flower_stages:{},plants:{},arrangements:{},cities:[],museum:[],special_titles:{},anniversary:false,travel_book:blankBook(),plant_book:blankBook(),acquired_items:[],seen_pic_ids:[],event_ids:[]};
  return {...fresh,...this.store.get(account,'progression',()=>fresh)};
 }
 condition(row){
  const text=String(row.info||'');let m;
  if(row.id===0)return {kind:'default'};
  if(m=text.match(/^旅行达到(\d+)次/))return {kind:'trip-count',count:Number(m[1])};
  if(m=text.match(/^获得(\d+)种纪念品/))return {kind:'collections',count:Number(m[1])};
  if(m=text.match(/^获得(\d+)种特产/))return {kind:'specialties',count:Number(m[1])};
  if(m=text.match(/^登录达到(\d+)天/))return {kind:'login-days',count:Number(m[1])};
  if(m=text.match(/^(.+)超过(\d+)个/)){const item=[...this.items.values()].find(x=>canonical(x.name)===canonical(m[1]));return {kind:'inventory',item:item?.id,item_name:m[1],count:Number(m[2])};}
  if(m=text.match(/^(.+)开放阶段(\d+)/))return {kind:'flower-stage',plant:canonical(m[1]),stage:Number(m[2])};
  if(m=text.match(/^获得(\d+)个典藏/))return {kind:'museum-collections',count:Number(m[1])};
  if(row.id===6)return {kind:'all-specialties'};
  if(row.id===7)return {kind:'short-trip'};
  if(row.id===8)return {kind:'long-trip'};
  if(row.id===9)return {kind:'clover',count:100000};
  if(row.id===10)return {kind:'gacha',count:20};
  if(row.id===11)return {kind:'juice',count:4};
  if(row.id===78)return {kind:'children-day'};
  if(row.id===81)return {kind:'all-cities'};
  if(row.id===87)return {kind:'anniversary'};
  if(row.is_special||row.id>=900)return {kind:'timed-title'};
  return {kind:'unknown',info:text};
 }
 coverage(){return this.achievements.map(row=>({id:row.id,name:row.name,info:row.info,...this.conditions.get(row.id)}));}
 record(account,event,data={}){
  return this.db.transaction(()=>{
   this.db.ensureAccount(account);const s=this.state(account),now=this.clock();
   if(data.event_id!==undefined){const id=String(event)+':'+String(data.event_id);if(s.event_ids.includes(id))return this.sync(account);s.event_ids.push(id);s.event_ids=s.event_ids.slice(-1024);}
   if(event==='login'){const d=day(now);if(!s.days.includes(d))s.days.push(d);}
   if(event==='trip-start'){
    const juiceIds=rows(this.config.encytravel_json?.list).filter(x=>canonical(x.name).includes('果汁')).map(x=>x.item_id),food=this.items.get(data.food);
    const juice=juiceIds.includes(data.food)||/果汁/.test(food?.name||'');s.juice_streak=juice?s.juice_streak+1:0;
   }
   if(event==='trip-return'){
    if(Number.isFinite(data.duration)&&data.duration>=0&&data.duration<1800)s.short_return=true;
    if(Number.isFinite(data.duration)&&data.duration>86400)s.long_trip=true;
    if(data.place&&!s.cities.includes(data.place))s.cities.push(data.place);
    if(integer(data.pic_id))s.seen_pic_ids=unique([...s.seen_pic_ids,data.pic_id]);
   }
   if(event==='flower-stage'&&typeof data.plant==='string'&&integer(data.stage)){
    const name=canonical(data.plant);s.flower_stages[name]=Math.max(s.flower_stages[name]||0,data.stage);s.arrangements[name]=Math.max(s.arrangements[name]||0,data.stage);
   }
   if(event==='plant-stage'&&typeof data.plant==='string'&&integer(data.stage)){const name=canonical(data.plant);s.plants[name]=Math.max(s.plants[name]||0,data.stage);}
   if(event==='museum-acquire'&&integer(data.id)&&!s.museum.includes(data.id))s.museum.push(data.id);
   if(event==='collection-acquire'||event==='museum-acquire'){
    for(const id of unique([data.collection_id,...array(data.collections),...(event==='collection-acquire'?[data.id]:[])]).filter(id=>integer(id)&&this.collections.has(id)))this.db.db.prepare('INSERT OR IGNORE INTO handbook VALUES (?,\'collection\',?)').run(account,id);
   }
   if(event==='item-acquire'&&integer(data.item_id)){s.acquired_items=unique([...s.acquired_items,data.item_id]);if(this.items.get(data.item_id)?.type===3)this.db.db.prepare('INSERT OR IGNORE INTO handbook VALUES (?,\'specialty\',?)').run(account,data.item_id);}
   if(event==='anniversary-login')s.anniversary=true;
   this.store.set(account,'progression',s);return this.sync(account);
  });
 }
 bookMerge(original,current){
  const desc=new Map();for(const row of [...array(original?.unlock_desc),...current.unlock_desc])desc.set(row.id,{id:row.id,list:unique([...(desc.get(row.id)?.list||[]),...array(row.list)])});
  const show=new Map([...array(original?.show_sub),...current.show_sub].map(x=>[x.id,x]));
  return {unlock_list:unique([...array(original?.unlock_list),...current.unlock_list]),unlock_desc:[...desc.values()],show_sub:[...show.values()]};
 }
 travelBook(account){return this.bookMerge(this.db.getOfficialArchive(account)?.protocols?.encytravel_load,this.state(account).travel_book);}
 encyclopedia(account){return this.bookMerge(this.bookMerge(this.db.getOfficialArchive(account)?.protocols?.encyclopedia_load,this.db.getEncyclopedia(account)),this.state(account).plant_book);}
 unlock(book,entry,descIds){
  let changed=false;
  if(!book.unlock_list.includes(entry.long_id)){book.unlock_list.push(entry.long_id);changed=true;}
  let desc=book.unlock_desc.find(x=>x.id===entry.id);if(!desc){desc={id:entry.id,list:[]};book.unlock_desc.push(desc);}
  for(const id of descIds)if(!desc.list.includes(id)){desc.list.push(id);changed=true;}
  if(!book.show_sub.some(x=>x.id===entry.id)){book.show_sub.push({id:entry.id,sub_id:entry.long_id});changed=true;}
  return changed;
 }
 itemMatches(entry,item){return entry.item_id===item.id||entry.icon===item.id||(entry.icon!==undefined&&entry.icon===item.img?.index)||(entry.pic_img!==undefined&&entry.pic_img===item.img?.index)||canonical(entry.name)===canonical(item.name)||canonical(entry.name+'·'+entry.sub_name)===canonical(item.name);}
 observePlants(account,s){
  const creative=this.store.get(account,'creative',()=>({}));
  for(const plant of array(creative.flowerpot?.plant_list)){
   const cfg=this.config.flowerpotData_json?.plant?.[plant.id];if(cfg&&integer(plant.stage)){const name=canonical(cfg.name);s.plants[name]=Math.max(s.plants[name]||0,plant.stage);}
  }
  const raw=this.db.getOfficialArchive(account)?.protocols?.client_load_decorate,modules=this.store.export(account);
  const decorations=[raw,modules.decoration,...Object.values(modules).flatMap(x=>[x.decorate,x.decoration])].filter(Boolean);
  for(const d of decorations){
   const selected=this.config.decoration_json?.[d.put_id];
   if(selected&&d.status>0){const name=canonical(selected.name),stage=Math.min(2,Number(d.status));s.flower_stages[name]=Math.max(s.flower_stages[name]||0,stage);s.arrangements[name]=Math.max(s.arrangements[name]||0,stage);}
   for(const owned of array(d.has_list)){const cfg=this.config.decoration_json?.[owned.id];if(cfg&&owned.num>0&&s.plants[canonical(cfg.name)]===undefined)s.plants[canonical(cfg.name)]=0;}
   for(const observed of array(d.stage_history)){
    const cfg=this.config.decoration_json?.[observed.id];if(!cfg||!integer(observed.stage,1))continue;const name=canonical(cfg.name),stage=Math.min(2,observed.stage);
    s.flower_stages[name]=Math.max(s.flower_stages[name]||0,stage);s.arrangements[name]=Math.max(s.arrangements[name]||0,stage);
   }
  }
 }
 activateTitles(account,s,inventory,now){
  const changes=[];
  for(const row of inventory){const item=this.items.get(row.item_id);if(item?.type!==14||Number(item.sub_type)!==8||row.count<=0)continue;
   const match=String(item.name||'').match(/^(.+)·(\d+)天$/),title=this.achievements.find(x=>x.name===match?.[1]&&(x.is_special||x.id>=900));if(!title||!match)continue;
   const seconds=Number(match[2])*row.count*86400,expires=Math.max(now,Number(s.special_titles[title.id]||0))+seconds;
   if(!Number.isSafeInteger(expires)||expires>8640000000000)throw Error('Invalid title duration');
   this.db.changeInventory(account,item.id,-row.count);s.special_titles[title.id]=expires;changes.push({item_id:item.id,count:0});
  }
  return changes;
 }
 sync(account){return this.db.transaction(()=>{
  const s=this.state(account),now=this.clock(),role=this.db.ensureAccount(account),itemState=this.db.getItemState(account),inventory=itemState.house;
  const itemChanges=this.activateTitles(account,s,inventory,now),held=unique([...inventory.filter(x=>x.count>0).map(x=>x.item_id),...itemState.bag,...itemState.desk]).filter(id=>id>=0);
  s.acquired_items=unique([...s.acquired_items,...held]);
  let handbookChanged=false;for(const id of s.acquired_items)if(this.items.get(id)?.type===3){const result=this.db.db.prepare('INSERT OR IGNORE INTO handbook VALUES (?,\'specialty\',?)').run(account,id);if(result.changes)handbookChanged=true;}
  const handbook=this.db.getHandbook(account),counts=new Map(inventory.map(x=>[x.item_id,x.count]));
  const trip=this.db.getTravelState(account);if(trip&&now-trip.started_at>86400)s.long_trip=true;
  this.observePlants(account,s);
  const accountPictures=['album','new','recycle','gift'].flatMap(location=>this.db.getPostcards(account,location));
  const anim=this.store.get(account,'animpicture',()=>({}));for(const row of array(anim.pic_list))accountPictures.push(...array(row.exp_pic),...array(row.pictures),...(row.source_picture?[row.source_picture]:[]));
  s.seen_pic_ids=unique([...s.seen_pic_ids,...accountPictures.map(x=>x.pic_id).filter(id=>integer(id))]);
  for(const city of this.cityGroups)if(city.ids.size&&s.seen_pic_ids.some(id=>city.ids.has(id))&&!s.cities.includes(city.name))s.cities.push(city.name);
  const cake=this.store.get(account,'partycake',()=>({}));if(cake.cur_state===6)s.anniversary=true;
  if(s.days.includes(day(now))&&role.created_at>0&&now-role.created_at>=31536000&&day(role.created_at).slice(5)===day(now).slice(5))s.anniversary=true;
  const earned=[],expired=[],old=new Set(this.db.db.prepare('SELECT achievement_id AS id FROM achievements WHERE account=?').all(account).map(x=>x.id));
  for(const [id,expires]of Object.entries(s.special_titles)){if(expires<=now&&old.has(Number(id))){this.db.db.prepare('DELETE FROM achievements WHERE account=? AND achievement_id=?').run(account,Number(id));old.delete(Number(id));expired.push(Number(id));if(role.current_achievement===Number(id))this.db.updateAccount(account,{current_achievement:0});}}
  const museumCount=handbook.collections.filter(id=>this.museumCollections.has(id)).length;
  for(const a of this.achievements){if(old.has(a.id))continue;const condition=this.conditions.get(a.id);let ok=false;
   switch(condition.kind){
    case 'default':ok=true;break;
    case 'trip-count':ok=role.trip_count>=condition.count;break;
    case 'collections':ok=handbook.collections.length>=condition.count;break;
    case 'specialties':ok=handbook.specialtys.length>=condition.count;break;
    case 'login-days':ok=s.days.length>=condition.count;break;
    case 'inventory':ok=condition.item!==undefined&&(counts.get(condition.item)||0)>condition.count;break;
    case 'all-specialties':{const all=(this.catalog.specialties||rows(this.config.Specialty_json)).map(x=>x.itemId);ok=all.length>0&&all.every(id=>handbook.specialtys.includes(id));break;}
    case 'short-trip':ok=s.short_return;break;
    case 'long-trip':ok=s.long_trip;break;
    case 'clover':ok=role.clover>condition.count;break;
    case 'gacha':ok=(itemState.gacha.draw_count||0)>=condition.count;break;
    case 'juice':ok=s.juice_streak>=condition.count;break;
    case 'flower-stage':ok=(s.flower_stages[condition.plant]||0)>=condition.stage;break;
    case 'children-day':ok=s.days.includes(day(now))&&day(now).slice(5)==='06-01';break;
    case 'all-cities':ok=this.cityGroups.length>0&&this.cityGroups.every(x=>s.cities.includes(x.name));break;
    case 'museum-collections':ok=museumCount>=condition.count;break;
    case 'anniversary':ok=s.anniversary;break;
    case 'timed-title':ok=(s.special_titles[a.id]||0)>now;break;
   }
   if(ok){const result=this.db.db.prepare('INSERT OR IGNORE INTO achievements VALUES (?,?,?)').run(account,a.id,now);if(result.changes)earned.push(a.id);}
  }
  let bookChanged=false,encyclopediaChanged=false;
  for(const entry of rows(this.config.encytravel_json?.list)){
   if(!s.acquired_items.includes(Number(entry.item_id)))continue;
   bookChanged=this.unlock(s.travel_book,entry,Object.keys(this.config.encytravel_json?.desc?.[entry.id]||{}).map(Number))||bookChanged;
  }
  for(const entry of rows(this.config.encyclopedia_json?.list)){
   const items=[...this.items.values()].filter(item=>this.itemMatches(entry,item));const heldBefore=items.some(item=>s.acquired_items.includes(item.id));
   const names=unique([canonical(entry.name),canonical(entry.name+'·'+entry.sub_name),...items.map(x=>canonical(x.name))]);
   const stages=names.map(name=>s.plants[name]).filter(Number.isFinite),arrangements=names.map(name=>s.arrangements[name]).filter(Number.isFinite);
   const grown=stages.length?Math.max(...stages):-1,arranged=arrangements.length?Math.max(...arrangements):-1,stage=Math.max(grown,arranged),name=String(entry.pic_name||'');
   const growing=name.match(/^成长(\d+)/),arranging=name.match(/^插花(\d+)/);
   const visible=Number(entry.pic_id)===1?(heldBefore||stage>=0):growing?grown>=Number(growing[1]):arranging?arranged>=Number(arranging[1]):stage>=0&&Number(entry.pic_id)<=stage+1;
   if(!visible)continue;
   const allDesc=Object.keys(this.config.encyclopedia_json?.desc?.[entry.id]||{}).map(Number),unlockedDesc=allDesc.slice(0,Math.max(1,stage+1));
   encyclopediaChanged=this.unlock(s.plant_book,entry,unlockedDesc)||encyclopediaChanged;
  }
  this.store.set(account,'progression',s);
  const events=itemChanges.map(item=>({cmd:'item_update',data:{item}}));
  if(earned.length||expired.length)events.push({cmd:'client_load_role',data:this.db.getRole(account)});
  if(bookChanged)events.push({cmd:'encytravel_load',data:this.travelBook(account)});
  if(encyclopediaChanged)events.push({cmd:'encyclopedia_load',data:this.encyclopedia(account)});
  if(handbookChanged)events.push({cmd:'item_load_handbook',data:this.db.getHandbook(account)});
  return {earned,expired,bookChanged,encyclopediaChanged,handbookChanged,itemChanges,events};
 });}
 initial(account){const result=this.sync(account);return [...result.events.filter(x=>!['encytravel_load','encyclopedia_load'].includes(x.cmd)),{cmd:'encytravel_load',data:this.travelBook(account)},{cmd:'encyclopedia_load',data:this.encyclopedia(account)}];}
 handle(account,cmd,data={}){
  if(!this.commands.has(cmd))return null;
  if(cmd==='encytravel_load'){this.sync(account);return {response:this.travelBook(account),events:[]};}
  if(cmd==='encyclopedia_load'){this.sync(account);return {response:this.encyclopedia(account),events:[]};}
  const plant=cmd==='encyclopedia_set_show_sub',module=plant?'encyclopedia_json':'encytravel_json',book=plant?this.encyclopedia(account):this.travelBook(account),entry=this.config[module]?.list?.[data.long_id];
  if(!entry||!book.unlock_list.includes(data.long_id))return {response:{code:1},events:[]};
  const state=this.state(account),target=plant?state.plant_book:state.travel_book;target.show_sub=target.show_sub.filter(x=>x.id!==entry.id);target.show_sub.push({id:entry.id,sub_id:data.long_id});this.store.set(account,'progression',state);return {response:{code:0},events:[]};
 }
}
module.exports={ProgressionService};
