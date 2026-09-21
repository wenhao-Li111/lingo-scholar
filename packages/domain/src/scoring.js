/**
 * 积分流水账（R05 / R06）。
 * 积分不可直接覆盖：只允许追加 ledger entry。余额允许为负。
 * week_key 归属决定周榜；退款归属原被扣周，不给当前周额外竞争积分。
 */

import { CONFIG, RULES_VERSION } from './config.js';
import { weekKeyOf } from './time.js';

export const LEDGER_REASONS = {
  LEARN_GROUP: 'learn_group',
  REVIEW_GROUP: 'review_group',
  WEEKLY_GROUP_REVIEW: 'weekly_group_review',
  WEEKLY_OLD_BATCH: 'weekly_old_batch',
  WEEKLY_PENALTY: 'weekly_penalty',
  WEEKLY_PENALTY_REFUND: 'weekly_penalty_refund',
  GATE_REWARD: 'gate_reward',
  ADMIN_ADJUST: 'admin_adjust',
};

/** 幂等键生成器 —— 所有正式奖励都必须带 key，数据库唯一约束兜底。 */
export const idempotencyKeys = {
  weeklyPenalty: (userId, groupId, weekKey) => `weekly-penalty:${userId}:${groupId}:${weekKey}`,
  weeklyPenaltyRefund: (userId, groupId, weekKey) => `weekly-penalty-refund:${userId}:${groupId}:${weekKey}`,
  learnGroup: (userId, groupId, groupCode) => `learn:${userId}:${groupId}:${groupCode}:${RULES_VERSION}`,
  day3Review: (userId, groupId, groupCode) => `review-d3:${userId}:${groupId}:${groupCode}`,
  weeklyGroupReview: (userId, groupId, groupCode, weekKey) => `weekly-group-review:${userId}:${groupId}:${groupCode}:${weekKey}`,
  weeklyOldBatch: (userId, groupId, batchId) => `weekly-old-batch:${userId}:${groupId}:${batchId}`,
  gateReward: (userId, groupId, level) => `gate:${userId}:${groupId}:L${level}`,
};

/**
 * 计算排行榜。同分并列名次；时间作为独立指标。
 * @param {Array<{userId:string, displayName:string, points:number, seconds:number, level:number, avatarSeed?:string}>} rows
 */
export function buildLeaderboard(rows, { scope = 'week', includeSeconds = true } = {}) {
  const sorted = [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.seconds !== a.seconds) return b.seconds - a.seconds;
    return String(a.userId).localeCompare(String(b.userId));
  });
  let rank = 0;
  let prevPoints = null;
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i];
    // 并列：只有积分相同才共享名次（时间只作为第二排序键，不改变名次）
    if (prevPoints === null || r.points !== prevPoints) {
      rank = i + 1;
      prevPoints = r.points;
    }
    out.push({
      rank,
      userId: r.userId,
      displayName: r.displayName,
      points: r.points,
      seconds: includeSeconds ? r.seconds : undefined,
      level: r.level,
      avatarSeed: r.avatarSeed ?? null,
      scope,
    });
  }
  return out;
}

/** 把流水按 week_key 汇总 */
export function summarizeLedger(entries) {
  let total = 0;
  const byWeek = new Map();
  for (const e of entries) {
    const v = Number(e.points) || 0;
    total += v;
    const wk = e.week_key || 'unknown';
    byWeek.set(wk, (byWeek.get(wk) || 0) + v);
  }
  return { total, byWeek };
}

export function weekScores(entries) {
  const map = new Map();
  for (const e of entries) {
    const wk = e.week_key || 'unknown';
    map.set(wk, (map.get(wk) || 0) + (Number(e.points) || 0));
  }
  return map;
}

export function ledgerEntry({ userId, groupId, points, reason, weekKey, note = null, refType = null, refId = null, createdAt }) {
  if (!Number.isInteger(points)) throw new Error('ledger points 必须为整数');
  if (!reason) throw new Error('ledger reason 必填');
  return {
    userId,
    groupId,
    points,
    reason,
    weekKey,
    note,
    refType,
    refId,
    createdAt,
  };
}

export function pointsForWeekOf(date, timeZone) {
  return weekKeyOf(date, timeZone);
}

/** 周复习完成后的奖励账面数字（用于 UI 展示与测试断言） */
export function weeklyGroupReviewReward() {
  return CONFIG.review.rewardPerSystemGroup;
}
