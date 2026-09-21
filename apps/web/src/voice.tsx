import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Banner, Card, Icon, Skeleton, Tag, fmtDate, useAsync, useToast } from './ui';

/**
 * 情景口语（情景限定模式）。
 * 诚实标注：不是通用自由对话；ASR 与 TTS 都是本机离线引擎，零费用。
 * 采集：麦克风 → 16kHz 单声道 PCM(Float32→Int16) → 能量 VAD 判定说完 → 上传服务端识别。
 */

type Capabilities = {
  mode: string; modeLabel: string; paid: boolean; offlineCapable: boolean;
  asr: { available: boolean; modelName: string | null; note: string; engine?: string };
  tts: { available: boolean; voice: string | null; note: string };
  limitations: string[];
  pipeline: string[];
};

type Turn = {
  turnIndex: number; transcript: string | null; transcriptSource: string;
  feedback: { type: string; severity: string; original: string; suggestion: string; reasonZh: string }[];
  reply: string; advance: boolean; stepHint?: string | null; sampleUserLine?: string | null;
  referenceAnswer?: { prompt: string; answer: string } | null;
  usedTargetWordIds: string[]; missingTargetWordIds: string[];
  audio: { url: string; durationSeconds: number; voice: string | null } | null;
  latency: Record<string, number | null>;
  feedbackBasis?: string;
  limitations?: string[];
};

const TARGET_RATE = 16000;

export function VoiceScreen({ scenarioRef, onBack }: { scenarioRef?: string; onBack: () => void }) {
  const toast = useToast();
  const { data: caps } = useAsync<Capabilities>(() => api.get<Capabilities>('/api/voice/capabilities'), []);
  const [groupId, setGroupId] = useState<string>(scenarioRef || '');
  const [group, setGroup] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [scenario, setScenario] = useState<any>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, setState] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'error'>('idle');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [textMode, setTextMode] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnStats, setTurnStats] = useState<number[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const speakingRef = useRef(false);
  const silenceRef = useRef(0);
  const speechMsRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startAtRef = useRef(0);

  const { data: groupDetail } = useAsync<any>(() => (groupId ? api.get(`/api/course/groups/${groupId}`) : Promise.resolve(null)), [groupId]);

  // 未指定词组时，取当前级别第一组
  useEffect(() => {
    if (groupId) return;
    api.get<{ levels: any[] }>('/api/course/levels').then((r) => {
      const cur = r.levels.find((l) => l.current);
      if (cur && cur.groupsPublished > 0) {
        const idx = [0, 1, 11, 26, 41, 61][cur.id] || 1;
        setGroupId(`g${String(idx).padStart(3, '0')}`);
      }
    }).catch(() => {});
  }, [groupId]);

  useEffect(() => () => stopCapture(), []);

  const releaseMic = useCallback(() => {
    try { procRef.current?.disconnect(); } catch { /* ignore */ }
    try { srcRef.current?.disconnect(); } catch { /* ignore */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    procRef.current = null; srcRef.current = null; streamRef.current = null; ctxRef.current = null;
  }, []);

  const stopCapture = useCallback(() => {
    speakingRef.current = false;
    releaseMic();
    setLevel(0);
  }, [releaseMic]);

  const sendTurn = useCallback(async (pcm: Int16Array | null, text: string | null) => {
    if (!session) return;
    setState('thinking');
    const t0 = performance.now();
    try {
      let res: Turn;
      if (pcm && pcm.length > TARGET_RATE * 0.25) {
        res = await api.post<Turn>(`/api/voice/turn?sessionId=${session.session.id}&sampleRate=${TARGET_RATE}`, pcm.buffer as ArrayBuffer, {
          headers: { 'content-type': 'application/octet-stream' },
        });
      } else {
        res = await api.post<Turn>('/api/voice/turn-text', { sessionId: session.session.id, text: text || '' });
      }
      setTurns((prev) => [...prev, res]);
      setTurnStats((prev) => [...prev, Math.round(performance.now() - t0)]);
      if (res.audio?.url) {
        setState('speaking');
        const a = audioRef.current;
        if (a) {
          a.src = res.audio.url;
          a.play().catch(() => setState('idle'));
        }
      } else {
        setState('idle');
      }
    } catch (e: any) {
      setState('error');
      setError(e.message || '语音回合失败');
      toast.push(e.message || '语音回合失败', 'err');
    }
  }, [session, toast]);

  const onAudioChunk = useCallback((buf: Float32Array, sampleRate: number) => {
    // 能量 VAD + 重采样到 16k
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    setLevel(Math.min(1, rms * 14));

    const now = performance.now();
    const voiced = rms > 0.012;
    if (voiced) { lastVoiceAtRef.current = now; speechMsRef.current += (buf.length / sampleRate) * 1000; }

    if (speakingRef.current) {
      const resampled = resampleTo16k(buf, sampleRate);
      chunksRef.current.push(resampled);
      const silentFor = now - lastVoiceAtRef.current;
      const tooLong = now - startAtRef.current > 45000;
      if ((speechMsRef.current > 350 && silentFor > 1100) || tooLong) {
        const pcm = concatToInt16(chunksRef.current);
        chunksRef.current = [];
        speechMsRef.current = 0;
        speakingRef.current = false;
        stopCapture();
        if (pcm.length > TARGET_RATE * 0.3) sendTurn(pcm, null);
        else setState('idle');
      }
    }
  }, [sendTurn, stopCapture]);

  const startListening = useCallback(async (manual = false) => {
    setError(null);
    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        streamRef.current = stream;
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new Ctx();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        srcRef.current = src;
        const proc = ctx.createScriptProcessor(2048, 1, 1);
        procRef.current = proc;
        proc.onaudioprocess = (ev: AudioProcessingEvent) => {
          const buf = ev.inputBuffer.getChannelData(0);
          onAudioChunk(new Float32Array(buf), ctx.sampleRate);
        };
        src.connect(proc);
        proc.connect(ctx.destination);
      }
      chunksRef.current = [];
      speechMsRef.current = 0;
      lastVoiceAtRef.current = performance.now();
      startAtRef.current = performance.now();
      speakingRef.current = true;
      setState('listening');
      if (manual) {
        // 手动模式：用户点“我说完了”再结束
        const tick = setInterval(() => {
          if (!speakingRef.current) { clearInterval(tick); return; }
          setElapsed(Math.round((performance.now() - startAtRef.current) / 1000));
        }, 250);
      }
    } catch (e: any) {
      setState('error');
      setError('麦克风不可用或被拒绝。可以在下方改用文字输入继续训练。');
    }
  }, [onAudioChunk]);

  const finishTurn = useCallback(() => {
    const pcm = concatToInt16(chunksRef.current);
    chunksRef.current = [];
    speakingRef.current = false;
    stopCapture();
    if (pcm.length > TARGET_RATE * 0.3) sendTurn(pcm, null);
    else { setState('idle'); toast.push('没有检测到足够长的语音', 'info'); }
  }, [sendTurn, stopCapture, toast]);

  const start = async () => {
    try {
      const gid = groupId;
      const detail = await api.get<any>(`/api/course/groups/${gid}`);
      setGroup(detail);
      const sid = `${gid}-s1`;
      const r = await api.post<any>('/api/voice/session', { scenarioId: pickScenarioId(gid), groupId: gid, mode: 'voice' });
      setSession(r);
      setScenario(r.scenario);
      setTurns([]);
      setTurnStats([]);
      if (r.openingAudio?.url) {
        const a = audioRef.current;
        if (a) { a.src = r.openingAudio.url; a.play().catch(() => {}); }
      }
      toast.push(`${r.capabilities.modeLabel}｜${r.capabilities.asrAvailable ? '本地离线识别' : '识别不可用'}`, r.degraded ? 'info' : 'ok');
    } catch (e: any) {
      toast.push(e.message || '无法开始会话', 'err');
    }
  };

  const end = async (reason = 'user_stopped') => {
    stopCapture();
    if (session) await api.post(`/api/voice/session/${session.session.id}/end`, { reason }).catch(() => {});
    setSession(null);
    setState('idle');
    toast.push('会话结束，麦克风与临时音频已释放', 'ok');
  };

  const stats = useMemo(() => {
    if (!turnStats.length) return null;
    const sorted = [...turnStats].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return { count: turnStats.length, p50, p95, avg: Math.round(turnStats.reduce((a, b) => a + b, 0) / turnStats.length) };
  }, [turnStats]);

  return (
    <div className="stack" style={{ paddingBottom: 40 }}>
      <audio ref={audioRef} onEnded={() => setState('idle')} onError={() => setState('idle')} />
      <div className="row">
        <button className="btn ghost sm" onClick={() => { end(); onBack(); }}>← 返回</button>
        <div className="spacer" />
        {caps && <Tag kind="warn">{caps.modeLabel}</Tag>}
      </div>

      {caps && (
        <Card className="tight">
          <div className="row wrap tiny" style={{ gap: 6 }}>
            <Tag kind={caps.asr.available ? 'ok' : 'danger'}>识别 {caps.asr.available ? `${caps.asr.modelName}（离线）` : '不可用'}</Tag>
            <Tag kind={caps.tts.available ? 'ok' : 'danger'}>合成 {caps.tts.available ? caps.tts.voice : '不可用'}</Tag>
            <Tag>{caps.paid ? '付费' : '零费用 · 本地'}</Tag>
            <Tag>链路 {caps.pipeline.join(' → ')}</Tag>
          </div>
          {!caps.asr.available && <Banner kind="danger">{caps.asr.note}</Banner>}
        </Card>
      )}

      {!session ? (
        <Card>
          <span className="eyebrow">情景口语</span>
          <h1 style={{ marginTop: 2 }}>先你开口，再给参考表达</h1>
          <p className="small muted">
            目标词清单在开始前可见，完整范句要等你说完之后才出现。系统只在本情景预先编写的分支内回应；
            超出范围的表达会被明确说明未识别，而不是假装听懂。
          </p>
          <div className="stack" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="gid">练习词组</label>
              <select id="gid" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {(groupDetail ? [groupDetail] : []).map((g: any) => <option key={g.group.id} value={g.group.id}>{g.group.title}</option>)}
                {!groupDetail && <option value={groupId}>{groupId || '载入中…'}</option>}
              </select>
            </div>
            <div className="row wrap tiny" style={{ gap: 6 }}>
              <Tag>麦克风需要安全上下文（localhost 或 HTTPS）</Tag>
              <Tag kind="warn">不做发音评估，不给口语分数</Tag>
            </div>
            <button className="btn primary wide" onClick={start} disabled={!groupId}>开始情景通话</button>
            <button className="btn ghost wide" onClick={() => { setTextMode(true); start(); }} disabled={!groupId}>只用文字（识别不可用时的降级）</button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="tight">
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{scenario?.title}</div>
                <div className="tiny muted">{scenario?.role}</div>
              </div>
              <div className="spacer" />
              <Tag kind={state === 'error' ? 'danger' : state === 'listening' ? 'ok' : 'accent'}>
                {{ idle: '待机', listening: '正在听', thinking: '识别中', speaking: '播报中', error: '出错' }[state]}
              </Tag>
            </div>
            <div className="row wrap tiny" style={{ gap: 5, marginTop: 8 }}>
              {(scenario?.targetWords || []).map((w: any) => (
                <Tag key={w.id} kind={turns.some((t) => t.usedTargetWordIds.includes(w.id)) ? 'ok' : undefined}>{w.lemma}</Tag>
              ))}
            </div>
            {scenario?.steps && (
              <div className="tiny muted" style={{ marginTop: 8 }}>
                当前任务：{scenario.steps[Math.min(turns[turns.length - 1]?.turnIndex ?? 0, scenario.steps.length - 1)]?.hint || scenario.userGoal}
              </div>
            )}
          </Card>

          <div className="call-stage">
            <div className={`mic-orb ${state}`} style={{ ['--level' as any]: level }}>
              <Icon.Mic size={40} className="orb-ico" />
            </div>
            <div className="meter"><span style={{ width: `${Math.round(level * 100)}%` }} /></div>
            <div className="small muted" style={{ minHeight: 22 }}>
              {state === 'listening' && `正在听… 说完自然停顿就会自动结束（已录 ${elapsed}s）`}
              {state === 'thinking' && '识别与生成回应中…'}
              {state === 'speaking' && '正在播报回应…'}
              {state === 'idle' && '按下面的按钮开始说话'}
              {state === 'error' && (error || '出错了')}
            </div>
            <div className="row" style={{ marginTop: 12, gap: 8, justifyContent: 'center' }}>
              {state === 'listening' ? (
                <>
                  <button className="btn" onClick={finishTurn}>我说完了</button>
                  <button className="btn danger" onClick={() => { stopCapture(); setState('idle'); }}>取消</button>
                </>
              ) : (
                <>
                  <button className="btn primary" onClick={() => startListening(false)} disabled={!caps?.asr.available}>开始说话</button>
                  <button
                    className="btn"
                    onClick={() => { audioRef.current?.pause(); setState('idle'); }}
                    disabled={state !== 'speaking'}
                    title="随时可点的打断按钮（不做成假装的全双工）"
                  >打断</button>
                  <button className="btn danger" onClick={() => end('user_stopped')}>结束会话</button>
                </>
              )}
            </div>
          </div>

          {textMode && (
            <Card>
              <h3>文字输入（降级模式，会明确标注）</h3>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <input className="input" placeholder="输入你刚才想说的英文句子" value={typed} onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) { sendTurn(null, typed); setTyped(''); } }} />
                <button className="btn primary" onClick={() => { if (typed.trim()) { sendTurn(null, typed); setTyped(''); } }}>发送</button>
              </div>
            </Card>
          )}

          {turns.length === 0 && (
            <Card>
              <h3>参考表达（说完才会出现）</h3>
              <p className="tiny muted">本轮结束后，会先展示你的识别文本，再给出有依据的修改建议与自然参考表达。</p>
            </Card>
          )}

          {[...turns].reverse().map((t) => (
            <div key={t.turnIndex} className="stack" style={{ gap: 10 }}>
              <div className="turn user">
                <div className="who">第 {t.turnIndex} 轮 · 你（{sourceLabel(t.transcriptSource)}）</div>
                <div className="transcript">{t.transcript || '（未识别出内容）'}</div>
                {t.feedbackBasis === 'manual_transcript' && <div className="tiny muted">本回合反馈基于手工修正后的文本，不是原始声音。</div>}
              </div>
              {t.feedback.length > 0 && (
                <div className="card">
                  <h3>反馈</h3>
                  {t.feedback.map((f, i) => (
                    <div key={i} className="feedback-item">
                      <span className="mark" style={{ color: f.severity === 'error' ? 'var(--danger)' : f.severity === 'warn' ? 'var(--warn)' : 'var(--secondary)' }}>
                        {f.severity === 'error' ? '✕' : f.severity === 'warn' ? '!' : 'i'}
                      </span>
                      <div>
                        <div>{f.reasonZh}</div>
                        {f.original && f.suggestion && f.original !== f.suggestion && (
                          <div className="tiny" style={{ marginTop: 3 }}>
                            <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{f.original}</span>
                            {' → '}
                            <strong>{f.suggestion}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="turn">
                <div className="who">{scenario?.role || '对方'}</div>
                <div className="transcript">{t.reply}</div>
                {t.audio?.url && <audio src={t.audio.url} controls preload="none" style={{ width: '100%', marginTop: 8, height: 34 }} />}
              </div>
              {t.referenceAnswer && (
                <div className="ref-answer">
                  <div className="tiny muted">{t.referenceAnswer.prompt}</div>
                  <div className="serif" style={{ fontSize: 16 }}>{t.referenceAnswer.answer}</div>
                </div>
              )}
              <div className="row wrap tiny" style={{ gap: 6 }}>
                {t.usedTargetWordIds.map((id) => {
                  const w = (scenario?.targetWords || []).find((x: any) => x.id === id);
                  return w ? <Tag key={id} kind="ok">用到 {w.lemma}</Tag> : null;
                })}
                {t.missingTargetWordIds.map((id) => {
                  const w = (scenario?.targetWords || []).find((x: any) => x.id === id);
                  return w ? <Tag key={id} kind="warn">未用 {w.lemma}</Tag> : null;
                })}
                <Tag>首音 {(t.latency?.firstAudioMs ?? t.latency?.ttsMs ?? 0)} ms</Tag>
              </div>
            </div>
          ))}

          {stats && (
            <Card>
              <h3>本会话实测延迟</h3>
              <div className="kv"><dt>回合数</dt><dd className="num">{stats.count}</dd></div>
              <div className="kv"><dt>端到端 p50</dt><dd className="num">{stats.p50} ms</dd></div>
              <div className="kv"><dt>端到端 p95</dt><dd className="num">{stats.p95} ms</dd></div>
              <p className="tiny muted">
                这里显示的是浏览器实测的“按下说话到收到可播放回应”总时长，包含录音、上传、识别、引擎与合成。
                工程目标是暖启动 p50 ≤ 2.5s、p95 ≤ 5s；是否达成以独立基准脚本 VOICE_BENCHMARK.json 为准。
              </p>
            </Card>
          )}

          <Card>
            <h3>能力边界（必须知道）</h3>
            <ul className="list tiny">
              {(caps?.limitations || []).map((l, i) => <li key={i}><Icon.Info size={14} /><span>{l}</span></li>)}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function pickScenarioId(groupId: string) { return `s-${groupId}-1`; }
function sourceLabel(s: string) {
  return ({ whispercpp: '本地 Whisper 识别', 'whisper.cpp': '本地 Whisper 识别', manual_correction: '手工修正文本', typed_text: '文字输入（降级）', asr_failed: '识别失败' } as any)[s] || s;
}

function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return input;
  const ratio = fromRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function concatToInt16(chunks: Float32Array[]): Int16Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Int16Array(total);
  let off = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i += 1) {
      const s = Math.max(-1, Math.min(1, c[i]));
      out[off + i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
    off += c.length;
  }
  return out;
}
