import {randomInt} from 'node:crypto';
import {all,get,run,tx,uuid,nowIso} from './db.js';
import {createUser,createSession,sessionCookie,publicUser,findUserByEmail,normalizeEmail,randomToken,sha256,passwordProblem,hashPassword,rateLimit} from './auth.js';
import {resourceDecks} from './resources.js';
import {weekKeyOf} from '@lingo/domain';

export const publicSignup = () => process.env.LINGO_PUBLIC_SIGNUP === '1';
export const starTotal = id => Number(get('SELECT COALESCE(SUM(stars),0) n FROM star_ledger WHERE user_id=?',[id]).n);
const dayKey = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const shuffle = items => { const result=[...items]; for(let i=result.length-1;i>0;i--){const j=randomInt(i+1);[result[i],result[j]]=[result[j],result[i]];} return result; };
const fail = (res,status,message) => res.status(status).json({error:'CLOUD_REQUEST_FAILED',message});
const limit = (req,res,key,count=10) => {const result=rateLimit(`${key}:${req.auth?.user.id||req.ip}`,{limit:count,windowMs:3600000});if(!result.allowed){res.status(429).json({error:'RATE_LIMITED',message:'操作过于频繁，请稍后再试',retryAfter:result.retryAfter});return false;}return true;};

export function cloudSocialRoutes(router,requireAuth,requireWrite,ensureGroupFor,now){
  router.post('/auth/register',(req,res)=>{
    if(!publicSignup())return fail(res,403,'当前未开放注册');
    if(!limit(req,res,'register',12))return;
    if(Number(get('SELECT COUNT(*) n FROM users').n)>=Number(process.env.LINGO_MAX_USERS||1000))return fail(res,409,'当前账号名额已满，请联系管理员');
    try{
      const {email,displayName,password}=req.body||{};
      const user=createUser({email,displayName,password});
      ensureGroupFor(user.id);
      const recoveryCode=randomToken();
      run('INSERT INTO account_recovery(user_id,code_hash) VALUES(?,?)',[user.id,sha256(recoveryCode)]);
      const session=createSession(user.id,req.headers['user-agent']);
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Set-Cookie',sessionCookie(session.token));
      res.json({user:publicUser(user),csrfToken:session.csrf,recoveryCode,emailVerified:false});
    }catch(e){fail(res,e.status||400,e.message);}
  });
  router.post('/auth/recover',(req,res)=>{
    if(!limit(req,res,'recover',5))return;
    const {email,code,password}=req.body||{};const user=findUserByEmail(email);
    const recovery=user&&get('SELECT code_hash FROM account_recovery WHERE user_id=?',[user.id]);
    if(!recovery||recovery.code_hash!==sha256(code||''))return fail(res,400,'邮箱或恢复码不正确');
    const problem=passwordProblem(password);if(problem)return fail(res,400,problem);
    const next=randomToken(),hashed=hashPassword(password);
    tx(()=>{
      run('UPDATE users SET password_hash=?,password_salt=? WHERE id=?',[hashed.hash,hashed.salt,user.id]);
      run('UPDATE account_recovery SET code_hash=? WHERE user_id=?',[sha256(next),user.id]);
      run('UPDATE sessions SET revoked_at=? WHERE user_id=?',[nowIso(),user.id]);
    });
    res.setHeader('Cache-Control','no-store');res.json({ok:true,recoveryCode:next});
  });
  router.get('/social',requireAuth,(req,res)=>{
    const id=req.auth.user.id,wk=weekKeyOf(now(),'Asia/Shanghai');
    const friends=all(`SELECT f.id,f.sender_id,f.recipient_id,f.status,u.id userId,u.display_name displayName,u.avatar_seed avatarSeed
      FROM friendships f JOIN users u ON u.id=CASE WHEN f.sender_id=? THEN f.recipient_id ELSE f.sender_id END
      WHERE (f.sender_id=? OR f.recipient_id=?) AND f.status IN ('pending','accepted')`,[id,id,id]);
    const ids=[id,...friends.filter(f=>f.status==='accepted').map(f=>f.userId)];
    const board=[...new Set(ids)].map(uid=>{const u=get('SELECT display_name,avatar_seed FROM users WHERE id=?',[uid]);return {userId:uid,displayName:u.display_name,avatarSeed:u.avatar_seed,total:starTotal(uid),week:Number(get('SELECT COALESCE(SUM(stars),0) n FROM star_ledger WHERE user_id=? AND week_key=?',[uid,wk]).n)};}).sort((a,b)=>b.week-a.week||b.total-a.total);
    const active=get('SELECT id FROM star_challenges WHERE user_id=? AND result_json IS NULL ORDER BY created_at DESC LIMIT 1',[id]);
    res.json({friends:friends.map(f=>({...f,incoming:f.recipient_id===id})),board,weekKey:wk,stars:starTotal(id),activeChallenge:active?.id||null,remaining:Math.max(0,5-Number(get('SELECT COUNT(*) n FROM star_challenges WHERE user_id=? AND day_key=?',[id,dayKey(now())]).n))});
  });
  router.post('/social/requests',requireWrite,(req,res)=>{
    if(!limit(req,res,'friend-request',20))return;
    const id=req.auth.user.id,other=findUserByEmail(normalizeEmail(req.body?.email));
    if(other&&other.id!==id){
      const existing=get('SELECT * FROM friendships WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)',[id,other.id,other.id,id]);
      if(!existing)run('INSERT INTO friendships VALUES(?,?,?,?,?)',[uuid('friend'),id,other.id,'pending',nowIso()]);
    }
    res.json({ok:true,message:'如果该邮箱已注册且允许请求，对方会收到好友申请。请线下核对身份：邮箱未验证。'});
  });
  router.post('/social/requests/:id',requireWrite,(req,res)=>{
    const f=get('SELECT * FROM friendships WHERE id=?',[req.params.id]),id=req.auth.user.id,action=req.body?.action;
    if(!f||![f.sender_id,f.recipient_id].includes(id))return fail(res,404,'好友申请不存在');
    if(action==='accept'&&f.recipient_id===id&&f.status==='pending')run("UPDATE friendships SET status='accepted' WHERE id=?",[f.id]);
    else if(action==='remove')run('DELETE FROM friendships WHERE id=?',[f.id]);
    else return fail(res,400,'操作无效');
    res.json({ok:true});
  });
  router.post('/stars/challenges',requireWrite,(req,res)=>{
    const id=req.auth.user.id,day=dayKey(now());
    const active=get('SELECT id FROM star_challenges WHERE user_id=? AND result_json IS NULL',[id]);
    if(active)return res.json({id:active.id});
    if(Number(get('SELECT COUNT(*) n FROM star_challenges WHERE user_id=? AND day_key=?',[id,day]).n)>=5)return fail(res,409,'今天的 5 组计星挑战已用完，普通练习不限次数');
    const words=[...new Map(resourceDecks().flatMap(d=>d.words).map(w=>[w.lemma.toLowerCase(),w])).values()].filter(w=>w.meaningDisplay&&w.exampleZh);
    const used=new Set(all('SELECT questions_json FROM star_challenges WHERE user_id=? AND day_key=?',[id,day]).flatMap(r=>JSON.parse(r.questions_json).map(q=>q.word.lemma)));
    const selected=shuffle(words.filter(w=>!used.has(w.lemma))).slice(0,20);
    if(selected.length<20)return fail(res,409,'可用词条不足 20 个，请先导入完整词库');
    const questions=selected.map(word=>{
      const candidates=shuffle(words.filter(w=>w.lemma!==word.lemma&&w.partOfSpeech===word.partOfSpeech&&w.meaningDisplay!==word.meaningDisplay));
      const other=[...new Map([...candidates,...shuffle(words)].filter(w=>w.lemma!==word.lemma&&w.meaningDisplay!==word.meaningDisplay).map(w=>[w.meaningDisplay,w])).values()].slice(0,3);
      const options=shuffle([word,...other].map(w=>({id:randomToken(8),text:w.meaningDisplay,correct:w===word})));
      return {word,options};
    });
    const challengeId=uuid('challenge');run('INSERT INTO star_challenges(id,user_id,day_key,questions_json,created_at) VALUES(?,?,?,?,?)',[challengeId,id,day,JSON.stringify(questions),nowIso()]);
    res.json({id:challengeId});
  });
  router.get('/stars/challenges/:id',requireAuth,(req,res)=>{
    const row=get('SELECT * FROM star_challenges WHERE id=? AND user_id=?',[req.params.id,req.auth.user.id]);
    if(!row)return fail(res,404,'挑战不存在');
    const answers=JSON.parse(row.answers_json),questions=JSON.parse(row.questions_json),q=questions[answers.length];
    res.json({id:row.id,index:answers.length,total:questions.length,result:row.result_json?JSON.parse(row.result_json):null,lastAnswer:answers.at(-1)||null,question:q?{lemma:q.word.lemma,phonetic:q.word.phonetic,options:q.options.map(({id,text})=>({id,text}))}:null});
  });
  router.post('/stars/challenges/:id/answer',requireWrite,(req,res)=>{
    const row=get('SELECT * FROM star_challenges WHERE id=? AND user_id=?',[req.params.id,req.auth.user.id]);
    if(!row)return fail(res,404,'挑战不存在');
    const answers=JSON.parse(row.answers_json),questions=JSON.parse(row.questions_json),index=req.body?.index;
    if(!Number.isInteger(index)||index<0||index>=questions.length)return fail(res,400,'题号不正确');
    if(index<answers.length)return res.json({answer:answers[index],result:row.result_json?JSON.parse(row.result_json):null});
    if(index!==answers.length||row.result_json)return fail(res,409,'进度已变化，请刷新继续');
    const q=questions[index],option=q.options.find(o=>o.id===req.body?.optionId);
    if(!option)return fail(res,400,'请选择一个有效选项');
    const answer={correct:option.correct,word:q.word,selectedId:option.id,correctId:q.options.find(o=>o.correct).id};answers.push(answer);
    let result=null;
    tx(()=>{
      if(answers.length===questions.length){
        const correct=answers.filter(a=>a.correct).length,accuracy=correct/questions.length;
        const proposed=accuracy>=.95?10:accuracy>=.85?7:accuracy>=.70?4:accuracy>=.60?1:-2;
        const stars=Math.max(-starTotal(row.user_id),proposed);
        result={correct,total:questions.length,accuracy,stars,balance:starTotal(row.user_id)+stars};
        run('INSERT INTO star_ledger VALUES(?,?,?,?,?,?)',[uuid('star'),row.user_id,row.id,stars,weekKeyOf(now(),'Asia/Shanghai'),nowIso()]);
      }
      run('UPDATE star_challenges SET answers_json=?,result_json=? WHERE id=?',[JSON.stringify(answers),result?JSON.stringify(result):null,row.id]);
    });
    res.json({answer,result});
  });
}
