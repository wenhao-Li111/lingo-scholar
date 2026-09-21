import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {useAsync} from './ui';
type Segment={start:number;end:number;en:string;zh?:string;words?:{start:number;end:number;text:string}[]};
type Script={paragraphs:string[];source:string;resourceId?:string;page?:number;segments?:Segment[];translationSource?:string;original?:{source:string;paragraphs:{en:string;zh?:string}[]}};
const time=(v:number)=>`${Math.floor(v/60)}:${String(Math.floor(v%60)).padStart(2,'0')}`;
export function Transcript({id,position=0,onSeek}:{id:string;position?:number;onSeek?:(seconds:number)=>void}){
 const {data,loading}=useAsync<{transcript:null|Script}>(()=>api.get(`/api/study/transcript/${id}`),[id]);
 const [index,setIndex]=useState(0),[showZh,setShowZh]=useState(true),[follow,setFollow]=useState(true);
 const panel=useRef<HTMLDivElement>(null);
 const t=data?.transcript;
 const active=t?.segments?.findIndex(s=>position>=s.start&&position<s.end)??-1;
 useEffect(()=>{if(!follow||active<0||!panel.current)return;const row=panel.current.querySelector<HTMLElement>(`[data-segment="${active}"]`);if(row)panel.current.scrollTo({top:row.getBoundingClientRect().top-panel.current.getBoundingClientRect().top+panel.current.scrollTop-panel.current.clientHeight*.3,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[active,follow]);
 if(loading)return <p>正在加载原文…</p>;
 if(!t)return <section className="transcript-panel"><h3>此音频的原文正在整理</h3><p>请稍后刷新。现有音频可正常播放。</p></section>;
 return <section className="transcript-panel"><div className="row"><h3>{t.segments?'双语同步字幕':'听力原文'}</h3><button className="btn sm" aria-pressed={showZh} onClick={()=>setShowZh(!showZh)}>{showZh?'隐藏翻译':'显示翻译'}</button>{t.segments&&<button className="btn sm" aria-pressed={follow} onClick={()=>setFollow(!follow)}>{follow?'✓ 跟随播放':'跟随播放'}</button>}</div><p className="small">{t.source}。{t.translationSource||'译文仅供理解参考'}{t.segments?'；点击时间可跳转，金色标出当前读到的词。':''}</p>
 {t.segments?<div className="synced-transcript" ref={panel} aria-label="双语同步字幕">{t.segments.map((s,i)=><article key={i} data-segment={i} className={`transcript-row ${i===active?'is-active':''}`} aria-current={i===active?'true':undefined}><button className="transcript-time" aria-label={`跳转到 ${time(s.start)}`} onClick={()=>onSeek?.(s.start)}>{time(s.start)}</button><div><p className="transcript-en">{s.words?.length?s.words.map((w,j)=><span key={j} className={position>=w.start&&position<w.end?'spoken-word':''}>{w.text}</span>):s.en}</p>{showZh&&<p className="sentence-translation">{s.zh||'参考译文正在整理'}</p>}</div></article>)}</div>:<><p className="transcript-en">{t.paragraphs[index]}</p>{showZh&&<Translation key={`${id}:${index}`} id={id} index={index}/>}<div className="row"><button className="btn" disabled={index===0} onClick={()=>setIndex(index-1)}>上一段</button><span>{index+1} / {t.paragraphs.length}</span><button className="btn" disabled={index===t.paragraphs.length-1} onClick={()=>setIndex(index+1)}>下一段</button></div></>}
 {t.original&&<details className="original-script"><summary>原书文字与译文 · 核对用</summary><p className="small">{t.original.source}</p><div className="original-script-body">{t.original.paragraphs.map((p,i)=><article key={i}><p>{p.en}</p>{showZh&&<p className="sentence-translation">{p.zh||'参考译文正在整理'}</p>}</article>)}</div></details>}
 {t.resourceId&&<a className="btn sm" href={`#/resource/${t.resourceId}?page=${t.page}`}>核对本地原文书页</a>}</section>;
}


function Translation({id,index}:{id:string;index:number}){const {data,loading}=useAsync<{translation:string;source?:string}>(()=>api.get(`/api/study/transcript/${id}/translation/${index}`),[]);return <p className="sentence-translation">{loading?'正在加载参考译文…':data?.translation||'译文暂不可用'}<small> · {data?.source||'参考译文'}</small></p>;}
