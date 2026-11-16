'use strict';

const {ModuleState}=require('./module_state');
const {exportFurnitureState}=require('./furniture');
const values=value=>Array.isArray(value)?value:value&&typeof value==='object'?Object.values(value):[];
const clone=value=>JSON.parse(JSON.stringify(value));
const commands=new Set(['guest_load_drawing','guest_accept_invit','guest_putin_bag','guest_takeout_bag','guest_lock_bag','pray_load_grays','pray_confirm_make_box','pray_compose','furniture_load_tumbler','furniture_replace_tumbler','furniture_load_compost','furniture_load_pocket','furniture_load_flowerpot','furniture_replace_compost','furniture_replace_pocket','furniture_replace_flowerpot','furniture_putin_box','furniture_takeout_box','furniture_pocket_get','furniture_flowerpot_harvest']);

class CreativeService {
  constructor(database,catalog={},options={}){
    this.db=database;this.storage=new ModuleState(database);this.config=catalog.config||{};
    this.items=new Map((catalog.items||values(this.config.Item_json)).map(x=>[x.id,x]));
    this.pages=values(this.config.drawingPageData_json);this.collections=values(this.config.drawingCollectData_json);
    this.prays=values(this.config.prayData_json);this.bodies=new Map(values(this.config.prayBodyData_json).map(x=>[x.id,x]));
    this.stamps=values(this.config.stampData_json);this.notes=values(this.config.prayNoteData_json);
    this.tumblers=values(this.config.tumblerData_json);this.paths=values(this.config.tumblerPathData_json);
    this.composts=values(this.config.compostData_json);this.pockets=values(this.config.pocketData_json);
    this.flowerpots=values(this.config.flowerpotData_json?.flowerpot);this.plants=values(this.config.flowerpotData_json?.plant);
    this.clock=options.clock||(()=>Math.floor(Date.now()/1000));this.random=options.random||Math.random;
    this.drawingSeconds=options.drawingSeconds??1800;this.departSeconds=options.departSeconds??30;this.inviteSeconds=options.inviteSeconds??21600;
    this.craftSeconds=options.craftSeconds??900;this.craftCooldown=options.craftCooldown??300;this.tumblerSeconds=options.tumblerSeconds??1800;
    this.pocketSeconds=options.pocketSeconds??300;this.plantSeconds=options.plantSeconds??3600;this.compostSeconds=options.compostSeconds??900;this.fertilitySeconds=options.fertilitySeconds??21600;
    this.pocketCapacity=Number(this.config.pocketCommonData_json?.base_info)||50;
    for(const key of ['drawingSeconds','departSeconds','inviteSeconds','craftSeconds','craftCooldown','tumblerSeconds','pocketSeconds','plantSeconds','compostSeconds','fertilitySeconds'])if(!Number.isSafeInteger(this[key])||this[key]<1)throw Error('Invalid creative duration '+key);
    this.commands=commands;
  }
  choose(list){if(!list.length)return null;const n=Number(this.random());return list[Math.min(list.length-1,Math.max(0,Math.floor((Number.isFinite(n)?n:0)*list.length)))];}
  seed(account){
    const raw=this.db.getOfficialArchive(account)?.protocols||{},drawing=raw.guest_load_drawing||{},pray=raw.pray_load_grays||{},tumbler=raw.furniture_load_tumbler||{};
    const pages=values(drawing.pages).filter(id=>this.pages.some(x=>x.id===id)),colls=values(drawing.colls).filter(id=>this.collections.some(x=>x.id===id));
    // Old official parties have no surviving local deadline. Their reserved bag
    // and collection survive, while the party resumes at preparation, without rewards.
    return {version:1,drawing:{state:[0,1,2,3].includes(drawing.state)?drawing.state:drawing.state===4?2:0,guest:Number.isInteger(drawing.guest)?drawing.guest:0,
      bag:Array.from({length:4},(_,i)=>Number.isSafeInteger(drawing.bag?.[i])?drawing.bag[i]:-1),pages,colls,show_coll:Number(drawing.show_coll)||0,pen_motion:drawing.pen_motion||'write',
      next_invite:0,depart_at:0,returns_at:0,cycle:0},
      pray:{wishs:values(pray.wishs),stamps:values(pray.stamps),boxes:values(pray.boxes),wish_new:pray.wish_new||null,stamp_new:pray.stamp_new||null,job:null,next_at:0,sequence:0},
      tumbler:{show_index:Number(tumbler.show_index)||0,replace_index:0,tumbler_list:values(tumbler.tumbler_list),job:null,next_at:0},...this.seedGarden(account)};
  }
  seedGarden(account){
    const raw=this.db.getOfficialArchive(account)?.protocols||{},c=raw.furniture_load_compost||{},p=raw.furniture_load_pocket||{},f=raw.furniture_load_flowerpot||{},now=this.clock();
    return {compost:{show_index:Number(c.show_index)||0,replace_index:0,compost_list:values(c.compost_list),state:Number(c.state)||1,box_index:0,box_list:Array.from({length:6},(_,i)=>Number(c.box_list?.[i])||0),job:null,last_decay:now},
      pocket:{show_index:Number(p.show_index)||0,replace_index:0,list:values(p.list),clover:Number(p.clover)||0,last_at:now},
      flowerpot:{show_index:Number(f.show_index)||0,replace_index:0,list:values(f.list),plant_list:values(f.plant_list).map(x=>({...x,started_at:x.started_at||now,finish_at:x.stage===3?now:now+this.plantSeconds})),next_at:now},structure_job:null,structure_next_at:0};
  }
  state(account){this.db.ensureAccount(account);const state=this.storage.get(account,'creative',()=>this.seed(account));if(!state.compost){Object.assign(state,this.seedGarden(account));}return state;}
  save(account,state){return this.storage.set(account,'creative',state);}
  drawingData(state){const {state:phase,guest,bag,pages,colls,show_coll,pen_motion}=state.drawing;return {state:phase,guest,bag:clone(bag),pages:clone(pages),colls:clone(colls),show_coll,pen_motion};}
  prayData(state){const {wishs,stamps,boxes,wish_new,stamp_new}=state.pray;return clone({wishs,stamps,boxes,wish_new,stamp_new});}
  tumblerData(state){const {show_index,replace_index,tumbler_list}=state.tumbler;return clone({show_index,replace_index,tumbler_list});}
  gardenData(state,kind){const s=state[kind];if(kind==='compost'){const {show_index,replace_index,compost_list,state:level,box_index,box_list}=s;return clone({show_index,replace_index,compost_list,state:level,box_index,box_list});}if(kind==='pocket'){const {show_index,replace_index,list,clover}=s;return clone({show_index,replace_index,list,clover});}const {show_index,replace_index,list,plant_list}=s;return {show_index,replace_index,list:clone(list),plant_list:plant_list.map(({index,id,stage})=>({index,id,stage}))};}
  initial(account){const advanced=this.advance(account);const state=this.state(account);return [...advanced.events.filter(x=>!['guest_load_drawing','pray_load_grays','furniture_load_tumbler','furniture_load_compost','furniture_load_pocket','furniture_load_flowerpot'].includes(x.cmd)),{cmd:'guest_load_drawing',data:this.drawingData(state)},{cmd:'pray_load_grays',data:this.prayData(state)},{cmd:'furniture_load_tumbler',data:this.tumblerData(state)},...['compost','pocket','flowerpot'].map(kind=>({cmd:'furniture_load_'+kind,data:this.gardenData(state,kind)}))];}
  isBenchLocked(account){const state=this.state(account);return !!state.tumbler.job||!!state.structure_job;}
  decorateFurnitureState(account,projection){return {...projection,bench_lock:!!projection.bench_lock||this.isBenchLocked(account)};}
  updates(account,state,changed={}){
    const out=[];
    if(changed.drawing)out.push({cmd:'guest_load_drawing',data:this.drawingData(state)});
    if(changed.pray)out.push({cmd:'pray_load_grays',data:this.prayData(state)});
    if(changed.tumbler)out.push({cmd:'furniture_load_tumbler',data:this.tumblerData(state)});
    for(const kind of ['compost','pocket','flowerpot'])if(changed[kind])out.push({cmd:'furniture_load_'+kind,data:this.gardenData(state,kind)});
    if(changed.role)out.push({cmd:'client_load_role',data:this.db.getRole(account)});
    for(const item of changed.items||[])out.push({cmd:'item_update',data:{item}});
    for(const event of changed.events||[])out.push({cmd:'notify_new_event',data:{event}});
    return out;
  }
  inventory(account,id,delta,changed){const item={item_id:id,count:this.db.changeInventory(account,id,delta)};const old=changed.items.findIndex(x=>x.item_id===id);if(old>=0)changed.items[old]=item;else changed.items.push(item);}
  fail(message){return {response:{code:1,message},events:[]};}
  handle(account,cmd,data={}){
    cmd=cmd.replace('.','_');if(!commands.has(cmd))return null;
    return this.db.transaction(()=>{
      const state=this.state(account),drawing=state.drawing,now=this.clock(),changed={items:[],events:[]};
      if(cmd==='guest_load_drawing')return {response:this.drawingData(state),events:[]};
      if(cmd==='pray_load_grays')return {response:this.prayData(state),events:[]};
      if(cmd==='furniture_load_tumbler')return {response:this.tumblerData(state),events:[]};
      for(const kind of ['compost','pocket','flowerpot']){
        if(cmd==='furniture_load_'+kind)return {response:this.gardenData(state,kind),events:[]};
        if(cmd==='furniture_replace_'+kind){
          const list=kind==='compost'?state.compost.compost_list:state[kind].list;
          if(!Number.isSafeInteger(data.index)||data.index<0||data.index>list.length)return {response:{code:-1,message:'物件尚未拥有'},events:[]};
          this.advanceGarden(account,state,now,changed);state[kind].show_index=data.index;state[kind].replace_index=0;if(kind==='pocket')state.pocket.last_at=now;changed[kind]=true;
          this.save(account,state);return {response:{code:1},events:this.updates(account,state,changed)};
        }
      }
      if(cmd==='furniture_putin_box'||cmd==='furniture_takeout_box'){
        const c=state.compost,pos=data.pos;
        if(!Number.isSafeInteger(pos)||pos<1||pos>6||!c.show_index||pos===c.box_index)return this.fail('当前不能修改该堆肥槽');
        const old=c.box_list[pos-1];
        if(cmd==='furniture_takeout_box'){if(old>0)this.inventory(account,old,1,changed);c.box_list[pos-1]=0;}
        else {const item=this.items.get(data.id);if(!item||!(item.type===3||item.type===15&&item.sub_type===1))return this.fail('只能投入特产或肥料');
          if(old===data.id)return {response:{code:0},events:[]};if(this.db.getInventoryCount(account,data.id)<1)return this.fail('库存不足');
          this.inventory(account,data.id,-1,changed);if(old>0)this.inventory(account,old,1,changed);c.box_list[pos-1]=data.id;
        }changed.compost=true;this.save(account,state);return {response:{code:0},events:this.updates(account,state,changed)};
      }
      if(cmd==='furniture_pocket_get'){
        this.advanceGarden(account,state,now,changed);const p=state.pocket;if(p.clover<1){this.save(account,state);return {response:{code:1,message:'挂兜还是空的'},events:this.updates(account,state,changed)};}
        const reward=p.clover;p.clover=0;p.last_at=now;const role=this.db.getRole(account);this.db.updateAccount(account,{clover:role.res.clover_point+reward});changed.pocket=changed.role=true;
        this.save(account,state);return {response:{code:0},events:this.updates(account,state,changed)};
      }
      if(cmd==='furniture_flowerpot_harvest'){
        this.advanceGarden(account,state,now,changed);const f=state.flowerpot,plant=f.plant_list.find(x=>x.index===data.index);
        if(!Number.isSafeInteger(data.index)||!f.show_index||!plant||plant.stage!==3){this.save(account,state);return {response:{code:1,message:'植物尚未成熟'},events:this.updates(account,state,changed)};}
        const definition=this.plants.find(x=>x.id===plant.id),item=definition?this.plantReward(definition):null;
        if(!item){this.save(account,state);return {response:{code:1,message:'植物产物配置不可用'},events:this.updates(account,state,changed)};}
        this.inventory(account,item.id,1,changed);f.plant_list=f.plant_list.filter(x=>x.index!==data.index);f.next_at=now+this.craftCooldown;changed.flowerpot=true;
        this.save(account,state);return {response:{code:0,item_list:[{item_id:item.id,num:1}]},events:this.updates(account,state,changed)};
      }
      if(cmd==='guest_accept_invit'){
        if(typeof data.is_accept!=='boolean')return this.fail('Invalid invitation choice');
        if(!this.pages.length||this.db.getInventoryCount(account,7001)<1)return this.fail('需要友情绘本');
        if([3,4].includes(drawing.state))return this.fail('聚会准备已锁定或正在参加');
        if(data.is_accept){drawing.state=2;drawing.depart_at=0;}
        else {for(const id of drawing.bag)if(id>=0)this.inventory(account,id,1,changed);drawing.bag=[-1,-1,-1,-1];drawing.state=0;drawing.next_invite=now+this.inviteSeconds;}
        changed.drawing=true;
      }else if(cmd==='guest_putin_bag'||cmd==='guest_takeout_bag'){
        const pos=data.pos;
        if(drawing.state!==2||!Number.isSafeInteger(pos)||pos<1||pos>4)return this.fail('无法修改聚会背包');
        const current=drawing.bag[pos-1];
        if(cmd==='guest_takeout_bag'){
          if(current>=0){this.inventory(account,current,1,changed);drawing.bag[pos-1]=-1;}changed.drawing=true;
        }else{
          const item=this.items.get(data.id),food=this.config.drawingCommonData_json?.food;
          const foods=food?[food.value2?.[0],food.value3?.[0],food.value4?.[0]].filter(Boolean).map(x=>Number(String(x).split(',')[1])):[16,15,33];
          if(!Number.isSafeInteger(data.id)||!item||(pos===1?!foods.includes(data.id):item.type!==3))return this.fail('该物品不能放入此聚会槽位');
          if(current===data.id)return {response:{code:0},events:[]};
          if(this.db.getInventoryCount(account,data.id)<1)return this.fail('物品数量不足');
          this.inventory(account,data.id,-1,changed);if(current>=0)this.inventory(account,current,1,changed);drawing.bag[pos-1]=data.id;changed.drawing=true;
        }
      }else if(cmd==='guest_lock_bag'){
        if(drawing.state===3){drawing.state=2;drawing.depart_at=0;}
        else if(drawing.state===2){if(drawing.bag[0]<0)return this.fail('请先准备手信');drawing.state=3;drawing.depart_at=now+this.departSeconds;}
        else return this.fail('当前不能锁定聚会背包');changed.drawing=true;
      }else if(cmd==='pray_confirm_make_box'){state.pray.boxes=[];changed.pray=true;}
      else if(cmd==='pray_compose'){
        if(data.id!==5502)return this.fail('未知合成配方');
        const pieces=[1,2,3].map(sub=>[...this.items.values()].find(x=>x.type===16&&x.sub_type===sub)?.id);
        const outputs=[...this.items.values()].filter(x=>x.type===1&&x.id>=1300&&x.id<=1309);
        if(pieces.some(id=>id===undefined)||!outputs.length)return this.fail('合成配置不可用');
        if(pieces.some(id=>this.db.getInventoryCount(account,id)<1))return this.fail('木片尚未凑齐');
        pieces.forEach(id=>this.inventory(account,id,-1,changed));const output=this.choose(outputs).id;this.inventory(account,output,1,changed);this.save(account,state);
        return {response:{code:0,item_list:[output]},events:this.updates(account,state,changed)};
      }else if(cmd==='furniture_replace_tumbler'){
        if(!Number.isSafeInteger(data.index)||data.index<0||data.index>state.tumbler.tumbler_list.length)return {response:{code:-1,message:'不倒翁尚未拥有'},events:[]};
        state.tumbler.show_index=data.index;state.tumbler.replace_index=0;changed.tumbler=true;
        this.save(account,state);return {response:{code:1},events:this.updates(account,state,changed)};
      }
      this.save(account,state);return {response:{code:0},events:this.updates(account,state,changed)};
    });
  }
  advance(account){
    return this.db.transaction(()=>{
      const state=this.state(account),now=this.clock(),changed={items:[],events:[]};
      this.advanceDrawing(account,state,now,changed);this.advancePray(account,state,now,changed);this.advanceGarden(account,state,now,changed);this.advanceStructures(account,state,now,changed);this.advanceTumbler(account,state,now,changed);
      this.save(account,state);const events=this.updates(account,state,changed);return {changed:events.length>0,events};
    });
  }
  advanceDrawing(account,state,now,changed){
    const d=state.drawing;if(!this.pages.length||this.db.getInventoryCount(account,7001)<1)return;
    if(d.state===0&&now>=d.next_invite){d.guest=this.choose([0,1,2]);d.state=1;changed.drawing=true;return;}
    if(d.state===3&&d.depart_at===0){d.depart_at=now+this.departSeconds;return;}
    if(d.state===3&&now>=d.depart_at&&this.db.getRole(account).frog.status===0&&!this.db.getTravelState(account)){
      d.state=4;d.returns_at=now+this.drawingSeconds;this.db.updateAccount(account,{frog_status:3,frog_motion:-1});changed.role=changed.drawing=true;changed.events.push(this.db.enqueueEvent(account,23,d.guest,[0]));return;
    }
    if(d.state!==4||now<d.returns_at)return;
    const pages=this.pages.filter(x=>x.guest===d.guest&&!d.pages.includes(x.id));const page=this.choose(pages),possible=this.collections.filter(x=>(x.guest===d.guest||x.guest===-1)&&(!x.page||x.page===page?.id)&&!d.colls.includes(x.id));
    const coll=this.choose(possible);if(page)d.pages.push(page.id);if(coll)d.colls.push(coll.id);
    d.bag=[-1,-1,-1,-1];d.state=0;d.cycle++;d.next_invite=now+this.inviteSeconds;d.depart_at=d.returns_at=0;
    const role=this.db.getRole(account);const reward=20;this.db.updateAccount(account,{frog_status:0,frog_motion:0,clover:role.res.clover_point+reward});
    changed.role=changed.drawing=true;changed.events.push(this.db.enqueueEvent(account,24,d.guest,[page?.id??-1,coll?.id??-1,reward,0]));
  }
  advancePray(account,state,now,changed){
    const p=state.pray;
    if(p.job){
      if(now<p.job.finish_at)return;
      const job=p.job;
      if(job.kind==='wish'){
        p.wishs.push(job.record);p.wish_new=job.record;
      }else if(job.kind==='stamp'){
        const found=p.stamps.findIndex(x=>x.id===job.record.id);if(found<0)p.stamps.push(job.record);else p.stamps[found]=job.record;p.stamp_new=job.record;
      }else {this.inventory(account,job.item_id,1,changed);p.boxes.push(job.item_id);}
      p.job=null;p.next_at=now+this.craftCooldown;changed.pray=true;return;
    }
    if(now<p.next_at||this.db.getRole(account).frog.status!==0||this.db.getInventoryCount(account,7000)<1)return;
    const material=this.db.getInventoryCount(account,8000)>0?8000:this.db.getInventoryCount(account,8001)>0?8001:null;if(!material)return;
    const uid=Math.max(now*1000,++p.sequence);p.sequence=uid;
    if(material===8001){
      const outputs=[...this.items.values()].filter(x=>[0,1,3,10,11,16].includes(x.type));if(!outputs.length)return;
      p.job={kind:'box',item_id:this.choose(outputs).id,finish_at:now+this.craftSeconds};
    }else if((p.wishs.length+p.stamps.length)%2===0&&this.prays.length){
      const type=this.choose(this.prays),index=type.state.indexOf(4);if(index<0)return;
      const parse=text=>String(text||'').split(',').map(Number).filter(id=>this.bodies.has(id));
      const body=this.choose(parse(type.wood_body[index])),paper=this.choose(parse(type.paper[index]));if(!body||!paper)return;
      const note=this.choose(this.notes),stamp=this.choose(p.stamps);
      p.job={kind:'wish',finish_at:now+this.craftSeconds,record:{u_id:uid,id:type.id,state:4,body,paper,content:note?.id||0,make_time:now+this.craftSeconds,stamp:stamp?.id||0,stamp_state:stamp?.state||0,stamp_time:stamp?now+this.craftSeconds:0}};
    }else if(this.stamps.length){
      const candidate=this.choose(this.stamps.filter(x=>!p.stamps.some(s=>s.id===x.id&&s.state>=Math.max(...x.state))));if(!candidate)return;
      const previous=p.stamps.find(x=>x.id===candidate.id);const next=candidate.state.find(x=>x>(previous?.state||0));if(!next)return;
      p.job={kind:'stamp',finish_at:now+this.craftSeconds,record:{u_id:uid,id:candidate.id,state:next,time:now+this.craftSeconds}};
    }else return;
    this.inventory(account,material,-1,changed);changed.pray=true;
  }
  tumblerLayers(id){
    const family=id%10===2?10000:0;const eyes=this.paths.filter(x=>x.id>=family+1000&&x.id<family+2000),decor=this.paths.filter(x=>x.id>=family+2000&&x.id<family+3000);
    const eye=this.choose(eyes)||this.paths.find(x=>!x.adorn),adorn=this.choose(decor)||this.paths.find(x=>x.adorn===1);
    return [eye,adorn].filter(Boolean).map(x=>({layer:[x.id,0,0,0,0]}));
  }
  advanceTumbler(account,state,now,changed){
    const t=state.tumbler;
    if(t.job){
      if(now<t.job.finish_at)return;
      if(!this.tumblers.some(x=>x.id===t.job.id))return;
      const result={id:t.job.id,layers:t.job.layers};t.tumbler_list.push(result);t.job=null;t.next_at=now+this.craftCooldown;changed.tumbler=true;
      const event=this.db.enqueueEvent(account,21,result.id,[5,...result.layers.flatMap(x=>x.layer)]);changed.events.push(event);return;
    }
    if(state.structure_job||now<t.next_at||!this.tumblers.length||!this.paths.length||this.db.getRole(account).frog.status!==0||this.db.getInventoryCount(account,10401)<1||this.db.getInventoryCount(account,10001)<1)return;
    const furniture=exportFurnitureState(this.db,account);if(!furniture||furniture.job)return;
    const tool=furniture.bench.slice(0,5).some(id=>this.items.get(id)?.type===12&&this.db.getInventoryCount(account,id)>0);if(!tool)return;
    const remaining=this.tumblers.filter(x=>!t.tumbler_list.some(y=>y.id===x.id));const selected=this.choose(remaining);if(!selected)return;
    const layers=this.tumblerLayers(selected.id);if(!layers.length)return;
    this.inventory(account,10001,-1,changed);t.job={id:selected.id,layers,finish_at:now+this.tumblerSeconds};changed.tumbler=true;
  }
  advanceStructures(account,state,now,changed){
    if(state.structure_job){if(now<state.structure_job.finish_at)return;const {kind,id}=state.structure_job;const list=kind==='compost'?state.compost.compost_list:state[kind].list;
      if(!list.includes(id))list.push(id);state.structure_job=null;state.structure_next_at=now+this.craftCooldown;changed[kind]=true;changed.events.push(this.db.enqueueEvent(account,21,id,[]));return;
    }
    if(state.tumbler.job||now<state.structure_next_at||this.db.getRole(account).frog.status!==0)return;
    const furniture=exportFurnitureState(this.db,account);if(!furniture||furniture.job||!furniture.bench.slice(0,5).some(id=>this.items.get(id)?.type===12&&this.db.getInventoryCount(account,id)>0))return;
    const recipes=[{kind:'compost',paper:10501,material:10001,rows:this.composts.filter(x=>x.id!==21000)},{kind:'pocket',paper:10601,material:10005,rows:this.pockets},{kind:'flowerpot',paper:10701,material:10003,rows:this.flowerpots}];
    // Finish one useful object of each type before choosing cosmetic variants.
    recipes.sort((a,b)=>(a.kind==='compost'?state.compost.compost_list:state[a.kind].list).length-(b.kind==='compost'?state.compost.compost_list:state[b.kind].list).length);
    for(const recipe of recipes){const list=recipe.kind==='compost'?state.compost.compost_list:state[recipe.kind].list;
      if(this.db.getInventoryCount(account,recipe.paper)<1||this.db.getInventoryCount(account,recipe.material)<1)continue;
      const selected=this.choose(recipe.rows.filter(x=>!list.includes(x.id)));if(!selected)continue;
      this.inventory(account,recipe.material,-1,changed);state.structure_job={kind:recipe.kind,id:selected.id,finish_at:now+this.tumblerSeconds};changed[recipe.kind]=true;return;
    }
  }
  compostGrowthFactor(account){const state=this.state(account);return state.compost.show_index&&state.compost.state>=3?0.75:1;}
  plantReward(plant){const items=[...this.items.values()];return items.find(x=>x.name===plant.name)||items.find(x=>x.type===3&&x.name===plant.name.split('·')[0]);}
  advanceGarden(account,state,now,changed){
    const c=state.compost,p=state.pocket,f=state.flowerpot;
    if(c.show_index){
      if(now-c.last_decay>=this.fertilitySeconds){c.state=Math.max(1,c.state-Math.floor((now-c.last_decay)/this.fertilitySeconds));c.last_decay=now;changed.compost=true;}
      if(c.job&&now>=c.job.finish_at){c.box_list[c.box_index-1]=0;c.box_index=0;c.state=Math.min(4,c.state+c.job.power);c.job=null;c.last_decay=now;changed.compost=true;}
      if(!c.job){const slot=c.box_list.findIndex(id=>id>0);if(slot>=0){const item=this.items.get(c.box_list[slot]);if(item){c.box_index=slot+1;c.job={item_id:item.id,power:item.type===15?1+(item.id-20001)%3:1,finish_at:now+this.compostSeconds};changed.compost=true;}}}
    }
    if(p.show_index){const intervals=Math.floor(Math.max(0,now-p.last_at)/this.pocketSeconds);if(intervals){p.clover=Math.min(this.pocketCapacity,p.clover+intervals);p.last_at+=intervals*this.pocketSeconds;changed.pocket=true;}}
    else p.last_at=now;
    if(!f.show_index)return;const pot=this.flowerpots.find(x=>x.id===f.list[f.show_index-1]);if(!pot)return;
    for(const plant of f.plant_list){if(!plant.id)continue;const stage=now>=plant.finish_at?3:now>=(plant.started_at+plant.finish_at)/2?2:1;if(stage!==plant.stage){plant.stage=stage;changed.flowerpot=true;}}
    if(now<f.next_at||this.db.getRole(account).frog.status!==0)return;
    for(let index=1;index<=(pot.pos_list?.length||2);index++){
      const current=f.plant_list.find(x=>x.index===index);if(current?.id)continue;
      const seeds=[...this.items.values()].filter(item=>item.type===15&&item.sub_type===2&&this.db.getInventoryCount(account,item.id)>0);
      const options=seeds.flatMap(seed=>this.plants.filter(plant=>Math.floor(plant.id/100)===seed.id).map(plant=>({seed,plant})));const selected=this.choose(options);if(!selected)break;
      this.inventory(account,selected.seed.id,-1,changed);f.plant_list=f.plant_list.filter(x=>x.index!==index);
      const duration=Math.max(1,Math.round(this.plantSeconds*(c.show_index&&c.state>=3?0.75:1)));f.plant_list.push({index,id:selected.plant.id,stage:1,started_at:now,finish_at:now+duration});changed.flowerpot=true;
    }
  }
}
module.exports={CreativeService};
