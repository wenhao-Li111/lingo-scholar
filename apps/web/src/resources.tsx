import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Bar, Card, Icon, Skeleton, Tag, useAsync, useToast } from './ui';
import {PdfReader} from './pdf-reader';

type ResourceState = {
  favorite: boolean;
  status: 'not_started' | 'reading' | 'completed';
  progressPercent: number;
  lastPage: number;
  note: string;
  updatedAt: string | null;
};

type ResourceItem = {
  id: string;
  title: string;
  category: string;
  format: 'pdf' | 'docx' | 'md';
  sourceName?: string;
  sha256?: string;
  storage?: string;
  sizeBytes: number;
  pages: number;
  scanned: boolean;
  textCharacters: number;
  searchPreview: string;
  description: string;
  tags: string[];
  featured: boolean;
  sourcePath: string;
  sourceUrl: string;
  fileUrl: string;
  state: ResourceState;
  snippet?: string;
  matchSource?: string;
};

type Catalog = {
  source: { name: string; repository: string; license: string; usage: string; notice: string };
  generatedAt: string;
  stats: { total: number; pdf: number; docx: number; searchable: number; scanned: number; sizeBytes: number; categories: Record<string, number> };
  resources: ResourceItem[];
};

const CATEGORY: Record<string, { label: string; en: string; tone: string }> = {
  all: { label: '全部', en: 'All', tone: 'all' },
  listening: { label: '听力', en: 'Listening', tone: 'blue' },
  reading: { label: '阅读', en: 'Reading', tone: 'green' },
  writing: { label: '写作', en: 'Writing', tone: 'gold' },
  speaking: { label: '口语', en: 'Speaking', tone: 'coral' },
  planning: { label: '规划', en: 'Planning', tone: 'purple' },
  general: { label: '综合', en: 'General', tone: 'slate' },
};

function go(path: string) {
  window.location.hash = `#/${path.replace(/^\//, '')}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stateLabel(state: ResourceState) {
  if (state.status === 'completed') return '已完成';
  if (state.status === 'reading') return `已读 ${state.progressPercent}%`;
  return '未开始';
}

export function ResourcesScreen({initialCategory='all',papersOnly=false}:{initialCategory?:string;papersOnly?:boolean}={}) {
  const { data, loading } = useAsync<Catalog>(() => api.get('/api/resources'), []);
  const [category, setCategory] = useState(initialCategory);
  const [query, setQuery] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [searchResults, setSearchResults] = useState<ResourceItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const value = query.trim();
    if (!value) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.get<{ results: ResourceItem[] }>(`/api/resources/search?q=${encodeURIComponent(value)}&category=${encodeURIComponent(category)}&limit=60`)
        .then((result) => setSearchResults(result.results))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, category]);

  const stateById = useMemo(() => new Map(data?.resources.map((item) => [item.id, item.state]) || []), [data]);
  const visible = useMemo(() => {
    const source = searchResults || data?.resources || [];
    return source
      .map((item) => ({ ...item, state: stateById.get(item.id) || item.state }))
      .filter((item) => category === 'all' || item.category === category)
      .filter((item) => !papersOnly || /真题|剑桥|cambridge|ielts\s*\d/i.test(item.title+' '+item.sourcePath))
      .filter((item) => !onlyFavorites || item.state.favorite);
  }, [category, data, onlyFavorites, searchResults, stateById,papersOnly]);

  const featured = useMemo(() => (data?.resources || []).filter((item) => item.featured).slice(0, 6), [data]);
  const completed = data?.resources.filter((item) => item.state.status === 'completed').length || 0;

  if (loading || !data) return <div className="resource-page stack"><Skeleton h={190} /><Skeleton h={360} /></div>;

  return (
    <div className="resource-page">
      <section className="resource-hero">
        <div className="resource-hero-copy">
          <span className="resource-overline">IELTS · 我的备考资料库</span>
          <h1>把散落的资料，变成你的备考系统。</h1>
          <p>你的 PDF、openIELTS 本地资料和 zeeklog 联网资料集中在这里。搜索、阅读、收藏，让每一次练习留下笔记。</p>
          <div className="resource-search-wrap">
            <Icon.List size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索资料名称或正文，例如：流程图、同义替换、environment…"
              aria-label="全文搜索资料"
            />
            {query && <button onClick={() => setQuery('')} aria-label="清空搜索"><Icon.X size={16} /></button>}
          </div>
        </div>
        <div className="resource-hero-stats" aria-label="资料库统计">
          <span><strong>{data.stats.total}</strong><small>份资料</small></span>
          <span><strong>{data.stats.searchable}</strong><small>可全文检索</small></span>
          <span><strong>{completed}</strong><small>已完成</small></span>
        </div>
      </section>

      <section className="resource-path-grid" aria-label="推荐学习入口">
        <button className="path-card vocab" onClick={() => go('vocabulary')}>
          <span className="path-number">01</span>
          <div><span className="eyebrow">WORDS IN CONTEXT</span><h2>主题词库与词汇练习</h2><p>词义回想 · 看义拼写 · 听音默写 · 逐词例句</p></div>
          <Icon.Chevron size={22} />
        </button>
        <button className="path-card course" onClick={() => go('listening-library')}>
          <span className="path-number">02</span>
          <div><span className="eyebrow">LISTENING STUDIO</span><h2>剑桥听力练习室</h2><p>按册选题 · 变速播放 · A–B 循环 · 复盘笔记</p></div>
          <Icon.Chevron size={22} />
        </button>
      </section>
      <button className="btn" onClick={()=>go('course')}>继续五级正式课程与关卡 →</button>

      {!query && category === 'all' && (
        <section className="resource-featured">
          <div className="section-heading"><div><span className="eyebrow">建议先看</span><h2>核心资料</h2></div><span className="muted small">从高收益资料开始，而不是从文件名开始迷路</span></div>
          <div className="featured-strip">
            {featured.map((item, index) => <FeaturedResource key={item.id} item={item} index={index} />)}
          </div>
        </section>
      )}

      <section className="resource-library">
        <div className="resource-library-head">
          <div><span className="eyebrow">资料目录</span><h2>{query ? `“${query}”的搜索结果` : '按科目浏览'}</h2></div>
          <button className={`favorite-filter${onlyFavorites ? ' active' : ''}`} onClick={() => setOnlyFavorites((value) => !value)}>
            <span>{onlyFavorites ? '★' : '☆'}</span> 只看收藏
          </button>
        </div>

        <div className="resource-categories" role="tablist" aria-label="资料分类">
          {Object.entries(CATEGORY).map(([key, value]) => (
            <button key={key} role="tab" aria-selected={category === key} onClick={() => setCategory(key)}>
              <span>{value.label}</span>
              <small>{key === 'all' ? data.stats.total : data.stats.categories[key] || 0}</small>
            </button>
          ))}
        </div>

        {searching ? <div className="resource-grid"><Skeleton h={210} /><Skeleton h={210} /><Skeleton h={210} /></div> : (
          visible.length ? (
            <div className="resource-grid">
              {visible.map((item) => <ResourceCard key={item.id} item={item} />)}
            </div>
          ) : (
            <div className="resource-empty"><Icon.Book size={34} /><h3>没有找到匹配资料</h3><p>换一个关键词，或取消“只看收藏”。</p></div>
          )
        )}
      </section>

      <footer className="resource-notice">
        <Icon.Info size={17} />
        <span>资料来自你的 IELTS 文件夹、openIELTS 与 zeeklog。个人本地副本和原站联网资料均保留来源信息。</span>
        <a href={data.source.repository} target="_blank" rel="noreferrer">openIELTS 来源 ↗</a>
      </footer>
    </div>
  );
}

function FeaturedResource({ item, index }: { item: ResourceItem; index: number }) {
  const meta = CATEGORY[item.category] || CATEGORY.general;
  return (
    <button className={`featured-resource tone-${meta.tone}`} onClick={() => go(`resource/${item.id}`)}>
      <span className="featured-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="featured-category">{meta.en}</span>
      <h3>{item.title}</h3>
      <span className="featured-meta">{item.pages ? `${item.pages} 页` : item.format.toUpperCase()} · {formatSize(item.sizeBytes)}</span>
      <Icon.Chevron size={20} />
    </button>
  );
}

function ResourceCard({ item }: { item: ResourceItem }) {
  const meta = CATEGORY[item.category] || CATEGORY.general;
  const snippet = item.snippet || item.description;
  return (
    <button className="resource-card" onClick={() => go(`resource/${item.id}`)}>
      <div className="resource-card-top">
        <span className={`resource-kind tone-${meta.tone}`}>{meta.label}</span>
        <span className="resource-format">{item.format.toUpperCase()}</span>
        {item.state.favorite && <span className="resource-star" aria-label="已收藏">★</span>}
      </div>
      <h3>{item.title}</h3>
      <p>{snippet}</p>
      <div className="resource-tags">{item.tags.slice(1, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <div className="resource-card-bottom">
        <span>{item.pages ? `${item.pages} 页` : '可读文本'} · {formatSize(item.sizeBytes)}</span>
        <span className={item.state.status === 'completed' ? 'done' : ''}>{stateLabel(item.state)} <Icon.Chevron size={14} /></span>
      </div>
      {item.state.progressPercent > 0 && item.state.status !== 'completed' && <Bar value={item.state.progressPercent} thin />}
    </button>
  );
}

export function ResourceViewer({ resourceId, onBack }: { resourceId: string; onBack: () => void }) {
  const toast = useToast();
  const { data, loading, setData } = useAsync<{
    resource: ResourceItem;
    state: ResourceState;
    extractedText: string;
    textTruncated: boolean;
  }>(() => api.get(`/api/resources/${resourceId}`), [resourceId]);
  const [note, setNote] = useState('');
  const [lastPage, setLastPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const openedRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    setNote(data.state.note || '');
    setLastPage(Number(new URLSearchParams(window.location.hash.split('?')[1]).get('page')) || data.state.lastPage || 1);
    if (!openedRef.current && data.state.status === 'not_started') {
      openedRef.current = true;
      api.patch<{ state: ResourceState }>(`/api/resources/${resourceId}/state`, { status: 'reading', progressPercent: data.state.progressPercent })
        .then((result) => setData((current) => current ? { ...current, state: result.state } : current))
        .catch(() => {});
    }
  }, [data?.resource.id]);

  const save = async (patch: Partial<ResourceState>, message?: string) => {
    if (!data) return;
    setSaving(true);
    try {
      const result = await api.patch<{ state: ResourceState }>(`/api/resources/${resourceId}/state`, patch);
      setData((current) => current ? { ...current, state: result.state } : current);
      if (message) toast.push(message, 'ok');
    } catch (error: any) {
      toast.push(error.message || '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) return <div className="resource-viewer-shell"><Skeleton h={64} /><Skeleton h={680} /></div>;
  const item = data.resource;
  const meta = CATEGORY[item.category] || CATEGORY.general;
  const progressFromPage = item.pages ? Math.round(Math.min(100, lastPage / item.pages * 100)) : data.state.progressPercent;

  return (
    <div className="resource-viewer-shell">
      <header className="resource-viewer-head">
        <button className="viewer-back" onClick={onBack}>← 返回资料库</button>
        <div className="viewer-title">
          <span className={`resource-kind tone-${meta.tone}`}>{meta.label}</span>
          <h1>{item.title}</h1>
          <span>{item.pages ? `${item.pages} 页` : '站内文本'} · {formatSize(item.sizeBytes)}</span>
        </div>
        <div className="viewer-actions">
          <button onClick={() => save({ favorite: !data.state.favorite }, data.state.favorite ? '已取消收藏' : '已收藏')}>
            {data.state.favorite ? '★ 已收藏' : '☆ 收藏'}
          </button>
          <a href={item.fileUrl} target="_blank" rel="noreferrer"><Icon.Download size={16} /> 原文件</a>
        </div>
      </header>

      <div className="resource-viewer-layout">
        <main className="resource-document">
          {item.format === 'pdf' ? (
            <>
              <PdfReader url={item.fileUrl} page={lastPage} onPage={setLastPage} title={item.title}/>
              {data.extractedText&&<details className="html-extracted"><summary>展开可搜索的全文文本</summary><article className="docx-reader">{data.extractedText.split(/\n+/).filter(Boolean).map((p,i)=><p key={i}>{p}</p>)}</article></details>}
            </>
          ) : (
            <article className="docx-reader">
              {data.extractedText.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </article>
          )}
        </main>

        <aside className="resource-study-panel">
          <Card>
            <span className="eyebrow">阅读进度</span>
            <div className="viewer-progress-value"><strong>{data.state.status === 'completed' ? 100 : progressFromPage}%</strong><span>{data.state.status === 'completed' ? '已完成' : item.pages ? `第 ${lastPage}/${item.pages} 页` : stateLabel(data.state)}</span></div>
            <Bar value={data.state.status === 'completed' ? 100 : progressFromPage} />
            {item.pages > 0 && (
              <div className="page-position">
                <label htmlFor="resource-page">我读到第</label>
                <input id="resource-page" type="number" min={1} max={item.pages} value={lastPage} onChange={(event) => setLastPage(Math.max(1, Math.min(item.pages, Number(event.target.value) || 1)))} />
                <span>/ {item.pages} 页</span>
              </div>
            )}
            <button className="btn wide" onClick={() => save({ lastPage, progressPercent: progressFromPage, status: progressFromPage >= 100 ? 'completed' : 'reading' }, '阅读位置已保存')} disabled={saving}>保存阅读位置</button>
            <button className="btn primary wide" onClick={() => save({ status: data.state.status === 'completed' ? 'reading' : 'completed', progressPercent: data.state.status === 'completed' ? progressFromPage : 100 }, data.state.status === 'completed' ? '已改回阅读中' : '已标记完成')} disabled={saving}>
              {data.state.status === 'completed' ? '继续学习这份资料' : '标记为已完成'}
            </button>
          </Card>

          <Card>
            <div className="row"><Icon.Text size={17} /><h2>我的笔记</h2></div>
            <textarea className="input resource-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录可复用的表达、易错点、练习结果……" />
            <button className="btn wide" onClick={() => save({ note }, '笔记已保存')} disabled={saving || note === data.state.note}>保存笔记</button>
          </Card>

          <Card className="resource-origin-card">
            <span className="eyebrow">来源与边界</span>
            <p className="small">{item.sourceName || 'openIELTS'} · {item.storage === 'remote' ? '原站联网阅读' : '个人备考本地资料'}</p>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源文件 ↗</a>}
            {item.sha256 && <details><summary>文件校验信息</summary><div className="mono tiny">SHA-256<br />{item.sha256}</div></details>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

type DeckWord = {
  id: string; order: number; lemma: string; partOfSpeech: string; meaningZh: string; group: number;
  progress: null | { familiarity: string; seenCount: number; nextReviewAt: string };
};

export function ResourceDeckScreen({ deckId, onBack }: { deckId: string; onBack: () => void }) {
  const toast = useToast();
  const { data, loading } = useAsync<{
    deck: { id: string; title: string; shortTitle: string; description: string; wordCount: number; groupSize: number; sourceResourceId: string; words: DeckWord[] };
    summary: { seen: number; due: number; again: number; fuzzy: number; known: number };
  }>(() => api.get(`/api/resources/decks/${deckId}?limit=350`), [deckId]);
  const [group, setGroup] = useState(1);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  const words = useMemo(() => data?.deck.words.filter((word) => word.group === group) || [], [data, group]);
  const word = words[position];
  const finished = position >= words.length && words.length > 0;

  const speak = () => {
    if (!word || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.lemma);
    utterance.lang = 'en-GB';
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
  };

  const rate = useCallback(async (rating: 'again' | 'fuzzy' | 'known') => {
    if (!word || saving) return;
    setSaving(true);
    try {
      await api.patch(`/api/resources/decks/${deckId}/words/${word.id}`, { rating });
      setPosition((value) => value + 1);
      setRevealed(false);
    } catch (error: any) {
      toast.push(error.message || '进度保存失败', 'err');
    } finally {
      setSaving(false);
    }
  }, [deckId, saving, toast, word]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!word || saving) return;
      if (!revealed && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault(); setRevealed(true);
      } else if (revealed && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault(); rate(event.key === '1' ? 'again' : event.key === '2' ? 'fuzzy' : 'known');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rate, revealed, saving, word]);

  if (loading || !data) return <div className="resource-deck-shell"><Skeleton h={70} /><Skeleton h={610} /></div>;
  const totalGroups = Math.ceil(data.deck.wordCount / data.deck.groupSize);

  return (
    <div className="resource-deck-shell">
      <header className="resource-deck-head">
        <button onClick={onBack}>← 资料库</button>
        <div><span className="eyebrow">OPENIELTS 结构化词表</span><h1>{data.deck.shortTitle || data.deck.title}</h1><p>{data.deck.description}</p></div>
        <button onClick={() => go(`resource/${data.deck.sourceResourceId}`)}>查看原 PDF ↗</button>
      </header>

      <div className="resource-deck-layout">
        <aside className="deck-groups">
          <div className="deck-summary-mini"><strong>{data.summary.seen}</strong><span>已学习</span><strong>{data.summary.due}</strong><span>待复习</span></div>
          <label htmlFor="deck-group">当前词组</label>
          <select id="deck-group" className="input" value={group} onChange={(event) => { setGroup(Number(event.target.value)); setPosition(0); setRevealed(false); }}>
            {Array.from({ length: totalGroups }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 组 · {index * 10 + 1}-{Math.min(data.deck.wordCount, index * 10 + 10)}</option>)}
          </select>
          <div className="deck-group-dots">
            {Array.from({ length: totalGroups }, (_, index) => <button key={index} aria-label={`第 ${index + 1} 组`} className={group === index + 1 ? 'active' : ''} onClick={() => { setGroup(index + 1); setPosition(0); setRevealed(false); }} />)}
          </div>
        </aside>

        <main className="source-word-stage">
          {finished ? (
            <div className="source-word-finished">
              <span className="finish-ring"><Icon.Check size={34} /></span>
              <h2>第 {group} 组完成</h2>
              <p>10 个词的熟悉度已经同步。建议完成今日课程后再回来复习“不认识”和“模糊”的词。</p>
              {group < totalGroups && <button className="btn primary" onClick={() => { setGroup(group + 1); setPosition(0); }}>继续第 {group + 1} 组</button>}
              <button className="btn" onClick={() => setPosition(0)}>再过一遍</button>
            </div>
          ) : word ? (
            <>
              <div className="source-word-progress"><span>第 {group} 组</span><Bar value={position} max={words.length} /><span className="num">{position + 1}/{words.length}</span></div>
              <button className="source-sound" onClick={speak} aria-label={`朗读 ${word.lemma}`}><Icon.Volume size={21} /></button>
              <span className="source-word-number">NO. {String(word.order).padStart(3, '0')}</span>
              <h2 className="serif">{word.lemma}</h2>
              <span className="source-word-pos">{word.partOfSpeech}</span>
              {!revealed ? (
                <button className="source-reveal" onClick={() => setRevealed(true)}><span>先回想中文意思</span><strong>点击揭晓</strong><small>SPACE</small></button>
              ) : (
                <div className="source-answer"><span>核心释义</span><strong>{word.meaningZh}</strong></div>
              )}
              {revealed && (
                <div className="source-ratings">
                  <button disabled={saving} onClick={() => rate('again')}><span>1</span><strong>不认识</strong><small>明天复习</small></button>
                  <button disabled={saving} onClick={() => rate('fuzzy')}><span>2</span><strong>有点模糊</strong><small>3 天后复习</small></button>
                  <button disabled={saving} onClick={() => rate('known')}><span>3</span><strong>认识</strong><small>7 天后复习</small></button>
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
