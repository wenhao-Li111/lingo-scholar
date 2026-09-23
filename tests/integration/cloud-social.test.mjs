import test from 'node:test';
import assert from 'node:assert/strict';
import {startHarness,makeClient} from '../helpers/harness.mjs';
import {get} from '../../apps/server/src/db.js';

test('cloud registration, recovery, friend privacy, authoritative scoring and cross-device resume',async()=>{
  process.env.LINGO_PUBLIC_SIGNUP='1';
  // This test must work in the source-only distribution, without private study content.
  const testWords=Array.from({length:40},(_,index)=>({
    lemma:`testword${index+1}`,partOfSpeech:'n.',meaningDisplay:`n. 测试词义 ${index+1}`,
    exampleZh:`这是第 ${index+1} 个测试词的例句。`,phonetic:'',
  }));
  const h=await startHarness({seed:false,getStarDecks:()=>[{id:'test-stars',words:testWords}]});
  try{
    const a=h.client,b=makeClient(h.baseUrl),stranger=makeClient(h.baseUrl);
    const signup=async(c,email)=>{const r=await c.post('/api/auth/register',{email,password:'MountainRiver79',displayName:email.split('@')[0],role:'admin'});assert.equal(r.status,200);assert.equal(r.body.user.role,'member');assert.equal(r.body.emailVerified,false);c.setCsrf(r.body.csrfToken);return r.body;};
    const accountA=await signup(a,'alice@example.com'),accountB=await signup(b,'bob@example.com');await signup(stranger,'charlie@example.com');
    assert.equal((await a.post('/api/social/requests',{email:'bob@example.com'})).status,200);
    const inbox=(await b.get('/api/social')).body;assert.equal(inbox.friends.length,1);assert.equal(inbox.friends[0].incoming,true);assert.equal(inbox.board.length,1);
    assert.equal((await stranger.post(`/api/social/requests/${inbox.friends[0].id}`,{action:'accept'})).status,404);
    assert.equal((await b.post(`/api/social/requests/${inbox.friends[0].id}`,{action:'accept'})).status,200);
    const social=(await a.get('/api/social')).body;assert.equal(social.board.length,2);assert.ok(!JSON.stringify(social).includes('@example.com'));
    const start=await a.post('/api/stars/challenges');assert.equal(start.status,200);const id=start.body.id;
    assert.equal((await b.get(`/api/stars/challenges/${id}`)).status,404);
    assert.equal((await a.post('/api/stars/challenges')).body.id,id);
    const q=(await a.get(`/api/stars/challenges/${id}`)).body;assert.equal(q.question.options.length,4);assert.ok(q.question.options.every(o=>!('correct' in o)));
    // Read expected answer only from the isolated test DB, never from public API.
    const questions=JSON.parse(get('SELECT questions_json FROM star_challenges WHERE id=?',[id]).questions_json);
    for(let i=0;i<20;i++){
      const answer=await a.post(`/api/stars/challenges/${id}/answer`,{index:i,optionId:questions[i].options.find(o=>o.correct).id,correct:false});assert.equal(answer.status,200);assert.equal(answer.body.answer.correct,true);
      if(i===0){const second=makeClient(h.baseUrl);const login=await second.post('/api/auth/login',{email:'alice@example.com',password:'MountainRiver79'});second.setCsrf(login.body.csrfToken);assert.equal((await second.get(`/api/stars/challenges/${id}`)).body.index,1);}
    }
    assert.equal((await a.get('/api/social')).body.stars,10);
    await a.post(`/api/stars/challenges/${id}/answer`,{index:19,optionId:questions[19].options[0].id});assert.equal((await a.get('/api/social')).body.stars,10);
    const badId=(await a.post('/api/stars/challenges')).body.id;const wrongQuestions=JSON.parse(get('SELECT questions_json FROM star_challenges WHERE id=?',[badId]).questions_json);
    assert.ok(wrongQuestions.every(q=>!questions.some(old=>old.word.lemma===q.word.lemma)));
    for(let i=0;i<20;i++)await a.post(`/api/stars/challenges/${badId}/answer`,{index:i,optionId:wrongQuestions[i].options.find(o=>!o.correct).id});
    assert.equal((await a.get('/api/social')).body.stars,8);
    const bChallenge=(await b.post('/api/stars/challenges')).body.id;
    const bQuestions=JSON.parse(get('SELECT questions_json FROM star_challenges WHERE id=?',[bChallenge]).questions_json);
    for(let i=0;i<20;i++)await b.post(`/api/stars/challenges/${bChallenge}/answer`,{index:i,optionId:bQuestions[i].options.find(o=>!o.correct).id});
    assert.equal((await b.get('/api/social')).body.stars,0,'Penalty cannot make total balance negative');
    const recovery=await stranger.post('/api/auth/recover',{email:'alice@example.com',code:accountA.recoveryCode,password:'CloudMeadow382'});assert.equal(recovery.status,200);assert.notEqual(recovery.body.recoveryCode,accountA.recoveryCode);assert.equal((await a.get('/api/me')).status,401);
    assert.equal((await stranger.post('/api/auth/recover',{email:'alice@example.com',code:accountA.recoveryCode,password:'CloudMeadow384'})).status,400);
    b.setCsrf('invalid');assert.equal((await b.post('/api/auth/logout',{})).status,403);
  }finally{await h.close();delete process.env.LINGO_PUBLIC_SIGNUP;}
});
