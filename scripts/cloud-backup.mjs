#!/usr/bin/env node
/** Atomic SQLite snapshot: never copy a live database and WAL independently. */
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.env.LINGO_DB||path.join(root,'data','lingo.db');
if(!existsSync(source))throw new Error('Database does not exist');
const directory=path.join(root,'data','backups');mkdirSync(directory,{recursive:true});
const destination=path.join(directory,`lingo-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
const db=new DatabaseSync(source);db.exec('PRAGMA busy_timeout=30000');
try{db.prepare('VACUUM INTO ?').run(destination);}finally{db.close();}
const verify=new DatabaseSync(destination,{readOnly:true});
try{if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed');}finally{verify.close();}
console.log(`Verified snapshot: ${destination} (${statSync(destination).size} bytes)`);
console.log('Restore only with service stopped. Preserve the current DB and WAL before replacing them. Backups are not deleted automatically.');
