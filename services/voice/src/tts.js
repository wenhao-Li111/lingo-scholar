/**
 * 本地免费 TTS：Windows SAPI（Microsoft Zira Desktop, en-US）。
 * 事实：完全离线、零费用、无需密钥；输出为真实 WAV 文件，已解析时长与 sha256。
 * 未使用任何真人录音；所有音频在界面上都会标记为“合成语音”。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RUNTIME = process.env.LINGO_VOICE_HOME
  || path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'LingoScholar', 'voice');
const CACHE_DIR = path.join(RUNTIME, 'tts-cache');
const DEFAULT_VOICE = process.env.LINGO_TTS_VOICE || 'Microsoft Zira Desktop';

export function ttsCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  return CACHE_DIR;
}

export function parseWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let fmt = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataSize = Math.min(size, buffer.length - body);
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || dataSize === null) return null;
  const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  return { ...fmt, dataSize, durationSeconds: Number((dataSize / bytesPerSecond).toFixed(3)), bytesPerSecond };
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

let voiceProbe = null;

export async function ttsAvailability() {
  if (voiceProbe) return voiceProbe;
  const res = await runPowerShell(`
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { Write-Output ($_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture) }
`).catch((e) => ({ stdout: '', stderr: String(e) }));
  const voices = String(res.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [name, culture] = l.split('|'); return { name, culture }; });
  const english = voices.filter((v) => /en-/i.test(v.culture || ''));
  voiceProbe = {
    provider: 'windows-sapi',
    available: english.length > 0,
    offline: true,
    paid: false,
    human: false,
    voice: english[0]?.name || null,
    voices: english,
    note: english.length
      ? `使用本机 Windows SAPI 英文语音 ${english[0].name}（合成语音，非真人录音）。`
      : '未找到英文语音包，TTS 不可用（不会用静音文件冒充）。',
  };
  return voiceProbe;
}

export function resetTtsProbe() {
  voiceProbe = null;
}

/**
 * 合成一段文本到缓存文件。同样文本命中缓存直接复用。
 * @returns {{ ok:boolean, file?:string, url?:string, durationSeconds?:number, sha256?:string, voice?:string, cached?:boolean, error?:string }}
 */
export async function synthesizeToCache(text, { voice = DEFAULT_VOICE, rate = -1, prefix = 'tts' } = {}) {
  const clean = String(text || '').trim().slice(0, 1200);
  if (!clean) return { ok: false, error: 'empty_text' };
  const hash = crypto.createHash('sha256').update(`${voice}|${rate}|${clean}`).digest('hex').slice(0, 20);
  const dir = ttsCacheDir();
  const file = path.join(dir, `${prefix}-${hash}.wav`);
  if (existsSync(file) && statSync(file).size > 2000) {
    const parsed = parseWav(readFileSync(file));
    return { ok: true, file, url: `/media/tts/${path.basename(file)}`, durationSeconds: parsed?.durationSeconds ?? null, sha256: crypto.createHash('sha256').update(readFileSync(file)).digest('hex'), voice, cached: true };
  }
  const txtPath = path.join(dir, `${prefix}-${hash}.txt`);
  writeFileSync(txtPath, clean, 'utf8');
  const script = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = ${rate}
$available = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }
if ($available -contains '${voice}') { $synth.SelectVoice('${voice}') }
$text = [System.IO.File]::ReadAllText('${txtPath.replace(/\\/g, '\\\\')}', [System.Text.Encoding]::UTF8)
$synth.SetOutputToWaveFile('${file.replace(/\\/g, '\\\\')}')
$synth.Speak($text)
$synth.SetOutputToNull()
$synth.Dispose()
Write-Output 'OK'
`;
  const res = await runPowerShell(script);
  try { unlinkSync(txtPath); } catch { /* ignore */ }
  if (!existsSync(file) || statSync(file).size < 2000) {
    return { ok: false, error: 'tts_failed', detail: String(res.stderr).slice(0, 300), exitCode: res.code };
  }
  const buf = readFileSync(file);
  const parsed = parseWav(buf);
  return {
    ok: true,
    file,
    url: `/media/tts/${path.basename(file)}`,
    durationSeconds: parsed?.durationSeconds ?? null,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    voice,
    cached: false,
  };
}

/** 清理超过 maxAgeHours 的临时 TTS 缓存（默认 24 小时） */
export function cleanupTtsCache({ maxAgeHours = 24 } = {}) {
  const dir = ttsCacheDir();
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); removed += 1; }
    } catch { /* ignore */ }
  }
  return { removed, dir, maxAgeHours };
}
