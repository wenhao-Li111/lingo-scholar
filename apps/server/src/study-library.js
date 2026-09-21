import {all,get,run} from './db.js';
import {deckById,resourceDecks,listeningCatalog,resourceCatalog,listeningTranscript} from './resources.js';

export function studyLibraryRoutes(router,requireAuth,requireWrite,now=()=>new Date()){
  const pendingTranslations=new Map();
  router.get('/study/transcript/:id',requireAuth,(req,res)=>res.json({transcript:listeningTranscript(req.params.id)}));
  router.get('/study/transcript/:id/translation/:index',requireAuth,async(req,res)=>{
    const transcript=listeningTranscript(req.params.id);
    const segment=transcript?.segments?.[Number(req.params.index)];
    if(segment?.zh)return res.json({translation:segment.zh,source:transcript.translationSource});
    const text=transcript?.paragraphs[Number(req.params.index)];
    if(!text)return res.status(404).json({error:'NO_TRANSCRIPT'});
    const cached=get('SELECT translation FROM translation_cache WHERE source_text=?',[text]);
    if(cached)return res.json(cached);
    try{const r=await fetch('https://api.mymemory.translated.net/get?langpair=en%7Czh-CN&q='+encodeURIComponent(text),{signal:AbortSignal.timeout(10000)});const result=await r.json();if(result.responseStatus!==200||result.quotaFinished||!result.responseData?.translatedText)throw Error();const translation=result.responseData.translatedText;run('INSERT OR REPLACE INTO translation_cache(source_text,translation) VALUES(?,?)',[text,translation]);res.json({translation});}catch{res.json({translation:'翻译暂不可用：网络或服务额度受限，请稍后重试。'});}
  });
  router.get('/study/word-translation/:id',requireAuth,async(req,res)=>{
    const word=resourceDecks().flatMap(d=>d.words).find(w=>w.id===req.params.id);
    if(!word?.example)return res.status(404).json({error:'NO_EXAMPLE'});
    if(word.exampleZh)return res.json({translation:word.exampleZh,source:'本地译文'});
    const cached=get('SELECT translation FROM translation_cache WHERE source_text=?',[word.example]);
    if(cached)return res.json({...cached,source:'MyMemory · 联网参考译文（已缓存）'});
    try{
      if(!pendingTranslations.has(word.example))pendingTranslations.set(word.example,(async()=>{
        const url='https://api.mymemory.translated.net/get?langpair=en%7Czh-CN&q='+encodeURIComponent(word.example);
        const r=await fetch(url,{signal:AbortSignal.timeout(10000)});const result=await r.json();
        if(result.responseStatus!==200||result.quotaFinished||!result.responseData?.translatedText)throw Error('TRANSLATION_UNAVAILABLE');
        const translation=result.responseData.translatedText;
        run('INSERT OR REPLACE INTO translation_cache(source_text,translation) VALUES(?,?)',[word.example,translation]);return translation;
      })().finally(()=>pendingTranslations.delete(word.example)));
      res.json({translation:await pendingTranslations.get(word.example),source:'MyMemory · 联网参考译文'});
    }catch{res.json({translation:'译文暂时不可用（网络或翻译服务额度限制），请稍后重试。',source:'unavailable'});}
  });
  router.get('/study/session/:key',requireAuth,(req,res)=>{
    const row=get('SELECT value_json FROM library_sessions WHERE user_id=? AND session_key=?',[req.auth.user.id,req.params.key]);
    res.json({session:row?JSON.parse(row.value_json):null});
  });
  router.patch('/study/session/:key',requireWrite,(req,res)=>{
    if(req.params.key.length>180||JSON.stringify(req.body).length>16000)return res.status(400).json({error:'INVALID_SESSION'});
    run('INSERT INTO library_sessions(user_id,session_key,value_json) VALUES(?,?,?) ON CONFLICT(user_id,session_key) DO UPDATE SET value_json=excluded.value_json',[req.auth.user.id,req.params.key,JSON.stringify(req.body)]);
    res.json({saved:true});
  });
  router.get('/study/daily',requireAuth,(req,res)=>{
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:req.auth.user.timezone||'Asia/Shanghai'}).format(now());
    const key=`daily:${day}`;
    let row=get('SELECT value_json FROM library_sessions WHERE user_id=? AND session_key=?',[req.auth.user.id,key]);
    if(!row){
      const decks=resourceDecks().filter(d=>d.words.length>=20);
      if(!decks.length)return res.status(409).json({error:'NO_DECK',message:'请先导入至少 20 个词的词库，或运行演示数据初始化。'});
      const deck=decks[Math.floor(Math.random()*decks.length)];
      const words=[...deck.words];
      for(let i=words.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[words[i],words[j]]=[words[j],words[i]];}
      const value=JSON.stringify({deckId:deck.id,wordIds:words.slice(0,20).map(w=>w.id)});
      run('INSERT OR IGNORE INTO library_sessions(user_id,session_key,value_json) VALUES(?,?,?)',[req.auth.user.id,key,value]);
      row=get('SELECT value_json FROM library_sessions WHERE user_id=? AND session_key=?',[req.auth.user.id,key]);
    }
    res.json({...JSON.parse(row.value_json),day});
  });
  router.get('/study/favorites',requireAuth,(req,res)=>{
    const items=all('SELECT kind,item_id FROM study_favorites WHERE user_id=?',[req.auth.user.id]).map(row=>{
      if(row.kind==='word'){
        const [deckId,wordId]=row.item_id.split(':');const deck=deckById(deckId);const word=deck?.words.find(w=>w.id===wordId);
        return word?{kind:'word',id:row.item_id,title:word.lemma,description:word.meaningZh,route:`resource-deck/${deckId}?word=${wordId}`} : null;
      }
      const track=listeningCatalog().tracks.find(t=>t.id===row.item_id);
      return track?{kind:'listening',id:track.id,title:`${track.book} · ${track.title}`,route:`listening-library?id=${track.id}`} : null;
    }).filter(Boolean);
    const saved=all('SELECT resource_id FROM resource_states WHERE user_id=? AND favorite=1',[req.auth.user.id]);
    for(const row of saved){const item=resourceCatalog().resources.find(i=>i.id===row.resource_id);if(item)items.push({kind:item.category,id:item.id,title:item.title,route:`resource/${item.id}`});}
    res.json({items});
  });
  router.patch('/study/favorites/:kind/:id',requireWrite,(req,res)=>{
    const {kind,id}=req.params;
    const valid=kind==='word'?(()=>{const [d,w]=id.split(':');return deckById(d)?.words.some(x=>x.id===w);})():kind==='listening'&&listeningCatalog().tracks.some(x=>x.id===id);
    if(!valid)return res.status(404).json({error:'NOT_FOUND'});
    if(req.body.favorite)run('INSERT OR IGNORE INTO study_favorites(user_id,kind,item_id) VALUES(?,?,?)',[req.auth.user.id,kind,id]);
    else run('DELETE FROM study_favorites WHERE user_id=? AND kind=? AND item_id=?',[req.auth.user.id,kind,id]);
    res.json({favorite:Boolean(req.body.favorite)});
  });
}
