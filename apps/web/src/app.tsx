import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getCsrf, setCsrf, type ArticleView, type ReviewBrief, type TaskView, type TodayView, type WordDetail } from './api';
import {
  Avatar, Bar, Banner, Card, Empty, Icon, Skeleton, Tag, fmtDate, fmtDuration, fmtTime, posZh, useAsync, useOnline, useToast,
} from './ui';
import { ReaderScreen, TaskScreen, WordPreview } from './learn';
import { VoiceScreen } from './voice';
import { GatePanel } from './gate';
import { ResourcesScreen, ResourceViewer, ResourceDeckScreen } from './resources';
import { VocabularyLibrary, VocabularyPractice, DailyVocabulary } from './vocabulary-next';
import {Favorites} from './favorites';
import {CloudAuth,SocialHub} from './cloud-social';
import './study-next.css';
import { ListeningLibrary } from './listening-library';

/* ============================ 路由 ============================ */
type Route = { name: string; params: Record<string, string> };
function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  if (query) for (const kv of query.split('&')) { const [k, v] = kv.split('='); if (k) params[k] = decodeURIComponent(v || ''); }
  return { name: parts[0] || 'home', params: { ...params, id: parts[1] || '' } };
}
export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ============================ 应用外壳 ============================ */
type Me = {
  stars?:number;
  user: { id: string; email: string; displayName: string; role: string; avatarSeed: string; level: number; timezone: string };
  csrfToken: string;
  group: { id: string; name: string; timezone: string; role: string } | null;
  points: { total: number; week: { weekKey: string; points: number } };
  study: { totalSeconds: number; todaySeconds: number; days: { dayKey: string; seconds: number }[]; method: string };
  serverTime: string;
};

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const [me, setMe] = useState<Me | null>(null);
  const [booted, setBooted] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [publicSignup, setPublicSignup] = useState(false);
  const online = useOnline();

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const r = await api.get<Me>('/api/me');
      setMe(r);
      setCsrf(r.csrfToken);
      setNeedsSetup(false);
    } catch (e: any) {
      setMe(null);
      if (e.status === 401) {
        try {
          const s = await api.get<{ hasUser: boolean; bootstrapConsumed: boolean;publicSignup:boolean }>('/api/bootstrap/status');
          setPublicSignup(s.publicSignup);
          setNeedsSetup(!s.hasUser || !s.bootstrapConsumed);
        } catch { setNeedsSetup(true); }
      }
    } finally {
      setBooted(true);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const noNav = route.name === 'task' || route.name === 'reader' || route.name === 'voice' || route.name === 'resource' || route.name === 'resource-deck';

  if (!booted) {
    return <div className="app-main stack"><Skeleton h={90} /><Skeleton h={160} /><Skeleton h={90} /></div>;
  }
  if (!me) {
    if(publicSignup && route.name!=='bootstrap' && route.name!=='join')return <CloudAuth onDone={loadMe}/>;
    return <AuthScreen needsSetup={needsSetup} onDone={loadMe} route={route} />;
  }

  return (
    <div className="app">
      {!noNav && <TopBar me={me} />}
      <main className={`app-main${noNav ? ' no-nav' : ''}`}>
        {!online && <Banner kind="warn">当前离线。已缓存的音频与页面仍可用，但正式任务与计分需要服务端确认，恢复网络后会自动同步。</Banner>}
        <Screen route={route} me={me} reloadMe={loadMe} />
      </main>
      {!noNav && <TabBar route={route} />}
    </div>
  );
}

function TopBar({ me }: { me: Me }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark serif">Lingo&nbsp;Scholar</span>
          <span className="brand-sub">听词研习室 · L{me.user.level}</span>
        </div>
        <div className="topbar-spacer" />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm star-link" onClick={()=>navigate('friends')} title="好友与星星挑战">★ {me.stars||0} · 好友</button>
          <button className="btn ghost sm" onClick={() => navigate('settings')} aria-label="设置与诊断">
            <Icon.Settings size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

function TabBar({ route }: { route: Route }) {
  const tabs = [
    { key: 'home', label: '背单词', icon: Icon.Home },
    { key: 'listening-library', label: '听力', icon: Icon.Book },
    { key: 'reading', label: '阅读', icon: Icon.Book },
    { key: 'writing', label: '写作', icon: Icon.Book },
    { key: 'papers', label: '真题', icon: Icon.Book },
    { key: 'review', label: '复习', icon: Icon.Clock },
    { key: 'favorites', label: '收藏', icon: Icon.List },
  ];
  return (
    <nav className="tabbar" aria-label="主导航">
      <div className="tabbar-inner">
        {tabs.map((t) => {
          const active = route.name === t.key || (t.key === 'resources' && ['course', 'group'].includes(route.name));
          return (
            <button key={t.key} className="tab" aria-current={active ? 'page' : undefined} onClick={() => navigate(t.key)}>
              <t.icon size={21} className="tab-ico" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Screen({ route, me, reloadMe }: { route: Route; me: Me; reloadMe: () => void }) {
  switch (route.name) {
    case 'favorites': return <Favorites/>;
    case 'reading': return <ResourcesScreen key="reading" initialCategory="reading"/>;
    case 'writing': return <ResourcesScreen key="writing" initialCategory="writing"/>;
    case 'papers': return <ResourcesScreen key="papers" papersOnly/>;
    case 'resources': return <ResourcesScreen />;
    case 'vocabulary': return <VocabularyLibrary />;
    case 'listening-library': return <ListeningLibrary />;
    case 'resource': return <ResourceViewer resourceId={route.params.id} onBack={() => navigate('resources')} />;
    case 'resource-deck': return <VocabularyPractice key={route.params.id} deckId={route.params.id} onBack={() => navigate('vocabulary')} />;
    case 'course': return <CourseScreen me={me} />;
    case 'group': return <GroupScreen groupId={route.params.id} />;
    case 'task': return <TaskRoute taskId={route.params.id} onDone={() => { navigate('home'); reloadMe(); }} />;
    case 'reader': return <ReaderScreen articleId={route.params.id} onBack={() => window.history.back()} />;
    case 'review': return <ReviewScreen />;
    case 'exam': return <ExamScreen />;
    case 'wordbook': return <WordbookScreen />;
    case 'friends': return <SocialHub reloadMe={reloadMe}/>;
    case 'settings': return <SettingsScreen me={me} reloadMe={reloadMe} />;
    case 'voice': return <VoiceScreen scenarioRef={route.params.id} onBack={() => navigate('home')} />;
    default: return <HomeScreen me={me} reloadMe={reloadMe} />;
  }
}

/* ============================ 登录 / 初始化 ============================ */
function AuthScreen({ needsSetup, onDone, route }: { needsSetup: boolean; onDone: () => void; route: Route }) {
  const toast = useToast();
  const [mode, setMode] = useState<'bootstrap' | 'login' | 'join'>(route.name === 'join' ? 'join' : (needsSetup ? 'bootstrap' : 'login'));
  const [form, setForm] = useState({ token: route.params.token || '', email: '', displayName: '', password: '', groupName: '我的学习小组' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'bootstrap') {
        const r = await api.post<any>('/api/bootstrap', { token: form.token.trim(), email: form.email, displayName: form.displayName || form.email.split('@')[0], password: form.password, groupName: form.groupName });
        setCsrf(r.csrfToken);
        toast.push('管理员已创建', 'ok');
      } else if (mode === 'login') {
        const r = await api.post<any>('/api/auth/login', { email: form.email, password: form.password });
        setCsrf(r.csrfToken);
      } else {
        const r = await api.post<any>('/api/join', { token: form.token.trim(), email: form.email, displayName: form.displayName || form.email.split('@')[0], password: form.password });
        setCsrf(r.csrfToken);
        toast.push('已加入小组', 'ok');
      }
      onDone();
    } catch (e: any) {
      toast.push(e.message || '操作失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'bootstrap' ? '创建管理员' : mode === 'login' ? '登录' : '接受邀请';

  return (
    <div className="app-main stack" style={{ maxWidth: 520, margin: '0 auto', paddingTop: 40 }}>
      <div className="stack" style={{ gap: 6, textAlign: 'center', marginBottom: 8 }}>
        <div className="brand-mark serif" style={{ fontSize: 26 }}>Lingo Scholar</div>
        <div className="muted small">听词研习室 · IELTS G 类听力与词汇训练</div>
      </div>
      <Card>
        <div className="pill-tabs" role="tablist">
          <button role="tab" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>登录</button>
          <button role="tab" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>用邀请加入</button>
          {needsSetup && <button role="tab" aria-pressed={mode === 'bootstrap'} onClick={() => setMode('bootstrap')}>首次创建</button>}
        </div>
        <h2 style={{ marginTop: 14 }}>{title}</h2>
        <p className="small muted">
          {mode === 'bootstrap' && '默认关闭公开注册。请粘贴初始化时生成的一次性令牌；令牌只展示一次，不会写入代码仓库。'}
          {mode === 'login' && '使用你注册的邮箱与密码登录。'}
          {mode === 'join' && '粘贴组长给你的邀请链接中的令牌。邀请默认 7 天有效、单次使用，可被组长撤销。'}
        </p>
        <div className="stack" style={{ marginTop: 12 }}>
          {(mode === 'bootstrap' || mode === 'join') && (
            <div className="field">
              <label htmlFor="token">令牌</label>
              <input id="token" className="input mono" value={form.token} onChange={(e) => set('token', e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">邮箱</label>
            <input id="email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="username" />
          </div>
          {mode !== 'login' && (
            <div className="field">
              <label htmlFor="dn">昵称</label>
              <input id="dn" className="input" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pw">密码</label>
            <input id="pw" className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            {mode !== 'login' && <span className="tiny muted">至少 10 位，包含字母与数字。密码使用 scrypt 加盐哈希存储。</span>}
          </div>
          {mode === 'bootstrap' && (
            <div className="field">
              <label htmlFor="gn">小组名称</label>
              <input id="gn" className="input" value={form.groupName} onChange={(e) => set('groupName', e.target.value)} />
            </div>
          )}
          <button className="btn primary wide" onClick={submit} disabled={busy || !form.email || !form.password}>
            {busy ? '处理中…' : title}
          </button>
        </div>
      </Card>
      <p className="tiny muted" style={{ textAlign: 'center' }}>
        最多 10 个学习账号。你的原始录音、详细转录与错题内容默认只有自己可见；小组内共享的是任务完成、积分与学习时长。
      </p>
    </div>
  );
}

/* ============================ 首页 ============================ */
function HomeScreen({ me, reloadMe }: { me: Me; reloadMe: () => void }) {
  const toast = useToast();
  const { data, loading } = useAsync<TodayView>(() => api.get<TodayView>('/api/today'), []);
  const { data: board } = useAsync<any>(() => api.get('/api/leaderboard?scope=week'), []);
  const [starting, setStarting] = useState(false);

  const focusGroupId = data?.tasks.overdueReviews[0]?.groupId
    || data?.tasks.openTask?.groupId
    || data?.tasks.nextGroup?.id
    || '';
  const { data: focusGroup, loading: loadingDeck } = useAsync<{
    group: { id: string; level: number; index: number; title: string; topic: string; wordCount: number };
    words: (WordDetail & { demonstrated?: boolean })[];
    progress: { demonstrated: number; total: number };
  }>(() => api.get(`/api/course/groups/${focusGroupId}`), [focusGroupId], { immediate: Boolean(focusGroupId) });
  const { data: openIeltsDeck, loading: loadingOpenIelts } = useAsync<{
    deck: { id: string; title: string; shortTitle: string; words: { id: string; lemma: string; partOfSpeech: string; meaningZh: string; group: number; example?: string }[] };
  }>(() => api.get('/api/resources/decks/my-ielts-01?limit=20&offset=0'), []);

  const startNew = async () => {
    setStarting(true);
    try {
      const r = await api.post<{ task: TaskView }>('/api/tasks/new', {});
      navigate(`task/${r.task.id}`);
    } catch (e: any) {
      if (e.error === 'OVERDUE_REVIEWS') {
        toast.push('请先完成到期复习', 'err');
        navigate('review');
      } else {
        toast.push(e.message || '无法开始', 'err');
      }
    } finally {
      setStarting(false);
    }
  };

  const startReview = async (rv: ReviewBrief) => {
    try {
      const r = await api.post<{ task: TaskView }>(`/api/reviews/${rv.id}/start`, {});
      navigate(`task/${r.task.id}`);
    } catch (e: any) {
      toast.push(e.message || '无法开始复习', 'err');
    }
  };

  const startFocusTask = async () => {
    const overdue = data?.tasks.overdueReviews[0];
    if (overdue) return startReview(overdue);
    if (data?.tasks.openTask) return navigate(`task/${data.tasks.openTask.id}`);
    return startNew();
  };

  if (loading || !data) return <div className="stack"><Skeleton h={110} /><Skeleton h={150} /><Skeleton h={90} /></div>;

  const wk = data.weekly;
  const weeklyStateLabel: Record<string, string> = {
    not_open: '未开放（周日 00:00 开放）',
    open: '可参加',
    in_progress: '进行中',
    passed: '已通过',
    failed: '未通过（已扣分）',
    missed: '已缺考',
    not_applicable: '本周无合格词条，不扣分',
  };

  const focusMode = data.tasks.overdueReviews.length > 0
    ? 'review'
    : data.tasks.openTask
      ? 'continue'
      : 'new';
  const focusLabel = focusMode === 'review'
    ? `开始到期复习 · ${data.tasks.overdueReviews[0].groupTitle}`
    : focusMode === 'continue'
      ? '继续正式测验'
      : '开始正式测验';
  const todayMinutes = Math.max(0, Math.round(data.study.todaySeconds / 60));
  const dailyTarget = Object.values(data.dailyAllocation).reduce((a, b) => a + b, 0);
  const sourceWords: WordDetail[] = (openIeltsDeck?.deck.words || []).map((word) => ({
    id: word.id,
    lemma: word.lemma,
    partOfSpeech: word.partOfSpeech,
    coreMeaningZh: word.meaningZh,
    phonetic: null,
    collocations: [],
    confusionPairs: [],
    cloze: { en: word.example || '', answer: word.lemma, hintZh: '' },
    topic: 'IELTS listening',
    level: 1,
  }));

  return (
    <div className="home-shell">
      <section className="home-welcome" aria-labelledby="home-title">
        <div>
          <span className="eyebrow">今日学习</span>
          <h1 id="home-title">{me.user.displayName}，先记住一个词。</h1>
        </div>
        <div className="home-stats" aria-label="今日学习摘要">
          <span><strong className="num">{todayMinutes}</strong><small>分钟</small></span>
          <span><strong className="num">{data.points.points}</strong><small>本周积分</small></span>
          <span><strong className="num">L{me.user.level}</strong><small>当前级别</small></span>
        </div>
      </section>

      {board?.rows?.length > 0 && (
        <div className="friend-strip home-friends" aria-label="本周学习伙伴">
          {board.rows.slice(0, 8).map((r: any) => (
            <span key={r.userId} className={`friend-chip${r.userId === me.user.id ? ' me' : ''}`}>
              <span className="rank num">{r.rank}</span>
              <Avatar seed={r.avatarSeed} name={r.displayName} size={24} />
              <span className="nm">{r.displayName}</span>
              <span className="pts num">{r.points}</span>
              <span className="tm num">{fmtDuration(r.seconds || 0)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="home-layout">
        <section className="home-focus" aria-label="今日单词学习">
          <DailyVocabulary/>
        </section>

        <aside className="home-aside" aria-label="今日学习安排">
          {data.tasks.overdueReviews.length > 0 && (
            <Card className="due-card">
              <div className="row">
                <span className="due-icon"><Icon.Clock size={18} /></span>
                <div>
                  <span className="eyebrow">优先任务</span>
                  <h2>{data.tasks.overdueReviews.length} 项复习已到期</h2>
                </div>
              </div>
              <p className="small muted">先完成到期复习，系统才会开放今天的新词。</p>
              <button className="btn primary wide" onClick={() => startReview(data.tasks.overdueReviews[0])}>开始复习</button>
            </Card>
          )}

          {data.tasks.overdueReviews.length === 0 && (data.tasks.openTask || data.tasks.nextGroup) && (
            <Card className="course-focus-card">
              <div className="row">
                <span className="course-focus-icon"><Icon.Book size={18} /></span>
                <div>
                  <span className="eyebrow">今日正式课程</span>
                  <h2>{data.tasks.openTask ? '继续未完成测验' : data.tasks.nextGroup?.title}</h2>
                </div>
              </div>
              <p className="small muted">openIELTS 词表用于扩充输入；课程测验负责正式掌握、积分和复习调度。</p>
              <button className="btn primary wide" onClick={startFocusTask} disabled={starting}>{starting ? '准备中…' : focusLabel}</button>
            </Card>
          )}

          <Card className="today-plan-card">
            <div className="row">
              <div>
                <span className="eyebrow">今日进度</span>
                <h2>{todayMinutes >= dailyTarget ? '今日目标已完成' : `还差 ${Math.max(0, dailyTarget - todayMinutes)} 分钟`}</h2>
              </div>
              <div className="spacer" />
              <span className="plan-percent num">{dailyTarget ? Math.min(100, Math.round(todayMinutes / dailyTarget * 100)) : 0}%</span>
            </div>
            <Bar value={todayMinutes} max={dailyTarget || 1} />
            <div className="plan-grid">
              <span>复习<strong>{data.dailyAllocation.review}m</strong></span>
              <span>新词<strong>{data.dailyAllocation.new_words}m</strong></span>
              <span>听读<strong>{data.dailyAllocation.listening_reading}m</strong></span>
              <span>口语<strong>{data.dailyAllocation.speaking}m</strong></span>
            </div>
          </Card>

          <Card className="source-tip-card">
            <div className="row">
              <Icon.Spark size={18} />
              <h2>openIELTS 资料已入库</h2>
            </div>
            <p>主题词库、你提供的 PDF、openIELTS 资料与剑桥听力已整合。选择词库、练习拼写，或开始一段听力。</p>
            <button className="source-tip-link" onClick={() => navigate('vocabulary')}>选择词库与练习模式 →</button>
            <button className="source-tip-link" onClick={() => navigate('listening-library')}>剑桥听力练习 →</button>
            <button className="source-tip-link" onClick={() => navigate('resources')}>进入完整资料库 <span aria-hidden>→</span></button>
          </Card>

          <Card>
            <div className="row">
              <Icon.Trophy size={19} />
              <div>
                <span className="eyebrow">本周周考</span>
                <h2>{weeklyStateLabel[wk.state] || wk.state}</h2>
              </div>
              <div className="spacer" />
              <span className={`status-dot ${wk.state === 'passed' ? 'ok' : wk.state === 'failed' || wk.state === 'missed' ? 'danger' : 'warn'}`} />
            </div>
            <div className="home-exam-stats">
              <span><strong className="num">{wk.eligibleWords}</strong> 可考词</span>
              <span><strong className="num">{wk.completedGroupsThisWeek}</strong> 完成词组</span>
            </div>
            <button className="btn wide" onClick={() => navigate('exam')}>查看考试安排</button>
          </Card>

          <VoiceEntryCard />
        </aside>
      </div>
    </div>
  );
}

type DeckRating = 'again' | 'fuzzy' | 'known';

function HomeWordDeck({
  group, words, mode, actionLabel, starting, onStart, onRate,
}: {
  group: { id: string; level: number; index: number; title: string; topic: string; wordCount: number };
  words: WordDetail[];
  mode: 'review' | 'continue' | 'new' | 'source';
  actionLabel: string;
  starting: boolean;
  onStart: () => void;
  onRate?: (wordId: string, rating: DeckRating) => Promise<unknown>;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [context, setContext] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [ratings, setRatings] = useState<Record<DeckRating, number>>({ again: 0, fuzzy: 0, known: 0 });
  const storageKey = `lingo.home-deck.${group.id}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const savedIndex = Number(saved.index);
      setIndex(Number.isFinite(savedIndex) ? Math.max(0, Math.min(words.length, savedIndex)) : 0);
      setRatings({
        again: Number(saved.ratings?.again) || 0,
        fuzzy: Number(saved.ratings?.fuzzy) || 0,
        known: Number(saved.ratings?.known) || 0,
      });
    } catch {
      setIndex(0);
      setRatings({ again: 0, fuzzy: 0, known: 0 });
    }
    setRevealed(false);
  }, [storageKey, words.length]);

  const word = words[index];
  const finished = index >= words.length;

  const speak = () => {
    if (!word || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.lemma);
    utterance.lang = 'en-GB';
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
  };

  const rate = useCallback(async (rating: DeckRating) => {
    if (saving || context) return;
    setSaving(true);
    try {
    if (word) await onRate?.(word.id, rating);
    const nextRatings = { ...ratings, [rating]: ratings[rating] + 1 };
    const nextIndex = Math.min(words.length, index + 1);
    setRatings(nextRatings);
    setContext(true);
    localStorage.setItem(storageKey, JSON.stringify({ index: nextIndex, ratings: nextRatings }));
    } catch (e: any) { toast.push(e.message || '学习记录保存失败，请重试', 'err'); }
    finally { setSaving(false); }
  }, [index, onRate, ratings, storageKey, word, words.length, saving, context, toast]);

  const reset = () => {
    setIndex(0);
    setRevealed(false);
    setRatings({ again: 0, fuzzy: 0, known: 0 });
    localStorage.removeItem(storageKey);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (context && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault(); setIndex(v=>v+1);setContext(false);setRevealed(false);
      } else if (!revealed && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        rate(event.key === '1' ? 'again' : event.key === '2' ? 'fuzzy' : 'known');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rate, revealed, context]);

  if (finished) {
    return (
      <div className="study-deck deck-finished">
        <div className="deck-topline">
          <span className="deck-kicker">预习完成 · {group.title}</span>
          <Tag kind="ok">{words.length}/{words.length}</Tag>
        </div>
        <div className="deck-finish-mark"><Icon.Check size={34} /></div>
        <h2>这一轮过完了</h2>
        <p>自评只是帮你找出薄弱词；是否真正掌握，仍以接下来的无提示拼写为准。</p>
        <div className="deck-summary" aria-label="本轮自评结果">
          <span><strong>{ratings.again}</strong><small>不认识</small></span>
          <span><strong>{ratings.fuzzy}</strong><small>模糊</small></span>
          <span><strong>{ratings.known}</strong><small>认识</small></span>
        </div>
        <button className="btn deck-primary wide" onClick={onStart} disabled={starting}>
          {starting ? '准备中…' : actionLabel}
        </button>
        <button className="deck-link-button" onClick={reset}>再过一遍这组词</button>
      </div>
    );
  }

  if (!word) return <Skeleton h={520} />;

  return (
    <div className={`study-deck${revealed ? ' is-revealed' : ''}`}>
      <div className="deck-topline">
        <span className="deck-kicker">{mode === 'review' ? '到期复习预热' : mode === 'continue' ? '继续学习' : mode === 'source' ? 'WORDS IN CONTEXT · 每日词汇' : `L${group.level} · 第 ${group.index} 组`}</span>
        <span className="deck-counter num">{index + 1} / {words.length}</span>
      </div>
      <div className="deck-progress"><span style={{ width: `${((index + (revealed ? 0.5 : 0)) / words.length) * 100}%` }} /></div>

      <div className="deck-word-head">
        <span className="deck-topic">{group.title}</span>
        <button className="deck-sound" onClick={speak} aria-label={`朗读 ${word.lemma}`} title="朗读单词">
          <Icon.Volume size={21} />
        </button>
      </div>
      <div className="deck-word serif">{word.lemma}</div>
      <div className="deck-meta">
        <span>{posZh(word.partOfSpeech)}</span>
        {word.phonetic && <span className="serif">/{word.phonetic}/</span>}
        <span>{word.topic}</span>
      </div>

      {!revealed ? (
        <button className="deck-reveal" onClick={() => setRevealed(true)}>
          <span>先在脑中回想它的意思</span>
          <strong>点击查看释义</strong>
          <small>空格键也可以</small>
        </button>
      ) : (
        <div className="deck-answer" aria-live="polite">
          <div className="deck-meaning">{word.coreMeaningZh}</div>
          {word.collocations?.length > 0 && (
            <div className="deck-detail">
              <span>常用搭配</span>
              <p>{word.collocations.slice(0, 2).join(' · ')}</p>
            </div>
          )}
          {context && word.cloze?.en && (
            <div className="deck-example">
              <span>语境记忆</span>
              <p className="serif">{word.cloze.en.replace(/_{2,}/g,word.cloze.answer || word.lemma)}</p>
              {word.cloze.hintZh && <small>{word.cloze.hintZh}</small>}
            </div>
          )}
          {word.confusionPairs?.[0] && (
            <div className="deck-confusion"><strong>易混 {word.confusionPairs[0].word}</strong> · {word.confusionPairs[0].note}</div>
          )}
        </div>
      )}

      {context ? <button className="btn deck-primary wide" onClick={()=>{setIndex(v=>v+1);setContext(false);setRevealed(false);}}>读完例句，继续 →</button> : revealed ? (
        <div className="deck-ratings" aria-label="选择熟悉程度">
          <button onClick={() => rate('again')}><span>1</span><strong>不认识</strong><small>稍后重点测</small></button>
          <button onClick={() => rate('fuzzy')}><span>2</span><strong>有点模糊</strong><small>需要再看</small></button>
          <button onClick={() => rate('known')}><span>3</span><strong>认识</strong><small>继续下一个</small></button>
        </div>
      ) : (
        <div className="deck-bottom-note">先判断，再揭晓。不要让“看懂答案”冒充“真正记住”。</div>
      )}

      <div className="deck-source-line">
        <span>自评不计入正式掌握度</span>
        <button onClick={onStart} disabled={starting}>{actionLabel} <span aria-hidden>→</span></button>
      </div>
    </div>
  );
}

function VoiceEntryCard() {
  const { data } = useAsync<any>(() => api.get('/api/voice/capabilities').catch(() => null), []);
  return (
    <Card>
      <div className="row">
        <Icon.Mic size={19} />
        <h2>情景口语</h2>
        <div className="spacer" />
        {data && <Tag kind={data.mode === 'scenario_constrained' ? 'warn' : 'ok'}>{data.modeLabel || data.mode}</Tag>}
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        先由你开口，说完之后才展示识别文本、修改建议与参考表达。运行不使用任何付费 API。
      </p>
      {data && (
        <div className="row wrap tiny" style={{ gap: 8, marginTop: 6 }}>
          <Tag kind={data.asr?.available ? 'ok' : 'danger'}>ASR：{data.asr?.available ? `${data.asr.modelName}（离线）` : '不可用'}</Tag>
          <Tag kind={data.tts?.available ? 'ok' : 'danger'}>TTS：{data.tts?.available ? '本地合成' : '不可用'}</Tag>
        </div>
      )}
      <button className="btn primary wide" style={{ marginTop: 12 }} onClick={() => navigate('voice')}>开始情景通话</button>
    </Card>
  );
}

/* ============================ 五级课程 ============================ */
function CourseScreen({ me }: { me: Me }) {
  const { data, loading } = useAsync<{ levels: any[]; userLevel: number }>(() => api.get('/api/course/levels'), []);
  if (loading || !data) return <div className="stack"><Skeleton h={120} /><Skeleton h={120} /><Skeleton h={120} /></div>;
  return (
    <div className="stack">
      <Card>
        <span className="eyebrow">课程结构</span>
        <h1 style={{ marginTop: 2 }}>五级 · 80 组 · 1600 词</h1>
        <p className="small muted">
          这是专项强化课程，不是你的总词汇量，也不是“雅思 6.5 必备词数”。所有人从 L1 开始，初始能力诊断不会直接跳级。
        </p>
      </Card>
      {data.levels.map((l) => {
        const locked = !l.unlocked;
        const pct = l.groupsPlanned ? (l.completedGroups / l.groupsPlanned) * 100 : 0;
        return (
          <Card key={l.id}>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <h2>L{l.id} · {l.name}</h2>
                  {locked && <Tag><Icon.Lock size={12} />未解锁</Tag>}
                  {l.current && <Tag kind="solid">当前级别</Tag>}
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  计划 {l.groupsPlanned} 组 / {l.wordsPlanned} 词 · 建议 {l.suggestedWeeks} 周 · 已发布 {l.groupsPublished} 组
                </div>
              </div>
              <div className="spacer" />
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="row tiny muted"><span>已完成 {l.completedGroups}/{l.groupsPlanned} 组</span><div className="spacer" /><span className="num">{Math.round(pct)}%</span></div>
              <Bar value={l.completedGroups} max={l.groupsPlanned} />
            </div>
            {locked ? (
              <Banner kind="warn">需先完成 L{me.user.level} 的学习任务并通过三项关卡评测（词汇 ≥18/20、阅读 ≥8/10、无字幕听力 ≥8/10）。</Banner>
            ) : (
              <div className="stack" style={{ marginTop: 10 }}>
                <div className="row wrap tiny" style={{ gap: 6 }}>
                  <Tag>词汇 {l.gate.plan.vocab.questions} 题 · 需 {l.gate.plan.vocab.needCorrect} 对</Tag>
                  <Tag>阅读 {l.gate.plan.reading.questions} 题 · 需 {l.gate.plan.reading.needCorrect} 对</Tag>
                  <Tag>听力 {l.gate.plan.listening.questions} 题 · 需 {l.gate.plan.listening.needCorrect} 对（无字幕原速）</Tag>
                  <Tag kind={l.gate.materialsReady ? 'ok' : 'warn'}>{l.gate.materialsReady ? '关卡材料已就绪' : '待补充关卡材料'}</Tag>
                </div>
                {!l.gate.materialsReady && <div className="tiny muted">{l.gate.materialsDetail?.message}</div>}
                <div className="row">
                  <button className="btn" onClick={() => navigate(`group/${firstGroupCode(l)}`)}>查看词组</button>
                  <div className="spacer" />
                  <button className="btn primary" onClick={() => navigate('exam')}>关卡与周考</button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
function firstGroupCode(l: any) { return `g${String(1 + [0, 10, 25, 40, 60][l.id - 1]).padStart(3, '0')}`; }

/* ============================ 词组详情 ============================ */
function GroupScreen({ groupId }: { groupId: string }) {
  const toast = useToast();
  const { data, loading, reload } = useAsync<any>(() => api.get(`/api/course/groups/${groupId}`), [groupId]);
  const [showPreview, setShowPreview] = useState(false);
  const [starting, setStarting] = useState(false);

  if (loading || !data) return <div className="stack"><Skeleton h={120} /><Skeleton h={200} /></div>;

  const g = data.group;
  const start = async () => {
    setStarting(true);
    try {
      const r = await api.post<{ task: TaskView }>('/api/tasks/new', { groupId });
      navigate(`task/${r.task.id}`);
    } catch (e: any) {
      if (e.error === 'OVERDUE_REVIEWS') { toast.push('请先完成到期复习', 'err'); navigate('review'); }
      else toast.push(e.message || '无法开始', 'err');
    } finally { setStarting(false); }
  };

  return (
    <div className="stack">
      <div className="row">
        <button className="btn ghost sm" onClick={() => navigate('course')}>← 课程</button>
        <div className="spacer" />
        <Tag kind={g.editorialStatus === 'published' ? 'ok' : 'warn'}>{g.editorialStatus === 'published' ? '已发布' : '未发布'}</Tag>
      </div>
      <Card>
        <span className="eyebrow">第 {g.index} 组 · L{g.level}</span>
        <h1 style={{ marginTop: 2 }}>{g.title}</h1>
        <div className="row wrap tiny muted" style={{ gap: 10, marginTop: 6 }}>
          <span>主题 {g.topic}</span>
          <span>{g.wordCount} 词</span>
          <span>本组补齐进度 {data.progress.demonstrated}/{data.progress.total}</span>
        </div>
        <Bar value={data.progress.demonstrated} max={data.progress.total} thin />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setShowPreview((v) => !v)}>{showPreview ? '收起词表' : '预习本组词表'}</button>
          <div className="spacer" />
          <button className="btn primary" onClick={start} disabled={starting}>{starting ? '准备中…' : '开始默写'}</button>
        </div>
      </Card>

      <Card>
        <h3>教学材料</h3>
        <ul className="list">
          {data.articles.map((a: any) => (
            <li key={a.id}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }} className="serif">{a.title}</div>
                <div className="tiny muted">{a.role === 'main' ? '主材料' : '补充'} · {a.type === 'dialogue' ? '对话' : '文章'} · {a.wordCount} 词 · 覆盖 {a.coverageCovered}/20 词</div>
                <div className="row wrap tiny" style={{ gap: 5, marginTop: 4 }}>
                  <Tag>{a.textOrigin === 'original' ? '原创' : a.textOrigin}</Tag>
                  <Tag>{a.translationOrigin === 'editorial_original' ? '编辑部译文' : a.translationOrigin}</Tag>
                </div>
              </div>
              <button className="btn sm" onClick={() => navigate(`reader/${a.id}`)}>听读</button>
            </li>
          ))}
        </ul>
      </Card>

      {showPreview && <WordPreview words={data.words} onStart={start} starting={starting} />}

      <Card>
        <h3>本组情景练习（4 个）</h3>
        <p className="tiny muted">每个情景约 5 个目标词；完整范句在你开口之后才出现。</p>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn wide" onClick={() => navigate(`voice/${groupId}`)}>进入情景口语</button>
        </div>
      </Card>
    </div>
  );
}

function TaskRoute({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [task, setTask] = useState<(TaskView & { previewWords?: WordDetail[] | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    api.get<{ task: TaskView & { previewWords?: WordDetail[] | null } }>(`/api/tasks/${taskId}`)
      .then((r) => setTask(r.task))
      .catch((e) => setError(e.message || '任务加载失败'));
  }, [taskId]);
  if (error) {
    return (
      <div className="stack" style={{ maxWidth: 620, margin: '0 auto' }}>
        <Card>
          <h2>任务加载失败</h2>
          <p className="muted small">{error}</p>
          <button className="btn primary" style={{ marginTop: 10 }} onClick={() => navigate('home')}>回到首页</button>
        </Card>
      </div>
    );
  }
  if (!task) return <div className="stack"><Skeleton h={120} /><Skeleton h={140} /></div>;
  const showPreview = !started && task.status === 'first_test' && task.progress.answered === 0 && task.previewWords?.length;
  if (showPreview) {
    return <WordPreview words={task.previewWords!} starting={false} onStart={() => setStarted(true)} />;
  }
  return <TaskScreen taskId={taskId} onDone={onDone} onExit={() => window.history.back()} />;
}

/* ============================ 复习中心 ============================ */
function ReviewScreen() {
  const toast = useToast();
  const { data, loading, reload } = useAsync<{ overdue: ReviewBrief[]; upcoming: ReviewBrief[]; schedule: any }>(() => api.get('/api/reviews'), []);
  if (loading || !data) return <div className="stack"><Skeleton h={120} /><Skeleton h={120} /></div>;
  const start = async (rv: ReviewBrief) => {
    try {
      const r = await api.post<{ task: TaskView }>(`/api/reviews/${rv.id}/start`, {});
      navigate(`task/${r.task.id}`);
    } catch (e: any) { toast.push(e.message || '无法开始', 'err'); }
  };
  return (
    <div className="stack">
      <Card>
        <span className="eyebrow">复习中心</span>
        <h2>主题词库复习</h2><p className="small muted">每日词汇和主题词库：答错 1 天后、答对 7 天后复习；旧版“模糊”记录为 3 天。薄弱词可以随时再练，选择“到期词”会汇总整个词库中已到期的单词。此模式不限制继续学习新词，也不影响课程积分。</p><button className="btn primary" onClick={()=>navigate('vocabulary')}>查看词库进度与待复习词 →</button>
        <h1 style={{ marginTop: 2 }}>到期与抽查</h1>
        <p className="small muted">
          完成日 D 之后的第 3 个当地日历日到期（不是固定 72 小时）。到期未完成时，必须先补做才能开始新的词组。
          两项复习都完成后，词组转入长期单词本，并在 A+14 / A+30 / A+60 天抽查。
        </p>
      </Card>
      <Card>
        <h2>到期未完成 {data.overdue.length > 0 && <Tag kind="danger">{data.overdue.length}</Tag>}</h2>
        {data.overdue.length === 0 ? (
          <Empty title="没有到期任务" hint="按时复习是这套系统里唯一会阻止你继续学新词的门禁。" />
        ) : (
          <ul className="list">
            {data.overdue.map((rv) => (
              <li key={rv.id}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{rv.groupTitle}</div>
                  <div className="tiny muted">{kindLabel(rv.kind)} · 到期 {fmtDate(rv.dueAt, true)}</div>
                </div>
                <button className="btn primary sm" onClick={() => start(rv)}>开始</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2>未来到期</h2>
        {data.upcoming.length === 0 ? <p className="muted small">暂无未来任务。</p> : (
          <ul className="list">
            {data.upcoming.slice(0, 20).map((rv) => (
              <li key={rv.id}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{rv.groupTitle}</div>
                  <div className="tiny muted">{kindLabel(rv.kind)} · 到期 {fmtDate(rv.dueAt, true)}</div>
                </div>
                <Tag>未到期</Tag>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h3>调度说明</h3>
        <div className="kv"><dt>小组时区</dt><dd>{data.schedule.timeZone || '—'}</dd></div>
        <div className="kv"><dt>三日复习偏移</dt><dd>D+{data.schedule.day3OffsetDays} 个日历日</dd></div>
        <div className="kv"><dt>长期抽查</dt><dd>A+{(data.schedule.longTermOffsets || []).join(' / A+')}</dd></div>
        <div className="kv"><dt>归档条件</dt><dd>{(data.schedule.archiveAfter || []).join(' + ')}</dd></div>
      </Card>
    </div>
  );
}
function kindLabel(k: string) {
  return k === 'day3' ? '三日复习' : k === 'long_term' ? '长期抽查' : k === 'weekly_group' ? '周复习' : k;
}

/* ============================ 周考 / 关卡 ============================ */
function ExamScreen() {
  const toast = useToast();
  const { data, loading, reload } = useAsync<any>(() => api.get('/api/exam/state'), []);
  const { data: gate, reload: reloadGate } = useAsync<any>(() => api.get('/api/gate/state').catch(() => null), []);
  const [attempt, setAttempt] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const start = async (kind: 'first' | 'makeup') => {
    setBusy(true);
    try {
      const r = await api.post<any>('/api/exam/start', { kind });
      if (r.notApplicable) { toast.push('本周没有可考词条，不计罚分', 'info'); reload(); return; }
      setAttempt(r);
      setAnswers({});
      setResult(null);
    } catch (e: any) { toast.push(e.message || '无法开始', 'err'); } finally { setBusy(false); }
  };
  const submit = async () => {
    if (!attempt) return;
    setBusy(true);
    try {
      const r = await api.post<any>('/api/exam/submit', { kind: attempt.attempt?.kind || 'first', answers });
      setResult(r);
      setAttempt(null);
      reload();
    } catch (e: any) { toast.push(e.message || '交卷失败', 'err'); } finally { setBusy(false); }
  };

  if (loading || !data) return <div className="stack"><Skeleton h={140} /><Skeleton h={140} /></div>;

  return (
    <div className="stack">
      <Card>
        <span className="eyebrow">第 {data.weekKey} 周</span>
        <h1 style={{ marginTop: 2 }}>周考</h1>
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`status-dot ${data.state === 'passed' ? 'ok' : ['failed', 'missed'].includes(data.state) ? 'danger' : 'warn'}`} />
          <span className="small">{data.state}</span>
          <div className="spacer" />
          <span className="tiny muted">及格线 {data.passPercent} 分</span>
        </div>
        <ul className="list small" style={{ marginTop: 8 }}>
          {data.rules.map((r: string, i: number) => <li key={i}><Icon.Info size={15} /><span>{r}</span></li>)}
        </ul>
        <div className="kv"><dt>当前可考词条</dt><dd className="num">{data.eligibleWords}</dd></div>
        <div className="kv"><dt>开放 / 截止</dt><dd>{fmtDate(data.window.openAt, true)} → {fmtDate(data.window.deadlineAt, true)}</dd></div>
        {data.firstScore !== null && <div className="kv"><dt>首考原始分</dt><dd className="num">{data.firstScore?.toFixed(1)}</dd></div>}
        {data.bestMakeup !== null && <div className="kv"><dt>补考最好分</dt><dd className="num">{data.bestMakeup?.toFixed(1)}</dd></div>}
        {data.penaltyApplied && <div className="kv"><dt>本周扣分</dt><dd className="num">-10{data.penaltyRefunded ? '（已返还）' : ''}</dd></div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => start('first')} disabled={busy || data.state !== 'open'}>开始首考</button>
          <button className="btn" onClick={() => start('makeup')} disabled={busy || data.state !== 'failed'}>参加补考</button>
        </div>
      </Card>

      {attempt && (
        <Card>
          <div className="row">
            <h2>{attempt.attempt?.kind === 'makeup' ? '补考' : '首考'}</h2>
            <div className="spacer" />
            <Tag>{Object.keys(answers).length}/{attempt.questions.length}</Tag>
          </div>
          <p className="tiny muted">交卷后才显示答案与错词。题序与语境在补考中会更换，但覆盖面不变。</p>
          <ol className="list" style={{ marginTop: 8 }}>
            {attempt.questions.map((q: any) => (
              <li key={q.index} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="small"><strong>{q.index + 1}.</strong> {q.prompt}{q.hintZh ? <span className="muted">（{q.hintZh}）</span> : null}</div>
                <input className="input" value={answers[q.index] || ''} autoComplete="off" spellCheck={false}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.index]: e.target.value }))} placeholder="输入答案" />
              </li>
            ))}
          </ol>
          <button className="btn primary wide" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>交卷</button>
        </Card>
      )}

      {result && (
        <Card>
          <h2>交卷结果</h2>
          <div className="kv"><dt>得分</dt><dd className="num">{result.score.toFixed(1)} / 100</dd></div>
          <div className="kv"><dt>正确</dt><dd className="num">{result.correct}/{result.total}</dd></div>
          <div className="kv"><dt>结论</dt><dd>{result.passed ? '通过' : '未通过'}</dd></div>
          {result.penaltyApplied && <div className="kv"><dt>扣分</dt><dd>-10</dd></div>}
          {result.penaltyRefunded && <div className="kv"><dt>返还</dt><dd>+10（只返还一次）</dd></div>}
          <div className="divider" />
          <h3>错词与答案</h3>
          <ul className="list small">
            {result.detail.filter((d: any) => !d.correct).slice(0, 40).map((d: any) => (
              <li key={d.wordId}><Icon.X size={15} /><div>你写的是「{d.submitted || '（空）'}」，正确答案是 <strong className="serif">{d.answer}</strong></div></li>
            ))}
            {result.detail.every((d: any) => d.correct) && <li><Icon.Check size={15} /><span>全部正确。</span></li>}
          </ul>
          <p className="tiny muted">错题补齐不是新的周考成绩；首考分仍保留。周复习需要该组 20 词在考后纠错中全部补齐，才会给该组 +10。</p>
        </Card>
      )}

      {gate && <GatePanel state={gate} onChanged={() => { reloadGate(); reload(); }} />}
    </div>
  );
}

/* ============================ 单词本 ============================ */
function WordbookScreen() {
  const { data, loading } = useAsync<any>(() => api.get('/api/wordbook'), []);
  const [filter, setFilter] = useState<'all' | 'wrong' | 'archived'>('all');
  if (loading || !data) return <div className="stack"><Skeleton h={120} /><Skeleton h={200} /></div>;
  const words = data.words.filter((w: any) => filter === 'all' ? true : filter === 'wrong' ? w.validWrongCount > 0 : w.archived);
  return (
    <div className="stack">
      <Card>
        <span className="eyebrow">单词本</span>
        <h1 style={{ marginTop: 2 }}>全部词 {data.total} 个</h1>
        <p className="small muted">
          单词从学习开始就能在这里查到。归档表示两类复习都已完成、转入长期抽查阶段，不是前期把错词藏起来。
          错误次数只增不删；近期连续正确会降低复习优先级，但不会把历史次数改写成 0。
        </p>
        <div className="pill-tabs" style={{ marginTop: 10 }}>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部</button>
          <button aria-pressed={filter === 'wrong'} onClick={() => setFilter('wrong')}>有错误</button>
          <button aria-pressed={filter === 'archived'} onClick={() => setFilter('archived')}>已归档</button>
        </div>
      </Card>
      {words.length === 0 ? (
        <Empty title="这里还没有词" hint="开始第一组 20 词之后，它们会出现在这里。" />
      ) : (
        <Card className="flush">
          <ul className="list" style={{ padding: '0 16px' }}>
            {words.map((w: any) => (
              <li key={w.wordId}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="serif" style={{ fontWeight: 700, fontSize: 16 }}>{w.lemma}</span>
                    <span className="tiny muted">{posZh(w.partOfSpeech)}</span>
                    {w.demonstrated && <Tag kind="ok">已掌握</Tag>}
                    {w.archived && <Tag>已归档</Tag>}
                  </div>
                  <div className="small muted">{w.coreMeaningZh}</div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>{w.groupId} · L{w.level} · {w.topic}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`tag ${w.validWrongCount >= 4 ? 'danger' : w.validWrongCount > 0 ? 'warn' : ''}`}>{w.importance}</div>
                  <div className="tiny muted num" style={{ marginTop: 4 }}>错 {w.validWrongCount} 次</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <h3>重要等级口径</h3>
        <div className="row wrap tiny" style={{ gap: 6 }}>
          {data.legend.map((l: string, i: number) => <Tag key={l} kind={i >= 3 ? 'danger' : i === 2 ? 'warn' : undefined}>{i === 0 ? '0 次' : i === 1 ? '1 次' : i === 2 ? '2–3 次' : i === 3 ? '4–6 次' : '≥7 次'} · {l}</Tag>)}
        </div>
      </Card>
    </div>
  );
}

/* ============================ 好友 ============================ */
function FriendsScreen({ me }: { me: Me }) {
  const toast = useToast();
  const [scope, setScope] = useState<'week' | 'total'>('week');
  const { data, loading, reload } = useAsync<any>(() => api.get(`/api/leaderboard?scope=${scope}`), [scope]);
  const { data: invites, reload: reloadInvites } = useAsync<any>(() => api.get('/api/invites').catch(() => ({ invites: [] })), []);
  const [created, setCreated] = useState<string | null>(null);
  if (loading || !data) return <div className="stack"><Skeleton h={140} /><Skeleton h={160} /></div>;

  const createInvite = async () => {
    try {
      const r = await api.post<any>('/api/invites', { ttlDays: 7, maxUses: 1 });
      setCreated(`${window.location.origin}/#/join?token=${r.invite.token}`);
      reloadInvites();
    } catch (e: any) { toast.push(e.message || '创建失败', 'err'); }
  };

  return (
    <div className="stack">
      <Card>
        <div className="row">
          <Icon.Users size={19} />
          <h2>小组榜</h2>
          <div className="spacer" />
          <div className="pill-tabs">
            <button aria-pressed={scope === 'week'} onClick={() => setScope('week')}>周榜</button>
            <button aria-pressed={scope === 'total'} onClick={() => setScope('total')}>累计</button>
          </div>
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          {data.weekKey} · 时区 {data.timeZone} · 同分并列名次，学习时长作为独立指标显示。列表只包含真实加入的成员，不会伪造好友。
        </p>
        {data.rows.length === 0 ? (
          <Empty title="还没有成员" hint="生成邀请链接，把朋友加进来。" action={<button className="btn primary" onClick={createInvite}>生成邀请链接</button>} />
        ) : (
          <ul className="list" style={{ marginTop: 8 }}>
            {data.rows.map((r: any) => (
              <li key={r.userId}>
                <span className="num" style={{ width: 22, textAlign: 'center', color: 'var(--muted)' }}>{r.rank}</span>
                <Avatar seed={r.avatarSeed} name={r.displayName} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong>{r.displayName}</strong>
                    {r.userId === me.user.id && <Tag kind="accent">我</Tag>}
                    <Tag>L{r.level}</Tag>
                  </div>
                  <div className="tiny muted">时长 {fmtDuration(r.seconds || 0)}</div>
                </div>
                <div className="num" style={{ fontWeight: 700 }}>{r.points}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="row">
          <h3>邀请</h3>
          <div className="spacer" />
          <button className="btn sm" onClick={createInvite}>生成新邀请</button>
        </div>
        <p className="tiny muted">默认 7 天有效、单次使用，并且可以随时撤销。最多 10 个学习账号。</p>
        {created && (
          <div className="stack" style={{ marginTop: 10 }}>
            <Banner kind="ok">邀请链接已生成（只显示这一次的令牌）：</Banner>
            <input className="input mono" readOnly value={created} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(created); toast.push('已复制', 'ok'); }}>复制链接</button>
          </div>
        )}
        <ul className="list" style={{ marginTop: 10 }}>
          {(invites?.invites || []).map((i: any) => (
            <li key={i.id}>
              <div style={{ flex: 1 }}>
                <div className="small">{i.status === 'active' ? '可用' : i.status === 'expired' ? '已过期' : i.status === 'used' ? '已使用' : '已撤销'}</div>
                <div className="tiny muted">创建者 {i.creator} · 到期 {fmtDate(i.expiresAt, true)} · 使用 {i.uses}/{i.maxUses}</div>
              </div>
              {i.status === 'active' && <button className="btn danger sm" onClick={async () => { await api.post(`/api/invites/${i.id}/revoke`, {}); reloadInvites(); }}>撤销</button>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ============================ 设置与诊断 ============================ */
function SettingsScreen({ me, reloadMe }: { me: Me; reloadMe: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(me.user.displayName);
  const [tz, setTz] = useState(me.user.timezone);
  const [shareVoice, setShareVoice] = useState(false);
  const { data: caps } = useAsync<any>(() => api.get('/api/voice/capabilities').catch(() => null), []);
  const { data: health } = useAsync<any>(() => api.get('/api/health'), []);

  const save = async () => {
    try {
      await api.patch('/api/me', { displayName: name, timezone: tz, shareVoice });
      toast.push('已保存', 'ok');
      reloadMe();
    } catch (e: any) { toast.push(e.message || '保存失败', 'err'); }
  };
  const exportData = async () => {
    const r = await api.get<any>('/api/me/export');
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lingo-scholar-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="stack">
      <div className="row">
        <button className="btn ghost sm" onClick={() => navigate('home')}>← 首页</button>
        <h2 style={{ marginLeft: 6 }}>设置与诊断</h2>
      </div>
      <Card>
        <h3>个人资料</h3>
        <div className="field"><label htmlFor="s-name">昵称</label><input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="s-tz">小组时区（决定周考边界与复习到期）</label>
          <select id="s-tz" className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
            {['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'Australia/Sydney', 'UTC'].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <span className="tiny muted">修改时区不会追溯改变历史周考的截止时间。</span>
        </div>
        <label className="row" style={{ marginTop: 10, gap: 8 }}>
          <input type="checkbox" checked={shareVoice} onChange={(e) => setShareVoice(e.target.checked)} />
          <span className="small">允许把口语训练回放保存在我的账号（默认关闭，录音默认临时处理并清理）</span>
        </label>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={save}>保存</button>
      </Card>

      <Card>
        <h3>语音能力（实测状态）</h3>
        {caps ? (
          <>
            <div className="kv"><dt>运行模式</dt><dd>{caps.modeLabel}</dd></div>
            <div className="kv"><dt>是否付费</dt><dd>{caps.paid ? '是' : '否（本地离线）'}</dd></div>
            <div className="kv"><dt>识别引擎</dt><dd>{caps.asr?.available ? caps.asr.modelName : '不可用'}</dd></div>
            <div className="kv"><dt>合成引擎</dt><dd>{caps.tts?.available ? caps.tts.voice : '不可用'}</dd></div>
            <ul className="list tiny" style={{ marginTop: 8 }}>
              {(caps.limitations || []).map((l: string, i: number) => <li key={i}><Icon.Info size={14} /><span>{l}</span></li>)}
            </ul>
          </>
        ) : <Skeleton h={80} />}
      </Card>

      <Card>
        <h3>学习时长口径</h3>
        <div className="kv"><dt>累计</dt><dd>{fmtDuration(me.study.totalSeconds)}</dd></div>
        <div className="kv"><dt>今日</dt><dd>{fmtDuration(me.study.todaySeconds)}</dd></div>
        <p className="tiny muted" style={{ marginTop: 8 }}>{me.study.method}</p>
      </Card>

      <Card>
        <h3>数据与内容</h3>
        <div className="kv"><dt>服务端时间</dt><dd>{health?.time ? fmtDate(health.time, true) : '—'}</dd></div>
        <div className="kv"><dt>已发布词组</dt><dd className="num">{health?.counts?.groups ?? '—'}</dd></div>
        <div className="kv"><dt>词项</dt><dd className="num">{health?.counts?.words ?? '—'}</dd></div>
        <div className="kv"><dt>规则 / 课程版本</dt><dd>{health?.rulesVersion} / {health?.contentVersion}</dd></div>
        <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn" onClick={exportData}>导出我的数据</button>
          <button className="btn" onClick={async () => { const r = await api.get<any>('/api/articles/a-g001'); toast.push(r.locked ? '首听未解锁：正文与译文不会提前返回' : '已解锁', 'info'); }}>检查首听门禁</button>
          <button className="btn danger" onClick={async () => { await api.post('/api/auth/logout', {}); setCsrf(null); window.location.reload(); }}>退出登录</button>
        </div>
      </Card>

      <Card>
        <h3>材料来源与隐私</h3>
        <p className="small muted">
          本站课程文章的英文与中文均由本项目编辑部撰写，授权状态标记为 original_work；音频是本机 Windows SAPI 合成语音，界面上明确标注为“合成语音”，不是真人录音。
          小组内共享的是任务完成、积分与学习时长；原始录音、详细转录与错题内容默认只有你本人可见。积分只是行为奖励，不是能力证明，也不是雅思分数。
        </p>
      </Card>
    </div>
  );
}
