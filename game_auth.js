'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
class GameAuth{
  constructor(database){this.database=database;this.sql=database.db;this.attempts=new Map();this.sql.exec(`
    CREATE TABLE IF NOT EXISTS game_users(username TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(account),salt TEXT NOT NULL,password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS game_sessions(id TEXT PRIMARY KEY,account TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS game_refresh_sessions(id TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS game_user_audit(id INTEGER PRIMARY KEY,username TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,created_at INTEGER NOT NULL);`);
    for(const [name,type]of [['disabled','INTEGER NOT NULL DEFAULT 0'],['created_at','INTEGER NOT NULL DEFAULT 0'],['last_login','INTEGER NOT NULL DEFAULT 0']])if(!this.sql.prepare('PRAGMA table_info(game_users)').all().some(x=>x.name===name))this.sql.exec(`ALTER TABLE game_users ADD COLUMN ${name} ${type}`);
    if(!this.sql.prepare('PRAGMA table_info(game_sessions)').all().some(x=>x.name==='username')){
      this.sql.exec('ALTER TABLE game_sessions ADD COLUMN username TEXT');
      this.sql.exec('UPDATE game_sessions SET username=(SELECT username FROM game_users WHERE account=game_sessions.account ORDER BY username LIMIT 1)');
    }
  }
  setPassword(username,password,account){
    if(!/^[a-zA-Z0-9_.@-]{3,64}$/.test(username)||typeof password!=='string'||password.length<10||password.length>128)throw Error('登录名需为 3–64 位字母数字，密码需为 10–128 位');
    this.database.ensureAccount(account);const salt=crypto.randomBytes(16).toString('hex');
    const existing=this.sql.prepare('SELECT account FROM game_users WHERE username=?').get(username);
    if(existing&&existing.account!==account)throw Error('登录名已关联其他存档');
    const digest=crypto.scryptSync(password,salt,64).toString('hex');
    this.database.transaction(()=>{this.sql.prepare(`INSERT INTO game_users(username,account,salt,password_hash,created_at) VALUES (?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash`).run(username,account,salt,digest,Math.floor(Date.now()/1000));this.revoke(username);});
    return {username,account};
  }
  async login(username,password,remote){
    const now=Date.now(),key=remote||'unknown';for(const [k,v]of this.attempts)if(v.until<now)this.attempts.delete(k);
    const attempt=this.attempts.get(key)||{count:0,until:now+60000};
    if(++attempt.count>10){this.attempts.set(key,attempt);throw Error('登录尝试过于频繁，请稍后再试');}this.attempts.set(key,attempt);
    if(typeof username!=='string'||typeof password!=='string'||password.length>128)throw Error('账号或密码错误');
    const row=this.sql.prepare('SELECT * FROM game_users WHERE username=?').get(username);
    const digest=await new Promise((resolve,reject)=>crypto.scrypt(password,row?.salt||'invalid-login',64,(err,value)=>err?reject(err):resolve(value)));
    if(!row||row.disabled||!crypto.timingSafeEqual(digest,Buffer.from(row.password_hash,'hex')))throw Error('账号或密码错误');
    return this.database.transaction(()=>{
      // Password reset or disable may have happened while scrypt was running.
      const current=this.sql.prepare('SELECT * FROM game_users WHERE username=?').get(username);
      if(!current||current.disabled||current.password_hash!==row.password_hash)throw Error('账号或密码错误');
      const refresh=crypto.randomBytes(32).toString('base64url');
      this.sql.prepare('DELETE FROM game_refresh_sessions WHERE expires<?').run(now);
      this.sql.prepare('INSERT INTO game_refresh_sessions VALUES (?,?,?)').run(hash(refresh),username,now+2592000000);
      this.sql.prepare('UPDATE game_users SET last_login=? WHERE username=?').run(Math.floor(now/1000),username);
      return {...this.issue(username,row.account),refresh_token:refresh};
    });
  }
  issue(username,account){const token=crypto.randomBytes(32).toString('base64url');this.sql.prepare('DELETE FROM game_sessions WHERE expires<?').run(Date.now());this.sql.prepare('INSERT INTO game_sessions(id,account,expires,username) VALUES (?,?,?,?)').run(hash(token),account,Date.now()+86400000,username);return {token,account,expires_in:86400};}
  refresh(value){if(typeof value!=='string')throw Error('请重新登录');return this.database.transaction(()=>{const row=this.sql.prepare('SELECT u.username,u.account FROM game_refresh_sessions r JOIN game_users u ON u.username=r.username WHERE r.id=? AND r.expires>? AND u.disabled=0').get(hash(value),Date.now());if(!row)throw Error('登录已失效，请重新输入账号密码');this.sql.prepare('UPDATE game_refresh_sessions SET expires=? WHERE id=?').run(Date.now()+2592000000,hash(value));return this.issue(row.username,row.account);});}
  resolve(token){return typeof token==='string'?this.sql.prepare('SELECT s.account FROM game_sessions s JOIN game_users u ON u.username=s.username WHERE s.id=? AND s.expires>? AND u.disabled=0').get(hash(token),Date.now())?.account:null;}
  revoke(username){this.sql.prepare('DELETE FROM game_sessions WHERE username=?').run(username);this.sql.prepare('DELETE FROM game_refresh_sessions WHERE username=?').run(username);}
  list(){return this.sql.prepare('SELECT username,account,disabled,created_at,last_login,(SELECT count(*) FROM game_refresh_sessions r WHERE r.username=u.username AND r.expires>?) AS session_count FROM game_users u ORDER BY username').all(Date.now()).map(x=>({...x,disabled:!!x.disabled}));}
  manage(body,actor){
    const {action,username}=body;
    return this.database.transaction(()=>{
      const row=typeof username==='string'?this.sql.prepare('SELECT account FROM game_users WHERE username=?').get(username):null;
      if(action==='create'){
        if(row)throw Error('登录名已存在');
        if(typeof body.account!=='string'||!this.sql.prepare('SELECT 1 FROM accounts WHERE account=?').get(body.account))throw Error('请选择已有存档');
        this.setPassword(username,body.password,body.account);
      }else{
        if(!row)throw Error('登录账号不存在');
        if(action==='reset-password')this.setPassword(username,body.password,row.account);
        else if(action==='set-disabled'){
          if(typeof body.disabled!=='boolean')throw Error('Invalid disabled flag');
          this.sql.prepare('UPDATE game_users SET disabled=? WHERE username=?').run(Number(body.disabled),username);if(body.disabled)this.revoke(username);
        }else if(action==='revoke-sessions')this.revoke(username);
        else if(action==='delete'){this.revoke(username);this.sql.prepare('DELETE FROM game_users WHERE username=?').run(username);}
        else throw Error('Unknown game user action');
      }
      this.sql.prepare('INSERT INTO game_user_audit(username,action,actor,created_at) VALUES (?,?,?,?)').run(username,action,actor,Math.floor(Date.now()/1000));
      return {ok:true,username,action};
    });
  }
}
module.exports={GameAuth};
