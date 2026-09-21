/**
 * 复习调度（R03 / R06 / R07）。
 * 所有日期都按小组时区的日历日计算，不用固定毫秒差。
 */

import { CONFIG } from './config.js';
import { addZonedDays, calendarDayDiff, dayKey, startOfZonedDay } from './time.js';

/** 三日复习到期时刻：完成日 D（当地日历日）+ 3 天的当地 00:00 */
export function day3DueAt(completedAt, timeZone) {
  return addZonedDays(completedAt, CONFIG.review.firstDueCalendarDays, timeZone);
}

/** 长期抽查到期时刻列表：归档日 A + [14, 30, 60] 的当地 00:00 */
export function longTermDueAts(archivedAt, timeZone) {
  return CONFIG.review.longTermDaysAfterArchive.map((d) => addZonedDays(archivedAt, d, timeZone));
}

/**
 * 归档判定：三日复习与周复习都完成后，取较晚者为归档日 A。
 * @returns {{ archived: boolean, archivedAt: Date|null, reason: string }}
 */
export function evaluateArchive({ day3ReviewCompletedAt, weeklyGroupReviewCompletedAt }, timeZone) {
  if (!day3ReviewCompletedAt || !weeklyGroupReviewCompletedAt) {
    return { archived: false, archivedAt: null, reason: 'waiting_both_reviews' };
  }
  const a = day3ReviewCompletedAt.getTime() >= weeklyGroupReviewCompletedAt.getTime()
    ? day3ReviewCompletedAt
    : weeklyGroupReviewCompletedAt;
  return { archived: true, archivedAt: startOfZonedDay(a, timeZone), reason: 'both_reviews_done' };
}

/**
 * 判断一个词组的复习任务当前状态。
 * @param {object} p
 * @param {Date} p.completedAt 词组学习完成时刻
 * @param {Date|null} p.day3ReviewCompletedAt
 * @param {Date|null} p.weeklyGroupReviewCompletedAt
 */
export function groupReviewState(p, now, timeZone) {
  const due = day3DueAt(p.completedAt, timeZone);
  const archive = evaluateArchive(
    { day3ReviewCompletedAt: p.day3ReviewCompletedAt, weeklyGroupReviewCompletedAt: p.weeklyGroupReviewCompletedAt },
    timeZone,
  );
  const overdue = !p.day3ReviewCompletedAt && now.getTime() >= due.getTime();
  return {
    day3DueAt: due,
    day3Due: !p.day3ReviewCompletedAt && now.getTime() >= due.getTime(),
    /** 已到期但未完成 —— 用于“开始新任务前必须补做”的门禁 */
    overdue,
    /** 尚未到期 —— 不阻止晋级（R08） */
    pendingFuture: !p.day3ReviewCompletedAt && now.getTime() < due.getTime(),
    archived: archive.archived,
    archivedAt: archive.archivedAt,
    longTerm: archive.archived
      ? longTermDueAts(archive.archivedAt, timeZone).map((d) => ({ dueAt: d, due: now.getTime() >= d.getTime() }))
      : [],
  };
}

/**
 * 待办优先级排序（R07）：逾期 > 近期错误 > 历史高频错 > 正常到期。
 * 返回排序后的修复候选，保证同日不为同一个词并行安排两个奖励任务。
 */
export function prioritizeRepairCandidates(candidates, now, timeZone) {
  const scored = candidates.map((c) => {
    const isOverdue = c.dueAt && now.getTime() >= c.dueAt.getTime();
    const recentWrong = c.recentWrongCount || 0;
    const historicalWrong = c.validWrongCount || 0;
    const daysOverdue = c.dueAt ? Math.max(0, calendarDayDiff(c.dueAt, now, timeZone)) : 0;
    let bucket = 4;
    if (isOverdue) bucket = 1;
    else if (recentWrong > 0) bucket = 2;
    else if (historicalWrong >= CONFIG.vocabulary.highErrorMinimumWrongSubmissions) bucket = 3;
    return { ...c, bucket, daysOverdue, recentWrong, historicalWrong };
  });
  scored.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.bucket === 1 && b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
    if (b.recentWrong !== a.recentWrong) return b.recentWrong - a.recentWrong;
    if (b.historicalWrong !== a.historicalWrong) return b.historicalWrong - a.historicalWrong;
    return String(a.wordId).localeCompare(String(b.wordId));
  });
  return scored;
}

/**
 * 生成“服务端分配”的复习批次（每组 20 词）。同一个到期词不能被分配进两个同轮奖励任务。
 * @param {string[]} pool 候选 wordId（已排序去重）
 * @param {Set<string>} inFlight 已被其它进行中奖励任务占用的 wordId
 */
export function allocateReviewBatch(pool, inFlight = new Set(), size = CONFIG.plan.newWordGroupSize) {
  const picked = [];
  for (const id of pool) {
    if (inFlight.has(id)) continue;
    picked.push(id);
    if (picked.length >= size) break;
  }
  return { wordIds: picked, complete: picked.length >= size, skipped: picked.length < size ? size - picked.length : 0 };
}

export function describeSchedule(now, timeZone) {
  return {
    timeZone,
    today: dayKey(now, timeZone),
    day3OffsetDays: CONFIG.review.firstDueCalendarDays,
    longTermOffsets: [...CONFIG.review.longTermDaysAfterArchive],
  };
}
