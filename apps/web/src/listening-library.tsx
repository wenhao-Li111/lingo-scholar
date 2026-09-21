import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Skeleton,useAsync,useToast} from './ui';
import {FavoriteButton} from './favorites';
import {Transcript} from './transcript';
type Track={note?:string;id:string;title:string;book:string;url:string;sourceUrl:string;path:string;state:null|{position_seconds:number;note:string;completed:number}};
const fmt=(v:number)=>`${Math.floor(v/60)}:${String(Math.floor(v%60)).padStart(2,'0')}`;
export function ListeningLibrary(){
  const {data,loading,setData}=useAsync<{tracks:Track[]}>(()=>api.get('/api/listening-library'),[]);
  const [book,setBook]=useState(''),[selected,setSelected]=useState<Track|null>(null),[query,setQuery]=useState('');
  const [note,setNote]=useState(''),[rate,setRate]=useState(1),[a,setA]=useState<number|null>(null),[b,setB]=useState<number|null>(null);
  const [error,setError]=useState(''),[saved,setSaved]=useState(''),[completed,setCompleted]=useState(false);
  const [position,setPosition]=useState(0),[duration,setDuration]=useState(0),[showTranscript,setShowTranscript]=useState(false);
  const audio=useRef<HTMLAudioElement>(null),lastSaved=useRef(0);
  const toast=useToast();
  const books=[...new Set(data?.tracks.map(t=>t.book)||[])];
  useEffect(()=>{if(data&&!selected&&data.tracks.length){const id=new URLSearchParams(window.location.hash.split('?')[1]).get('id');api.get<{session:{id:string}|null}>('/api/study/session/listening-selection').then(r=>{const t=data.tracks.find(t=>t.id===(id||r.session?.id))||data.tracks[0];setSelected(t);setBook(t.book);});}},[data]);
  useEffect(()=>{if(!selected)return;setPosition(selected.state?.position_seconds||0);setDuration(0);setShowTranscript(false);setNote(selected.state?.note||'');setCompleted(Boolean(selected.state?.completed));setA(null);setB(null);setError('');setSaved('');lastSaved.current=0;api.patch('/api/study/session/listening-selection',{id:selected.id}).catch(()=>{});},[selected?.id]);
  const persist=async(patch:Record<string,unknown>={})=>{
    if(!selected)return;
    try{
      const result=await api.patch<{positionSeconds:number;note:string;completed:boolean}>(`/api/listening-library/${selected.id}`,{positionSeconds:audio.current?.currentTime||0,...patch});
      const state={position_seconds:result.positionSeconds,note:result.note,completed:result.completed?1:0};
      setData(current=>current?{...current,tracks:current.tracks.map(t=>t.id===selected.id?{...t,state}:t)}:current);
      setSelected(current=>current?.id===selected.id?{...current,state}:current);
      setSaved('进度已保存');
    }catch{setSaved('同步失败，请重试');}
  };
  if(loading||!data)return <Skeleton h={650}/>;
  const tracks=data.tracks.filter(t=>(!book||t.book===book)&&`${t.title} ${t.path}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="resource-page"><section className="resource-hero"><div className="resource-hero-copy"><span className="resource-overline">LISTEN CLOSELY</span><h1>听见细节，才听得懂。</h1><p>按剑桥册数与试题顺序练习。支持变速、回退、A–B 循环和学习笔记。</p><small>音频已接入站内播放器；双语字幕、播放位置与学习笔记随手可用。</small></div><div className="resource-hero-stats"><span><strong>{data.tracks.length}</strong><small>听力音频</small></span><span><strong>{books.length}</strong><small>册数</small></span></div></section>
    <div className="listening-layout"><aside className="listening-catalog"><label>选择册数<select className="input" aria-label="听力册数" value={book} onChange={e=>setBook(e.target.value)}>{books.map(x=><option key={x}>{x}</option>)}</select></label><input className="input" aria-label="搜索听力" placeholder="搜索 Test / Section" value={query} onChange={e=>setQuery(e.target.value)}/><div className="listening-track-list">{tracks.map(t=><button key={t.id} className={selected?.id===t.id?'active':''} onClick={async()=>{await persist({note});setSelected(t);}}><span>▷</span><div><strong>{t.title}</strong><small>{t.path.split('/').slice(2,-1).join(' / ')||t.book}</small></div></button>)}</div></aside>
    <main className="listening-player-card">{selected&&<><span className="eyebrow">{selected.book}</span><h2>{selected.title}</h2>{selected.note&&<p className="small listening-source-note">{selected.note}</p>}<FavoriteButton kind="listening" id={selected.id}/><p className="listening-position">已听到 {fmt(position)} / {fmt(duration)} · {duration?Math.round(position/duration*100):0}%</p><div className="audio-wave" aria-hidden="true">{Array.from({length:42},(_,i)=><i key={i} style={{height:`${14+(i*17%49)}px`}}/>)}</div>
      <audio key={`audio-${selected.id}`} ref={audio} controls preload="metadata" src={selected.url} onLoadedMetadata={()=>{if(audio.current){audio.current.currentTime=Math.min(selected.state?.position_seconds||0,audio.current.duration||0);audio.current.playbackRate=rate;setDuration(audio.current.duration||0);setPosition(audio.current.currentTime);}}} onSeeking={()=>setPosition(audio.current?.currentTime||0)} onSeeked={()=>setPosition(audio.current?.currentTime||0)} onError={()=>setError('音频暂时无法加载，请刷新页面后重试。')} onPause={()=>persist()} onEnded={()=>{setCompleted(true);persist({completed:true});}} onTimeUpdate={()=>{const el=audio.current;if(!el)return;setPosition(el.currentTime);if(a!==null&&b!==null&&el.currentTime>=b)el.currentTime=a;if(Date.now()-lastSaved.current>15000){lastSaved.current=Date.now();persist();}}}/>
      {error&&<p role="alert" className="incorrect">{error}</p>}
      <div className="listening-controls"><button className="btn" onClick={()=>{if(audio.current)audio.current.currentTime=Math.max(0,audio.current.currentTime-5);}}>↶ 5 秒</button><label>速度 <select value={rate} onChange={e=>{const v=Number(e.target.value);setRate(v);if(audio.current)audio.current.playbackRate=v;}}>{[.75,1,1.25,1.5].map(v=><option key={v} value={v}>{v}×</option>)}</select></label><button className="btn" onClick={()=>{setA(audio.current?.currentTime||0);setB(null);}}>A {a===null?'起点':fmt(a)}</button><button className="btn" disabled={a===null} onClick={()=>{const end=audio.current?.currentTime||0;if(a!==null&&end>a+.3)setB(end);else toast.push('终点需要在起点之后','err');}}>B {b===null?'终点':fmt(b)}</button><button className="btn" onClick={()=>{setA(null);setB(null);}}>取消循环</button></div>
      <button className="btn primary wide" aria-pressed={showTranscript} onClick={()=>setShowTranscript(!showTranscript)}>{showTranscript?'隐藏原文':'显示原文与翻译'}</button>{showTranscript&&<Transcript key={`transcript-${selected.id}`} id={selected.id} position={position} onSeek={seconds=>{if(audio.current){audio.current.currentTime=seconds;setPosition(seconds);}}}/>}<div className="listening-note"><label htmlFor="listening-note">这一段，我听到了什么？</label><textarea id="listening-note" className="input" value={note} onChange={e=>setNote(e.target.value)} placeholder="记下关键词、未听出的表达和复盘笔记……"/><div className="row"><button className="btn primary" onClick={()=>persist({note})}>保存笔记与位置</button><button className="btn" onClick={()=>{setCompleted(!completed);persist({completed:!completed});}}>{completed?'✓ 已完成':'标记完成'}</button><small aria-live="polite">{saved}</small></div></div><p className="small muted">这是自由听力练习，支持循环精听；正式课程首听与关卡仍使用原有播放规则。</p>
    </>}</main></div>
  </div>;
}
