'use strict';
const {ModuleState}=require('../../core/module_state');
const values=value=>Array.isArray(value)?value:Object.values(value||{}),clone=value=>JSON.parse(JSON.stringify(value));
class DecorationService{
  constructor(database,catalog={},options={}){
    this.db=database;this.store=new ModuleState(database);this.config=catalog.config||{};this.definitions=new Map(values(this.config.decoration_json).map(x=>[x.id,x]));
    this.items=new Map((catalog.items||values(this.config.Item_json)).map(x=>[x.id,x]));this.clock=options.clock||(()=>Math.floor(Date.now()/1000));
    this.bloomSeconds=options.bloomSeconds??21600;this.lifeSeconds=options.lifeSeconds??172800;
    if(!Number.isSafeInteger(this.bloomSeconds)||!Number.isSafeInteger(this.lifeSeconds)||this.bloomSeconds<1||this.lifeSeconds<=this.bloomSeconds)throw Error('Invalid flower lifecycle');
    this.mapping=new Map();for(const definition of this.definitions.values()){const item=[...this.items.values()].find(x=>x.name===definition.name&&x.type===14);if(item)this.mapping.set(item.id,definition.id);}
    this.commands=new Set(['client_load_decorate','client_change_decorate']);
  }
  seed(account){const raw=this.db.getOfficialArchive(account)?.protocols?.client_load_decorate||{},has_list=values(raw.has_list).filter(x=>this.definitions.has(x.id)&&Number.isSafeInteger(x.num)&&x.num>0).map(x=>({id:x.id,num:x.num})),now=this.clock();
    const put_id=has_list.some(x=>x.id===raw.put_id)?raw.put_id:0,status=put_id?Math.min(2,Math.max(1,Number(raw.status)||1)):0;
    const stage_history=put_id?[{id:put_id,stage:status,at:now,source:'official-capture'}]:[];
    return {has_list,put_id,status,started_at:put_id?now:0,bloom_at:put_id?now+this.bloomSeconds:0,expires_at:put_id?now+this.lifeSeconds:0,stage_history,owned_history:has_list.map(x=>x.id),discarded:[]};
  }
  state(account){this.db.ensureAccount(account);return this.store.get(account,'decoration',()=>this.seed(account));}
  save(account,state){return this.store.set(account,'decoration',state);}
  data(state){return clone({has_list:state.has_list,put_id:state.put_id,status:state.status});}
  decorateRole(account,role){return {...role,frog:{...role.frog,decoration:clone(this.state(account).has_list)}};}
  history(state,id,stage,at){if(!state.stage_history.some(x=>x.id===id&&x.stage===stage))state.stage_history.push({id,stage,at,source:'local-observation'});}
  consumeCurrent(state,reason){
    if(!state.put_id)return;
    const old=state.has_list.find(x=>x.id===state.put_id);if(old){old.num--;state.has_list=state.has_list.filter(x=>x.num>0);}
    state.discarded.push({id:state.put_id,at:this.clock(),reason});state.put_id=0;state.status=0;state.started_at=state.bloom_at=state.expires_at=0;
  }
  ingest(account,state){const changes=[];for(const [item_id,id]of this.mapping){const count=this.db.getInventoryCount(account,item_id);if(count<1)continue;
      let row=state.has_list.find(x=>x.id===id);if(row)row.num+=count;else state.has_list.push({id,num:count});if(!state.owned_history.includes(id))state.owned_history.push(id);
      changes.push({item_id,count:this.db.changeInventory(account,item_id,-count)});
    }return changes;
  }
  age(state){let changed=false;const now=this.clock();if(state.put_id&&state.status===1&&state.bloom_at&&now>=state.bloom_at){state.status=2;this.history(state,state.put_id,2,state.bloom_at);changed=true;}
    if(state.put_id&&state.expires_at&&now>=state.expires_at){this.consumeCurrent(state,'expired');changed=true;}return changed;
  }
  events(account,state,items=[],changed=true){const events=items.map(item=>({cmd:'item_update',data:{item}}));if(changed)events.push({cmd:'client_load_decorate',data:this.data(state)},{cmd:'client_load_role',data:this.decorateRole(account,this.db.getRole(account))});return events;}
  initial(account){const result=this.advance(account),state=this.state(account);return [...result.events.filter(x=>x.cmd!=='client_load_decorate'),{cmd:'client_load_decorate',data:this.data(state)}];}
  handle(account,cmd,data={}){cmd=cmd.replace('.','_');if(!this.commands.has(cmd))return null;return this.db.transaction(()=>{
    const state=this.state(account),items=this.ingest(account,state),aged=this.age(state);
    if(cmd==='client_load_decorate'){this.save(account,state);return {response:this.data(state),events:this.events(account,state,items,aged||items.length>0)};}
    const id=data.id;
    if(!Number.isSafeInteger(id)||id<0||id!==0&&!this.definitions.has(id)){this.save(account,state);return {response:{code:1,message:'未知花材'},events:this.events(account,state,items,aged||items.length>0)};}
    if(id===state.put_id){this.save(account,state);return {response:{code:0},events:this.events(account,state,items,aged||items.length>0)};}
    if(id!==0&&!state.has_list.some(x=>x.id===id&&x.num>0)){this.save(account,state);return {response:{code:1,message:'尚未拥有该花材'},events:this.events(account,state,items,aged||items.length>0)};}
    this.consumeCurrent(state,'replaced');
    if(id){const now=this.clock();state.put_id=id;state.status=1;state.started_at=now;state.bloom_at=now+this.bloomSeconds;state.expires_at=now+this.lifeSeconds;this.history(state,id,1,now);}
    this.save(account,state);return {response:{code:0},events:this.events(account,state,items,true)};
  });}
  advance(account){return this.db.transaction(()=>{const state=this.state(account),items=this.ingest(account,state),aged=this.age(state);this.save(account,state);return {changed:!!items.length||aged,events:this.events(account,state,items,!!items.length||aged)};});}
  encyclopediaObservations(account){const state=this.state(account),entries=values(this.config.encyclopedia_json?.list),images=new Set();
    for(const id of state.owned_history){const d=this.definitions.get(id);if(d?.icon)images.add(d.icon);}
    for(const row of state.stage_history){const d=this.definitions.get(row.id);if(d?.pic?.[row.stage-1])images.add(d.pic[row.stage-1]);}
    return entries.filter(x=>images.has(x.pic_img)).map(x=>x.long_id);
  }
}
module.exports={DecorationService};
