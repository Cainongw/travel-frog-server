'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
const {validateModules}=require('./module_validation');
// Account-scoped game state, deliberately separate from authentication/audits.
class ModuleState{
  constructor(database){this.database=database;this.sql=database.db;this.sql.exec(`CREATE TABLE IF NOT EXISTS game_module_state (
    account TEXT NOT NULL REFERENCES accounts(account) ON DELETE CASCADE,module TEXT NOT NULL,state_json TEXT NOT NULL,
    PRIMARY KEY(account,module));`);}
  get(account,module,factory=()=>({})){
    const row=this.sql.prepare('SELECT state_json FROM game_module_state WHERE account=? AND module=?').get(account,module);
    return row?JSON.parse(row.state_json):clone(typeof factory==='function'?factory():factory);
  }
  set(account,module,state){this.database.ensureAccount(account);this.sql.prepare(`INSERT INTO game_module_state VALUES (?,?,?) ON CONFLICT(account,module) DO UPDATE SET state_json=excluded.state_json`).run(account,module,JSON.stringify(state));return state;}
  state(account,module,factory){return this.get(account,module,factory);}
  save(account,module,state){return this.set(account,module,state);}
  export(account){return Object.fromEntries(this.sql.prepare('SELECT module,state_json FROM game_module_state WHERE account=? ORDER BY module').all(account).map(x=>[x.module,JSON.parse(x.state_json)]));}
  import(account,modules){
    validateModules(modules);
    if(modules!==undefined&&(!modules||typeof modules!=='object'||Array.isArray(modules)||Object.keys(modules).length>200))throw Error('Invalid game modules');
    for(const [name,value]of Object.entries(modules||{}))if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||!value||typeof value!=='object'||JSON.stringify(value).length>4000000)throw Error('Invalid game module state');
    this.sql.prepare('DELETE FROM game_module_state WHERE account=?').run(account);
    for(const [name,value]of Object.entries(modules||{}))this.set(account,name,value);
  }
}
module.exports={ModuleState};
