'use strict';

const crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function text(value,label,maximum){
  if(typeof value!=='string'||!value.trim()||value.length>maximum)throw Error(`${label}需为 1–${maximum} 个字符`);
  return value.trim();
}
function integer(value,label,min=0){if(!Number.isSafeInteger(value)||value<min)throw Error(`${label}无效`);return value;}

/** Server-wide notices are administration data, never account save contents. */
class AnnouncementsService{
  constructor(database,{clock=()=>Math.floor(Date.now()/1000)}={}){
    this.database=database;this.sql=database.db;this.clock=clock;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS admin_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,body TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL DEFAULT 0,author TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_announcement_operations (
      request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,action TEXT NOT NULL,
      announcement_id INTEGER NOT NULL,author TEXT NOT NULL,created_at INTEGER NOT NULL,result_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_announcements_active ON admin_announcements(active,expires_at,id);`);
  }
  row(value){return value?{id:Number(value.id),title:value.title,body:value.body,active:!!value.active,created_at:Number(value.created_at),expires_at:Number(value.expires_at),author:value.author}:null;}
  list(){return {announcements:this.sql.prepare('SELECT * FROM admin_announcements ORDER BY id DESC').all().map(value=>this.row(value))};}
  active(){const now=integer(this.clock(),'服务器时间');return this.sql.prepare('SELECT * FROM admin_announcements WHERE active=1 AND (expires_at=0 OR expires_at>?) ORDER BY id').all(now).map(value=>this.row(value));}
  mutate(body,actor,requestId){
    if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected a JSON object');
    const request=text(requestId,'Idempotency-Key',128),author=text(actor,'操作者',200);
    let input;
    if(body.action==='publish')input={action:'publish',title:text(body.title,'公告标题',100),body:text(body.body,'公告正文',2000),expires_at:integer(body.expires_at??0,'过期时间')};
    else if(body.action==='disable')input={action:'disable',id:integer(body.id,'公告编号',1)};
    else throw Error('未知公告操作');
    // Only allowlisted publication fields and authenticated actor enter the
    // fingerprint/audit. Extra payload passwords, tokens and secrets are ignored.
    const fingerprint=digest(JSON.stringify({author,input}));
    return this.database.transaction(()=>{
      const previous=this.sql.prepare('SELECT fingerprint,result_json FROM admin_announcement_operations WHERE request_id=?').get(request);
      if(previous){if(previous.fingerprint!==fingerprint)throw Error('Idempotency-Key already used for a different operation');return {...JSON.parse(previous.result_json),replayed:true};}
      const now=integer(this.clock(),'服务器时间');let announcement;
      if(input.action==='publish'){
        if(input.expires_at!==0&&input.expires_at<=now)throw Error('公告过期时间必须晚于当前时间，或填 0 表示不限期');
        const inserted=this.sql.prepare('INSERT INTO admin_announcements(title,body,active,created_at,expires_at,author) VALUES (?,?,1,?,?,?)').run(input.title,input.body,now,input.expires_at,author);
        announcement=this.row(this.sql.prepare('SELECT * FROM admin_announcements WHERE id=?').get(Number(inserted.lastInsertRowid)));
      }else{
        if(!this.sql.prepare('SELECT 1 FROM admin_announcements WHERE id=?').get(input.id))throw Error('公告不存在');
        this.sql.prepare('UPDATE admin_announcements SET active=0 WHERE id=?').run(input.id);
        announcement=this.row(this.sql.prepare('SELECT * FROM admin_announcements WHERE id=?').get(input.id));
      }
      const result={ok:true,action:input.action,announcement};
      this.sql.prepare('INSERT INTO admin_announcement_operations(request_id,fingerprint,action,announcement_id,author,created_at,result_json) VALUES (?,?,?,?,?,?,?)')
        .run(request,fingerprint,input.action,announcement.id,author,now,JSON.stringify(result));
      return result;
    });
  }
}
module.exports={AnnouncementsService};
