/**
 * 本地免费 ASR：whisper.cpp（whisper-cli.exe）。
 *
 * 事实说明（写进报告，不夸大）：
 *  - 完全在本机 CPU/GPU 上运行，不联网、不需要任何付费 API 或密钥。
 *  - 模型：ggml-base.en.bin（英语 base 模型，141MB，MIT）。未做声学发音评分。
 *  - 输入需要 16kHz 单声道 PCM；whisper.cpp 自带重采样，可直接喂任意采样率 WAV。
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VOICE_ROOT = path.resolve(__dirname, '..');

/**
 * 运行时目录必须是纯 ASCII：whisper.cpp 的 Windows 预编译二进制无法打开含非 ASCII
 * 字符的路径（本项目工作目录含中文，实测会以 0xC0000409 崩溃）。
 */
export function voiceRuntimeDir() {
  if (process.env.LINGO_VOICE_HOME) return process.env.LINGO_VOICE_HOME;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'LingoScholar', 'voice');
}

const RUNTIME = voiceRuntimeDir();
const DEFAULT_CLI = path.join(RUNTIME, 'bin', 'Release', 'whisper-cli.exe');
const DEFAULT_MODEL = path.join(RUNTIME, 'models', 'ggml-base.en.bin');

/** 临时目录也要是 ASCII；否则退回运行时目录下的 scratch */
export function asciiScratchDir() {
  const t = os.tmpdir();
  if (!/[^\x20-\x7E]/.test(t)) return t;
  const s = path.join(RUNTIME, 'scratch');
  return s;
}

let probeCache = null;

export function asrAvailability() {
  if (probeCache) return probeCache;
  const cli = process.env.WHISPER_CLI || DEFAULT_CLI;
  const model = process.env.WHISPER_MODEL || DEFAULT_MODEL;
  const cliOk = existsSync(cli);
  const modelOk = existsSync(model);
  probeCache = {
    provider: 'whisper.cpp',
    available: cliOk && modelOk,
    engine: cliOk ? cli : null,
    model: modelOk ? model : null,
    modelName: modelOk ? path.basename(model) : null,
    runtimeDir: RUNTIME,
    offline: true,
    paid: false,
    languages: ['en'],
    note: cliOk && modelOk
      ? '本地离线识别可用（不做发音评分，不返回伪造置信度）。'
      : '未找到 whisper.cpp 可执行文件或模型，请运行 npm run voice:fetch。',
  };
  return probeCache;
}

export function resetAsrProbe() {
  probeCache = null;
}

/** 把 Float32 PCM 写成 16kHz 单声道 WAV（避免依赖 ffmpeg） */
export function pcm16ToWav(pcmBuffer, { sampleRate = 16000, channels = 1, bitsPerSample = 16 } = {}) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

export function float32ToPcm16(float32) {
  const out = Buffer.alloc(float32.length * 2);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return out;
}

/** 简易线性重采样（语音识别足够，避免引入重依赖） */
export function resample(float32, fromRate, toRate) {
  if (fromRate === toRate) return float32;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, float32.length - 1);
    const frac = pos - i0;
    out[i] = float32[i0] * (1 - frac) + float32[i1] * frac;
  }
  return out;
}

/**
 * 对一段 WAV 文件做真实识别。
 * @returns {{ ok:boolean, text:string, segments:Array, durationMs:number, tookMs:number, provider:string, model:string, error?:string }}
 */
export function transcribeWavFile(wavPath, { language = 'en', threads = 8, model = null, cli = null, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const av = asrAvailability();
    if (!av.available) {
      resolve({ ok: false, text: '', segments: [], error: 'asr_unavailable', provider: 'whisper.cpp', detail: av.note });
      return;
    }
    const exe = cli || av.engine;
    const modelPath = model || av.model;
    // whisper.cpp 打不开含非 ASCII 的路径：必要时先把音频拷到 ASCII 暂存区
    let staged = null;
    let input = wavPath;
    try {
      if (/[^\x20-\x7E]/.test(wavPath)) {
        const dir = mkdtempSync(path.join(asciiScratchDir(), 'lingo-asr-'));
        staged = path.join(dir, 'input.wav');
        writeFileSync(staged, readFileSync(wavPath));
        input = staged;
      }
    } catch (e) {
      resolve({ ok: false, text: '', segments: [], error: 'staging_failed', detail: e.message });
      return;
    }
    const args = [
      '-m', modelPath,
      '-f', input,
      '-l', language,
      '-t', String(threads),
      '--no-prints',
    ];
    const t0 = Date.now();
    const child = spawn(exe, args, { windowsHide: true, cwd: path.dirname(exe) });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: '', segments: [], error: 'spawn_failed', detail: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (staged) { try { rmSync(path.dirname(staged), { recursive: true, force: true }); } catch { /* ignore */ } }
      if (killed) {
        resolve({ ok: false, text: '', segments: [], error: 'timeout', tookMs: Date.now() - t0 });
        return;
      }
      const text = stdout
        .split(/\r?\n/)
        .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim())
        .filter((l) => l && !l.startsWith('whisper_') && !/^system_info/.test(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      resolve({
        ok: code === 0 && text.length > 0,
        text,
        raw: stdout.trim().slice(0, 4000),
        stderrTail: stderr.trim().slice(-500),
        durationMs: null,
        tookMs: Date.now() - t0,
        provider: 'whisper.cpp',
        model: path.basename(modelPath),
        exitCode: code,
      });
    });
  });
}

/** 直接对 PCM(Float32, 任意采样率) 做识别，内部临时落盘为 16k WAV */
export async function transcribeFloat32(float32, fromRate, opts = {}) {
  const pcm = float32ToPcm16(resample(float32, fromRate, 16000));
  const wav = pcm16ToWav(pcm, { sampleRate: 16000 });
  const dir = mkdtempSync(path.join(asciiScratchDir(), 'lingo-asr-'));
  const file = path.join(dir, 'turn.wav');
  writeFileSync(file, wav);
  try {
    const r = await transcribeWavFile(file, opts);
    return { ...r, samples: pcm.length / 2, audioSeconds: Number((pcm.length / 2 / 16000).toFixed(2)) };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function readWavAsFloat32(wavPath) {
  const buf = readFileSync(wavPath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('不是 WAV 文件');
  let offset = 12;
  let fmt = null;
  let dataOffset = null;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = Math.min(size, buf.length - body);
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || dataOffset === null) throw new Error('WAV 解析失败');
  const frameCount = Math.floor(dataSize / (fmt.channels * (fmt.bitsPerSample / 8)));
  const out = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    if (fmt.bitsPerSample === 16) out[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
    else out[i] = 0;
  }
  return { samples: out, sampleRate: fmt.sampleRate, channels: fmt.channels };
}
