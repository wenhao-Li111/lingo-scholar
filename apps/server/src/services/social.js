/**
 * 小组、排行榜与邀请（R10）。
 * 同分并列名次；时间作为独立指标；绝不伪造好友数据。
 */

import { all, get, nowIso, run, tx, uuid } from '../db.js';
import { buildLeaderboard, weekKeyOf, CONFIG } from '@lingo/domain';
import { studyTimeSummary, weekStudySeconds } from './study.js';

export function currentWeekKeyFor(timeZone) {
  return weekKeyOf(new Date(), timeZone);
}

export function leaderboard({ groupId, timeZone, scope = 'week' }) {
  const members = all(
    `SELECT u.id, u.display_name, u.level, u.avatar_seed FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.left_at IS NULL`,
    [groupId],
  );
  const weekKey = currentWeekKeyFor(timeZone);
  const rows = members.map((m) => {
    const ledger = all('SELECT points, week_key FROM points_ledger WHERE user_id = ?', [m.id]);
    let points = 0;
    for (const l of ledger) {
      if (scope === 'week' && l.week_key !== weekKey) continue;
      points += Number(l.points) || 0;
    }
    const seconds = scope === 'week' ? weekStudySeconds(m.id, weekKey, timeZone) : studyTimeSummary(m.id, timeZone).totalSeconds;
    return { userId: m.id, displayName: m.display_name, points, seconds, level: m.level, avatarSeed: m.avatar_seed };
  });
  return {
    scope,
    weekKey,
    timeZone,
    generatedAt: nowIso(),
    refreshTargetSeconds: CONFIG.social.leaderboardRefreshTargetSeconds,
    rows: buildLeaderboard(rows, { scope }),
    emptyState: rows.length === 0,
  };
}

export function groupSummary({ groupId, userId, timeZone }) {
  const members = all(
    `SELECT u.id, u.display_name, u.level, u.avatar_seed FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.left_at IS NULL ORDER BY m.joined_at`,
    [groupId],
  );
  const weekKey = currentWeekKeyFor(timeZone);
  const brief = members.map((m) => {
    const pts = all('SELECT points, week_key FROM points_ledger WHERE user_id = ?', [m.id]);
    let week = 0;
    let total = 0;
    for (const p of pts) {
      total += Number(p.points) || 0;
      if (p.week_key === weekKey) week += Number(p.points) || 0;
    }
    return {
      userId: m.id,
      displayName: m.display_name,
      level: m.level,
      avatarSeed: m.avatar_seed,
      weekPoints: week,
      totalPoints: total,
      weekSeconds: weekStudySeconds(m.id, weekKey, timeZone),
      isMe: m.id === userId,
    };
  });
  brief.sort((a, b) => b.weekPoints - a.weekPoints);
  return { groupId, weekKey, memberCount: members.length, maxMembers: CONFIG.product.maxGroupMembers, members: brief };
}

export function totalPoints(userId) {
  const row = get('SELECT COALESCE(SUM(points),0) AS s FROM points_ledger WHERE user_id = ?', [userId]);
  return Number(row.s) || 0;
}

export function ledger(userId, { limit = 50 } = {}) {
  return all(
    `SELECT points, reason, week_key, note, created_at FROM points_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export function userRank(userId, groupId, timeZone) {
  const board = leaderboard({ groupId, timeZone, scope: 'week' });
  const mine = board.rows.find((r) => r.userId === userId);
  return { rank: mine?.rank ?? null, total: board.rows.length, points: mine?.points ?? 0 };
}

/* ----------------------------- 小组管理 ----------------------------- */

export function ensureDefaultGroup({ ownerUserId, name = '我的学习小组', timeZone = 'Asia/Shanghai' }) {
  const existing = get(
    `SELECT g.* FROM study_groups g JOIN memberships m ON m.group_id = g.id WHERE m.user_id = ? AND m.left_at IS NULL LIMIT 1`,
    [ownerUserId],
  );
  if (existing) return existing;
  return tx(() => {
    const id = uuid('grp');
    run('INSERT INTO study_groups (id, name, timezone, owner_user_id, created_at) VALUES (?,?,?,?,?)', [id, name, timeZone, ownerUserId, nowIso()]);
    run('INSERT INTO memberships (id, user_id, group_id, role, joined_at) VALUES (?,?,?,?,?)', [uuid('mb'), ownerUserId, id, 'owner', nowIso()]);
    return get('SELECT * FROM study_groups WHERE id = ?', [id]);
  });
}

export function userPrimaryGroup(userId) {
  return get(
    `SELECT g.*, m.role AS member_role FROM study_groups g JOIN memberships m ON m.group_id = g.id
     WHERE m.user_id = ? AND m.left_at IS NULL ORDER BY m.joined_at LIMIT 1`,
    [userId],
  );
}

export function joinGroup({ userId, invite }) {
  return tx(() => {
    const count = Number(get('SELECT COUNT(*) AS c FROM memberships WHERE group_id = ? AND left_at IS NULL', [invite.group_id]).c);
    if (count >= CONFIG.product.maxGroupMembers) {
      throw Object.assign(new Error('该小组已达 10 人上限'), { status: 409, code: 'GROUP_FULL' });
    }
    const existing = get('SELECT * FROM memberships WHERE user_id = ? AND group_id = ?', [userId, invite.group_id]);
    if (existing && !existing.left_at) return { joined: false, alreadyMember: true, groupId: invite.group_id };
    if (existing) {
      run('UPDATE memberships SET left_at = NULL, joined_at = ? WHERE id = ?', [nowIso(), existing.id]);
      return { joined: true, rejoined: true, groupId: invite.group_id };
    }
    run('INSERT INTO memberships (id, user_id, group_id, role, joined_at) VALUES (?,?,?,?,?)', [uuid('mb'), userId, invite.group_id, 'member', nowIso()]);
    const g = get('SELECT * FROM study_groups WHERE id = ?', [invite.group_id]);
    run('UPDATE users SET timezone = ? WHERE id = ? AND plan_started_at IS NULL', [g.timezone, userId]);
    return { joined: true, groupId: invite.group_id };
  });
}

export function listInvites(groupId) {
  return all(
    `SELECT i.*, u.display_name AS creator FROM invites i JOIN users u ON u.id = i.created_by
     WHERE i.group_id = ? ORDER BY i.created_at DESC`,
    [groupId],
  ).map((i) => ({
    id: i.id,
    note: i.note,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    maxUses: i.max_uses,
    uses: i.uses,
    revoked: Boolean(i.revoked_at),
    creator: i.creator,
    status: i.revoked_at ? 'revoked' : (Date.parse(i.expires_at) < Date.now() ? 'expired' : (i.uses >= i.max_uses ? 'used' : 'active')),
  }));
}
