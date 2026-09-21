import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {openDatabase,get,closeDatabase} from '../apps/server/src/db.js';
import {issueBootstrapToken} from '../apps/server/src/auth.js';
import {resolveDbPath} from '../apps/server/src/app.js';
const db=resolveDbPath();openDatabase(db);
try{
  if(get("SELECT id FROM users WHERE role='admin'"))throw new Error('Administrator already exists; no new initialization token issued.');
  const {token,expiresAt}=issueBootstrapToken({ttlMinutes:1440});
  const file=path.join(path.dirname(db),'bootstrap-access.json');
  writeFileSync(file,JSON.stringify({token,expiresAt,instructions:'打开网站 /#/bootstrap，粘贴此令牌，设置你自己的邮箱和密码。不要分享此文件。'},null,2),{mode:0o600});
  console.log('Initialization token written to private data/bootstrap-access.json; valid for 24 hours.');
}finally{closeDatabase();}
