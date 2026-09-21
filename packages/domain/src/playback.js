/**
 * 播放覆盖、解锁与学习时长（R09 / A06）。
 *
 * 核心原则：
 *  - 解锁 = 真实连续播放区间的并集覆盖率 >= 98%，且有自然播放结束证据。
 *    拖到结尾触发 ended 不能解锁，因为并集覆盖率不足。
 *  - 学习时长 = 同一用户“墙钟播放区间”的并集；两个设备同时听不双倍累计。
 *  - 倍速不放大时长：时长只按真实经过的墙钟时间。
 *  - 无法核实的异常区间标为待同步/待确认，不伪造精确计时。
 */

import { CONFIG } from './config.js';

/** 合并重叠区间（输入 [{start,end}] 秒或毫秒，单位自洽） */
export function mergeIntervals(intervals) {
  const arr = intervals
    .filter((i) => i && Number.isFinite(Number(i.start)) && Number.isFinite(Number(i.end)))
    .map((i) => ({ start: Number(i.start), end: Number(i.end) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const cur of arr) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end + 0.001) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function unionLength(intervals) {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.end - i.start), 0);
}

export function coverageRatio(intervals, durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  const covered = unionLength(intervals);
  return Math.min(1, covered / durationSeconds);
}

/**
 * 校验一条客户端上报的播放事件。
 * 客户端上报：{ mediaStart, mediaEnd, rate, wallStartMs, wallEndMs, ended }
 * @returns {{ verified:boolean, reason:string, wallStartMs:number, wallEndMs:number, mediaDelta:number, expectedWallMs:number }}
 */
export function validatePlaybackEvent(event, nowMs) {
  const cfg = CONFIG.listening;
  const rate = Number(event.rate) || 1;
  const mediaStart = Number(event.mediaStart);
  const mediaEnd = Number(event.mediaEnd);
  let wallStartMs = Number(event.wallStartMs);
  let wallEndMs = Number(event.wallEndMs);

  if (!Number.isFinite(mediaStart) || !Number.isFinite(mediaEnd) || mediaEnd <= mediaStart) {
    return { verified: false, reason: 'invalid_media_range', wallStartMs, wallEndMs, mediaDelta: 0, expectedWallMs: 0 };
  }
  if (!cfg.playbackRates.includes(rate)) {
    return { verified: false, reason: 'unsupported_rate', wallStartMs, wallEndMs, mediaDelta: mediaEnd - mediaStart, expectedWallMs: 0 };
  }
  const now = Number(nowMs);
  const skewMs = 30_000;
  if (!Number.isFinite(wallStartMs) || !Number.isFinite(wallEndMs)) {
    return { verified: false, reason: 'missing_wall_clock', wallStartMs, wallEndMs, mediaDelta: mediaEnd - mediaStart, expectedWallMs: 0 };
  }
  // 服务端钳制：不能声称未来时间，也不能声称异常久远
  if (wallEndMs > now + skewMs) wallEndMs = now;
  const earliest = now - cfg.maxPlausibleEventSeconds * 1000;
  if (wallStartMs < earliest) wallStartMs = earliest;
  if (wallEndMs <= wallStartMs) {
    return { verified: false, reason: 'empty_wall_range', wallStartMs, wallEndMs, mediaDelta: mediaEnd - mediaStart, expectedWallMs: 0 };
  }

  const mediaDelta = mediaEnd - mediaStart;
  const expectedWallMs = (mediaDelta / rate) * 1000;
  const actualWallMs = wallEndMs - wallStartMs;
  const lo = expectedWallMs * 0.5 - 1500;
  const hi = expectedWallMs * 2.0 + 3000;

  if (actualWallMs < lo || actualWallMs > hi) {
    // 可能是锁屏后被暂停的页面脚本导致上报不精确 —— 标为待确认，不据此加分，也不据此判罚
    return { verified: false, reason: 'wall_clock_mismatch_needs_sync', wallStartMs, wallEndMs, mediaDelta, expectedWallMs };
  }
  return { verified: true, reason: 'ok', wallStartMs, wallEndMs, mediaDelta, expectedWallMs };
}

/**
 * 首听解锁判定。
 * @param {object} p
 * @param {Array<{start:number,end:number}>} p.intervals 已通过校验的媒体播放区间（秒，媒体时间轴）
 * @param {number} p.durationSeconds
 * @param {boolean} p.naturalEndEvidence 是否有“正常播放到结尾”的证据（区间末段是真实播放而非 seek）
 * @param {boolean} p.firstPass
 */
export function evaluateUnlock({ intervals, durationSeconds, naturalEndEvidence }) {
  const ratio = coverageRatio(intervals, durationSeconds);
  const threshold = CONFIG.listening.coverageUnlockRatio;
  if (ratio + 1e-9 < threshold) {
    return { unlocked: false, coverage: ratio, reason: 'coverage_below_threshold', threshold };
  }
  if (CONFIG.listening.requireNaturalEndEvidence && !naturalEndEvidence) {
    return { unlocked: false, coverage: ratio, reason: 'missing_natural_end_evidence', threshold };
  }
  return { unlocked: true, coverage: ratio, reason: 'ok', threshold };
}

/**
 * 检查是否存在自然结束证据：至少一个区间真实覆盖到接近结尾，且不是“瞬间跳到结尾”。
 * 要求该区间自身长度 >= min(5s, 8% 时长)，且速率与墙钟一致（由调用方传入 verified 区间）。
 */
export function detectNaturalEnd(intervals, durationSeconds) {
  if (!durationSeconds) return false;
  const minTailLength = Math.min(5, durationSeconds * 0.08);
  const tailStart = durationSeconds - Math.max(1.5, minTailLength);
  return intervals.some((i) => i.end >= durationSeconds - 0.75 && i.end - i.start >= minTailLength && i.start <= tailStart);
}

/**
 * 把新的墙钟区间并入用户已有区间集合，返回新增的“净新时长”。
 * 用于跨设备去重：两个设备同时听 10 分钟，只增加 10 分钟。
 *
 * 单位约定：输入为**毫秒**（与 playback_events 的 wall_start_ms/wall_end_ms 一致）。
 * 同时返回毫秒与秒两种口径，避免调用方把毫秒当成秒（曾因此出过 1000 倍误差）。
 */
export function mergeStudyInterval(existingMs, incomingMs) {
  const before = unionLength(existingMs);
  const merged = mergeIntervals([...existingMs, incomingMs]);
  const after = unionLength(merged);
  const addedMs = Math.max(0, after - before);
  return {
    intervals: merged,
    addedMs,
    addedSeconds: addedMs / 1000,
    totalMs: after,
    totalSeconds: after / 1000,
  };
}

export function describePlaybackPolicy() {
  return {
    rates: [...CONFIG.listening.playbackRates],
    coverageUnlockRatio: CONFIG.listening.coverageUnlockRatio,
    requireNaturalEndEvidence: CONFIG.listening.requireNaturalEndEvidence,
    timeUnit: CONFIG.listening.timeUnit,
    lockedScreenAudioCounts: CONFIG.listening.lockedScreenAudioTimeCounts,
  };
}
