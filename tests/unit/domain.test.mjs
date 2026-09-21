/**
 * 领域层单元测试（规则边界）。
 * 这些用例不依赖数据库与网络，用于锁定最容易回归的判定逻辑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addZonedDays, calendarDayDiff, dayKey, fixedClock, isoWeek, weekKeyOf, weekKeyToMonday, startOfZonedDay,
} from '../../packages/domain/src/time.js';
import { gradeSpelling, importanceOf, isHighFrequencyError, correctedMasteryPercent, normalizeAnswer, matchSynonymHint } from '../../packages/domain/src/words.js';
import { examScore, examPassed, examWindow, evaluateWeeklyState, settleWeekly } from '../../packages/domain/src/exam.js';
import { scoreSection, evaluateGateAttempt, checkLevelEligibility } from '../../packages/domain/src/gate.js';
import { mergeIntervals, unionLength, coverageRatio, validatePlaybackEvent, evaluateUnlock, detectNaturalEnd, mergeStudyInterval } from '../../packages/domain/src/playback.js';
import { buildLeaderboard, summarizeLedger } from '../../packages/domain/src/scoring.js';
import { day3DueAt, longTermDueAts, evaluateArchive, prioritizeRepairCandidates, allocateReviewBatch } from '../../packages/domain/src/scheduler.js';

const TZ = 'Asia/Shanghai';

test('时区：当地日历日加减与到期时刻', () => {
  const mon = new Date('2026-09-21T01:00:00+08:00'); // 周一
  assert.equal(dayKey(mon, TZ), '2026-09-21');
  assert.equal(dayKey(addZonedDays(mon, 3, TZ), TZ), '2026-09-24');
  // 当地 00:00 = 前一天 16:00Z
  assert.equal(addZonedDays(mon, 0, TZ).toISOString(), '2026-09-20T16:00:00.000Z');
  assert.equal(calendarDayDiff(mon, addZonedDays(mon, 3, TZ), TZ), 3);
});

test('时区：跨年 ISO 周与周考窗口', () => {
  const d = new Date('2026-12-31T12:00:00+08:00');
  const wk = weekKeyOf(d, TZ);
  assert.match(wk, /^\d{4}-W\d{2}$/);
  const w = examWindow('2026-W40', TZ);
  // 周日 00:00 开放；下周一 00:00 截止
  assert.equal(dayKey(w.openAt, TZ), '2026-10-04');
  assert.equal(dayKey(w.deadlineAt, TZ), '2026-10-05');
  assert.equal(weekKeyToMonday('2026-W40', TZ).toISOString(), '2026-09-27T16:00:00.000Z');
});

test('时钟可注入：固定时钟不会随真实时间漂移', () => {
  const c = fixedClock('2026-09-21T09:00:00+08:00', TZ);
  const t1 = c.now().getTime();
  c.advanceDays(3);
  assert.equal(calendarDayDiff(new Date(t1), c.now(), TZ), 3);
});

test('答案判定：大小写/空白/变体/词形/同义词', () => {
  const q = { acceptedAnswers: ['deposit'], answerCanonical: 'deposit' };
  assert.equal(gradeSpelling('  DEPOSIT  ', q).correct, true);
  assert.equal(gradeSpelling('deposit.', q).correct, false, '多余句点应判错');
  assert.equal(gradeSpelling('', q).correct, false);
  assert.equal(gradeSpelling('', q).reason, 'empty');

  const multi = { acceptedAnswers: ['deposit', 'deposits'], answerCanonical: 'deposit' };
  assert.equal(gradeSpelling('deposits', multi).correct, true, '显式声明的复数形式应判对');
  assert.equal(gradeSpelling('deposit', multi).correct, true);

  const pluralRequired = { acceptedAnswers: ['utilities'], answerCanonical: 'utilities' };
  assert.equal(gradeSpelling('utility', pluralRequired).correct, false);
  assert.equal(gradeSpelling('utility', pluralRequired).reason, 'wrong-form', '应为词形错误而非普通错误');

  const phrase = { acceptedAnswers: ['hang up'], answerCanonical: 'hang up' };
  assert.equal(gradeSpelling('hang-up', phrase).correct, true, '空格/连字符互换可容忍');
  assert.equal(gradeSpelling('hangup', phrase).correct, true);

  const withHint = { acceptedAnswers: ['book'], answerCanonical: 'book', synonymHints: [{ answers: ['reserve'], label: 'reserve' }] };
  assert.equal(gradeSpelling('reserve', withHint).correct, false, '同义词不能代替目标词');
  assert.equal(matchSynonymHint('reserve', withHint), 'reserve');
});

test('重要等级：0/1/2–3/4–6/≥7 五档', () => {
  assert.equal(importanceOf(0).label, '常规');
  assert.equal(importanceOf(1).label, '关注');
  assert.equal(importanceOf(3).label, '重点');
  assert.equal(importanceOf(4).label, '高频错');
  assert.equal(importanceOf(7).label, '顽固错');
  assert.equal(isHighFrequencyError(3), false, '3 次还未达到「超过三次」');
  assert.equal(isHighFrequencyError(4), true);
  assert.equal(correctedMasteryPercent(['a', 'b'], 20), 10);
  assert.equal(correctedMasteryPercent(Array.from({ length: 20 }, (_, i) => `w${i}`), 20), 100);
});

test('周考：分数边界与未取整判定', () => {
  assert.equal(examScore(59, 100), 59);
  assert.equal(examPassed(59.999), false, '59.999 不能四舍五入及格');
  assert.equal(examPassed(60), true);
  assert.equal(examPassed(60.0001), true);
  assert.equal(examScore(0, 0), null);
});

test('周考：窗口状态机与 N/A', () => {
  const win = examWindow('2026-W39', TZ);
  const before = new Date(win.openAt.getTime() - 3600_000);
  const during = new Date(win.openAt.getTime() + 3600_000);
  const after = new Date(win.deadlineAt.getTime() + 3600_000);

  const notOpen = evaluateWeeklyState({ weekKey: '2026-W39', now: before, timeZone: TZ, eligibleWordCount: 0 });
  assert.equal(notOpen.status, 'not_open', '窗口未开就是未开放，不是 N/A');

  const na = evaluateWeeklyState({ weekKey: '2026-W39', now: during, timeZone: TZ, eligibleWordCount: 0 });
  assert.equal(na.status, 'not_applicable');

  const open = evaluateWeeklyState({ weekKey: '2026-W39', now: during, timeZone: TZ, eligibleWordCount: 100 });
  assert.equal(open.status, 'open');

  const missed = evaluateWeeklyState({ weekKey: '2026-W39', now: after, timeZone: TZ, eligibleWordCount: 100 });
  assert.equal(missed.status, 'missed');
});

test('周考结算：扣分与返还各只一次', () => {
  const state = { status: 'failed', reason: 'failed_and_closed' };
  const first = settleWeekly({ state, existingPenalty: null });
  assert.equal(first.actions.filter((a) => a.type === 'deduct').length, 1);
  const second = settleWeekly({ state, existingPenalty: { refunded: false } });
  assert.equal(second.actions.length, 0, '已有罚分不再扣');

  const passed = { status: 'passed', reason: 'makeup_passed' };
  const refund = settleWeekly({ state: passed, existingPenalty: { refunded: false } });
  assert.equal(refund.actions.filter((a) => a.type === 'refund').length, 1);
  const refundAgain = settleWeekly({ state: passed, existingPenalty: { refunded: true } });
  assert.equal(refundAgain.actions.length, 0, '只返还一次');

  const firstPass = settleWeekly({ state: { status: 'passed', reason: 'first_pass' }, existingPenalty: null });
  assert.equal(firstPass.actions.length, 0, '首考直接通过没有凭空返还');
});

test('关卡：三项独立达标与边界', () => {
  assert.equal(scoreSection({ section: 'vocab', correct: 18, total: 20 }).passed, true);
  assert.equal(scoreSection({ section: 'vocab', correct: 17, total: 20 }).passed, false);
  assert.equal(scoreSection({ section: 'reading', correct: 8, total: 10 }).passed, true);
  assert.equal(scoreSection({ section: 'reading', correct: 7, total: 10 }).passed, false);
  assert.equal(scoreSection({ section: 'listening', correct: 8, total: 10 }).passed, true);
  assert.equal(scoreSection({ section: 'vocab', correct: 18, total: 19 }).passed, false, '题量不符应拒绝');

  const ok = evaluateGateAttempt({
    level: 1,
    vocab: { firstPassCorrect: 18, total: 20 },
    reading: { firstPassCorrect: 8, total: 10 },
    listening: { firstPassCorrect: 8, total: 10 },
    materials: { readingArticleId: 'r1', listeningArticleId: 'l1' },
  });
  assert.equal(ok.passed, true);
  assert.equal(ok.unlockedLevel, 2);

  const reuse = evaluateGateAttempt({
    level: 1,
    vocab: { firstPassCorrect: 20, total: 20 },
    reading: { firstPassCorrect: 10, total: 10 },
    listening: { firstPassCorrect: 10, total: 10 },
    materials: { readingArticleId: 'same', listeningArticleId: 'same' },
  });
  assert.equal(reuse.passed, false, '阅读与听力复用同一篇必须拒绝');

  const elig = checkLevelEligibility({ level: 1, completedGroupsInLevel: 9, requiredGroupsInLevel: 10, overdueReviewCount: 0 });
  assert.equal(elig.eligible, false);
  const elig2 = checkLevelEligibility({ level: 1, completedGroupsInLevel: 10, requiredGroupsInLevel: 10, overdueReviewCount: 1 });
  assert.equal(elig2.eligible, false);
  const elig3 = checkLevelEligibility({ level: 1, completedGroupsInLevel: 10, requiredGroupsInLevel: 10, overdueReviewCount: 0 });
  assert.equal(elig3.eligible, true);
});

test('播放：并集、覆盖率与解锁条件', () => {
  const merged = mergeIntervals([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 30, end: 40 }]);
  assert.deepEqual(merged, [{ start: 0, end: 15 }, { start: 30, end: 40 }]);
  assert.equal(unionLength(merged), 25);
  assert.equal(Math.round(coverageRatio(merged, 100) * 100), 25);

  // 拖到结尾：只有一个很短区间 → 覆盖率不足 → 不解锁
  const seekToEnd = [{ start: 98, end: 100 }];
  const r1 = evaluateUnlock({ intervals: seekToEnd, durationSeconds: 100, naturalEndEvidence: true });
  assert.equal(r1.unlocked, false);
  assert.equal(r1.reason, 'coverage_below_threshold');

  // 全覆盖但缺少自然结束证据 → 不解锁
  const full = [{ start: 0, end: 100 }];
  assert.equal(evaluateUnlock({ intervals: full, durationSeconds: 100, naturalEndEvidence: false }).unlocked, false);
  assert.equal(evaluateUnlock({ intervals: full, durationSeconds: 100, naturalEndEvidence: true }).unlocked, true);

  assert.equal(detectNaturalEnd([{ start: 90, end: 100 }], 100), true);
  assert.equal(detectNaturalEnd([{ start: 99.5, end: 100 }], 100), false, '瞬间跳到结尾不算自然结束');
});

test('播放事件校验：倍速与墙钟一致性，异常区间标待同步', () => {
  const now = Date.now();
  const ok = validatePlaybackEvent({ mediaStart: 0, mediaEnd: 10, rate: 1, wallStartMs: now - 10_000, wallEndMs: now }, now);
  assert.equal(ok.verified, true);

  // 2 倍速听完 10 秒音频，真实墙钟约 5 秒
  const fast = validatePlaybackEvent({ mediaStart: 0, mediaEnd: 10, rate: 2, wallStartMs: now - 5_000, wallEndMs: now }, now);
  assert.equal(fast.verified, true);
  assert.equal(Math.round(fast.expectedWallMs / 1000), 5, '倍速不放大时长');

  const bad = validatePlaybackEvent({ mediaStart: 0, mediaEnd: 10, rate: 1, wallStartMs: now - 600_000, wallEndMs: now }, now);
  assert.equal(bad.verified, false);
  assert.equal(bad.reason, 'wall_clock_mismatch_needs_sync');

  const future = validatePlaybackEvent({ mediaStart: 0, mediaEnd: 10, rate: 1, wallStartMs: now + 100_000, wallEndMs: now + 200_000 }, now);
  assert.equal(future.verified, false, '不能声称未来时间');

  const badRate = validatePlaybackEvent({ mediaStart: 0, mediaEnd: 10, rate: 1.7, wallStartMs: now - 10_000, wallEndMs: now }, now);
  assert.equal(badRate.reason, 'unsupported_rate');
});

test('学习时长：跨设备墙钟并集去重', () => {
  const a = { start: 1000, end: 5000 };
  const first = mergeStudyInterval([], a);
  assert.equal(first.addedSeconds, 4, '第一次计 4 秒');
  const overlapping = mergeStudyInterval(first.intervals, { start: 3000, end: 9000 });
  assert.equal(overlapping.addedSeconds, 4, '重叠部分不重复计');
  assert.equal(overlapping.totalSeconds, 8);
  const same = mergeStudyInterval(overlapping.intervals, { start: 1000, end: 9000 });
  assert.equal(same.addedSeconds, 0, '完全包含不新增');
});

test('排行榜：同分并列名次，时间不改变名次', () => {
  const rows = [
    { userId: 'a', displayName: 'A', points: 50, seconds: 100, level: 1 },
    { userId: 'b', displayName: 'B', points: 50, seconds: 9000, level: 1 },
    { userId: 'c', displayName: 'C', points: 10, seconds: 100, level: 2 },
  ];
  const board = buildLeaderboard(rows, { scope: 'week' });
  assert.equal(board[0].rank, 1);
  assert.equal(board[1].rank, 1, '同分并列第一');
  assert.equal(board[2].rank, 3, '并列后跳过名次');
});

test('积分流水：汇总与允许负余额', () => {
  const s = summarizeLedger([
    { points: 10, week_key: '2026-W39' },
    { points: -10, week_key: '2026-W39' },
    { points: 10, week_key: '2026-W40' },
  ]);
  assert.equal(s.total, 10);
  assert.equal(s.byWeek.get('2026-W39'), 0);
  const neg = summarizeLedger([{ points: -10, week_key: '2026-W39' }]);
  assert.equal(neg.total, -10, '余额允许为负，不截断归零');
});

test('调度：三日到期、长期抽查与归档', () => {
  const completed = new Date('2026-09-21T10:00:00+08:00');
  assert.equal(dayKey(day3DueAt(completed, TZ), TZ), '2026-09-24');

  const arches = longTermDueAts(new Date('2026-10-01T12:00:00+08:00'), TZ);
  assert.deepEqual(arches.map((d) => dayKey(d, TZ)), ['2026-10-15', '2026-10-31', '2026-11-30']);

  assert.equal(evaluateArchive({ day3ReviewCompletedAt: null, weeklyGroupReviewCompletedAt: new Date() }, TZ).archived, false);
  const a = evaluateArchive({
    day3ReviewCompletedAt: new Date('2026-09-28T10:00:00+08:00'),
    weeklyGroupReviewCompletedAt: new Date('2026-09-27T10:00:00+08:00'),
  }, TZ);
  assert.equal(a.archived, true);
  assert.equal(dayKey(a.archivedAt, TZ), '2026-09-28', '取两类复习完成的较晚日期');

  const now = new Date('2026-10-05T10:00:00+08:00');
  const ranked = prioritizeRepairCandidates([
    { wordId: 'normal', dueAt: new Date('2026-10-20T00:00:00+08:00'), recentWrongCount: 0, validWrongCount: 0 },
    { wordId: 'overdue', dueAt: new Date('2026-09-30T00:00:00+08:00'), recentWrongCount: 0, validWrongCount: 1 },
    { wordId: 'highfreq', dueAt: null, recentWrongCount: 0, validWrongCount: 5 },
  ], now, TZ);
  assert.equal(ranked[0].wordId, 'overdue', '逾期优先级最高');
  assert.equal(ranked[1].wordId, 'highfreq');

  const batch = allocateReviewBatch(['a', 'b', 'c', 'd'], new Set(['b']), 3);
  assert.deepEqual(batch.wordIds, ['a', 'c', 'd']);
  assert.equal(batch.complete, true);
  const short = allocateReviewBatch(['a'], new Set(), 20);
  assert.equal(short.complete, false, '不足 20 词不能冒充一整组奖励');
});
