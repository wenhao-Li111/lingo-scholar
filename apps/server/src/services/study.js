/**
 * 播放、解锁与有效学习时间（R09 / A06）。
 * 服务端是唯一权威：客户端上报的区间必须通过校验，且时间以墙钟并集去重。
 */

import { all, get, jsonParse, nowIso, run, tx, uuid } from '../db.js';
import {
  CONFIG, detectNaturalEnd, mergeIntervals, mergeStudyInterval, unionLength, validatePlaybackEvent, evaluateUnlock, dayKey,
  weekKeyOf,
} from '@lingo/domain';

/** 读取用户在某媒体上的播放覆盖（媒体时间轴） */
export function mediaCoverage(userId, mediaId) {
  const row = get('SELECT * FROM user_media_coverage WHERE user_id = ? AND media_id = ?', [userId, mediaId]);
  if (!row) return { intervals: [], naturalEnd: false };
  return { intervals: jsonParse(row.intervals_json, []), naturalEnd: Boolean(row.natural_end) };
}

export function articleState(userId, articleId) {
  const row = get('SELECT * FROM user_article_states WHERE user_id = ? AND article_id = ?', [userId, articleId]);
  return row || null;
}

/**
 * 记录一次播放事件。返回 { verified, addedSeconds, unlocked, coverage }。
 * 关键：mergeStudyInterval 保证同一用户多设备同时听不会被重复计时。
 */
export function recordPlayback({ userId, mediaId, articleId, event, now = new Date(), timeZone = 'Asia/Shanghai', allowThirdParty = false }) {
  const media = get('SELECT * FROM media_assets WHERE id = ?', [mediaId]);
  if (!media) throw Object.assign(new Error('媒体不存在'), { status: 404, code: 'MEDIA_NOT_FOUND' });
  if (event.clientEventId) {
    const dup = get('SELECT * FROM playback_events WHERE client_event_id = ?', [event.clientEventId]);
    if (dup) return { duplicate: true, verified: Boolean(dup.verified), addedSeconds: 0 };
  }

  const v = validatePlaybackEvent(event, now.getTime());
  const result = { verified: v.verified, reason: v.reason, addedSeconds: 0, unlocked: false, coverage: 0, naturalEnd: false };

  tx(() => {
    run(
      `INSERT INTO playback_events (id, user_id, media_id, article_id, media_start, media_end, rate, wall_start_ms, wall_end_ms,
         verified, reason, added_seconds, client_event_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      [uuid('pb'), userId, mediaId, articleId || media.article_id, Number(event.mediaStart), Number(event.mediaEnd),
        Number(event.rate) || 1, v.wallStartMs, v.wallEndMs, v.verified ? 1 : 0, v.reason, event.clientEventId || null, nowIso()],
    );
  });

  // 媒体覆盖（只要区间合法就记录，用于解锁判定；未通过墙钟校验的区间标记待确认，不计入学习时长）
  const cov = mediaCoverage(userId, mediaId);
  const newInterval = { start: Number(event.mediaStart), end: Number(event.mediaEnd) };
  const merged = mergeIntervals([...cov.intervals, newInterval]);
  const naturalEnd = cov.naturalEnd || detectNaturalEnd(merged, media.duration_seconds);

  tx(() => {
    run(
      `INSERT INTO user_media_coverage (user_id, media_id, intervals_json, natural_end, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, media_id) DO UPDATE SET intervals_json=excluded.intervals_json,
         natural_end=excluded.natural_end, updated_at=excluded.updated_at`,
      [userId, mediaId, JSON.stringify(merged), naturalEnd ? 1 : 0, nowIso()],
    );
  });

  // 学习时长：仅统计通过校验的区间
  if (v.verified) {
    const existing = all('SELECT start_ms, end_ms FROM study_intervals WHERE user_id = ?', [userId])
      .map((r) => ({ start: Number(r.start_ms), end: Number(r.end_ms) }));
    const incoming = { start: v.wallStartMs, end: v.wallEndMs };
    const mergedTime = mergeStudyInterval(existing, incoming);
    if (mergedTime.addedSeconds > 0) {
      tx(() => {
        run('DELETE FROM study_intervals WHERE user_id = ?', [userId]);
        for (const iv of mergedTime.intervals) {
          run(
            'INSERT INTO study_intervals (id, user_id, start_ms, end_ms, source, day_key) VALUES (?,?,?,?,?,?)',
            [uuid('si'), userId, Math.round(iv.start), Math.round(iv.end), 'playback', dayKey(new Date(iv.start), timeZone)],
          );
        }
      });
    }
    result.addedSeconds = mergedTime.addedSeconds;
    result.totalStudySeconds = mergedTime.totalSeconds;
  }

  const cov2 = mediaCoverage(userId, mediaId);
  const unlockEval = evaluateUnlock({
    intervals: cov2.intervals,
    durationSeconds: media.duration_seconds,
    naturalEndEvidence: cov2.naturalEnd,
  });
  result.coverage = unlockEval.coverage;
  result.unlockReason = unlockEval.reason;
  result.naturalEnd = cov2.naturalEnd;

  if (unlockEval.unlocked) {
    const st = articleState(userId, media.article_id);
    if (!st?.unlocked_at) {
      tx(() => {
        run(
          `INSERT INTO user_article_states (user_id, article_id, unlocked_at, unlock_evidence, last_position_seconds, last_rate, updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(user_id, article_id) DO UPDATE SET unlocked_at=excluded.unlocked_at,
             unlock_evidence=excluded.unlock_evidence, updated_at=excluded.updated_at`,
          [userId, media.article_id, nowIso(),
            JSON.stringify({ coverage: unlockEval.coverage, naturalEnd: cov2.naturalEnd, threshold: unlockEval.threshold }),
            Number(event.mediaEnd) || 0, Number(event.rate) || 1, nowIso()],
        );
      });
      result.unlocked = true;
      result.unlockedAt = nowIso();
    } else {
      result.unlocked = true;
      result.alreadyUnlocked = true;
    }
  }
  return result;
}

export function saveArticlePosition({ userId, articleId, positionSeconds, rate }) {
  run(
    `INSERT INTO user_article_states (user_id, article_id, unlocked_at, last_position_seconds, last_rate, updated_at)
     VALUES (?,?,NULL,?,?,?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET last_position_seconds=excluded.last_position_seconds,
       last_rate=excluded.last_rate, updated_at=excluded.updated_at`,
    [userId, articleId, Number(positionSeconds) || 0, Number(rate) || 1, nowIso()],
  );
}

/** 学习时长统计（按天，按小组时区） */
export function studyTimeSummary(userId, timeZone, { days = 14 } = {}) {
  const rows = all('SELECT start_ms, end_ms, day_key FROM study_intervals WHERE user_id = ? ORDER BY start_ms', [userId]);
  const byDay = new Map();
  let total = 0;
  for (const r of rows) {
    const s = (Number(r.end_ms) - Number(r.start_ms)) / 1000;
    total += s;
    byDay.set(r.day_key, (byDay.get(r.day_key) || 0) + s);
  }
  const today = dayKey(new Date(), timeZone);
  return {
    totalSeconds: Math.round(total),
    todaySeconds: Math.round(byDay.get(today) || 0),
    days: [...byDay.entries()].sort().slice(-days).map(([k, v]) => ({ dayKey: k, seconds: Math.round(v) })),
    method: 'wall_clock_union_per_user（跨设备去重；暂停/缓冲/闲置不计）',
  };
}

export function weekStudySeconds(userId, weekKey, timeZone) {
  const rows = all('SELECT start_ms, end_ms FROM study_intervals WHERE user_id = ?', [userId]);
  let total = 0;
  for (const r of rows) {
    const d = new Date(Number(r.start_ms));
    const wk = weekKeyOf(d, timeZone);
    if (wk === weekKey) total += (Number(r.end_ms) - Number(r.start_ms)) / 1000;
  }
  return Math.round(total);
}

export function playbackPolicy() {
  return {
    rates: [...CONFIG.listening.playbackRates],
    coverageUnlockRatio: CONFIG.listening.coverageUnlockRatio,
    requireNaturalEndEvidence: CONFIG.listening.requireNaturalEndEvidence,
    hideEnglishFirstPass: CONFIG.listening.hideEnglishFirstPass,
    hideChineseFirstPass: CONFIG.listening.hideChineseFirstPass,
    hideGlossaryFirstPass: CONFIG.listening.hideGlossaryFirstPass,
    timeUnit: CONFIG.listening.timeUnit,
    note: '倍速只改变覆盖速度，不放大学习时长；时长按真实经过的墙钟时间计算。',
  };
}
