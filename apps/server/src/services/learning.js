/**
 * 词汇学习状态机（R01 / R02）。
 *
 * 关键约束：
 *  - 首测保存 first_pass_correct，永不被 100% 覆盖。
 *  - 只有服务端确认的“无提示正确回忆”才计入 demonstrated。
 *  - 展示答案后至少间隔 2 个其它条目才能再次无提示作答。
 *  - 学习奖励只发一次（幂等键 + 数据库唯一约束）。
 */

import crypto from 'node:crypto';
import { all, get, jsonParse, nowIso, run, tx, uuid } from '../db.js';
import { gradeSpelling, matchSynonymHint, normalizeAnswer, importanceOf } from '@lingo/domain';
import { CONFIG, RULES_VERSION, COURSE_VERSION, day3DueAt } from '@lingo/domain';
import { getGroup, hydrateWord } from '../content.js';

const POS_LABEL = {
  noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', preposition: '介词',
  conjunction: '连词', pronoun: '代词', phrase: '短语', interjection: '感叹词', determiner: '限定词',
};

export function seedFrom(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

/** 由种子决定题型的确定性洗牌 */
function shuffled(arr, seed) {
  const out = [...arr];
  let s = parseInt(seed.slice(0, 8), 16) || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 生成 20 题计划：12 题“中文释义 → 英文”，8 题“句子缺词 + 中文提示” */
export function buildQuestionPlan(words, seed) {
  const order = shuffled(words.map((w) => w.id), seed);
  const clozeCount = 8;
  const clozeIds = new Set(words.filter((w) => w.cloze?.en).map((w) => w.id));
  const byId = new Map(words.map((w) => [w.id, w]));

  const clozeCandidates = order.filter((id) => clozeIds.has(id));
  const chosenCloze = new Set(clozeCandidates.slice(0, clozeCount));

  return order.map((wordId) => {
    const w = byId.get(wordId);
    if (chosenCloze.has(wordId)) {
      return {
        wordId,
        type: 'cloze',
        prompt: w.cloze.en,
        hintZh: w.cloze.hintZh,
        acceptedAnswers: [w.cloze.answer],
        answerCanonical: w.cloze.answer,
        synonymHints: [],
      };
    }
    return {
      wordId,
      type: 'definition',
      prompt: w.coreMeaningZh,
      hintZh: `词性：${POS_LABEL[w.partOfSpeech] || w.partOfSpeech}｜请拼写本组目标英文词`,
      acceptedAnswers: [...(w.acceptedSpellings || [w.lemma])],
      answerCanonical: w.lemma,
      synonymHints: (w.confusionPairs || []).map((c) => ({ answers: [c.word], label: c.word })),
    };
  }).filter(Boolean);
}

/** 客户端可见的题目（绝不包含答案） */
export function sanitizeQuestion(planItem, index, meta = {}) {
  if (!planItem) return null;
  return {
    index,
    wordId: planItem.wordId,
    type: planItem.type,
    prompt: planItem.prompt,
    hintZh: planItem.hintZh,
    hint: planItem.hint || null,
    lemmaLength: planItem.answerCanonical ? planItem.answerCanonical.length : undefined,
    ...meta,
  };
}

export function isValidTaskId(id) {
  return typeof id === 'string' && /^t_[0-9a-f-]+$/i.test(id);
}

/* ------------------------------------------------------------------ */
/*                            任务读取                                  */
/* ------------------------------------------------------------------ */

export function loadTask(taskId, userId) {
  const t = get('SELECT * FROM learning_tasks WHERE id = ?', [taskId]);
  if (!t) return null;
  if (userId && t.user_id !== userId) {
    throw Object.assign(new Error('无权访问该任务'), { status: 403, code: 'FORBIDDEN' });
  }
  return t;
}

export function taskView(task, userId) {
  const plan = jsonParse(task.question_plan_json, []);
  const state = jsonParse(task.remediation_state_json, {});
  const attempts = all('SELECT * FROM answer_attempts WHERE task_id = ? ORDER BY created_at ASC', [task.id]);
  const answeredIndexes = new Set(attempts.filter((a) => a.phase === 'first_test').map((a) => Number(a.index_in_plan ?? -1)));
  const demonstrated = new Set(state.demonstrated || []);
  const group = getGroup(task.group_id);

  let currentQuestion = null;
  let phase = task.status;

  if (task.status === 'first_test') {
    const idx = plan.findIndex((_, i) => !answeredIndexes.has(i));
    if (idx >= 0) {
      currentQuestion = sanitizeQuestion(plan[idx], idx, { phase: 'first_test', position: idx + 1, total: plan.length });
    }
  } else if (task.status === 'remediation') {
    const queue = state.queue || [];
    if (queue.length) {
      const item = plan.find((p) => p.wordId === queue[0]);
      const wrongCount = wrongCountsFor(task.id, userId);
      currentQuestion = sanitizeQuestion(
        item ? { ...item, type: 'definition', prompt: definitionPrompt(item.wordId, group), hintZh: '补测：请再次拼写这个目标词' } : null,
        -1,
        { phase: 'remediation', queueRemaining: queue.length, wordImportance: importanceOf(wrongCount.get(queue[0]) || 0).label },
      );
    }
  }

  return {
    id: task.id,
    groupId: task.group_id,
    groupTitle: group?.title ?? null,
    taskType: task.task_type,
    status: task.status,
    attemptNo: task.attempt_no,
    createdAt: task.created_at,
    completedAt: task.completed_at,
    firstPassCorrect: task.first_pass_correct,
    firstPassTotal: task.first_pass_total,
    correctedMastery: task.corrected_mastery,
    progress: {
      answered: answeredIndexes.size,
      total: plan.length,
      demonstrated: demonstrated.size,
      demonstratedTotal: 20,
    },
    wrongWordIds: (state.wrongOrder || []),
    currentQuestion,
    /** 首测尚未作答时附带预习词表，避免前端再发一次请求（也保证弱网下界面可用） */
    previewWords: (task.status === 'first_test' && answeredIndexes.size === 0 && group)
      ? group.words.map((w) => ({
        id: w.id, lemma: w.lemma, partOfSpeech: w.partOfSpeech, coreMeaningZh: w.coreMeaningZh,
        phonetic: w.phonetic, collocations: w.collocations, confusionPairs: w.confusionPairs,
        cloze: w.cloze, topic: w.topic, level: w.level,
      }))
      : null,
    ruleVersion: task.rule_version,
    courseVersion: task.course_version,
  };
}

function definitionPrompt(wordId, group) {
  const w = group?.words.find((x) => x.id === wordId);
  if (!w) return '';
  return `${w.coreMeaningZh}（${POS_LABEL[w.partOfSpeech] || w.partOfSpeech}）`;
}

export function wrongCountsFor(taskId, userId) {
  const rows = all(
    `SELECT word_id, COUNT(*) AS c FROM answer_attempts
     WHERE task_id = ? AND user_id = ? AND is_correct = 0 AND reason NOT IN ('network_error','asr_error','system_error')
     GROUP BY word_id`,
    [taskId, userId],
  );
  return new Map(rows.map((r) => [r.word_id, Number(r.c)]));
}

/* ------------------------------------------------------------------ */
/*                          任务创建                                    */
/* ------------------------------------------------------------------ */

export function createLearningTask({ userId, groupId, taskType = 'new_words', attemptNo = 1, seed = null }) {
  const group = getGroup(groupId);
  if (!group) throw Object.assign(new Error('词组不存在或尚未发布'), { status: 404, code: 'GROUP_NOT_FOUND' });
  if (group.words.length !== 20) throw Object.assign(new Error('该词组内容不完整，不能开始学习'), { status: 409, code: 'GROUP_INCOMPLETE' });

  return tx(() => {
    const existing = get(
      'SELECT * FROM learning_tasks WHERE user_id = ? AND group_id = ? AND task_type = ? AND attempt_no = ?',
      [userId, groupId, taskType, attemptNo],
    );
    if (existing) return existing;

    const s = seed || `${userId}:${groupId}:${taskType}:${attemptNo}:${RULES_VERSION}`;
    const plan = buildQuestionPlan(group.words, seedFrom(s));
    const id = uuid('t');
    run(
      `INSERT INTO learning_tasks (id, user_id, group_id, task_type, status, attempt_no, created_at, started_at,
         first_pass_total, question_plan_json, remediation_state_json, rule_version, course_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, userId, groupId, taskType, 'first_test', attemptNo, nowIso(), nowIso(), plan.length, JSON.stringify(plan), JSON.stringify({ queue: [], answerShownAt: {}, counter: 0, demonstrated: [], wrongOrder: [] }), RULES_VERSION, COURSE_VERSION],
    );
    // 标记词项进入学习
    for (const w of group.words) {
      run(
        `INSERT INTO word_progress (user_id, word_id, group_id, first_seen_at, demonstrated_count, valid_wrong_count, independent_failed, correct_streak)
         VALUES (?,?,?,?,0,0,0,0)
         ON CONFLICT(user_id, word_id) DO UPDATE SET group_id = excluded.group_id,
           first_seen_at = COALESCE(word_progress.first_seen_at, excluded.first_seen_at)`,
        [userId, w.id, groupId, nowIso()],
      );
    }
    return get('SELECT * FROM learning_tasks WHERE id = ?', [id]);
  });
}

/** 当前应学习的下一个词组（按级别顺序，跳过已完成） */
export function nextGroupForUser(userId, level) {
  const done = new Set(
    all(`SELECT group_id FROM learning_tasks WHERE user_id = ? AND task_type = 'new_words' AND status = 'completed'`, [userId]).map((r) => r.group_id),
  );
  const groups = all('SELECT * FROM word_groups WHERE level = ? AND editorial_status = ? ORDER BY idx', [level, 'published']);
  return groups.find((g) => !done.has(g.id)) || null;
}

/* ------------------------------------------------------------------ */
/*                        提交答案与状态推进                             */
/* ------------------------------------------------------------------ */

export function submitAnswer({ taskId, userId, answer, clientRequestId, index = null, now = null }) {
  const task = loadTask(taskId, userId);
  if (!task) throw Object.assign(new Error('任务不存在'), { status: 404, code: 'TASK_NOT_FOUND' });
  if (task.status === 'completed') {
    return { alreadyCompleted: true, task: taskView(task, userId) };
  }
  if (clientRequestId) {
    const dup = get('SELECT * FROM answer_attempts WHERE client_request_id = ?', [clientRequestId]);
    if (dup) {
      return { duplicate: true, task: taskView(task, userId), previous: { correct: Boolean(dup.is_correct), reason: dup.reason } };
    }
  }

  const plan = jsonParse(task.question_plan_json, []);
  const state = jsonParse(task.remediation_state_json, { queue: [], answerShownAt: {}, counter: 0, demonstrated: [], wrongOrder: [] });
  state.queue ||= [];
  state.answerShownAt ||= {};
  state.counter ||= 0;
  state.demonstrated ||= [];
  state.wrongOrder ||= [];

  const group = getGroup(task.group_id);
  const byId = new Map(group.words.map((w) => [w.id, w]));

  let planItem = null;
  let phase = task.status;
  let promptText = '';
  let wordId = null;

  if (task.status === 'first_test') {
    const answered = new Set(
      all(`SELECT * FROM answer_attempts WHERE task_id = ? AND phase = 'first_test'`, [task.id])
        .map((a) => Number(a.index_in_plan)),
    );
    const idx = index !== null && index !== undefined && !answered.has(Number(index))
      ? Number(index)
      : plan.findIndex((_, i) => !answered.has(i));
    if (idx < 0 || idx >= plan.length) {
      return { task: taskView(task, userId), noMoreQuestions: true };
    }
    planItem = plan[idx];
    wordId = planItem.wordId;
    promptText = planItem.prompt;
  } else if (task.status === 'remediation') {
    if (!state.queue.length) {
      finalizeTask(task, state);
      return { task: taskView(loadTask(taskId, userId), userId) };
    }
    wordId = state.queue[0];
    const w = byId.get(wordId);
    planItem = {
      wordId,
      type: 'definition',
      prompt: `${w.coreMeaningZh}（${POS_LABEL[w.partOfSpeech] || w.partOfSpeech}）`,
      hintZh: '补测：请再次拼写这个目标词',
      acceptedAnswers: [...(w.acceptedSpellings || [w.lemma])],
      answerCanonical: w.lemma,
      synonymHints: [],
    };
    promptText = planItem.prompt;
  } else {
    return { task: taskView(task, userId), notAnswerable: true };
  }

  const normalized = normalizeAnswer(answer);
  const graded = gradeSpelling(answer, planItem);
  const synonym = graded.correct ? null : matchSynonymHint(normalized, planItem);
  const isNetworkish = String(answer ?? '').startsWith('__error__');
  const recordWrong = !graded.correct && !isNetworkish;

  const result = tx(() => {
    run(
      `INSERT INTO answer_attempts (id, task_id, user_id, word_id, question_type, phase, prompt, submitted, normalized,
         is_correct, reason, client_request_id, index_in_plan, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid('a'), task.id, userId, wordId, planItem.type, phase, promptText, String(answer ?? '').slice(0, 200),
        normalized, graded.correct ? 1 : 0, isNetworkish ? 'network_error' : graded.reason, clientRequestId || null,
        phase === 'first_test' ? (plan.findIndex((p) => p.wordId === wordId)) : null, nowIso(),
      ],
    );

    // 学习进度：只有服务端确认的作答才会更新
    if (!isNetworkish) {
      if (graded.correct) {
        run(
          `UPDATE word_progress SET correct_streak = correct_streak + 1, last_correct_at = ?
           WHERE user_id = ? AND word_id = ?`,
          [nowIso(), userId, wordId],
        );
      } else {
        run(
          `UPDATE word_progress SET valid_wrong_count = valid_wrong_count + 1, correct_streak = 0, last_wrong_at = ?
           WHERE user_id = ? AND word_id = ?`,
          [nowIso(), userId, wordId],
        );
        if (task.task_type !== 'new_words') {
          run('UPDATE word_progress SET independent_failed = independent_failed + 1 WHERE user_id = ? AND word_id = ?', [userId, wordId]);
        }
      }
    }
  });

  // 阶段推进（事务外，但用同一状态对象，保证一次请求只推进一次）
  let advance;
  if (phase === 'first_test') {
    advance = advanceFirstTest(task, state, plan, wordId, graded.correct, now);
  } else {
    advance = advanceRemediation(task, state, wordId, graded.correct, now);
  }

  return {
    correct: graded.correct,
    reason: isNetworkish ? 'network_error' : graded.reason,
    synonymHint: synonym,
    correctAnswer: graded.correct ? null : planItem.answerCanonical,
    acceptedAnswers: graded.correct ? null : planItem.acceptedAnswers,
      word: briefWord(byId.get(wordId)),
    advance,
    task: taskView(loadTask(taskId, userId), userId),
    _tx: result,
  };
}

function briefWord(w) {
  if (!w) return null;
  return {
    id: w.id,
    lemma: w.lemma,
    partOfSpeech: w.partOfSpeech,
    coreMeaningZh: w.coreMeaningZh,
    phonetic: w.phonetic,
    collocations: w.collocations,
    confusionPairs: w.confusionPairs,
    cloze: w.cloze,
  };
}

function advanceFirstTest(task, state, plan, wordId, correct, now = null) {
  const allAnswered = all(`SELECT COUNT(*) AS c FROM answer_attempts WHERE task_id = ? AND phase = 'first_test'`, [task.id]);
  const total = Number(allAnswered[0].c);
  if (!correct && !state.wrongOrder.includes(wordId)) state.wrongOrder.push(wordId);

  if (total >= plan.length) {
    const correctCount = Number(
      all(`SELECT COUNT(*) AS c FROM answer_attempts WHERE task_id = ? AND phase = 'first_test' AND is_correct = 1`, [task.id])[0].c,
    );
    const demonstratedNow = new Set(state.demonstrated);
    // 首测答对的词：无提示正确回忆，直接计入
    const correctRows = all(`SELECT DISTINCT word_id FROM answer_attempts WHERE task_id = ? AND phase = 'first_test' AND is_correct = 1`, [task.id]);
    for (const r of correctRows) demonstratedNow.add(r.word_id);
    state.demonstrated = [...demonstratedNow];
    state.queue = state.wrongOrder.filter((w) => !demonstratedNow.has(w));

    tx(() => {
      run(
        `UPDATE learning_tasks SET first_pass_correct = ?, status = ?, remediation_state_json = ? WHERE id = ?`,
        [correctCount, state.queue.length ? 'remediation' : 'completed', JSON.stringify(state), task.id],
      );
    });

    if (state.queue.length === 0) {
      finalizeTask({ ...task, first_pass_correct: correctCount }, state, now);
      return { phase: 'completed', firstPassCorrect: correctCount, total: plan.length, cornered: true };
    }
    return { phase: 'remediation', firstPassCorrect: correctCount, total: plan.length, queueLength: state.queue.length };
  }

  tx(() => {
    run('UPDATE learning_tasks SET status = ?, remediation_state_json = ? WHERE id = ?', [task.status, JSON.stringify(state), task.id]);
  });
  return { phase: 'first_test', answered: total, total: plan.length };
}

function advanceRemediation(task, state, wordId, correct, now = null) {
  state.counter += 1;
  const shownAt = state.answerShownAt[wordId];
  const gapOk = shownAt === undefined || state.counter - shownAt >= 2;

  // 先从队列头部移除
  state.queue = state.queue.filter((x, i) => !(i === 0 && x === wordId));

  if (correct && gapOk) {
    if (!state.demonstrated.includes(wordId)) state.demonstrated.push(wordId);
    run(`UPDATE word_progress SET demonstrated_count = demonstrated_count + 1 WHERE user_id = ? AND word_id = ?`, [task.user_id, wordId]);
  } else {
    // 需要重来：插入到位置 2（保证中间至少隔 2 个其它条目）
    const pos = Math.min(2, state.queue.length);
    state.queue.splice(pos, 0, wordId);
    if (!correct) state.answerShownAt[wordId] = state.counter;
    else state.answerShownAt[wordId] = state.counter; // 刚答对但间隔不足，视为需要再看一次
  }

  const demonstratedTotal = state.demonstrated.length;
  const done = state.queue.length === 0 && demonstratedTotal >= 20;

  tx(() => {
    run(
      `UPDATE learning_tasks SET status = ?, remediation_state_json = ?, corrected_mastery = ? WHERE id = ?`,
      [done ? 'completed' : 'remediation', JSON.stringify(state), Math.round((demonstratedTotal / 20) * 100), task.id],
    );
  });

  if (done) {
    finalizeTask(task, state, now);
    return { phase: 'completed', demonstrated: demonstratedTotal };
  }
  return { phase: 'remediation', demonstrated: demonstratedTotal, queueLength: state.queue.length };
}

/* ------------------------------------------------------------------ */
/*                          任务完成结算                                */
/* ------------------------------------------------------------------ */

export function finalizeTask(task, state, nowInput = null) {
  const t = get('SELECT * FROM learning_tasks WHERE id = ?', [task.id]);
  if (!t || t.status !== 'completed' || t.completed_at) return;
  const now = nowInput ? new Date(nowInput) : new Date();
  tx(() => {
    run('UPDATE learning_tasks SET completed_at = ?, corrected_mastery = 100 WHERE id = ?', [now.toISOString(), t.id]);
  });

  const user = get('SELECT * FROM users WHERE id = ?', [t.user_id]);
  const tz = user?.timezone || 'Asia/Shanghai';

  if (t.task_type === 'new_words') {
    awardPoints({
      userId: t.user_id,
      points: CONFIG.vocabulary.learnReward,
      reason: 'learn_group',
      idempotencyKey: `learn:${t.user_id}:${t.group_id}:${t.id}`,
      refType: 'learning_task',
      refId: t.id,
      note: `完成词组 ${t.group_id} 学习（首次 ${t.first_pass_correct}/${t.first_pass_total}，补齐 100%）`,
      at: now,
      timeZone: tz,
    });
    scheduleDay3Review({ userId: t.user_id, groupId: t.group_id, completedAt: now, timeZone: tz });
  } else if (t.task_type === 'day3_review') {
    run('UPDATE review_tasks SET status = ?, completed_at = ? WHERE user_id = ? AND group_id = ? AND kind = ?',
      ['completed', now.toISOString(), t.user_id, t.group_id, 'day3']);
    awardPoints({
      userId: t.user_id, points: CONFIG.review.rewardPerSystemGroup, reason: 'review_group',
      idempotencyKey: `review-d3:${t.user_id}:${t.group_id}:${t.id}`, refType: 'learning_task', refId: t.id,
      note: `完成 ${t.group_id} 三日复习（20 词补齐 100%）`, at: now, timeZone: tz,
    });
    maybeArchive({ userId: t.user_id, groupId: t.group_id, timeZone: tz, at: now });
  } else if (t.task_type === 'long_term') {
    awardPoints({
      userId: t.user_id, points: CONFIG.review.rewardPerSystemGroup, reason: 'review_group',
      idempotencyKey: `review-longterm:${t.user_id}:${t.group_id}:${t.id}`, refType: 'learning_task', refId: t.id,
      note: `完成 ${t.group_id} 长期抽查（20 词补齐 100%）`, at: now, timeZone: tz,
    });
  }
}

export function awardPoints({ userId, points, reason, idempotencyKey, note = null, refType = null, refId = null, at = new Date(), timeZone = 'Asia/Shanghai' }) {
  const existing = get('SELECT id FROM points_ledger WHERE idempotency_key = ?', [idempotencyKey]);
  if (existing) return { awarded: false, duplicate: true, id: existing.id };
  const weekKey = weekKeyFor(at, timeZone);
  const id = uuid('p');
  run(
    `INSERT INTO points_ledger (id, user_id, group_id, points, reason, week_key, note, ref_type, ref_id, idempotency_key, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, null, points, reason, weekKey, note, refType, refId, idempotencyKey, at.toISOString()],
  );
  return { awarded: true, id, points, weekKey };
}

import { weekKeyOf as _weekKeyOf } from '@lingo/domain';
export function weekKeyFor(date, timeZone) {
  return _weekKeyOf(date, timeZone);
}

export function scheduleDay3Review({ userId, groupId, completedAt, timeZone }) {
  const due = day3DueAt(completedAt, timeZone);
  run(
    `INSERT INTO review_tasks (id, user_id, group_id, kind, due_at, sequence_no, status, created_at)
     VALUES (?,?,?,?,?,1,'pending',?)
     ON CONFLICT(user_id, group_id, kind, sequence_no) DO NOTHING`,
    [uuid('rv'), userId, groupId, 'day3', due.toISOString(), nowIso()],
  );
  return due;
}

export function maybeArchive({ userId, groupId, timeZone, at = new Date() }) {
  const day3 = get(`SELECT * FROM review_tasks WHERE user_id=? AND group_id=? AND kind='day3' AND status='completed'`, [userId, groupId]);
  const weeklyDone = get(`SELECT * FROM review_tasks WHERE user_id=? AND group_id=? AND kind='weekly_group' AND status='completed'`, [userId, groupId]);
  if (!day3 || !weeklyDone) return { archived: false };
  const a = new Date(Math.max(Date.parse(day3.completed_at), Date.parse(weeklyDone.completed_at)));
  for (const [i, days] of CONFIG.review.longTermDaysAfterArchive.entries()) {
    const due = new Date(a.getTime() + days * 86400000);
    run(
      `INSERT INTO review_tasks (id, user_id, group_id, kind, due_at, sequence_no, status, created_at)
       VALUES (?,?,?,?,?,?,'pending',?)
       ON CONFLICT(user_id, group_id, kind, sequence_no) DO NOTHING`,
      [uuid('rv'), userId, groupId, 'long_term', due.toISOString(), i + 1, nowIso()],
    );
  }
  run('UPDATE word_progress SET archived = 1 WHERE user_id = ? AND group_id = ?', [userId, groupId]);
  return { archived: true, archivedAt: a };
}

export function groupWords(groupId) {
  return getGroup(groupId)?.words ?? [];
}

export function importanceMapForUser(userId) {
  const rows = all('SELECT word_id, valid_wrong_count FROM word_progress WHERE user_id = ?', [userId]);
  return new Map(rows.map((r) => [r.word_id, importanceOf(r.valid_wrong_count)]));
}
