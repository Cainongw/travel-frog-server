'use strict';

// Log structure and numeric identifiers only. Never persist tokens, free text,
// client settings or arbitrary payload strings from game requests.
function describe(value, depth = 0) {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 'non-finite';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return `[text:${value.length}]`;
  if (depth >= 3) return '[nested]';
  if (Array.isArray(value)) return { length:value.length, sample:value.slice(0,5).map(x=>describe(x,depth+1)) };
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0,30).map(([key,item])=>[
    key.slice(0,80), /token|secret|password|auth|cookie|credential/i.test(key) ? '[redacted]' : describe(item,depth+1),
  ]));
  return '[unknown]';
}
class ProtocolDiagnostics {
  constructor(database) {
    this.sql = database.db;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS admin_unsupported_calls (
      account TEXT NOT NULL, command TEXT NOT NULL, reason TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
      sample_json TEXT NOT NULL, PRIMARY KEY(account,command,reason)
    )`);
  }
  record(account, command, data, reason='unimplemented') {
    const now=Math.floor(Date.now()/1000), sample=JSON.stringify(describe(data));
    this.sql.prepare(`INSERT INTO admin_unsupported_calls(account,command,reason,count,first_at,last_at,sample_json)
      VALUES (?,?,?,1,?,?,?) ON CONFLICT(account,command,reason) DO UPDATE SET
      count=count+1,last_at=excluded.last_at,sample_json=excluded.sample_json`)
      .run(account,command.slice(0,128),reason,now,now,sample);
    console.warn('[unsupported]',JSON.stringify({account,command:command.slice(0,128),reason,params:JSON.parse(sample)}));
  }
  list(account) {
    return this.sql.prepare('SELECT * FROM admin_unsupported_calls WHERE account=? ORDER BY last_at DESC,command LIMIT 200')
      .all(account).map(({sample_json,...row})=>({...row,sample:JSON.parse(sample_json)}));
  }
}
module.exports={ProtocolDiagnostics,describe};
