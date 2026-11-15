'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
class GameAuth{
  constructor(database){this.database=database;this.sql=database.db;this.attempts=new Map();this.sql.exec(`
    CREATE TABLE IF NOT EXISTS game_users(username TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(account),salt TEXT NOT NULL,password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS game_sessions(id TEXT PRIMARY KEY,account TEXT NOT NULL,expires INTEGER NOT NULL);`);}
  setPassword(username,password,account){
    if(!/^[a-zA-Z0-9_.@-]{3,64}$/.test(username)||typeof password!=='string'||password.length<10||password.length>128)throw Error('登录名需为 3–64 位字母数字，密码需为 10–128 位');
    this.database.ensureAccount(account);const salt=crypto.randomBytes(16).toString('hex');
    const digest=crypto.scryptSync(password,salt,64).toString('hex');
    this.database.transaction(()=>{this.sql.prepare(`INSERT INTO game_users VALUES (?,?,?,?) ON CONFLICT(username) DO UPDATE SET account=excluded.account,salt=excluded.salt,password_hash=excluded.password_hash`).run(username,account,salt,digest);this.sql.prepare('DELETE FROM game_sessions WHERE account=?').run(account);});
    return {username,account};
  }
  async login(username,password,remote){
    const now=Date.now(),key=remote||'unknown';for(const [k,v]of this.attempts)if(v.until<now)this.attempts.delete(k);
    const attempt=this.attempts.get(key)||{count:0,until:now+60000};
    if(++attempt.count>10){this.attempts.set(key,attempt);throw Error('登录尝试过于频繁，请稍后再试');}this.attempts.set(key,attempt);
    if(typeof username!=='string'||typeof password!=='string'||password.length>128)throw Error('账号或密码错误');
    const row=this.sql.prepare('SELECT * FROM game_users WHERE username=?').get(username);
    const digest=await new Promise((resolve,reject)=>crypto.scrypt(password,row?.salt||'invalid-login',64,(err,value)=>err?reject(err):resolve(value)));
    if(!row||!crypto.timingSafeEqual(digest,Buffer.from(row.password_hash,'hex')))throw Error('账号或密码错误');
    const token=crypto.randomBytes(32).toString('base64url');
    this.sql.prepare('DELETE FROM game_sessions WHERE expires<?').run(now);
    this.sql.prepare('INSERT INTO game_sessions VALUES (?,?,?)').run(hash(token),row.account,now+86400000);
    return {token,account:row.account};
  }
  resolve(token){return typeof token==='string'?this.sql.prepare('SELECT account FROM game_sessions WHERE id=? AND expires>?').get(hash(token),Date.now())?.account:null;}
}
module.exports={GameAuth};
