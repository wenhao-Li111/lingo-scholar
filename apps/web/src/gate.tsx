import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Banner, Card, Icon, Skeleton, Tag, fmtTime, useToast } from './ui';

/**
 * 晋级关卡（R08）。
 * 三个部分独立达标：词汇 18/20、阅读 8/10、无字幕原速听力 8/10。
 * 失败不扣积分、可隔日再考；级别只由服务端判定更新。
 */

type GateQuestion = {
  index: number;
  section: 'vocab' | 'reading' | 'listening';
  type: 'definition' | 'mcq';
  prompt: string;
  hintZh?: string;
  choices?: string[];
  questionId: string;
};

type GateStart = {
  attemptId: string;
  questions: GateQuestion[];
  formNo?: number;
  resumed?: boolean;
  listenCount?: number;
  materials: {
    reading?: { id: string; title: string; paragraphs: { index: number; en: string; zh: string }[]; words: number; note: string };
    listening?: { id: string; title: string; audioUrl: string; durationSeconds: number; note: string; listenRules: { speed: number; playsAllowed: number } };
  };
  rules: Record<string, string>;
};

type GateResult = {
  passed: boolean;
  sections: Record<'vocab' | 'reading' | 'listening', { passed: boolean; correct: number; total: number; required: number; percent: number }>;
  unlockedLevel: number;
  penalty: number;
  note: string;
};

const SECTION_LABEL = { vocab: '词汇抽测', reading: '陌生阅读', listening: '无字幕听力' };

export function GatePanel({ state, onChanged }: { state: any; onChanged: () => void }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState<GateStart | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<GateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [listenUsed, setListenUsed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const grouped = useMemo(() => {
    const g: Record<string, GateQuestion[]> = { vocab: [], reading: [], listening: [] };
    for (const q of attempt?.questions || []) g[q.section]?.push(q);
    return g;
  }, [attempt]);

  const answeredCount = Object.values(answers).filter((v) => String(v).trim()).length;
  const total = attempt?.questions.length ?? 0;

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.post<GateStart>('/api/gate/start', {});
      setAttempt(r);
      setAnswers({});
      setResult(null);
      setListenUsed((r.listenCount ?? 0) > 0);
      if (r.resumed) toast.push('已恢复上次未提交的关卡评测', 'info');
    } catch (e: any) {
      toast.push(e.message || '无法开始关卡评测', 'err');
    } finally {
      setBusy(false);
    }
  };

  const playListening = async () => {
    if (!attempt) return;
    if (listenUsed) { toast.push('关卡听力只允许原速完整播放一遍', 'err'); return; }
    try {
      const r = await api.post<{ listenCount: number }>('/api/gate/listen', { attemptId: attempt.attemptId });
      setListenUsed(true);
      const a = audioRef.current;
      if (a) {
        a.playbackRate = 1;
        await a.play().catch(() => toast.push('音频播放被浏览器拦截，请再点一次', 'err'));
        setPlaying(true);
      }
      if (r.listenCount === 1) toast.push('这是一遍播放，请直接作答', 'info');
    } catch (e: any) {
      setListenUsed(true);
      toast.push(e.message || '播放限制', 'err');
    }
  };

  const submit = async () => {
    if (!attempt) return;
    setBusy(true);
    try {
      const r = await api.post<GateResult>('/api/gate/submit', { attemptId: attempt.attemptId, answers });
      setResult(r);
      setAttempt(null);
      audioRef.current?.pause();
      onChanged();
      toast.push(r.passed ? '关卡通过，已解锁下一级' : '本次未通过，可隔日再考（不扣分）', r.passed ? 'ok' : 'info');
    } catch (e: any) {
      toast.push(e.message || '提交失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------- 结果视图 --------------------------- */
  if (result) {
    return (
      <Card>
        <div className="row">
          <Icon.Trophy size={20} />
          <h2>关卡评测结果</h2>
          <div className="spacer" />
          <Tag kind={result.passed ? 'ok' : 'warn'}>{result.passed ? '通过' : '未通过'}</Tag>
        </div>
        <ul className="list" style={{ marginTop: 8 }}>
          {(['vocab', 'reading', 'listening'] as const).map((k) => {
            const s = result.sections[k];
            return (
              <li key={k}>
                <span className={`status-dot ${s.passed ? 'ok' : 'danger'}`} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{SECTION_LABEL[k]}</div>
                  <div className="tiny muted">
                    {s.correct}/{s.total} 正确（需 ≥{s.required}）· {(s.percent ?? 0).toFixed(0)}%
                  </div>
                </div>
                <Tag kind={s.passed ? 'ok' : 'danger'}>{s.passed ? '达标' : '未达标'}</Tag>
              </li>
            );
          })}
        </ul>
        <Banner kind={result.passed ? 'ok' : 'warn'}>
          {result.passed
            ? `已解锁 L${result.unlockedLevel}。晋级不额外发积分——解锁本身就是奖励。`
            : '失败保留本级、不扣积分，可练习后隔日再考。词汇项必须首次独立答对，补错后的满分不能替代这一项。'}
        </Banner>
        <button className="btn wide" style={{ marginTop: 12 }} onClick={() => { setResult(null); onChanged(); }}>返回</button>
      </Card>
    );
  }

  /* --------------------------- 答题视图 --------------------------- */
  if (attempt) {
    return (
      <div className="stack">
        <Card className="tight">
          <div className="row">
            <div>
              <span className="eyebrow">L{state.level} 晋级关卡{attempt.formNo ? ` · 第 ${attempt.formNo} 套` : ''}</span>
              <h2 style={{ marginTop: 2 }}>三部分独立达标</h2>
            </div>
            <div className="spacer" />
            <Tag>{answeredCount}/{total} 已作答</Tag>
          </div>
          <ul className="list tiny" style={{ marginTop: 8 }}>
            <li><Icon.Info size={14} /><span>{attempt.rules?.vocab}</span></li>
            <li><Icon.Info size={14} /><span>{attempt.rules?.reading}</span></li>
            <li><Icon.Info size={14} /><span>{attempt.rules?.listening}</span></li>
          </ul>
        </Card>

        {/* 一、词汇抽测 */}
        <Card>
          <div className="row">
            <Icon.Text size={18} />
            <h3>一、词汇抽测（{grouped.vocab.length} 题）</h3>
            <div className="spacer" />
            <Tag>{grouped.vocab.filter((q) => String(answers[q.index] || '').trim()).length}/{grouped.vocab.length}</Tag>
          </div>
          <p className="tiny muted">按中文释义拼写本级目标英文词。这项只看你第一次独立作答的结果。</p>
          <div className="stack" style={{ marginTop: 8, gap: 10 }}>
            {grouped.vocab.map((q, i) => (
              <div key={q.questionId} className="field">
                <label htmlFor={`gq-${q.index}`}>{i + 1}. {q.prompt}{q.hintZh ? <span className="muted">（{q.hintZh}）</span> : null}</label>
                <input
                  id={`gq-${q.index}`}
                  className="input"
                  value={answers[q.index] || ''}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.index]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* 二、陌生阅读 */}
        <Card>
          <div className="row">
            <Icon.Book size={18} />
            <h3>二、陌生阅读</h3>
            <div className="spacer" />
            {attempt.materials.reading && <Tag>{attempt.materials.reading.words} 英文词</Tag>}
          </div>
          {attempt.materials.reading ? (
            <>
              <h4 className="serif" style={{ marginTop: 8 }}>{attempt.materials.reading.title}</h4>
              <p className="tiny muted">{attempt.materials.reading.note}</p>
              <div className="reader" style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                {attempt.materials.reading.paragraphs.map((p) => (
                  <p key={p.index} className="para-en">{p.en}</p>
                ))}
              </div>
              <McqList questions={grouped.reading} answers={answers} setAnswers={setAnswers} prefix="r" />
            </>
          ) : <Banner kind="warn">阅读材料未就绪。</Banner>}
        </Card>

        {/* 三、无字幕听力 */}
        <Card>
          <div className="row">
            <Icon.Headphones size={18} />
            <h3>三、无字幕听力</h3>
            <div className="spacer" />
            {attempt.materials.listening && <Tag>{fmtTime(attempt.materials.listening.durationSeconds)}</Tag>}
          </div>
          {attempt.materials.listening ? (
            <>
              <p className="tiny muted">{attempt.materials.listening.note}</p>
              <audio
                ref={audioRef}
                src={attempt.materials.listening.audioUrl}
                preload="metadata"
                onEnded={() => setPlaying(false)}
                onPause={() => setPlaying(false)}
              />
              <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
                <button className="btn primary" onClick={playListening} disabled={listenUsed && playing}>
                  {playing ? '播放中…' : listenUsed ? '已使用唯一一次播放' : '原速播放（仅一次）'}
                </button>
                <Tag kind={listenUsed ? 'warn' : 'ok'}>{listenUsed ? '播放机会已用完' : '尚无播放记录'}</Tag>
                <Tag>1.0× 原速</Tag>
                <Tag kind="ok">无中英文字幕</Tag>
              </div>
              <Banner kind="warn">
                关卡听力不给字幕，也不允许回放：这是为了验证你在真实考试条件下的理解能力。平时的训练材料可以自由重听。
              </Banner>
              <McqList questions={grouped.listening} answers={answers} setAnswers={setAnswers} prefix="l" />
            </>
          ) : <Banner kind="warn">听力材料未就绪。</Banner>}
        </Card>

        <Card>
          <div className="row">
            <span className="small muted">已作答 {answeredCount}/{total}</span>
            <div className="spacer" />
            <button className="btn ghost sm" onClick={() => { audioRef.current?.pause(); setAttempt(null); }}>稍后再做</button>
            <button className="btn primary" onClick={submit} disabled={busy}>
              {busy ? '提交中…' : '提交并判定'}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  /* --------------------------- 入口视图 --------------------------- */
  const e = state.eligibility;
  const canStart = e.eligible && state.materials.ready;
  return (
    <Card>
      <div className="row">
        <Icon.Trophy size={20} />
        <h2>晋级关卡 · L{state.level}</h2>
        <div className="spacer" />
        <Tag kind={state.materials.ready ? 'ok' : 'warn'}>{state.materials.ready ? `材料就绪（${state.materials.availableForms} 套）` : '待补充材料'}</Tag>
      </div>
      <div className="kv"><dt>本级已完成词组</dt><dd className="num">{e.completedGroups}/{e.requiredGroups}</dd></div>
      <div className="kv"><dt>本级已发布词组</dt><dd className="num">{e.publishedGroups}</dd></div>
      <div className="kv"><dt>到期未完成复习</dt><dd className="num">{e.overdueReviews}</dd></div>
      <div className="kv"><dt>达标线</dt><dd>词汇 {state.plan.vocab.needCorrect}/{state.plan.vocab.questions} · 阅读 {state.plan.reading.needCorrect}/{state.plan.reading.questions} · 听力 {state.plan.listening.needCorrect}/{state.plan.listening.questions}</dd></div>

      {!state.materials.ready && <Banner kind="warn">{state.materials.message}</Banner>}
      {state.materials.ready && !e.eligible && (
        <Banner kind="warn">
          {e.completedGroups < e.requiredGroups
            ? `还差 ${e.requiredGroups - e.completedGroups} 组才满足晋级资格。`
            : `有 ${e.overdueReviews} 项到期未完成复习，先清理它们。`}
        </Banner>
      )}
      {state.lastAttempt && (
        <Banner kind={state.lastAttempt.passed ? 'ok' : 'info'}>
          上次评测：{state.lastAttempt.status}{state.lastAttempt.submittedAt ? `（${new Date(state.lastAttempt.submittedAt).toLocaleString('zh-CN')}）` : ''}
        </Banner>
      )}
      <p className="tiny muted" style={{ marginTop: 8 }}>{state.note}</p>
      <button className="btn primary wide" style={{ marginTop: 12 }} onClick={start} disabled={busy || !canStart}>
        {busy ? '准备中…' : canStart ? '开始关卡评测' : '尚不满足条件'}
      </button>
    </Card>
  );
}

function McqList({
  questions, answers, setAnswers, prefix,
}: {
  questions: GateQuestion[];
  answers: Record<number, string>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  prefix: string;
}) {
  if (!questions.length) return <Skeleton h={80} />;
  return (
    <div className="stack" style={{ marginTop: 12, gap: 14 }}>
      {questions.map((q, i) => (
        <div key={q.questionId} className="field">
          <span style={{ fontWeight: 600, fontSize: 15 }}>{i + 1}. {q.prompt}</span>
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            {(q.choices || []).map((c, ci) => {
              const key = String.fromCharCode(65 + ci);
              const picked = answers[q.index] === String(ci);
              return (
                <button
                  key={ci}
                  type="button"
                  className="btn sm"
                  aria-pressed={picked}
                  style={{
                    justifyContent: 'flex-start',
                    background: picked ? '#F3F7F5' : undefined,
                    borderColor: picked ? 'var(--secondary)' : undefined,
                  }}
                  onClick={() => setAnswers((a) => ({ ...a, [q.index]: String(ci) }))}
                >
                  <span className="mono" style={{ width: 16 }}>{key}</span>
                  {c}
                  {picked && <Icon.Check size={15} />}
                </button>
              );
            })}
          </div>
          <span className="sr-only">{`第 ${prefix}${i + 1} 题`}</span>
        </div>
      ))}
    </div>
  );
}
