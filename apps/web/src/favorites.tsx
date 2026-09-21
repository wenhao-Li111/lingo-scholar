import React,{useState} from 'react';
import {api} from './api';
import {Skeleton,useAsync,useToast} from './ui';
export function FavoriteButton({kind,id}:{kind:'word'|'listening';id:string}){
 const {data,setData}=useAsync<{items:{kind:string;id:string}[]}>(()=>api.get('/api/study/favorites'),[id]);
 const toast=useToast();const [busy,setBusy]=useState(false);
 const saved=Boolean(data?.items.some(x=>x.kind===kind&&x.id===id));
 return <button className="btn favorite-button" aria-label={saved?'取消收藏':'收藏'} aria-pressed={saved} disabled={!data||busy} onClick={async()=>{setBusy(true);try{await api.patch(`/api/study/favorites/${kind}/${encodeURIComponent(id)}`,{favorite:!saved});setData({items:saved?data!.items.filter(x=>!(x.kind===kind&&x.id===id)):[...data!.items,{kind,id}]});}catch{toast.push('收藏保存失败，请重试','err');}finally{setBusy(false);}}}>{saved?'★ 已收藏':'☆ 收藏'}</button>;
}
export function Favorites(){
 const {data,loading}=useAsync<{items:{kind:string;id:string;title:string;description?:string;route:string}[]}>(()=>api.get('/api/study/favorites'),[]);
 const labels:Record<string,string>={word:'单词',listening:'听力',reading:'阅读',writing:'写作',general:'真题与综合',speaking:'口语',planning:'规划'};
 const [kind,setKind]=useState('all');
 if(loading||!data)return <Skeleton h={500}/>;
 return <section className="resource-page"><span className="eyebrow">MY COLLECTION</span><h1>留住值得再学的内容。</h1><div className="practice-modes"><button onClick={()=>setKind('all')} aria-pressed={kind==='all'}>全部</button>{Object.entries(labels).map(([k,v])=><button key={k} aria-pressed={kind===k} onClick={()=>setKind(k)}>{v} · {data.items.filter(i=>i.kind===k).length}</button>)}</div><div className="resource-grid">{data.items.filter(i=>kind==='all'||i.kind===kind).map(i=><button key={`${i.kind}:${i.id}`} className="resource-card" onClick={()=>window.location.hash='#/'+i.route}><span className="eyebrow">{labels[i.kind]}</span><h2>{i.title}</h2><p>{i.description}</p><span>继续学习 →</span></button>)}</div>{!data.items.some(i=>kind==='all'||i.kind===kind)&&<p>还没有收藏。在单词、听力或资料页面点击 ☆，就会收进这里。</p>}</section>;
}
