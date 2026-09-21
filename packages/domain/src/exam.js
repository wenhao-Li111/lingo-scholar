/**
 * 周考规则（R04 / R05 / R06）—— 纯函数状态机，可在可注入时钟下测试。
 *
 * 时间轴（小组时区）：
 *   周一 00:00 ── 本周开始 ──── 周日 00:00 开考 ──── 下周一 00:00 截止
 *   注意：周考考核的是“本周（周一~周日）完成的词组”，截止在下一周周一 00:00。
 */

import { CONFIG } from './config.js';
import { addZonedDays, weekDeadline, weekExamOpen, weekKeyOf, weekKeyAdd } from './time.js';

export const EXAM_STATUS = {
  NOT_OPEN: 'not_open',
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  PASSED: 'passed',
  FAILED: 'failed',
  MISSED: 'missed',
  NOT_APPLICABLE: 'not_applicable',
  SETTLED_ABSENT: 'settled_absent',
};

/** 得分：正确数/题目数×100，保留未取整原值用于 >=60 判定 */
export function examScore(correctCount, questionCount) {
  if (!questionCount) return null;
  return (correctCount / questionCount) * 100;
}

export function examPassed(score) {
  if (score === null || score === undefined) return false;
  return score >= CONFIG.weekly.passPercent; // 59.999 不四舍五入
}

export function examWindow(weekKey, timeZone) {
  return {
    weekKey,
    openAt: weekExamOpen(weekKey, timeZone),
    deadlineAt: weekDeadline(weekKeyAdd(weekKey, 1, timeZone), timeZone),
  };
}

/**
 * 判定当前周考状态。
 * @param {object} p
 * @param {string} p.weekKey
 * @param {Date} p.now
 * @param {string} p.timeZone
 * @param {number} p.eligibleWordCount 本周可考词条数（新词 + carryover + 可考旧词）
 * @param {object|null} p.attempt 首考记录 { status, scorePercent, settledAt }
 * @param {object|null} p.makeup 补考记录 { scorePercent }
 */
export function evaluateWeeklyState({ weekKey, now, timeZone, eligibleWordCount, attempt, makeup }) {
  const win = examWindow(weekKey, timeZone);
  const beforeOpen = now.getTime() < win.openAt.getTime();
  const afterDeadline = now.getTime() >= win.deadlineAt.getTime();

  // 考试窗口尚未打开：不论有没有可考词，都是“未开放”
  if (beforeOpen) return { status: EXAM_STATUS.NOT_OPEN, ...win, reason: 'opens_sunday' };

  if (eligibleWordCount <= 0 && CONFIG.weekly.noEligibleWordsExempt) {
    return { status: EXAM_STATUS.NOT_APPLICABLE, ...win, reason: 'no_eligible_words' };
  }

  if (makeup && examPassed(makeup.scorePercent)) {
    return { status: EXAM_STATUS.PASSED, ...win, reason: 'makeup_passed', scorePercent: makeup.scorePercent };
  }
  if (attempt && attempt.status === EXAM_STATUS.PASSED) {
    return { status: EXAM_STATUS.PASSED, ...win, reason: 'first_pass', scorePercent: attempt.scorePercent };
  }
  if (attempt && attempt.status === EXAM_STATUS.IN_PROGRESS) {
    if (afterDeadline) return { status: EXAM_STATUS.MISSED, ...win, reason: 'deadline_passed_incomplete' };
    return { status: EXAM_STATUS.IN_PROGRESS, ...win, reason: 'attempt_in_progress' };
  }
  if (attempt && attempt.status === EXAM_STATUS.FAILED) {
    if (afterDeadline) return { status: EXAM_STATUS.FAILED, ...win, reason: 'failed_and_closed' };
    return { status: EXAM_STATUS.FAILED, ...win, reason: 'failed_awaiting_makeup', scorePercent: attempt.scorePercent };
  }
  if (afterDeadline) return { status: EXAM_STATUS.MISSED, ...win, reason: 'never_started' };
  return { status: EXAM_STATUS.OPEN, ...win, reason: 'window_open' };
}

/**
 * 结算决策：返回本周期应执行的账务动作（幂等，重复调用返回同样结果）。
 * @param {object} p
 * @param {object} p.state evaluateWeeklyState 的结果
 * @param {object|null} p.existingPenalty { refunded: boolean } | null
 * @param {number} p.penaltyAmount
 */
export function settleWeekly({ state, existingPenalty, penaltyAmount = CONFIG.weekly.deductOnFailureOrAbsence }) {
  const actions = [];
  const hasPenalty = Boolean(existingPenalty);
  const alreadyRefunded = Boolean(existingPenalty && existingPenalty.refunded);

  // 1) 首考直接不及格 → 立即扣分（状态已由调用方在交卷时处理；此处兜底补结算）
  const shouldDeductNow =
    (state.status === EXAM_STATUS.MISSED || state.status === EXAM_STATUS.SETTLED_ABSENT || state.status === EXAM_STATUS.FAILED)
    && CONFIG.weekly.deductAtMostOncePerUserWeek
    && !hasPenalty;

  if (shouldDeductNow) {
    actions.push({ type: 'deduct', amount: penaltyAmount, reason: 'weekly_failed_or_absent', idempotentBy: 'weekly_penalty' });
  }

  // 2) 补考通过 → 若本周被扣过分且尚未退款，返还一次
  const shouldRefund = state.status === EXAM_STATUS.PASSED
    && state.reason === 'makeup_passed'
    && hasPenalty
    && !alreadyRefunded;

  if (shouldRefund) {
    actions.push({ type: 'refund', amount: CONFIG.weekly.refundOnceOnMakeupPass, reason: 'makeup_passed', idempotentBy: 'weekly_penalty_refund' });
  }

  return { actions, idempotent: true };
}

/**
 * 冻结本周考试范围（R04）。
 * @returns {{ items: Array, frozenAt: Date, carryover: string[] }}
 */
export function composeExamScope({ completedGroupWordIds, oldWordIds, maxExtraOldWords = CONFIG.weekly.maxExtraOldWords, frozenAt }) {
  const seen = new Set();
  const items = [];
  for (const w of completedGroupWordIds) {
    if (seen.has(w)) continue;
    seen.add(w);
    items.push({ wordId: w, origin: 'new_this_week' });
  }
  let oldAdded = 0;
  for (const w of oldWordIds) {
    if (oldAdded >= maxExtraOldWords) break;
    if (seen.has(w)) continue;
    seen.add(w);
    items.push({ wordId: w, origin: 'old_high_error' });
    oldAdded += 1;
  }
  return { items, frozenAt, carryover: [] };
}

/**
 * 计算某用户在某周的可考范围。
 * carryover：上一周开考后新完成的词组，进入下一周。
 * @param {object} p
 */
export function eligibleWordsForWeek({ weekKey, completedGroups, frozenScopes, timeZone }) {
  const frozen = frozenScopes?.get(weekKey);
  if (frozen) return { wordIds: frozen.items.map((i) => i.wordId), frozen: true };

  const monday = weekExamOpen(weekKey, timeZone); // 周日开考；词范围按本周（周一~周日）完成
  const weekStart = addZonedDays(monday, -6, timeZone);
  const weekEnd = addZonedDays(monday, 1, timeZone);

  const inWeek = completedGroups.filter((g) => {
    const t = g.completedAt.getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });
  const ids = new Set();
  for (const g of inWeek) for (const w of g.wordIds) ids.add(w);
  return { wordIds: [...ids], frozen: false };
}

/** 当某词组完成周复习：需要 (a) 该词组所在周的周考或其补考 >=60；(b) 该词组 20 词在考后纠错中全部补齐 */
export function weeklyGroupReviewEligible({ examPassedForWeek, groupWordIds, weeklyReviewDemonstrated }) {
  if (!examPassedForWeek) return { eligible: false, reason: 'weekly_exam_not_passed' };
  const need = new Set(groupWordIds);
  const have = new Set(weeklyReviewDemonstrated);
  for (const w of need) if (!have.has(w)) return { eligible: false, reason: 'group_not_fully_corrected', missing: [...need].filter((x) => !have.has(x)) };
  return { eligible: true, reason: 'ok' };
}

export function currentWeekKey(now, timeZone) {
  return weekKeyOf(now, timeZone);
}
