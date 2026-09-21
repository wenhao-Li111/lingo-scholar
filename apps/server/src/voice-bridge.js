/**
 * 语音桥：把前端的一个回合接到真实的本地 ASR + 情景引擎 + 本地 TTS。
 *
 * 真实能力（写进 VOICE_CAPABILITIES.md，不夸大）：
 *  - ASR：whisper.cpp ggml-base.en，本机离线推理，零费用。
 *  - 对话：情景限定分支引擎（scenario_constrained），不是通用自由对话。
 *  - TTS：Windows SAPI 英文语音合成，离线、零费用，输出真实 WAV。
 *  - 不提供发音评分；不返回伪造置信度；ASR 不确定时明确提示可重录。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, jsonParse, nowIso, run, tx, uuid } from './db.js';
import { CONFIG } from '@lingo/domain';
import { asrAvailability, transcribeFloat32, transcribeWavFile, float32ToPcm16, pcm16ToWav } from '../../../services/voice/src/asr.js';
import { runTurn, scenarioReady, detectTargetWords } from '../../../services/voice/src/dialogue.js';
import { synthesizeToCache, ttsAvailability, cleanupTtsCache } from '../../../services/voice/src/tts.js';
import { getGroup } from './content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export async function voiceCapabilities() {
  const asr = asrAvailability();
  const tts = await ttsAvailability();
  return {
    mode: 'scenario_constrained',
    modeLabel: '情景限定模式（不是通用自由对话）',
    paid: false,
    offlineCapable: asr.available && tts.available,
    pipeline: ['麦克风采集', 'VAD 端点', '本地 ASR', '情景分支引擎', '本地 TTS', '音频播放'],
    asr: { ...asr, engine: asr.available ? 'whisper.cpp' : null },
    tts: { ...tts },
    limitations: [
      '对话只在课程作者编写的分支内进行；超出的表达会被明确说明未识别，而不是假装听懂。',
      '不做发音评估，不给 IELTS 口语分数，不返回伪造的识别置信度。',
      '语法反馈只覆盖显式编写的模式；未命中不等于没有错误。',
      '浏览器 SpeechRecognition 作为可选备用通道，可能依赖厂商云端服务，默认不启用。',
      '未做真人设备（iPhone/Android）麦克风实测，该项在 DEVICE_MATRIX 中标为 NOT_TESTED。',
    ],
    targets: {
      warmFirstAudioP50Seconds: CONFIG.voice.targetWarmFirstAudioP50Seconds,
      warmFirstAudioP95Seconds: CONFIG.voice.targetWarmFirstAudioP95Seconds,
      benchmarkMinTurns: CONFIG.voice.benchmarkMinTurns,
      baselineConcurrency: CONFIG.voice.baselineModelConcurrency,
      note: '以上是工程目标，是否达成以 VOICE_BENCHMARK.json 的实测值为准。',
    },
    limits: { maxTurnSeconds: CONFIG.voice.maxTurnSeconds, maxTurnBytes: CONFIG.voice.maxTurnBytes, rawAudioTempMaxHours: CONFIG.voice.rawAudioTempMaxHours },
  };
}

/** 根据词组 + 情景 id 找到情景定义与目标词 */
export function resolveScenario({ groupId, scenarioId }) {
  if (!groupId) throw Object.assign(new Error('缺少 groupId'), { status: 400, code: 'MISSING_GROUP' });
  const group = getGroup(groupId);
  if (!group) throw Object.assign(new Error('词组不存在'), { status: 404, code: 'GROUP_NOT_FOUND' });
  const raw = all('SELECT id FROM word_groups WHERE id = ?', [groupId]);
  if (!raw.length) throw Object.assign(new Error('词组不存在'), { status: 404 });
  const json = JSON.parse(JSON.stringify(group));
  const scenarios = loadGroupScenarios(groupId);
  const scenario = scenarios.find((s) => s.id === scenarioId) || scenarios[0];
  if (!scenarioReady(scenario)) throw Object.assign(new Error('该情景内容不完整'), { status: 409, code: 'SCENARIO_NOT_READY' });
  const words = group.words.filter((w) => scenario.targetWordIds.includes(w.id));
  return { scenario, words, group, allScenarios: scenarios };
}

function loadGroupScenarios(groupId) {
  const row = get('SELECT * FROM word_groups WHERE id = ?', [groupId]);
  if (!row) return [];
  // scenarios 存在课程文件里；导入时未单独建表，这里按需读文件（只读，安全）
  const file = path.join(PROJECT_ROOT, 'content', 'courses', `L${row.level}`, `${groupId}.json`);
  if (!fsModule.existsSync(file)) return [];
  const raw = JSON.parse(fsModule.readFileSync(file, 'utf8'));
  return raw.scenarios || [];
}

import * as fsModule from 'node:fs';

export async function startVoiceSession({ userId, scenarioId, mode = 'voice', groupId = null, now = new Date() }) {
  const caps = await voiceCapabilities();
  const resolved = scenarioId ? resolveScenario({ groupId: groupId || inferGroupFromScenario(scenarioId), scenarioId }) : null;
  const id = uuid('vs');
  const effectiveMode = caps.asr.available ? (mode === 'voice' ? 'voice' : 'text') : 'text';
  run(
    `INSERT INTO voice_sessions (id, user_id, group_id, scenario_id, mode, provider_json, status, started_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, userId, resolved?.group.id ?? null, resolved?.scenario.id ?? scenarioId ?? 'unknown', effectiveMode,
      JSON.stringify({ asr: caps.asr.provider, tts: caps.tts.provider, engine: 'scenario_constrained' }), 'active', now.toISOString()],
  );
  return {
    session: sessionPublic(get('SELECT * FROM voice_sessions WHERE id = ?', [id])),
    scenario: resolved ? publicScenario(resolved.scenario, resolved.words) : null,
    capabilities: { mode: caps.mode, modeLabel: caps.modeLabel, asrAvailable: caps.asr.available, ttsAvailable: caps.tts.available, limitations: caps.limitations },
    openingLine: resolved?.scenario.openingLine ?? null,
    openingAudio: resolved?.scenario.openingLine ? await synthesizeToCache(resolved.scenario.openingLine, { prefix: 'vs-open' }) : null,
    degraded: !caps.asr.available,
    degradedReason: caps.asr.available ? null : caps.asr.note,
  };
}

function inferGroupFromScenario(scenarioId) {
  const m = String(scenarioId || '').match(/^s-(g\d+)-/);
  return m ? m[1] : null;
}

export function publicScenario(scenario, words) {
  return {
    id: scenario.id,
    title: scenario.title,
    role: scenario.role,
    setting: scenario.setting,
    userGoal: scenario.userGoal,
    openingLine: scenario.openingLine,
    steps: (scenario.steps || []).map((s) => ({ id: s.id, hint: s.hint, expects: s.expects })),
    targetWords: words.map((w) => ({ id: w.id, lemma: w.lemma, coreMeaningZh: w.coreMeaningZh, partOfSpeech: w.partOfSpeech })),
    grammarFocus: scenario.grammarFocus || [],
    note: '完整范句在你发言之后才会出现。',
  };
}

export function sessionPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    groupId: row.group_id,
    mode: row.mode,
    provider: jsonParse(row.provider_json, {}),
    status: row.status,
    turnCount: row.turn_count,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    cancelReason: row.cancel_reason,
  };
}

export function endVoiceSession({ sessionId, userId, reason = 'user_stopped' }) {
  const s = get('SELECT * FROM voice_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!s) throw Object.assign(new Error('会话不存在'), { status: 404 });
  // 麦克风与临时音频释放：删除该会话的临时音频文件
  const turns = all('SELECT audio_path FROM voice_turns WHERE session_id = ?', [sessionId]);
  const fs = fsModule;
  for (const t of turns) {
    if (t.audio_path) { try { fs.unlinkSync(t.audio_path); } catch { /* ignore */ } }
  }
  run('UPDATE voice_sessions SET status = ?, ended_at = ?, cancel_reason = ? WHERE id = ?', ['ended', nowIso(), reason, sessionId]);
  run('UPDATE voice_turns SET audio_path = NULL, audio_retained = 0 WHERE session_id = ?', [sessionId]);
  return { ended: true, releasedTurns: turns.length, note: '麦克风与临时音频已释放（原始录音默认不长期保存）。' };
}

/**
 * 执行一个语音回合：音频或文本 → ASR（若为音频）→ 情景引擎 → TTS。
 */
export async function runVoiceTurn({ sessionId, userId, audioBuffer, sampleRate = 16000, text = null, manualTranscript = null, now = new Date(), forceText = false }) {
  const session = get('SELECT * FROM voice_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
  if (!session) throw Object.assign(new Error('语音会话不存在'), { status: 404, code: 'VOICE_SESSION_NOT_FOUND' });
  if (session.status !== 'active') throw Object.assign(new Error('会话已结束'), { status: 409, code: 'VOICE_SESSION_ENDED' });

  const resolved = resolveScenario({ groupId: session.group_id, scenarioId: session.scenario_id });
  const t0 = Date.now();
  const latency = { coldStartMs: null, vadMs: 0, asrMs: 0, dialogueMs: 0, ttsMs: 0, firstAudioMs: null };
  let transcript = null;
  let transcriptSource = 'none';
  let asrDetail = null;

  const asr = asrAvailability();
  if (!forceText && audioBuffer && audioBuffer.length) {
    if (audioBuffer.length > CONFIG.voice.maxTurnBytes) {
      throw Object.assign(new Error('单回合音频过大'), { status: 413, code: 'TURN_TOO_LARGE' });
    }
    const t1 = Date.now();
    // 客户端上传的是 16kHz 单声道 s16le PCM（由浏览器 AudioWorklet 降采样后发送，避免依赖 ffmpeg）
    const wav = pcm16ToWav(audioBuffer, { sampleRate, channels: 1 });
    const tmpDir = asr.available ? path.join(process.env.LOCALAPPDATA || '.', 'LingoScholar', 'voice', 'scratch') : null;
    let result;
    if (asr.available && tmpDir) {
      const fs = fsModule;
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const f = path.join(tmpDir, `turn-${uuid('a')}.wav`);
      fs.writeFileSync(f, wav);
      try {
        result = await transcribeWavFile(f, { threads: 8 });
      } finally {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
    } else {
      result = { ok: false, error: 'asr_unavailable', detail: asr.note };
    }
    latency.asrMs = Date.now() - t1;
    latency.vadMs = Number(manualTranscript ? 0 : 0);
    asrDetail = { provider: 'whisper.cpp', model: asr.modelName, ok: result.ok, error: result.error || null, audioSeconds: Number((audioBuffer.length / 2 / sampleRate).toFixed(2)) };
    if (result.ok) {
      transcript = result.text;
      transcriptSource = 'whisper.cpp';
    } else if (manualTranscript) {
      transcript = manualTranscript;
      transcriptSource = 'manual_correction';
    } else {
      // 识别失败：不评价英语能力，允许重录
      const turnIndex = Number(get('SELECT COALESCE(MAX(turn_index),0) AS m FROM voice_turns WHERE session_id = ?', [sessionId]).m) + 1;
      const rec = {
        sessionId, turnIndex, transcript: null, transcriptSource: 'asr_failed',
        feedback: [{
          type: 'asr', severity: 'info', original: '',
          suggestion: '请靠近麦克风再清楚地说一遍，或手工输入你刚才说的句子。',
          reasonZh: '这次没有识别出语音内容，系统不会据此评价你的英语。',
        }],
        reply: 'Sorry, I could not hear you clearly. Could you say that again?',
        latency, asrDetail,
      };
      const audio = await synthesizeToCache(rec.reply, { prefix: 'vs' });
      latency.ttsMs = Date.now() - t1 - latency.asrMs;
      return finalizeTurn({ rec, sessionId, audio, session, latency, t0, asrFailed: true });
    }
  } else {
    transcript = String(text ?? '').trim();
    transcriptSource = manualTranscript ? 'manual_correction' : 'typed_text';
  }

  const t2 = Date.now();
  const state = jsonParse(session.provider_json, {});
  const stepState = tx(() => {
    const rows = all('SELECT slots_json FROM voice_turns WHERE session_id = ? ORDER BY turn_index DESC LIMIT 1', [sessionId]);
    return jsonParse(rows[0]?.slots_json, { stepIndex: 0 })?.engineState || { stepIndex: 0 };
  });
  const engine = runTurn({
    scenario: resolved.scenario,
    session: { stepIndex: state.stepIndex ?? stepState.stepIndex ?? 0 },
    transcript,
    targetWords: resolved.words,
    transcriptManuallyEdited: transcriptSource === 'manual_correction',
  });
  latency.dialogueMs = Date.now() - t2;

  const t3 = Date.now();
  const audio = await synthesizeToCache(engine.reply, { prefix: 'vs' });
  latency.ttsMs = Date.now() - t3;
  latency.firstAudioMs = Date.now() - t0;

  const rec = {
    sessionId,
    turnIndex: Number(get('SELECT COALESCE(MAX(turn_index),0) AS m FROM voice_turns WHERE session_id = ?', [sessionId]).m) + 1,
    transcript,
    transcriptSource,
    confidence: null, // 明确不返回伪造置信度
    intent: engine.intent,
    slots: { ...engine.slots, engineState: { stepIndex: engine.stepIndex } },
    feedback: engine.feedback,
    reply: engine.reply,
    advance: engine.advance,
    stepIndex: engine.stepIndex,
    stepHint: engine.stepHint,
    sampleUserLine: engine.sampleUserLine,
    referenceAnswer: engine.referenceAnswer,
    usedTargetWordIds: engine.usedTargetWordIds,
    missingTargetWordIds: engine.missingTargetWordIds,
    feedbackBasis: engine.feedbackBasis,
    limitations: engine.limitations,
    latency,
    asrDetail,
  };
  return finalizeTurn({ rec, sessionId, audio, session, latency, t0 });
}

function finalizeTurn({ rec, sessionId, audio, session, latency, t0, asrFailed = false }) {
  const id = uuid('vt');
  tx(() => {
    run(
      `INSERT INTO voice_turns (id, session_id, turn_index, transcript, transcript_source, asr_confidence, intent, slots_json,
         feedback_json, reply_text, audio_url, audio_provider, latency_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, sessionId, rec.turnIndex, rec.transcript, rec.transcriptSource, null, rec.intent ?? null,
        JSON.stringify(rec.slots || {}), JSON.stringify(rec.feedback || []), rec.reply,
        audio.ok ? audio.url : null, audio.ok ? 'windows-sapi' : 'unavailable', JSON.stringify(latency), nowIso()],
    );
    run('UPDATE voice_sessions SET turn_count = ? WHERE id = ?', [rec.turnIndex, sessionId]);
  });
  return {
    turnId: id,
    turnIndex: rec.turnIndex,
    transcript: rec.transcript,
    transcriptSource: rec.transcriptSource,
    transcriptCertainty: 'unverified', // 不伪造置信度
    engine: 'scenario_constrained',
    intent: rec.intent,
    slots: rec.slots,
    feedback: rec.feedback,
    reply: rec.reply,
    advance: rec.advance ?? false,
    stepIndex: rec.stepIndex,
    stepHint: rec.stepHint,
    sampleUserLine: rec.sampleUserLine,
    referenceAnswer: rec.referenceAnswer,
    usedTargetWordIds: rec.usedTargetWordIds,
    missingTargetWordIds: rec.missingTargetWordIds,
    feedbackBasis: rec.feedbackBasis,
    limitations: rec.limitations,
    audio: audio.ok ? { url: audio.url, durationSeconds: audio.durationSeconds, voice: audio.voice, provider: 'windows-sapi', synthetic: true } : null,
    audioError: audio.ok ? null : audio.error,
    latency,
    totalMs: Date.now() - t0,
    asrFailed,
  };
}

export { cleanupTtsCache };
