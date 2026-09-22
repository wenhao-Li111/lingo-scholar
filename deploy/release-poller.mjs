/** Root-owned deployment controller. Repository build commands run as lingobuild,
 * never root. Only formal vX.Y.Z releases from the configured public repo deploy. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const repo='wenhao-Li111/lingo-scholar';
const stateDir='/var/lib/lingo-deploy', releases='/opt/lingo-releases', current='/opt/lingo-current', shared='/opt/lingo-scholar';
const statusFile=path.join(stateDir,'status.json');
const previous=fs.existsSync(statusFile)?JSON.parse(fs.readFileSync(statusFile,'utf8')):{};
const save=v=>{const tmp=statusFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify({...v,at:new Date().toISOString()},null,2),{mode:0o600});fs.renameSync(tmp,statusFile);};
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:15*60*1000,maxBuffer:5e6});if(r.status!==0)throw new Error(`${cmd} failed: ${(r.stderr||r.stdout||String(r.error)).slice(-3000)}`);return r.stdout.trim();}
async function json(url){const r=await fetch(url,{headers:{'User-Agent':'Lingo-Scholar-Deploy','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});if(r.status===404)return null;if(!r.ok)throw new Error(`GitHub HTTP ${r.status}`);return r.json();}
function build(args){return run('/usr/sbin/runuser',['-u','lingobuild','--','env','HOME=/var/lib/lingobuild',...args]);}
function switchTo(target){const next=current+'.next';try{fs.unlinkSync(next);}catch(e){if(e.code!=='ENOENT')throw e;}fs.symlinkSync(target,next);fs.renameSync(next,current);}
async function healthy(){for(let i=0;i<20;i++){try{const r=await fetch('http://127.0.0.1:5173/api/health',{signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).ok)return true;}catch{}await new Promise(r=>setTimeout(r,1000));}return false;}
let candidate, oldTarget, switched=false;
try{
  const release=await json(`https://api.github.com/repos/${repo}/releases/latest`);
  if(!release||release.draft||release.prerelease){console.log('No stable release; leaving current service unchanged.');process.exit(0);}
  const tag=release.tag_name;
  if(!/^v\d+\.\d+\.\d+$/.test(tag))throw new Error('Release tag must be vMAJOR.MINOR.PATCH');
  if(previous.releaseId===release.id||previous.failedReleaseId===release.id){console.log('No new release.');process.exit(0);}
  candidate={id:release.id,tag};
  const stage=path.join(releases,`${tag}-${release.id}`);
  if(fs.existsSync(stage))throw new Error('Staging path already exists; inspect it before retrying.');
  fs.mkdirSync(stage);run('chown',['lingobuild:lingobuild',stage]);
  build(['git','clone','--depth','1','--branch',tag,'--single-branch',`https://github.com/${repo}.git`,stage]);
  const sha=build(['git','-C',stage,'rev-parse','HEAD']);
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid commit identity');
  // Build and test before attaching any production data. No install lifecycle scripts.
  build(['npm','--prefix',stage,'ci','--ignore-scripts','--no-audit','--no-fund']);
  build(['npm','--prefix',stage,'test']);
  build(['npm','--prefix',stage,'run','build:web']);
  if(!fs.existsSync(path.join(stage,'apps/web/dist/index.html')))throw new Error('Missing frontend build');
  // Refuse release trees that include production path names rather than deleting them.
  for(const name of ['data','content','LingoScholar'])if(fs.existsSync(path.join(stage,name)))throw new Error(`Unexpected production path in release: ${name}`);
  const web=fs.realpathSync(path.join(stage,'apps/web/dist'));
  if(!web.startsWith(stage+'/'))throw new Error('Frontend path escapes staging directory');
  fs.writeFileSync(path.join(web,'version.json'),JSON.stringify({version:tag,commit:sha}),{flag:'wx'});
  const worker=path.join(stage,'apps/web/dist/sw.js');
  if(!fs.lstatSync(worker).isFile()||!fs.realpathSync(worker).startsWith(stage+'/'))throw new Error('Invalid Service Worker path');
  fs.appendFileSync(worker,`\n// Release ${tag} ${sha}\n`);
  // Build account must no longer be able to mutate executable production files.
  run('chown',['-hR','root:root',stage]);run('chmod',['-R','go-w',stage]);
  for(const name of ['data','content','LingoScholar'])fs.symlinkSync(path.join(shared,name),path.join(stage,name));
  run('systemctl',['start','lingo-backup.service']);
  oldTarget=fs.realpathSync(current);
  switchTo(stage);switched=true;run('systemctl',['restart','lingo-scholar.service']);
  if(!await healthy())throw new Error('New release failed health check');
  save({releaseId:release.id,tag,commit:sha,path:stage,previousPath:oldTarget,status:'healthy'});
  console.log(`Deployed ${tag} (${sha})`);
}catch(error){
  let rollback='not-needed';
  if(switched){try{switchTo(oldTarget);run('systemctl',['restart','lingo-scholar.service']);rollback=await healthy()?'healthy':'failed';}catch{rollback='failed';}}
  save({...previous,failedReleaseId:candidate?.id,failedTag:candidate?.tag,status:'failed',rollback,error:String(error)});
  console.error(String(error));process.exitCode=1;
}
