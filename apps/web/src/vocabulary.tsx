import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Bar, Skeleton, useAsync, useToast } from './ui';

type Word = { id: string; lemma: string; partOfSpeech: string; meaningZh: string; acceptedSpellings?: string[]; example?: string; exampleSource?: string; extra?: string; group: number; progress?: { familiarity: string; nextReviewAt: string } };
type Deck = { id: string; title: string; shortTitle: string; description: string; wordCount: number; groupSize: number; sourceUrl?: string; sourceResourceId?: string; words: Word[] };
const go = (route: string) => { window.location.hash = `#/${route}`; };
function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-GB'; utterance.rate = .85;
  speechSynthesis.speak(utterance);
}
function Sentence({ word }: { word: Word }) {
  const sentence = word.example || '';
  const variants = [...(word.acceptedSpellings || []), word.lemma].filter(Boolean).sort((a,b) => b.length-a.length);
  const pattern = variants.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts = sentence.split(new RegExp(`(${pattern})`, 'ig'));
  return <section className="practice-context" aria-label="单词对应例句"><span>IN CONTEXT · 在句子中记住它</span>
    <p className="serif">{sentence ? parts.map((part, i) => variants.some(v => v.toLowerCase() === part.toLowerCase()) ? <mark key={i}>{part}</mark> : part) : '这份原词表没有提供例句；可切换主题词库学习有例句的词条。'}</p>
    {sentence && <button className="btn sm" onClick={() => speak(sentence)}>听完整例句</button>}
    {word.extra && word.extra !== '-' && <p className="small">{word.extra}</p>}
    <small>{word.exampleSource || '来源词条例句'}</small>
  </section>;
}

export function VocabularyLibrary() {
  const {data, loading} = useAsync<{decks: Deck[];stats:{uniqueHeadwords:number}}>(() => api.get('/api/resources/decks'), []);
  const [query, setQuery] = useState('');
  if (loading || !data) return <Skeleton h={500}/>;
  const total = data.stats.uniqueHeadwords;
  return <div className="resource-page">
    <section className="resource-hero"><div className="resource-hero-copy"><span className="resource-overline">WORDS IN CONTEXT</span><h1>每一个词，都有它的语境。</h1><p>先回想，再练习，最后在完整句子里把词记住。选择一个主题，开始今天的 20 词。</p><input className="input" aria-label="搜索词库" placeholder="搜索主题词库" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="resource-hero-stats"><span><strong>{total.toLocaleString()}</strong><small>去重英文词头 / 短语</small></span><span><strong>{data.decks.length}</strong><small>词库 / 主题</small></span></div></section>
    <div className="resource-grid" style={{marginTop:24}}>{data.decks.filter(d=>d.title.toLowerCase().includes(query.toLowerCase())).map((deck,i)=><button key={deck.id} className="resource-card vocab-book" onClick={()=>go(`resource-deck/${deck.id}`)}><span className="eyebrow">WORD COLLECTION {String(i+1).padStart(2,'0')}</span><h2>{deck.title}</h2><p>{deck.description}</p><div className="resource-card-bottom"><strong>{deck.wordCount} 词</strong><span>开始学习 →</span></div></button>)}</div>
  </div>;
}

export function VocabularyPractice({deckId,onBack}: {deckId:string;onBack:()=>void}) {
  const {data,loading,setData} = useAsync<{deck:Deck;summary:{seen:number;due:number}}>(()=>api.get(`/api/resources/decks/${deckId}?limit=1000`),[deckId]);
  const toast = useToast();
  const [group,setGroup]=useState(1), [position,setPosition]=useState(0);
  const [mode,setMode]=useState<'recall'|'spelling'|'dictation'>('recall');
  const [filter,setFilter]=useState('all');
  const [phase,setPhase]=useState<'question'|'meaning'|'context'>('question');
  const [answer,setAnswer]=useState(''), [correct,setCorrect]=useState<boolean|null>(null), [busy,setBusy]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const lock=useRef(false);
  const reset=()=>{setPosition(0);setPhase('question');setAnswer('');setCorrect(null);};
  useEffect(()=>{reset();setGroup(1);return ()=>{if('speechSynthesis' in window)window.speechSynthesis.cancel();};},[deckId]);
  const words=useMemo(()=>data?.deck.words.filter(w=>w.group===group && (filter==='all'||(filter==='weak'?['again','fuzzy'].includes(w.progress?.familiarity||''):w.progress?.nextReviewAt && Date.parse(w.progress.nextReviewAt)<=Date.now())))||[],[data,group,filter]);
  const word=words[position];
  const totalGroups=Math.ceil((data?.deck.wordCount||0)/(data?.deck.groupSize||20));
  useEffect(()=>{if(mode!=='recall'&&phase==='question')input.current?.focus();},[position,mode,phase,group]);
  const rate=async(rating:string, result:boolean|null=null)=>{
    if(!word||lock.current||phase==='context')return;
    lock.current=true;setBusy(true);
    try {
      const r=await api.patch<{nextReviewAt:string}>(`/api/resources/decks/${deckId}/words/${word.id}`,{rating});
      setCorrect(result);setPhase('context');
      // Keep the active practice queue stable until the learner explicitly advances.
    }catch(e:any){toast.push(e.message||'保存失败，请重试','err');}
    finally{lock.current=false;setBusy(false);}
  };
  const submit=()=>{if(!word||!answer.trim())return;const normalized=answer.trim().toLowerCase().replace(/\s+/g,' ');const ok=(word.acceptedSpellings||[word.lemma]).some(s=>s.toLowerCase()===normalized);rate(ok?'known':'again',ok);};
  const next=()=>{setPosition(v=>v+1);setAnswer('');setCorrect(null);setPhase('question');};
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if((event.target as HTMLElement).closest('input,textarea,select,button,a')||busy||!word)return;
      if(phase==='context'&&(event.code==='Space'||event.key==='Enter')){event.preventDefault();next();}
      else if(mode==='recall'&&phase==='question'&&(event.code==='Space'||event.key==='Enter')){event.preventDefault();setPhase('meaning');}
      else if(mode==='recall'&&phase==='meaning'&&['1','2','3'].includes(event.key)){event.preventDefault();rate(event.key==='1'?'again':event.key==='2'?'fuzzy':'known');}
    };window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  });
  if(loading||!data)return <Skeleton h={640}/>;
  return <div className="resource-deck-shell"><header className="resource-deck-head"><button onClick={onBack}>← 全部词库</button><div><span className="eyebrow">FOCUS / PRACTISE / REMEMBER</span><h1>{data.deck.title}</h1><p>{data.deck.wordCount} 词 · 每组 {data.deck.groupSize} 词 · 学完单词后读例句</p></div></header>
    <div className="practice-toolbar"><div className="practice-modes" aria-label="词汇练习模式">{([['recall','词义回想'],['spelling','看义拼写'],['dictation','听音默写']] as const).map(([key,label])=><button aria-pressed={mode===key} key={key} onClick={()=>{setMode(key);reset();}}>{label}</button>)}</div><label>词组 <select className="input" value={group} onChange={e=>{setGroup(Number(e.target.value));reset();}}>{Array.from({length:totalGroups},(_,i)=><option value={i+1} key={i}>第 {i+1} 组</option>)}</select></label><label>范围 <select className="input" value={filter} onChange={e=>{setFilter(e.target.value);reset();}}><option value="all">全部词</option><option value="weak">薄弱词</option><option value="due">到期词</option></select></label></div>
    <main className="context-stage" key={`${deckId}-${group}-${position}-${mode}`}>
      {!word?<div className="source-word-finished"><span className="eyebrow">SESSION COMPLETE</span><h2>{words.length?'这一组，记得更牢了。':'当前分组没有符合条件的词'}</h2><p>{words.length?`${words.length} 个词的学习记录已保存。`:'可切换分组或选择全部词。'}</p><button className="btn primary" onClick={()=>{api.get<any>(`/api/resources/decks/${deckId}?limit=1000`).then(setData); if(group<totalGroups)setGroup(group+1);reset();}}>继续学习</button><button className="btn" onClick={onBack}>选择其他主题</button></div>:<>
        <div className="source-word-progress"><span>{mode==='recall'?'RECALL':mode==='spelling'?'SPELLING':'DICTATION'}</span><Bar value={position} max={words.length}/><span>{position+1}/{words.length}</span></div>
        <div className="context-word"><span className="eyebrow">{phase==='context'?'把词放回生活中':'留一点时间，认真回想'}</span>
          <h2 className="serif">{phase==='context'||mode==='recall'?word.lemma:mode==='spelling'?word.meaningZh:'听一听，写下来'}</h2>
          {(mode!=='spelling'||phase==='context')&&<button className="word-pronounce" onClick={()=>speak(word.lemma)}>◖ 英式发音</button>}
          {(phase!=='question'||mode==='recall')&&<span className="source-word-pos">{word.partOfSpeech}</span>}
        </div>
        {phase==='context'?<div className="context-feedback" aria-live="polite">{correct!==null&&<p className={correct?'correct':'incorrect'}>{correct?'✓ 拼写正确':'再记一次 · 正确拼写：'+word.lemma}</p>}<p className="context-meaning">{word.meaningZh}</p><Sentence word={word}/><button className="btn primary wide" onClick={next}>记住这个语境，继续 →</button></div>:mode==='recall'?<>
          {phase==='question'?<button className="source-reveal" onClick={()=>setPhase('meaning')}><span>先回想，再揭晓</span><strong>查看词义</strong><small>SPACE</small></button>:<><div className="source-answer"><strong>{word.meaningZh}</strong></div><div className="source-ratings"><button disabled={busy} onClick={()=>rate('again')}><span>1</span><strong>不认识</strong></button><button disabled={busy} onClick={()=>rate('fuzzy')}><span>2</span><strong>模糊</strong></button><button disabled={busy} onClick={()=>rate('known')}><span>3</span><strong>认识</strong></button></div></>}
        </>:<form className="practice-form" onSubmit={e=>{e.preventDefault();submit();}}><input ref={input} aria-label="拼写英文单词" className="input answer-input" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="输入英文单词" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}/><button className="btn primary wide" disabled={busy||!answer.trim()}>检查拼写</button><button type="button" className="btn wide" disabled={busy} onClick={()=>rate('again',false)}>想不起来，学习答案</button></form>}
      </>}
    </main>
  </div>;
}
