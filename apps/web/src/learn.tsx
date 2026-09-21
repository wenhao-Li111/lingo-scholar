import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ArticleView, type TaskView, type WordDetail } from './api';
import { Bar, Banner, Card, Empty, Icon, Skeleton, Tag, fmtTime, posZh, useAsync, useToast } from './ui';

/* ============================ 词汇预习 ============================ */
function WordPreview({ words, onStart, starting }: { words: WordDetail[]; onStart: () => void; starting: boolean }) {
  const [compact, setCompact] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="stack">
      <Card>
        <div className="row">
          <div className="stack" style={{ gap: 2 }}>
            <span className="eyebrow">第 1 步 · 词汇预习</span>
            <h2>本组 20 词</h2>
          </div>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setCompact((v) => !v)} aria-pressed={compact}>
            {compact ? '展开全部' : '只看词表'}
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          每词包含核心词义、词性、常见搭配与易混淆对比。标“熟悉”只会压缩展示，不能跳过组内考核或提前晋级。
        </p>
      </Card>

      <div className="word-grid">
        {words.map((w) => (
          <div key={w.id} className="word-card">
            <div className="row" style={{ gap: 8 }}>
              <span className="lemma serif">{w.lemma}</span>
              <span className="pos">{posZh(w.partOfSpeech)}</span>
              <div className="spacer" />
              <button
                className="btn ghost sm"
                aria-expanded={expanded === w.id}
                onClick={() => setExpanded(expanded === w.id ? null : w.id)}
                title="查看搭配与易混词"
              >
                {expanded === w.id ? '收起' : '细节'}
              </button>
            </div>
            <div className="meaning">{w.coreMeaningZh}</div>
            {!compact && (
              <>
                {w.collocations?.length > 0 && (
                  <div className="collocation">搭配：{w.collocations.join(' · ')}</div>
                )}
                {(expanded === w.id || w.confusionPairs?.length > 0) && w.confusionPairs?.map((c) => (
                  <div key={c.word} className="confusion">易混：{c.word} —— {c.note}</div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>

      <Card>
        <Banner kind="warn">
          预习不代表首听时可以看原文。听力训练页只显示主题、任务提示、音频与进度，全文与译文会在完整听后开放。
        </Banner>
        <button className="btn primary wide" style={{ marginTop: 12 }} onClick={onStart} disabled={starting}>
          {starting ? '准备中…' : '开始本组默写（20 题）'}
        </button>
      </Card>
    </div>
  );
}

/* ============================ 默写答题 ============================ */
export function TaskScreen({ taskId, onDone, onExit }: { taskId: string; onDone: () => void; onExit: () => void }) {
  const toast = useToast();
  const [task, setTask] = useState<TaskView | null>(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<null | { correct: boolean; correctAnswer?: string | null; word?: WordDetail | null; reason: string }>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<null | { firstPass: number; firstPassTotal: number; mastery: number }>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const r = await api.get<{ task: TaskView }>(`/api/tasks/${taskId}`);
    setTask(r.task);
    if (r.task.status === 'completed') {
      setFinished({ firstPass: r.task.firstPassCorrect ?? 0, firstPassTotal: r.task.firstPassTotal, mastery: r.task.correctedMastery });
    }
  }, [taskId]);

  useEffect(() => { load().catch((e) => toast.push(e.message || '加载失败', 'err')); }, [load, toast]);

  useEffect(() => {
    if (task && task.status !== 'completed' && !feedback) inputRef.current?.focus();
  }, [task?.currentQuestion?.index, task?.status, feedback]);

  const submit = async () => {
    if (!task?.currentQuestion || busy) return;
    const value = answer;
    setBusy(true);
    reqIdRef.current += 1;
    try {
      const r = await api.post<any>(`/api/tasks/${task.id}/answer`, { answer: value, clientRequestId: `${task.id}-${reqIdRef.current}-${task.currentQuestion.wordId}` });
      setAnswer('');
      if (r.task.status === 'completed') {
        setFinished({ firstPass: r.task.firstPassCorrect ?? 0, firstPassTotal: r.task.firstPassTotal, mastery: r.task.correctedMastery });
      }
      setFeedback({ correct: r.correct, correctAnswer: r.correctAnswer, word: r.word, reason: r.reason });
      setTask(r.task);
    } catch (e: any) {
      toast.push(e.message || '提交失败，请重试', 'err');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setFeedback(null);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  if (!task) {
    return <div className="quiz-shell stack"><Skeleton h={120} /><Skeleton h={46} /></div>;
  }

  if (finished && !feedback) {
    const pct = Math.round((finished.firstPass / finished.firstPassTotal) * 100);
    const gained = finished.firstPassTotal > 0;
    return (
      <div className="quiz-shell stack">
        <Card>
          <span className="eyebrow">本组完成</span>
          <h1 style={{ marginTop: 4 }}>{task.groupTitle || task.groupId}</h1>
          <div className="divider" />
          <div className="kv"><dt>首次测验</dt><dd><strong>{finished.firstPass}/{finished.firstPassTotal}</strong>（{pct}%）</dd></div>
          <div className="kv"><dt>本组补齐</dt><dd>{finished.mastery}%</dd></div>
          <div className="kv"><dt>学习积分</dt><dd>{gained ? '+10（仅首次完成发放一次）' : '—'}</dd></div>
          <div style={{ marginTop: 12 }}>
            <Bar value={finished.mastery} />
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>
            首次测验成绩会被永久保留，不会被 100% 覆盖——它是你真实的第一遍表现。
            {finished.firstPass < finished.firstPassTotal && ` 本次首测有 ${finished.firstPassTotal - finished.firstPass} 个词需要补测，已全部补齐。`}
          </div>
        </Card>
        <Card>
          <h3>接下来</h3>
          <ul className="list small">
            <li><Icon.Clock size={17} /><div>第 3 天会出现这 20 词的复习任务，需补到 100% 才结算。</div></li>
            <li><Icon.Headphones size={17} /><div>建议现在去听本组配套音频：首听不给原文，听满覆盖率后才解锁对照阅读。</div></li>
            <li><Icon.Spark size={17} /><div>周日会把这周的新词与高频错词合成周考。</div></li>
          </ul>
          <button className="btn primary wide" style={{ marginTop: 12 }} onClick={onDone}>回到首页</button>
        </Card>
      </div>
    );
  }

  const q = task.currentQuestion;
  const isRemediation = task.status === 'remediation';
  const answered = task.progress.answered;

  return (
    <div className="quiz-shell stack">
      <div className="row">
        <button className="btn ghost sm" onClick={onExit}>← 返回</button>
        <div className="spacer" />
        {isRemediation ? (
          <Tag kind="warn">补测中 · 剩余 {task.progress.demonstratedTotal - task.progress.demonstrated} 词</Tag>
        ) : (
          <Tag>首测 {Math.min(answered + 1, task.progress.total)}/{task.progress.total}</Tag>
        )}
      </div>

      {isRemediation && (
        <Banner kind="warn">
          现在只补错词。每个词必须在你没有看到答案的情况下再次答对；刚看过答案的题目会先隔开两个其它条目再出现。
        </Banner>
      )}

      <div className="question-card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="tag accent">{q?.type === 'cloze' ? '句子缺词' : '中文释义 → 英文'}</span>
          <div className="spacer" />
          {q?.wordImportance && <Tag>{q.wordImportance}</Tag>}
        </div>
        <p className="question-prompt" style={{ marginTop: 12 }}>{q?.prompt}</p>
        {q?.hintZh && <p className="question-hint">{q.hintZh}</p>}

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="answer">拼写本组目标英文</label>
          <input
            id="answer"
            ref={inputRef}
            className="input answer-input"
            value={answer}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="done"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); feedback ? next() : submit(); } }}
            placeholder="输入英文后按回车"
            aria-describedby="answer-help"
          />
          <div id="answer-help" className="tiny muted">不接受同义词替换；词条显式声明的英/美拼写变体可以。</div>
        </div>

        {feedback && (
          <div className={`answer-feedback ${feedback.correct ? 'ok' : 'bad'}`} style={{ marginTop: 14 }}>
            <span className="mark">{feedback.correct ? '✓' : '✕'}</span>
            <div>
              <div style={{ fontWeight: 600 }}>{feedback.correct ? '正确' : (feedback.reason === 'wrong-form' ? '词形不对' : '不正确')}</div>
              {!feedback.correct && (
                <>
                  <div style={{ marginTop: 3 }}>正确答案：<strong className="serif" style={{ fontSize: 17 }}>{feedback.correctAnswer}</strong></div>
                  {feedback.word && <div style={{ marginTop: 3 }}>{feedback.word.coreMeaningZh} · {posZh(feedback.word.partOfSpeech)}</div>}
                </>
              )}
              {feedback.reason === 'network_error' && <div className="tiny">网络类错误不计为学习错词。</div>}
              {feedback.word?.cloze?.en && <div className="practice-context"><span>把单词放回句子里</span><p className="serif">{feedback.word.cloze.en.replace(/_{2,}/g, feedback.word.cloze.answer || feedback.word.lemma)}</p><small>{feedback.word.cloze.hintZh}</small></div>}
            </div>
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          {feedback ? (
            <button className="btn primary wide" onClick={next}>继续</button>
          ) : (
            <button className="btn primary wide" onClick={submit} disabled={busy || !answer.trim()}>
              {busy ? '判定中…' : '提交'}
            </button>
          )}
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="row small muted">
          <span>本组补齐进度</span>
          <div className="spacer" />
          <span className="num">{task.progress.demonstrated}/{task.progress.demonstratedTotal} 词</span>
        </div>
        <Bar value={task.progress.demonstrated} max={task.progress.demonstratedTotal} gold />
      </div>
    </div>
  );
}

/* ============================ 播放器 ============================ */
type PlaybackProps = {
  src: string;
  rates: number[];
  title: string;
  onEvent: (e: { mediaStart: number; mediaEnd: number; rate: number; wallStartMs: number; wallEndMs: number; ended?: boolean }) => void;
  onParagraph?: (index: number) => void;
  paragraphCount?: number;
  initialRate?: number;
  initialPosition?: number;
  articleId: string;
};

export function Player({ src, rates, title, onEvent, onParagraph, paragraphCount = 0, initialRate = 1, initialPosition = 0, articleId }: PlaybackProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segRef = useRef<{ mediaStart: number; wallStart: number; rate: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(initialRate);
  const [time, setTime] = useState(initialPosition);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'stalled'>('loading');
  const [expanded, setExpanded] = useState(false);

  const flush = useCallback((ended = false) => {
    const a = audioRef.current;
    const seg = segRef.current;
    if (!a || !seg) return;
    const mediaEnd = a.currentTime;
    if (mediaEnd > seg.mediaStart + 0.2) {
      onEvent({ mediaStart: seg.mediaStart, mediaEnd, rate: seg.rate, wallStartMs: seg.wallStart, wallEndMs: Date.now(), ended });
    }
    segRef.current = null;
  }, [onEvent]);

  const startSeg = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    segRef.current = { mediaStart: a.currentTime, wallStart: Date.now(), rate: a.playbackRate };
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => {
      setDuration(a.duration || 0);
      setStatus('ready');
      if (initialPosition > 0 && initialPosition < (a.duration || 0) - 2) a.currentTime = initialPosition;
    };
    const onTime = () => setTime(a.currentTime);
    const onPlay = () => { setPlaying(true); startSeg(); };
    const onPause = () => { setPlaying(false); flush(false); };
    const onEnded = () => { setPlaying(false); flush(true); savePosition(); };
    const onErr = () => setStatus('error');
    const onStall = () => setStatus('stalled');
    const onPlaying = () => setStatus('ready');
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onErr);
    a.addEventListener('stalled', onStall);
    a.addEventListener('waiting', onStall);
    a.addEventListener('playing', onPlaying);
    return () => {
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onErr);
      a.removeEventListener('stalled', onStall);
      a.removeEventListener('waiting', onStall);
      a.removeEventListener('playing', onPlaying);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // 后台/锁屏时页面脚本可能被挂起：播放期间每 20 秒上报一次已播放区间
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const a = audioRef.current;
      if (!a || !segRef.current) return;
      const mediaEnd = a.currentTime;
      const seg = segRef.current;
      if (mediaEnd > seg.mediaStart + 1) {
        onEvent({ mediaStart: seg.mediaStart, mediaEnd, rate: seg.rate, wallStartMs: seg.wallStart, wallEndMs: Date.now(), ended: false });
        segRef.current = { mediaStart: mediaEnd, wallStart: Date.now(), rate: a.playbackRate };
      }
    }, 20000);
    return () => clearInterval(t);
  }, [playing, onEvent]);

  const savePosition = useCallback(() => {
    const a = audioRef.current;
    if (!a || !articleId) return;
    api.post(`/api/articles/${articleId}/position`, { position: a.currentTime, rate: a.playbackRate }).catch(() => {});
  }, [articleId]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'hidden') { flush(false); savePosition(); } };
    window.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('visibilitychange', onVis); flush(false); savePosition(); };
  }, [flush, savePosition]);

  // Media Session：锁屏元数据与操作
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !('mediaSession' in navigator)) return;
    try {
      (navigator as any).mediaSession.metadata = new (window as any).MediaMetadata({ title, artist: 'Lingo Scholar · 听词研习室', album: 'IELTS 听力训练' });
      (navigator as any).mediaSession.setActionHandler('play', () => a.play());
      (navigator as any).mediaSession.setActionHandler('pause', () => a.pause());
      (navigator as any).mediaSession.setActionHandler('seekbackward', () => { a.currentTime = Math.max(0, a.currentTime - 10); });
      (navigator as any).mediaSession.setActionHandler('seekforward', () => { a.currentTime = Math.min(a.duration || 0, a.currentTime + 10); });
    } catch { /* 部分设备不支持，忽略 */ }
    return () => {
      if ('mediaSession' in navigator) {
        try {
          (navigator as any).mediaSession.setActionHandler('play', null);
          (navigator as any).mediaSession.setActionHandler('pause', null);
        } catch { /* ignore */ }
      }
    };
  }, [title]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { try { await a.play(); } catch { setStatus('error'); } } else { a.pause(); }
  };

  const seekBy = (delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    flush(false);
    a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + delta));
    if (!a.paused) startSeg();
  };

  const changeRate = (r: number) => {
    const a = audioRef.current;
    if (!a) return;
    flush(false);
    a.playbackRate = r;
    setRate(r);
    if (!a.paused) startSeg();
  };

  const jumpParagraph = (dir: number) => {
    const a = audioRef.current;
    if (!a || !duration || paragraphCount < 2) return;
    flush(false);
    const step = duration / paragraphCount;
    const idx = Math.max(0, Math.min(paragraphCount - 1, Math.floor(a.currentTime / step) + dir));
    a.currentTime = idx * step + 0.05;
    onParagraph?.(idx);
    if (!a.paused) startSeg();
  };

  const segLabel = paragraphCount > 0 ? `段落级定位（共 ${paragraphCount} 段，无逐句时间戳）` : '';

  return (
    <div className="player" role="region" aria-label="音频播放器">
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />
      <div className="player-inner">
        <div className="player-row">
          <div className="player-track">
            <div className="player-title" title={title}>
              {status === 'loading' && '正在加载音频…'}
              {status === 'stalled' && '缓冲中…'}
              {status === 'error' && '音频加载失败 —— 请检查网络后重试'}
              {status === 'ready' && title}
            </div>
          </div>
          <span className="time">{fmtTime(time)} / {fmtTime(duration)}</span>
          <button className="icon-btn" onClick={() => jumpParagraph(-1)} aria-label="上一段" title="上一段" disabled={paragraphCount < 2}>
            <Icon.SkipBack size={18} />
          </button>
          <button className="icon-btn play" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
            {playing ? <Icon.Pause size={20} /> : <Icon.Play size={20} />}
          </button>
          <button className="icon-btn" onClick={() => jumpParagraph(1)} aria-label="下一段" title="下一段" disabled={paragraphCount < 2}>
            <Icon.SkipFwd size={18} />
          </button>
        </div>
        <input
          className="seek"
          type="range" min={0} max={duration || 0} step={0.1} value={time}
          onChange={(e) => { const a = audioRef.current; if (!a) return; flush(false); a.currentTime = Number(e.target.value); setTime(Number(e.target.value)); if (!a.paused) startSeg(); }}
          aria-label="播放进度"
        />
        <div className="player-row">
          <div className="speed-group" role="group" aria-label="播放速度">
            {rates.map((r) => (
              <button key={r} className="speed-btn" aria-pressed={rate === r} onClick={() => changeRate(r)}>{r}×</button>
            ))}
          </div>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? '收起' : '说明'}
          </button>
        </div>
        {expanded && (
          <div className="tiny muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            {segLabel}。学习时长按真实经过的墙钟时间计算；倍速不会放大时长。锁屏后台播放可以计时；暂停、缓冲与闲置不计。
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================ 听读工作台 ============================ */
export function ReaderScreen({ articleId, onBack }: { articleId: string; onBack: () => void }) {
  const toast = useToast();
  const { data, loading, reload } = useAsync<ArticleView>(() => api.get<ArticleView>(`/api/articles/${articleId}`), [articleId]);
  const [coverage, setCoverage] = useState<number | null>(null);
  const [glossary, setGlossary] = useState<WordDetail[] | null>(null);
  const [drawerWord, setDrawerWord] = useState<WordDetail | null>(null);
  const [showZh, setShowZh] = useState(false);
  const [activeParagraph, setActiveParagraph] = useState<number | null>(null);
  const [playingParagraph, setPlayingParagraph] = useState<number | null>(null);

  const rates = data?.policy?.rates ?? [0.75, 1, 1.25, 1.5, 2];

  const handleEvent = useCallback(async (e: any) => {
    try {
      const r = await api.post<any>('/api/playback/event', { mediaId: data?.media?.id, event: { ...e, clientEventId: `${data?.media?.id}-${e.wallStartMs}-${Math.round(e.mediaStart * 10)}` } });
      if (typeof r.coverage === 'number') setCoverage(r.coverage);
      if (r.unlocked && !r.alreadyUnlocked) {
        toast.push('已解锁对照阅读与词汇释义', 'ok');
        reload();
      }
    } catch { /* 网络抖动不阻塞播放 */ }
  }, [data?.media?.id, reload, toast]);

  useEffect(() => {
    if (data && !data.locked) {
      api.get<{ words: WordDetail[] }>(`/api/articles/${articleId}/glossary`).then((r) => setGlossary(r.words)).catch(() => {});
    }
  }, [data?.locked, articleId]);

  const highlighted = useMemo(() => {
    if (!data?.paragraphs || !glossary) return null;
    const map = new Map<string, string[]>();
    for (const w of glossary) {
      const forms = [w.lemma, ...(w.collocations || [])].filter((x) => /^[A-Za-z][A-Za-z'\- ]*$/.test(x));
      map.set(w.id, forms);
    }
    return map;
  }, [data?.paragraphs, glossary]);

  if (loading || !data) return <div className="stack"><Skeleton h={140} /><Skeleton h={220} /><Skeleton h={60} /></div>;

  const totalSeconds = data.media?.durationSeconds ?? 0;
  const coveragePct = coverage ?? 0;
  const unlockTarget = (data.policy?.coverageUnlockRatio ?? 0.98) * 100;

  return (
    <div className="stack" style={{ paddingBottom: 150 }}>
      <div className="row">
        <button className="btn ghost sm" onClick={onBack}>← 返回</button>
        <div className="spacer" />
        <Tag>{data.type === 'dialogue' ? '对话' : '文章'} · L{data.level}</Tag>
        {data.media?.human ? <Tag kind="accent">真人原声</Tag> : <Tag kind="warn">合成语音</Tag>}
      </div>

      <Card className="card">
        <span className="eyebrow">{data.role === 'main' ? '主材料' : '补充材料'}</span>
        <h1 className="serif" style={{ marginTop: 4, fontSize: 24 }}>{data.title}</h1>
        <div className="row wrap small muted" style={{ marginTop: 8, gap: 12 }}>
          <span>{data.wordCount} 英文词</span>
          <span>{fmtTime(totalSeconds)}</span>
          {data.media?.voice && <span>{data.media.voice}</span>}
          <span>{data.media?.provider || '–'}</span>
        </div>
        <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
          <Tag>原文：{data.textOrigin === 'original' ? '本项目原创' : data.textOrigin}</Tag>
          <Tag>译文：{data.translationOrigin === 'editorial_original' ? '编辑部自行翻译' : data.translationOrigin}</Tag>
          <Tag kind={data.rightsStatus === 'original_work' ? 'ok' : 'warn'}>授权：{data.rightsStatus}</Tag>
        </div>
      </Card>

      {data.locked ? (
        <>
          <Card>
            <div className="row">
              <Icon.Headphones size={22} />
              <div className="spacer" />
              <span className="coverage-pill">
                播放覆盖 <strong className="num">{Math.round(coveragePct * 100)}%</strong> / 需 {Math.round(unlockTarget)}%
              </span>
            </div>
            <div style={{ marginTop: 10 }}>
              <Bar value={coveragePct * 100} />
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              首听模式：正文、中文译文、字幕与词汇释义都被隐藏。只有在真实连续播放的区间并集覆盖率达标，并且音频自然播放到结尾之后，才会解锁对照阅读。
              拖到结尾触发的结束事件不会解锁——合法的跳过必须把漏掉的区间补听回来。
            </p>
          </Card>
          <div className="blind-panel">
            <Icon.Lock size={26} />
            <div style={{ marginTop: 6, fontWeight: 600, color: 'var(--ink)' }}>全文与译文已隐藏</div>
            <div className="small" style={{ marginTop: 4 }}>主题：{(data.topics || []).join(' · ') || '—'}</div>
            <div className="tiny" style={{ marginTop: 10 }}>
              词汇释义侧栏在解锁前同样不可用，避免提前泄露答案。
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="row wrap">
            <button className="btn sm" onClick={() => setShowZh((v) => !v)} aria-pressed={showZh}>
              {showZh ? '隐藏中文' : '显示中文对照'}
            </button>
            <button className="btn ghost sm" onClick={() => reload()}>重新载入</button>
            <div className="spacer" />
            {data.coverage && <Tag kind="ok">本组文章覆盖 {data.coverage.covered}/{data.coverage.total} 词</Tag>}
          </div>

          <div className="workbench">
            <Card className="reader">
              {(data.paragraphs || []).map((p) => (
                <div key={p.index} className={`para${playingParagraph === p.index ? ' playing' : ''}`} id={`para-${p.index}`}>
                  <div className="para-en">{p.en}</div>
                  {showZh && p.zh && <div className="para-zh">{p.zh}</div>}
                </div>
              ))}
            </Card>

            <Card>
              <div className="row">
                <h3>本组词汇</h3>
                <div className="spacer" />
                {data.firstListen.unlockedAt && <Tag kind="ok"><Icon.Unlock size={13} />已解锁</Tag>}
              </div>
              <div className="word-grid" style={{ gridTemplateColumns: '1fr', marginTop: 10 }}>
                {(glossary || []).map((w) => (
                  <button
                    key={w.id}
                    className="word-card"
                    style={{ textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => {
                      setDrawerWord(w);
                      const occ = data.occurrences?.find((o) => o.wordId === w.id);
                      if (occ) {
                        setActiveParagraph(occ.paragraph);
                        document.getElementById(`para-${occ.paragraph}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }}
                  >
                    <div className="row" style={{ gap: 8 }}>
                      <span className="lemma serif" style={{ fontSize: 17 }}>{w.lemma}</span>
                      <span className="pos">{posZh(w.partOfSpeech)}</span>
                      <div className="spacer" />
                      {data.occurrences?.some((o) => o.wordId === w.id) ? <Tag kind="ok">正文出现</Tag> : <Tag kind="warn">仅情景强化</Tag>}
                    </div>
                    <div className="meaning small">{w.coreMeaningZh}</div>
                  </button>
                ))}
                {!glossary && <Skeleton h={60} />}
              </div>
            </Card>
          </div>

          <Card>
            <h3>理解检查</h3>
            <p className="tiny muted">做完默写与听力后再看答案；题目依据均指向正文段落。</p>
            <ComprehensionList items={data.comprehension || []} />
          </Card>
        </>
      )}

      {data.media?.verifiedPlayable ? (
        <Player
          src={data.media.url}
          rates={rates}
          title={data.title}
          articleId={articleId}
          initialRate={data.progress?.rate ?? 1}
          initialPosition={data.progress?.position ?? 0}
          paragraphCount={(data.paragraphs || []).length || undefined}
          onParagraph={setPlayingParagraph}
          onEvent={handleEvent}
        />
      ) : (
        <Banner kind="danger">该文章的音频未通过可播放校验，已下线从学习路径。</Banner>
      )}

      {drawerWord && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerWord(null)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label={`${drawerWord.lemma} 的词汇说明`}>
            <div className="drawer-head">
              <div className="stack" style={{ gap: 0 }}>
                <span className="serif" style={{ fontSize: 20, fontWeight: 700 }}>{drawerWord.lemma}</span>
                <span className="tiny muted">{posZh(drawerWord.partOfSpeech)}</span>
              </div>
              <div className="spacer" />
              <button className="btn ghost sm" onClick={() => setDrawerWord(null)} aria-label="关闭"><Icon.X size={18} /></button>
            </div>
            <div className="drawer-body stack">
              <div>{drawerWord.coreMeaningZh}</div>
              {drawerWord.collocations?.length > 0 && <div className="small"><strong>常见搭配</strong><div className="muted">{drawerWord.collocations.join(' · ')}</div></div>}
              {drawerWord.confusionPairs?.map((c) => <div key={c.word} className="confusion">易混：{c.word} —— {c.note}</div>)}
              {data.occurrences?.filter((o) => o.wordId === drawerWord.id).map((o, i) => (
                <div key={i} className="small">
                  <div className="muted">真实出现句（第 {o.paragraph + 1} 段）</div>
                  <div className="serif" style={{ fontSize: 15 }}>{o.sentence}</div>
                </div>
              ))}
              {!data.occurrences?.some((o) => o.wordId === drawerWord.id) && (
                <Banner kind="warn">这个词没有出现在本篇正文里，不计入文章覆盖率。请在情景对话中强化。</Banner>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ComprehensionList({ items }: { items: ArticleView['comprehension'] }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  if (!items || items.length === 0) return <p className="muted small">本篇暂无理解题。</p>;
  return (
    <ol className="list" style={{ marginTop: 10 }}>
      {items.map((q, qi) => (
        <li key={q.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>{qi + 1}. {q.prompt}</div>
          <div className="stack" style={{ gap: 6 }}>
            {q.choices.map((c, ci) => {
              const chosen = picked[qi] === ci;
              const revealed = picked[qi] !== undefined;
              const ok = ci === q.answerIndex;
              return (
                <button
                  key={ci}
                  className="btn sm"
                  style={{
                    justifyContent: 'flex-start',
                    borderColor: revealed && ok ? '#CFE3D6' : revealed && chosen ? '#E6C9C4' : undefined,
                    background: revealed && ok ? 'var(--ok-bg)' : revealed && chosen ? 'var(--danger-bg)' : undefined,
                  }}
                  onClick={() => setPicked((p) => ({ ...p, [qi]: ci }))}
                >
                  {String.fromCharCode(65 + ci)}. {c}
                  {revealed && ok && <span className="mark" style={{ marginLeft: 'auto', color: 'var(--ok)' }}>✓</span>}
                </button>
              );
            })}
          </div>
          {picked[qi] !== undefined && (
            <div className="tiny muted">依据：{q.evidence} —— {q.explanation}</div>
          )}
        </li>
      ))}
    </ol>
  );
}

export { WordPreview };
