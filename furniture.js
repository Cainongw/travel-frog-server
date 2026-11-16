'use strict';
const crypto=require('node:crypto');

const normalizeAccount = value => String(value || 'guest').trim().slice(0, 128) || 'guest';
const nowSeconds = () => Math.floor(Date.now() / 1000);
const clone = value => JSON.parse(JSON.stringify(value));
const STYLE_MATERIAL = Object.freeze({ 2:10101, 3:10102, 4:10103, 5:10104, 6:10105, 7:10106, 8:10107, 9:10108 });
const {buildFurnitureRecipes,beginFurnitureCraft}=require('./furniture_policy');

function migrateFurniture(database) {
  database.db.exec(`CREATE TABLE IF NOT EXISTS furniture_state (
    account TEXT PRIMARY KEY REFERENCES accounts(account) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

function exportFurnitureState(database, value) {
  const row = database.db.prepare('SELECT state_json FROM furniture_state WHERE account=?').get(normalizeAccount(value));
  return row ? JSON.parse(row.state_json) : null;
}

function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid furniture ${name}`);
  return value;
}

function validateFurnitureState(state, catalog = null) {
  if (state == null) return;
  if (typeof state !== 'object' || Array.isArray(state)) throw Error('Invalid furniture state');
  if (!Array.isArray(state.bench) || state.bench.length !== 10) throw Error('Furniture bench must have 10 slots');
  state.bench.forEach(id => integer(id, 'bench item', -1));
  if (new Set(state.bench.slice(0,5).filter(id => id >= 0)).size !== state.bench.slice(0,5).filter(id => id >= 0).length) throw Error('Duplicate bench tool');
  if (!Array.isArray(state.owned) || state.owned.length > 5000 || new Set(state.owned).size !== state.owned.length) throw Error('Invalid owned furniture');
  state.owned.forEach(id => integer(id, 'owned id', 1));
  if (!Array.isArray(state.placed) || state.placed.length > 100 || new Set(state.placed.map(x=>x.type)).size !== state.placed.length) throw Error('Invalid furniture placement');
  for (const item of state.placed) {
    integer(item.type, 'placement type', 1); integer(item.id, 'placement id', 1);
    if (!state.owned.includes(item.id)) throw Error('Cannot place unowned furniture');
  }
  for (const key of ['shop_start','shop_end']) integer(state[key], key, 1);
  if (state.shop_end <= state.shop_start) throw Error('Invalid furniture shop interval');
  for (const key of ['purchases','shop_bought']) {
    if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) throw Error(`Invalid furniture ${key}`);
    for (const [id,count] of Object.entries(state[key])) { integer(Number(id),'purchase id',1); integer(count,'purchase count'); }
  }
  if (state.job != null) {
    integer(state.job.furniture_id,'job furniture',1); integer(state.job.started_at,'start',1); integer(state.job.finish_at,'finish',state.job.started_at);
    if (state.owned.includes(state.job.furniture_id)) throw Error('Pending furniture is already owned');
    if (!Array.isArray(state.job.material) || state.job.material.length < 1 || state.job.material.length > 20 || !Array.isArray(state.job.tool) || state.job.tool.length < 1 || state.job.tool.length > 5) throw Error('Invalid furniture job resources');
    state.job.material.forEach(x => { integer(x.item_id,'material id',1); integer(x.count,'material count',1,99); });
    state.job.tool.forEach(id => integer(id,'job tool',1));
  }
  if (catalog) {
    const items = new Map((catalog.items || []).map(x=>[x.id,x]));
    const furnitures = new Map((catalog.furniture || []).map(x=>[x.id,x]));
    state.bench.forEach((id,i) => {
      if (id !== -1 && items.get(id)?.type !== (i < 5 ? 12 : 11)) throw Error('Wrong bench item category');
    });
    state.owned.forEach(id => { if (!furnitures.has(id)) throw Error('Unknown owned furniture'); });
    state.placed.forEach(x => { if (furnitures.get(x.id)?.type !== x.type) throw Error('Wrong placement type'); });
    if (state.job) {
      if (!furnitures.has(state.job.furniture_id)) throw Error('Unknown pending furniture');
      state.job.tool.forEach(id => { if (items.get(id)?.type !== 12) throw Error('Unknown or invalid job tool'); });
      state.job.material.forEach(x => { if (![10,11].includes(items.get(x.item_id)?.type)) throw Error('Unknown or invalid job material'); });
    }
  }
}

function importFurnitureState(database, value, state, catalog = null) {
  const account = normalizeAccount(value);
  validateFurnitureState(state, catalog);
  if (state == null) {
    database.db.prepare('DELETE FROM furniture_state WHERE account=?').run(account);
  } else {
    database.db.prepare(`INSERT INTO furniture_state(account,state_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(account) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
      .run(account, JSON.stringify(state), nowSeconds());
  }
}

class FurnitureService {
  constructor(database, catalog, options = {}) {
    this.database = database;
    this.catalog = catalog;
    this.craftSeconds = integer(options.craftSeconds ?? 60, 'duration', 1, 2592000);
    this.shopSeconds = integer(options.shopSeconds ?? 86400, 'shop duration', 60, 2592000);
    this.items = new Map((catalog.items || []).map(x=>[x.id,x]));
    this.furniture = new Map((catalog.furniture || []).map(x=>[x.id,x]));
    this.shop = new Map((catalog.furnitureShop || []).filter(x=>x.type!==998&&[0,1,5,8,10,11,12,13,14,15].includes(this.items.get(x.item_id)?.type)).map(x=>[x.id,x]));
    const buildable = new Set((catalog.bench || []).filter(x=>x.type===1).map(x=>x.id));
    this.tools = [...this.items.values()].filter(x=>x.type===12).map(x=>x.id);
    this.recipes = [...this.furniture.values()].filter(x=>buildable.has(x.id) && STYLE_MATERIAL[x.style] && this.items.has(x.drawing) && this.items.has(STYLE_MATERIAL[x.style]) && this.items.has(10001)).map(x=>({
      id:x.id, name:x.name, paper_item_id:x.drawing,
      material:[{item_id:STYLE_MATERIAL[x.style],count:1},{item_id:10001,count:1}],
      tool:[...this.tools], time:this.craftSeconds, area:x.type, type:x.type, style:x.style, resource:x.res || [],
    })).sort((a,b)=>a.id-b.id);
    this.available = this.recipes.length > 0 && this.tools.length > 0;
    if(catalog.config){this.recipes=buildFurnitureRecipes(catalog,{craftSeconds:this.craftSeconds});this.available=this.recipes.length>0;}
    migrateFurniture(database);
  }

  getCatalog() {
    return { available:this.available,furniture:clone(this.recipes),shop:clone([...this.shop.values()]),
      allFurniture:[...this.furniture.values()].map(({id,name,type,style})=>({id,name,type,style})) };
  }

  save(account,state,now) {
    this.database.db.prepare(`INSERT INTO furniture_state(account,state_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(account) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
      .run(account,JSON.stringify(state),now);
  }

  defaultState(now) {
    const defaults = [...this.furniture.values()].filter(x=>x.style===1).sort((a,b)=>a.id-b.id);
    return { bench:Array(10).fill(-1),owned:defaults.map(x=>x.id),placed:defaults.map(x=>({type:x.type,id:x.id})),
      job:null,shop_start:Math.max(1,now-1),shop_end:now+this.shopSeconds,purchases:{},shop_bought:{} };
  }

  load(account,now) {
    this.database.ensureAccount(account);
    let state = exportFurnitureState(this.database,account);
    if (!state) {
      state = this.defaultState(now);
      // A temporarily missing APK catalog must not permanently seed an empty
      // room. Once assets return, the next load can establish the defaults.
      if (!this.furniture.size) return state;
      this.save(account,state,now);
    } else if (this.shop.size && now >= state.shop_end) {
      state.shop_start = Math.max(1,now-1); state.shop_end = now+this.shopSeconds; state.shop_bought={};
      this.save(account,state,now);
    }
    return state;
  }

  ownedItem(account,state,id) {
    // Tools stay in inventory; bench positions reference them. Consumable
    // special materials are transferred out of inventory into the bench.
    return this.database.getInventoryCount(account,id) + state.bench.slice(5).filter(x=>x===id).length;
  }

  remaining(state,row) {
    const lifetime = row.limit > 0 ? Math.max(0,row.limit-(state.purchases[row.id]||0)) : 99;
    const visit = row.shop_limit > 0 ? Math.max(0,row.shop_limit-(state.shop_bought[row.id]||0)) : 99;
    return Math.min(lifetime,visit);
  }

  getState(value,now = nowSeconds()) {
    const account = normalizeAccount(value), state=this.load(account,now);
    return this.projectState(account,state);
  }

  peekState(value,now = nowSeconds()) {
    const account=normalizeAccount(value),state=exportFurnitureState(this.database,account)||this.defaultState(now);
    return this.projectState(account,state);
  }

  projectState(account,state) {
    return {
      has_fur:[...state.owned],put_fur:clone(state.placed),replace_fur:[],bench:[...state.bench],bench_lock:!!state.job,
      mate_list:[],mood:3,
      shop:{start_time:state.shop_start,leave_time:state.shop_end,shop_list:this.offers(account,state)
        // The native merchant renderer resolves its image/name from item_id;
        // shop_id alone is only enough for the purchase RPC.
        .map(row=>({shop_id:row.id,item_id:row.item_id,num:this.remaining(state,row)}))},
      job:state.job ? clone(state.job) : null,
    };
  }

  offers(account,state){
    const eligible=[...this.shop.values()].filter(row=>!row.has_item||this.ownedItem(account,state,row.has_item)>0);
    if(eligible.length<=24)return eligible;
    // Offline policy: fixed offers during one visit, then rotate. Configuration
    // proves item/price/predecessor; it does not contain the official stock draw.
    const score=row=>crypto.createHash('sha256').update(account+':'+state.shop_start+':'+row.id).digest().readUInt32BE(0);
    const order=eligible.map(row=>({row,score:score(row)})).sort((a,b)=>a.score-b.score).map(x=>x.row);
    const selected=[];for(const type of [5,10,11,12,13,15,14,0,1,8]){const candidate=order.find(row=>this.items.get(row.item_id)?.type===type);if(candidate)selected.push(candidate);}
    // The two flowering branches are regular merchandise and provide the
    // natural source for flower arrangement, growth and their four titles.
    for(const id of [8,9]){const row=eligible.find(x=>x.id===id);if(row&&!selected.some(x=>x.id===id))selected.push(row);}
    for(const row of order)if(selected.length<24&&!selected.some(x=>x.id===row.id))selected.push(row);
    return selected.sort((a,b)=>a.id-b.id);
  }

  put(value,pos,itemId,now = nowSeconds()) {
    const account=normalizeAccount(value);
    return this.database.transaction(()=>{
      const state=this.load(account,now), fail=reason=>({ok:false,code:1,reason,itemChanges:[]});
      if (!Number.isSafeInteger(pos)||pos<1||pos>10) return fail('Invalid workbench slot');
      if (state.job) return fail('Workbench is busy');
      const i=pos-1, item=this.items.get(itemId);
      if (!item || item.type!==(i<5?12:11)) return fail('Wrong item category for workbench slot');
      if (state.bench[i]===itemId) return {ok:true,code:0,itemChanges:[]};
      if (this.database.getInventoryCount(account,itemId)<1) return fail('Item not owned');
      if (i<5 && state.bench.slice(0,5).includes(itemId)) return fail('Tool already on workbench');
      const changes=[];
      if (i>=5) {
        changes.push({item_id:itemId,count:this.database.changeInventory(account,itemId,-1)});
        if (state.bench[i]>=0) changes.push({item_id:state.bench[i],count:this.database.changeInventory(account,state.bench[i],1)});
      }
      state.bench[i]=itemId; this.save(account,state,now);
      return {ok:true,code:0,itemChanges:changes};
    });
  }

  take(value,pos,now = nowSeconds()) {
    const account=normalizeAccount(value);
    return this.database.transaction(()=>{
      const state=this.load(account,now);
      if (!Number.isSafeInteger(pos)||pos<1||pos>10||state.job) return {ok:false,code:1,reason:'Invalid slot or workbench busy',itemChanges:[]};
      const i=pos-1,item=state.bench[i],changes=[];
      if (i>=5 && item>=0) changes.push({item_id:item,count:this.database.changeInventory(account,item,1)});
      state.bench[i]=-1;this.save(account,state,now);
      return {ok:true,code:0,itemChanges:changes};
    });
  }

  buy(value,shopId,now = nowSeconds()) {
    const account=normalizeAccount(value);
    return this.database.transaction(()=>{
      const state=this.load(account,now), row=this.shop.get(shopId), role=this.database.getRole(account);
      const fail=reason=>({ok:false,code:1,reason,itemChanges:[],clover:role.res.clover_point});
      if (!row || !Number.isSafeInteger(shopId)) return fail('Unknown furniture shop item');
      if(!this.offers(account,state).some(x=>x.id===shopId))return fail('Merchant is not offering this item during this visit');
      if (row.has_item && this.ownedItem(account,state,row.has_item)<1) return fail('Shop prerequisite not owned');
      if (this.remaining(state,row)<1) return fail('Shop purchase limit reached');
      const item=this.items.get(row.item_id),held=this.database.getItemState(account);
      const owned=this.ownedItem(account,state,row.item_id)+[...held.bag,...held.desk].filter(id=>id===row.item_id).length;
      if(item?.spend!==1&&Number(item?.own_num)>0&&owned>=Number(item.own_num))return fail('Item ownership limit reached');
      if (role.res.clover_point<row.price) return fail('Not enough clover');
      const clover=role.res.clover_point-row.price;
      this.database.updateAccount(account,{clover});
      const itemChanges=[{item_id:row.item_id,count:this.database.changeInventory(account,row.item_id,1)}];
      state.purchases[shopId]=(state.purchases[shopId]||0)+1;state.shop_bought[shopId]=(state.shop_bought[shopId]||0)+1;
      this.save(account,state,now);
      return {ok:true,code:0,itemChanges,clover};
    });
  }

  event(account,type,id,now) {
    const eventId=Math.max(now*1000,Number(this.database.db.prepare('SELECT COALESCE(MAX(event_id),0)+1 AS id FROM travel_events WHERE account=?').get(account).id));
    const event={id:eventId,evt_type:type,evt_id:id,evt_value:[],evt_string:[],evt_pic:[]};
    this.database.db.prepare(`INSERT INTO travel_events(account,event_id,evt_type,evt_id,evt_value_json,evt_string_json,evt_pic_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(account,eventId,type,id,'[]','[]','[]',now);
    return event;
  }

  advance(value,now = nowSeconds()) {
    const account=normalizeAccount(value);
    return this.database.transaction(()=>{
      const state=this.load(account,now);
      if (state.job) {
        if (state.job.finish_at>now) return {ok:true,code:0,changed:false,itemChanges:[]};
        const id=state.job.furniture_id;
        if (!this.furniture.has(id)) return {ok:false,code:1,changed:false,reason:'Pending furniture configuration unavailable',itemChanges:[]};
        if (!state.owned.includes(id)) state.owned.push(id);
        state.job=null;this.save(account,state,now);
        return {ok:true,code:0,changed:true,completed:id,itemChanges:[],event:this.event(account,21,id,now)};
      }
      if (!this.available || this.database.getRole(account).frog.status!==0) return {ok:true,code:0,changed:false,itemChanges:[]};
      if(this.catalog.config)return beginFurnitureCraft(this,account,now);
      const tools=state.bench.slice(0,5).filter(id=>id>=0&&this.database.getInventoryCount(account,id)>0);
      if (!tools.length) return {ok:true,code:0,changed:false,itemChanges:[]};
      const recipe=this.recipes.find(x=>!state.owned.includes(x.id) && this.database.getInventoryCount(account,x.paper_item_id)>0 &&
        state.bench.slice(5).includes(x.material[0].item_id) && this.database.getInventoryCount(account,10001)>=1);
      if (!recipe) return {ok:true,code:0,changed:false,itemChanges:[]};
      const materialId=recipe.material[0].item_id;
      state.bench[state.bench.indexOf(materialId,5)]=-1;
      const itemChanges=[{item_id:10001,count:this.database.changeInventory(account,10001,-1)}];
      state.job={furniture_id:recipe.id,started_at:now,finish_at:now+this.craftSeconds,material:clone(recipe.material),tool:tools};
      this.save(account,state,now);
      return {ok:true,code:0,changed:true,started:recipe.id,itemChanges};
    });
  }

  finish(value,now = nowSeconds()) {
    const account=normalizeAccount(value);
    return this.database.transaction(()=>{
      const state=this.load(account,now);
      if (!state.job) return {ok:false,code:1,changed:false,reason:'No furniture is being made',itemChanges:[]};
      state.job.finish_at=now;this.save(account,state,now);
      return this.advance(account,now);
    });
  }

  replace(value,id,now = nowSeconds()) {
    const account=normalizeAccount(value);
    return this.database.transaction(()=>{
      const state=this.load(account,now), furniture=this.furniture.get(id);
      if (!furniture || !state.owned.includes(id)) return {ok:false,code:-1,reason:'Furniture not owned',itemChanges:[]};
      if (state.placed.some(x=>x.id===id)) return {ok:true,code:1,changed:false,itemChanges:[]};
      state.placed=state.placed.filter(x=>x.type!==furniture.type);
      state.placed.push({type:furniture.type,id});this.save(account,state,now);
      return {ok:true,code:1,changed:true,itemChanges:[],event:this.event(account,22,id,now)};
    });
  }
}

module.exports={FurnitureService,migrateFurniture,exportFurnitureState,importFurnitureState,validateFurnitureState};
