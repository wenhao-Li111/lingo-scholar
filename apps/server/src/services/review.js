/**
 * 复习与周考（R03 / R04 / R05 / R06 / R07）。
 * 所有到期判断都基于小组时区的日历日；测试时通过可注入时钟（server.clock）驱动。
 */

import { all, get, jsonParse, nowIso, run, tx, uuid } from '../db.js';
import {
  CONFIG, examPassed, examScore, examWindow, evaluateWeeklyState, settleWeekly, weekKeyOf, weekKeyAdd,
  calendarDayDiff, EXAM_STATUS,
} from '@lingo/domain';
import { buildQuestionPlan, sanitizeQuestion, awardPoints, scheduleDay3Review, maybeArchive, weekKeyFor } from './learning.js';
import { getGroup } from '../content.js';

/* ---------------------------- 到期检查 ---------------------------- */

export function overdueReviews(userId, now) {
  const rows = all(
    `SELECT r.*, g.title AS group_title FROM review_tasks r JOIN word_groups g ON g.id = r.group_id
     WHERE r.user_id = ? AND r.status = 'pending' AND r.due_at <= ? ORDER BY r.due_at ASC`,
    [userId, now.toISOString()],
  );
  return rows;
}

export function upcomingReviews(userId, now) {
  return all(
    `SELECT r.*, g.title AS group_title FROM review_tasks r JOIN word_groups g ON g.id = r.group_id
     WHERE r.user_id = ? AND r.status = 'pending' AND r.due_at > ? ORDER BY r.due_at ASC`,
    [userId, now.toISOString()],
  );
}

/** 新建词组的门禁：存在到期复习时不允许开始新组（R03） */
export function canStartNewWords(userId, now) {
  const overdue = overdueReviews(userId, now);
  if (overdue.length) {
    return { allowed: false, code: 'OVERDUE_REVIEWS', overdue };
  }
  return { allowed: true, overdue: [] };
}

export function startReviewTask({ userId, reviewTaskId }) {
  const rv = get('SELECT * FROM review_tasks WHERE id = ? AND user_id = ?', [reviewTaskId, userId]);
  if (!rv) throw Object.assign(new Error('复习任务不存在'), { status: 404 });
  if (rv.status === 'completed') throw Object.assign(new Error('该复习已完成'), { status: 409, code: 'ALREADY_DONE' });
  const taskType = rv.kind === 'day3' ? 'day3_review' : 'long_term';
  const attempt = Number(get(`SELECT COUNT(*) AS c FROM learning_tasks WHERE user_id=? AND group_id=? AND task_type=?`, [userId, rv.group_id, taskType]).c) + 1;
  return { reviewTask: rv, taskType, attempt };
}

/* ---------------------------- 周考 ---------------------------- */

export function weekKeyNow(now, timeZone) {
  return weekKeyOf(now, timeZone);
}

export function examStateFor({ userId, groupId, timeZone, now }) {
  const weekKey = weekKeyNow(now, timeZone);
  const row = get('SELECT * FROM weekly_exams WHERE user_id = ? AND group_id = ? AND week_key = ?', [userId, groupId, weekKey]);
  const eligible = eligibleWordIds({ userId, groupId, weekKey, timeZone });
  const attempt = row ? get(`SELECT * FROM exam_attempts WHERE exam_id = ? AND kind='first' ORDER BY attempt_no DESC LIMIT 1`, [row.id]) : null;
  const makeup = row ? get(`SELECT * FROM exam_attempts WHERE exam_id = ? AND kind='makeup' ORDER BY score_percent DESC LIMIT 1`, [row.id]) : null;
  const state = evaluateWeeklyState({
    weekKey, now, timeZone,
    eligibleWordCount: eligible.length,
    attempt: attempt ? { status: attemptStatus(attempt, row), scorePercent: attempt.score_percent } : null,
    makeup: makeup ? { scorePercent: makeup.score_percent } : null,
  });
  return { weekKey, row, eligible, state, window: examWindow(weekKey, timeZone), attempt, makeup };
}

function attemptStatus(attempt, examRow) {
  if (attempt.submitted_at) {
    if (attempt.passed) return EXAM_STATUS.PASSED;
    return EXAM_STATUS.FAILED;
  }
  if (examRow && examRow.status === 'missed') return EXAM_STATUS.MISSED;
  return EXAM_STATUS.IN_PROGRESS;
}

/** 本周可考词：本周完成的词组 + 上次开考后新完成的 carryover + 最多 20 个历史高频错词 */
export function eligibleWordIds({ userId, groupId, weekKey, timeZone }) {
  const frozen = get('SELECT * FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?', [userId, groupId, weekKey]);
  if (frozen && frozen.scope_json && frozen.scope_json !== '{}') {
    const scope = jsonParse(frozen.scope_json, {});
    if (scope.items?.length) return scope.items.map((i) => i.wordId);
  }
  const win = examWindow(weekKey, timeZone);
  const weekStart = new Date(win.openAt.getTime() - 6 * 86400000);
  const weekEnd = win.deadlineAt;
  const groups = all(
    `SELECT * FROM learning_tasks WHERE user_id=? AND task_type='new_words' AND status='completed' AND completed_at IS NOT NULL
       AND completed_at >= ? AND completed_at < ?`,
    [userId, weekStart.toISOString(), weekEnd.toISOString()],
  );
  const ids = [];
  const seen = new Set();
  // carryover：上周开考后完成的词组
  const carry = get(
    `SELECT scope_json FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?`,
    [userId, groupId, weekKeyAdd(weekKey, -1, timeZone)],
  );
  if (carry) {
    const prev = jsonParse(carry.scope_json, {});
    for (const c of prev.carryover || []) if (!seen.has(c)) { seen.add(c); ids.push(c); }
  }
  for (const g of groups) {
    for (const item of getGroup(g.group_id)?.words || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      ids.push(item.id);
    }
  }
  // 历史高频错词（最多 20 个，不足不虚构填充）
  const highErr = all(
    `SELECT word_id, valid_wrong_count FROM word_progress
     WHERE user_id=? AND valid_wrong_count >= ? ORDER BY valid_wrong_count DESC LIMIT ?`,
    [userId, CONFIG.vocabulary.highErrorMinimumWrongSubmissions, CONFIG.weekly.maxExtraOldWords],
  );
  const oldIds = [];
  for (const h of highErr) {
    if (seen.has(h.word_id)) continue;
    seen.add(h.word_id);
    oldIds.push(h.word_id);
  }
  return [...ids, ...oldIds];
}

export function startWeeklyExam({ userId, groupId, timeZone, now, kind = 'first' }) {
  const weekKey = weekKeyNow(now, timeZone);
  const win = examWindow(weekKey, timeZone);
  if (now.getTime() < win.openAt.getTime()) {
    throw Object.assign(new Error('周考在周日 00:00 才开放'), { status: 409, code: 'EXAM_NOT_OPEN' });
  }
  return tx(() => {
    let row = get('SELECT * FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?', [userId, groupId, weekKey]);
    const eligible = eligibleWordIds({ userId, groupId, weekKey, timeZone });
    if (eligible.length === 0 && CONFIG.weekly.noEligibleWordsExempt) {
      if (!row) {
        const id = uuid('we');
        run(
          `INSERT INTO weekly_exams (id, user_id, group_id, week_key, status, opened_at, scope_json, question_count)
           VALUES (?,?,?,?,?,?,?,0)`,
          [id, userId, groupId, weekKey, EXAM_STATUS.NOT_APPLICABLE, now.toISOString(), JSON.stringify({ items: [] })],
        );
        row = get('SELECT * FROM weekly_exams WHERE id = ?', [id]);
      }
      return { exam: row, state: { status: EXAM_STATUS.NOT_APPLICABLE }, questions: [], notApplicable: true };
    }
    if (!row) {
      const id = uuid('we');
      const scope = {
        items: eligible.map((w) => ({ wordId: w, origin: 'new_or_old' })),
        frozenAt: now.toISOString(),
        ruleVersion: 'rules-v1',
      };
      run(
        `INSERT INTO weekly_exams (id, user_id, group_id, week_key, status, opened_at, frozen_at, scope_json, question_count)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, userId, groupId, weekKey, EXAM_STATUS.IN_PROGRESS, now.toISOString(), now.toISOString(), JSON.stringify(scope), eligible.length],
      );
      row = get('SELECT * FROM weekly_exams WHERE id = ?', [id]);
    }
    const attemptNo = Number(get('SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id=? AND kind=?', [row.id, kind]).c) + 1;
    if (kind === 'first' && attemptNo > 1) {
      throw Object.assign(new Error('首考只能进行一次'), { status: 409, code: 'FIRST_ATTEMPT_EXISTS' });
    }
    const scope = jsonParse(row.scope_json, { items: [] });
    const words = scope.items.map((i) => getWord(i.wordId)).filter(Boolean);
    const orderSeed = `${row.id}:${kind}:${attemptNo}`;
    const plan = buildQuestionPlan(words, orderSeed).map((p) => ({ ...p, wordId: p.wordId }));
    const attemptId = uuid('ea');
    run(
      `INSERT INTO exam_attempts (id, exam_id, kind, attempt_no, started_at, question_count, answers_json, order_seed)
       VALUES (?,?,?,?,?,?,?,?)`,
      [attemptId, row.id, kind, attemptNo, nowIso(), plan.length, JSON.stringify(plan), orderSeed],
    );
    run('UPDATE weekly_exams SET status = ? WHERE id = ?', [EXAM_STATUS.IN_PROGRESS, row.id]);
    return {
      exam: get('SELECT * FROM weekly_exams WHERE id = ?', [row.id]),
      attempt: get('SELECT * FROM exam_attempts WHERE id = ?', [attemptId]),
      questions: plan.map((p, i) => sanitizeQuestion(p, i, { phase: kind })),
      deadlineAt: win.deadlineAt,
    };
  });
}

function getWord(wordId) {
  const row = get('SELECT * FROM words WHERE id = ?', [wordId]);
  if (!row) return null;
  return {
    id: row.id,
    lemma: row.lemma,
    partOfSpeech: row.part_of_speech,
    coreMeaningZh: row.core_meaning_zh,
    acceptedSpellings: all(`SELECT form FROM word_forms WHERE word_id=? AND kind IN ('canonical','spelling_variant')`, [wordId]).map((r) => r.form),
    inflections: all(`SELECT form FROM word_forms WHERE word_id=? AND kind='inflection'`, [wordId]).map((r) => r.form),
    cloze: jsonParse(row.cloze_json, {}),
  };
}

export function resumeWeeklyExam({ userId, groupId, timeZone, now }) {
  const weekKey = weekKeyNow(now, timeZone);
  const row = get('SELECT * FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?', [userId, groupId, weekKey]);
  if (!row) return null;
  const attempt = get(`SELECT * FROM exam_attempts WHERE exam_id=? AND submitted_at IS NULL ORDER BY attempt_no DESC LIMIT 1`, [row.id]);
  if (!attempt) return null;
  const plan = jsonParse(attempt.answers_json, []);
  return {
    exam: row,
    attempt,
    questions: plan.map((p, i) => sanitizeQuestion(p, i, { phase: attempt.kind })),
    resumed: true,
  };
}

export function submitWeeklyExam({ userId, groupId, timeZone, now, kind = 'first', answers }) {
  const weekKey = weekKeyNow(now, timeZone);
  const row = get('SELECT * FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?', [userId, groupId, weekKey]);
  if (!row) throw Object.assign(new Error('尚未开始周考'), { status: 409, code: 'EXAM_NOT_STARTED' });
  const attempt = get(
    `SELECT * FROM exam_attempts WHERE exam_id=? AND kind=? AND submitted_at IS NULL ORDER BY attempt_no DESC LIMIT 1`,
    [row.id, kind],
  );
  if (!attempt) throw Object.assign(new Error('没有进行中的试卷'), { status: 409, code: 'NO_ACTIVE_ATTEMPT' });
  return tx(() => {
    const plan = jsonParse(attempt.answers_json, []);
    let correct = 0;
    const detail = [];
    const results = [];
    for (const [i, item] of plan.entries()) {
      const submitted = answers?.[i] ?? answers?.[item.wordId] ?? null;
      const got = gradeExamAnswer(submitted, item);
      if (got.correct) correct += 1;
      detail.push({
        index: i,
        wordId: item.wordId,
        submitted: submitted === null || submitted === undefined ? '' : String(submitted).slice(0, 80),
        correct: got.correct,
        answer: item.answerCanonical,
      });
      results.push({ wordId: item.wordId, correct: got.correct });
    }
    const total = plan.length;
    const score = examScore(correct, total);
    const passed = examPassed(score);
    run(
      `UPDATE exam_attempts SET submitted_at=?, correct_count=?, score_percent=?, passed=?, answers_json=? WHERE id=?`,
      [nowIso(), correct, score, passed ? 1 : 0, JSON.stringify(plan), attempt.id],
    );
    for (const r of results) {
      run(
        `INSERT OR REPLACE INTO exam_word_results (id, exam_id, attempt_id, word_id, origin, is_correct)
         VALUES (?,?,?,?,?,?)`,
        [uuid('ewr'), row.id, attempt.id, r.wordId, 'new_or_old', r.correct ? 1 : 0],
      );
    }
    const newStatus = passed ? EXAM_STATUS.PASSED : EXAM_STATUS.FAILED;
    run(
      `UPDATE weekly_exams SET status=?, correct_count=?, score_percent=?,
         first_score_percent = CASE WHEN ? = 'first' THEN ? ELSE first_score_percent END,
         best_makeup_score = CASE WHEN ? = 'makeup' THEN MAX(COALESCE(best_makeup_score,-1), ?) ELSE best_makeup_score END,
         makeup_count = CASE WHEN ? = 'makeup' THEN makeup_count + 1 ELSE makeup_count END,
         settled_at = ?
       WHERE id=?`,
      [newStatus, correct, score, kind, score, kind, score, kind, nowIso(), row.id],
    );

    let ledger = null;
    if (!passed) {
      ledger = applyPenaltyIfNeeded({ userId, groupId, weekKey, now, timeZone, reason: 'weekly_failed' });
    } else {
      ledger = refundIfEligible({ userId, groupId, weekKey, now, timeZone, kind });
    }
    return {
      score,
      correct,
      total,
      passed,
      detail,
      penaltyRefunded: Boolean(ledger && ledger.refunded),
      penaltyApplied: Boolean(ledger && ledger.applied),
      exam: get('SELECT * FROM weekly_exams WHERE id=?', [row.id]),
    };
  });
}

export function gradeExamAnswer(submitted, planItem) {
  if (submitted === null || submitted === undefined) return { correct: false };
  const norm = String(submitted).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const accepted = (planItem.acceptedAnswers || []).map((a) => String(a).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase());
  return { correct: accepted.includes(norm) && norm.length > 0 };
}

/* ------------------------- 罚分与退款（幂等） ------------------------- */

export function applyPenaltyIfNeeded({ userId, groupId, weekKey, now, timeZone, reason = 'weekly_failed_or_absent' }) {
  const key = `weekly-penalty:${userId}:${groupId}:${weekKey}`;
  const existing = get('SELECT * FROM points_ledger WHERE idempotency_key = ?', [key]);
  if (existing) return { applied: false, duplicate: true };
  const id = uuid('p');
  run(
    `INSERT INTO points_ledger (id, user_id, group_id, points, reason, week_key, note, ref_type, ref_id, idempotency_key, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, groupId, -Math.abs(CONFIG.weekly.deductOnFailureOrAbsence), 'weekly_penalty', weekKey,
      `第 ${weekKey} 周周考未通过或未参加`, 'weekly_exam', `${userId}:${groupId}:${weekKey}`, key, now.toISOString()],
  );
  run(`UPDATE weekly_exams SET penalty_applied = 1 WHERE user_id=? AND group_id=? AND week_key=?`, [userId, groupId, weekKey]);
  return { applied: true, points: -CONFIG.weekly.deductOnFailureOrAbsence, weekKey };
}

export function refundIfEligible({ userId, groupId, weekKey, now, kind }) {
  if (kind !== 'makeup') return null;
  const penalty = get('SELECT * FROM points_ledger WHERE idempotency_key = ?', [`weekly-penalty:${userId}:${groupId}:${weekKey}`]);
  if (!penalty) return null;
  const refundKey = `weekly-penalty-refund:${userId}:${groupId}:${weekKey}`;
  const existing = get('SELECT * FROM points_ledger WHERE idempotency_key = ?', [refundKey]);
  if (existing) return { refunded: false, duplicate: true };
  const id = uuid('p');
  run(
    `INSERT INTO points_ledger (id, user_id, group_id, points, reason, week_key, note, ref_type, ref_id, idempotency_key, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, groupId, CONFIG.weekly.refundOnceOnMakeupPass, 'weekly_penalty_refund', weekKey,
      `补考通过，返还第 ${weekKey} 周扣分`, 'weekly_exam', penalty.id, refundKey, now.toISOString()],
  );
  run(`UPDATE weekly_exams SET penalty_refunded = 1 WHERE user_id=? AND group_id=? AND week_key=?`, [userId, groupId, weekKey]);
  return { refunded: true, points: CONFIG.weekly.refundOnceOnMakeupPass, weekKey };
}

/* ------------------------- 定时结算（幂等） ------------------------- */

/**
 * 结算所有已经截止的周。
 * 触发点：进程启动、每次读账本、以及定时任务。重复调用不会重复扣分。
 */
export function settleClosedWeeks({ now = new Date() } = {}) {
  const users = all('SELECT u.id, m.group_id, g.timezone FROM users u JOIN memberships m ON m.user_id = u.id AND m.left_at IS NULL JOIN study_groups g ON g.id = m.group_id');
  const actions = [];
  for (const u of users) {
    const tz = u.timezone || 'Asia/Shanghai';
    const currentWeek = weekKeyNow(now, tz);
    for (let i = 1; i <= 4; i += 1) {
      const weekKey = weekKeyAdd(currentWeek, -i, tz);
      const win = examWindow(weekKey, tz);
      if (now.getTime() < win.deadlineAt.getTime()) continue;
      const settled = settleHistoricalWeek({ userId: u.id, groupId: u.group_id, weekKey, timeZone: tz, now });
      if (settled) actions.push(settled);
    }
  }
  return actions;
}

export function settleHistoricalWeek({ userId, groupId, weekKey, timeZone, now }) {
  const committedAt = now > new Date() ? now : now;
  const row = get('SELECT * FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?', [userId, groupId, weekKey]);
  const eligible = eligibleWordIds({ userId, groupId, weekKey, timeZone });
  if (eligible.length === 0 && CONFIG.weekly.noEligibleWordsExempt) {
    return null;
  }
  const passed = row && (row.status === EXAM_STATUS.PASSED || (row.best_makeup_score ?? -1) >= CONFIG.weekly.passPercent);
  if (passed) return null;
  const attempt = row ? get(`SELECT * FROM exam_attempts WHERE exam_id=? AND kind='first' ORDER BY attempt_no DESC LIMIT 1`, [row.id]) : null;
  const makeup = row ? get(`SELECT * FROM exam_attempts WHERE exam_id=? AND kind='makeup' AND passed=1 LIMIT 1`, [row.id]) : null;
  const state = evaluateWeeklyState({
    weekKey, now, timeZone, eligibleWordCount: eligible.length,
    attempt: attempt ? { status: attemptStatus(attempt, row), scorePercent: attempt.score_percent } : null,
    makeup: makeup ? { scorePercent: makeup.score_percent } : null,
  });
  const decision = settleWeekly({ state, existingPenalty: row?.penalty_applied ? { refunded: Boolean(row.penalty_refunded) } : null });
  const out = { weekKey, userId, actions: [] };
  for (const action of decision.actions) {
    if (action.type === 'deduct') {
      const r = applyPenaltyIfNeeded({ userId, groupId, weekKey, now: committedAt, timeZone, reason: action.reason });
      if (r.applied) out.actions.push('deduct');
    } else if (action.type === 'refund') {
      const r = refundIfEligible({ userId, groupId, weekKey, now: committedAt, timeZone, kind: 'makeup' });
      if (r && r.refunded) out.actions.push('refund');
    }
  }
  if (row && !passed && row.status === EXAM_STATUS.IN_PROGRESS) {
    run(`UPDATE weekly_exams SET status = ? WHERE id = ?`, [EXAM_STATUS.MISSED, row.id]);
  }
  return out.actions.length ? out : null;
}

/* ------------------------- 周复习（R06） ------------------------- */

/**
 * 周复习任务：某词组组的周考（含补考）>=60，且该组 20 词在考后纠错中全部补齐，才 +10 一次。
 */
export function evaluateWeeklyGroupReview({ userId, groupId, weekKey, timeZone }) {
  const exam = get('SELECT * FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?', [userId, groupId, weekKey]);
  const passed = Boolean(exam && (exam.status === EXAM_STATUS.PASSED || (exam.best_makeup_score ?? -1) >= CONFIG.weekly.passPercent));
  if (!passed) return { eligible: false, reason: 'weekly_exam_not_passed' };
  const group = getGroup(groupId);
  if (!group) return { eligible: false, reason: 'group_not_found' };
  const wordIds = group.words.map((w) => w.id);
  const repaired = all(
    `SELECT DISTINCT r.word_id FROM exam_word_results r
     JOIN exam_attempts a ON a.id = r.attempt_id
     WHERE r.exam_id = ? AND (r.is_correct = 1 OR r.repaired_at IS NOT NULL)`,
    [exam.id],
  ).map((r) => r.word_id);
  const missing = wordIds.filter((w) => !repaired.includes(w));
  return { eligible: missing.length === 0, missing, reason: missing.length ? 'group_not_fully_corrected' : 'ok' };
}

export function completeWeeklyGroupReview({ userId, groupId, weekKey, timeZone, now = new Date() }) {
  const check = evaluateWeeklyGroupReview({ userId, groupId, weekKey, timeZone });
  if (!check.eligible) return { completed: false, ...check };
  const key = `weekly-group-review:${userId}:${groupId}:${weekKey}`;
  const awarded = awardPoints({
    userId, points: CONFIG.weekly.groupReviewBonus, reason: 'weekly_group_review',
    idempotencyKey: key, refType: 'weekly_exam', refId: `${userId}:${groupId}:${weekKey}`,
    note: `完成 ${groupId} 周复习（周考通过 + 20 词全部补齐）`, at: now, timeZone,
  });
  run(
    `INSERT INTO review_tasks (id, user_id, group_id, kind, due_at, sequence_no, status, created_at, completed_at, corrected_mastery)
     VALUES (?,?,?,?,?,1,'completed',?,?,100)
     ON CONFLICT(user_id, group_id, kind, sequence_no) DO UPDATE SET status='completed', completed_at=excluded.completed_at`,
    [uuid('rv'), userId, groupId, 'weekly_group', now.toISOString(), nowIso(), now.toISOString()],
  );
  maybeArchive({ userId, groupId, timeZone, at: now });
  return { completed: true, awarded };
}

/** 用户在周考交卷后做“错题补齐”，作为周复习的取证材料 */
export function repairExamWord({ userId, examId, wordId }) {
  const row = get('SELECT * FROM exam_word_results WHERE exam_id=? AND word_id=?', [examId, wordId]);
  if (!row) return { repaired: false, reason: 'not_in_scope' };
  run('UPDATE exam_word_results SET repaired_at=? WHERE id=?', [nowIso(), row.id]);
  return { repaired: true };
}

export function weeklyGroupReviewStatus(userId, groupId, timeZone, now) {
  const weekKey = weekKeyNow(now, timeZone);
  return evaluateWeeklyGroupReview({ userId, groupId, weekKey, timeZone });
}

export function describeReviewSchedule(now, timeZone) {
  return {
    today: now.toISOString(),
    weekKey: weekKeyNow(now, timeZone),
    window: examWindow(weekKeyNow(now, timeZone), timeZone),
    day3Offset: CONFIG.review.firstDueCalendarDays,
    longTermOffsets: CONFIG.review.longTermDaysAfterArchive,
    archiveAfter: CONFIG.review.archiveAfter,
    daysUntilDeadline: calendarDayDiff(now, examWindow(weekKeyNow(now, timeZone), timeZone).deadlineAt, timeZone),
  };
}

export { scheduleDay3Review, weekKeyFor };
