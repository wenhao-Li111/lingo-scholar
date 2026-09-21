/**
 * API 路由。所有正式状态由服务端决定；客户端不能直接写积分、晋级或掌握度。
 */

import express from 'express';
import {studyLibraryRoutes} from './study-library.js';
import {cloudSocialRoutes,publicSignup,starTotal} from './cloud-social.js';
import path from 'node:path';
import { createReadStream, statSync, existsSync } from 'node:fs';
import {
  all, get, jsonParse, nowIso, run, setMeta, getMeta, tx, uuid, currentDatabasePath, tableCount,
} from './db.js';
import {
  COOKIE_NAME, CSRF_HEADER, bootstrapConsumed, clearCookie, consumeBootstrap, createInvite, createSession,
  createUser, findInviteByToken, findUserByEmail, groupMemberCount, hasAnyUser,
  issueBootstrapToken, listGroupMembers, parseCookies, publicUser, rateLimit, resolveSession, revokeInvite, revokeSession,
  sessionCookie, verifyPassword,
} from './auth.js';
import { contentStats, getGroup, listGroupsForLevel, importContent, CONTENT_ROOT } from './content.js';
import {
  awardPoints, createLearningTask, groupWords, importanceMapForUser, isValidTaskId, loadTask, nextGroupForUser,
  submitAnswer, taskView,
} from './services/learning.js';
import {
  canStartNewWords, completeWeeklyGroupReview, examStateFor, overdueReviews, resumeWeeklyExam, startReviewTask,
  startWeeklyExam, submitWeeklyExam, upcomingReviews, weeklyGroupReviewStatus, repairExamWord, settleClosedWeeks,
  weekKeyNow, refundIfEligible, describeReviewSchedule,
} from './services/review.js';
import { articleState, playbackPolicy, recordPlayback, saveArticlePosition, studyTimeSummary } from './services/study.js';
import { groupSummary, joinGroup, leaderboard, ledger, listInvites, totalPoints, userPrimaryGroup } from './services/social.js';
import { CONFIG, examWindow, weekKeyOf, LEVEL_BY_ID, gateQuestionPlan, scoreSection } from '@lingo/domain';
import { buildQuestionPlan, sanitizeQuestion, finalizeTask } from './services/learning.js';
import { voiceCapabilities, runVoiceTurn, sessionPublic, startVoiceSession, endVoiceSession } from './voice-bridge.js';
import {
  deckById, publicDeck, resourceById, resourceCatalog, resourceDecks, resourceText, searchResources, listeningCatalog,
} from './resources.js';

export function buildRouter({ clock }) {
  const router = express.Router();
  const now = () => clock.now();

  /* ---------------------------- 中间件 ---------------------------- */
  router.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    const resolved = resolveSession(token);
    req.auth = resolved ? { ...resolved, token } : null;
    req.now = now();
    next();
  });

  function requireAuth(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'UNAUTHENTICATED', message: '请先登录' });
    next();
  }
  function requireWrite(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'UNAUTHENTICATED', message: '请先登录' });
    const header = req.headers[CSRF_HEADER];
    if (!header || header !== req.auth.session.csrf_token) {
      return res.status(403).json({ error: 'CSRF_FAILED', message: '缺少或错误的 CSRF 令牌' });
    }
    next();
  }
  function requireAdmin(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (req.auth.user.role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN', message: '需要管理员权限' });
    next();
  }
  function requireGroup(req, res, next) {
    const g = userPrimaryGroup(req.auth.user.id);
    if (!g) return res.status(409).json({ error: 'NO_GROUP', message: '尚未加入任何小组' });
    req.group = g;
    next();
  }

  /* ---------------------------- 健康检查 ---------------------------- */
  studyLibraryRoutes(router,requireAuth,requireWrite,now);
  cloudSocialRoutes(router,requireAuth,requireWrite,ensureGroupFor,now);
  router.get('/health', async (req, res) => {
    if(process.env.NODE_ENV==='production')return res.json({ok:true});
    res.json({
      ok: true,
      time: nowIso(),
      timezoneDefault: CONFIG.product.defaultGroupTimezone,
      db: currentDatabasePath(),
      counts: {
        users: tableCount('users'),
        groups: tableCount('word_groups'),
        words: tableCount('words'),
        tasks: tableCount('learning_tasks'),
        ledger: tableCount('points_ledger'),
        resources: resourceCatalog().stats.total,
        searchableResources: resourceCatalog().stats.searchable,
        resourceDeckWords: resourceDecks().reduce((total, deck) => total + (deck.words?.length || 0), 0),
      },
      rulesVersion: 'rules-v1',
      contentVersion: 'course-v1',
    });
  });

  /* ---------------------------- Bootstrap ---------------------------- */
  router.get('/bootstrap/status', (req, res) => {
    res.json({ hasUser: hasAnyUser(), bootstrapConsumed: bootstrapConsumed(), publicSignup: publicSignup() });
  });

  router.post('/bootstrap', (req, res) => {
    const { token, email, displayName, password, groupName } = req.body || {};
    if (hasAnyUser() && bootstrapConsumed()) {
      return res.status(409).json({ error: 'ALREADY_BOOTSTRAPPED', message: '管理员已创建，请使用邀请加入' });
    }
    try {
      const user = tx(() => {
        consumeBootstrap(token);
        return createUser({ email, displayName, password, role: 'admin' });
      });
      run('UPDATE users SET plan_started_at = ? WHERE id = ?', [nowIso(), user.id]);
      const group = ensureGroupFor(user.id, groupName);
      const session = createSession(user.id, req.headers['user-agent']);
      res.setHeader('Set-Cookie', sessionCookie(session.token));
      res.json({ user: publicUser(user), csrfToken: session.csrf, groupId: group.id, expiresAt: session.expiresAt });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'BOOTSTRAP_FAILED', message: e.message });
    }
  });

  function ensureGroupFor(userId, name) {
    const existing = get(
      `SELECT g.* FROM study_groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=? AND m.left_at IS NULL LIMIT 1`,
      [userId],
    );
    if (existing) return existing;
    return tx(() => {
      const id = uuid('grp');
      run('INSERT INTO study_groups (id, name, timezone, owner_user_id, created_at) VALUES (?,?,?,?,?)',
        [id, name || '我的学习小组', CONFIG.product.defaultGroupTimezone, userId, nowIso()]);
      run('INSERT INTO memberships (id, user_id, group_id, role, joined_at) VALUES (?,?,?,?,?)', [uuid('mb'), userId, id, 'owner', nowIso()]);
      run('UPDATE users SET plan_started_at = ? WHERE id = ? AND plan_started_at IS NULL', [nowIso(), userId]);
      return get('SELECT * FROM study_groups WHERE id = ?', [id]);
    });
  }

  /* ---------------------------- 登录 ---------------------------- */
  router.post('/auth/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const limit = rateLimit(`login:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!limit.allowed) return res.status(429).json({ error: 'RATE_LIMITED', retryAfter: limit.retryAfter });
    const { email, password } = req.body || {};
    const user = findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '邮箱或密码不正确' });
    const ok = verifyPassword(password, user.password_hash, user.password_salt);
    if (!ok) return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '邮箱或密码不正确' });
    const session = createSession(user.id, req.headers['user-agent']);
    res.setHeader('Set-Cookie', sessionCookie(session.token));
    const group = ensureGroupFor(user.id, null);
    res.json({ user: publicUser(user), csrfToken: session.csrf, groupId: group.id });
  });

  router.post('/auth/logout', requireWrite, (req, res) => {
    revokeSession(req.auth.token);
    res.setHeader('Set-Cookie', clearCookie());
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    const group = userPrimaryGroup(req.auth.user.id);
    const tz = group?.timezone || req.auth.user.timezone;
    res.json({
      user: publicUser(req.auth.user),
      stars:starTotal(req.auth.user.id),
      csrfToken: req.auth.session.csrf_token,
      group: group ? { id: group.id, name: group.name, timezone: group.timezone, role: group.member_role } : null,
      points: { total: totalPoints(req.auth.user.id), week: weekPoints(req.auth.user.id, tz) },
      study: studyTimeSummary(req.auth.user.id, tz),
      serverTime: nowIso(),
      rulesVersion: 'rules-v1',
      contentVersion: 'course-v1',
    });
  });

  function weekPoints(userId, tz) {
    const wk = weekKeyOf(now(), tz);
    const row = get('SELECT COALESCE(SUM(points),0) AS s FROM points_ledger WHERE user_id=? AND week_key=?', [userId, wk]);
    return { weekKey: wk, points: Number(row.s) || 0 };
  }

  router.patch('/me', requireWrite, (req, res) => {
    const { displayName, timezone, shareVoice, prefs } = req.body || {};
    const fields = [];
    const params = [];
    if (displayName) { fields.push('display_name = ?'); params.push(String(displayName).slice(0, 40)); }
    if (timezone) {
      const group = userPrimaryGroup(req.auth.user.id);
      if (group && group.timezone_locked_at) {
        return res.status(409).json({ error: 'TIMEZONE_LOCKED', message: '小组时区已锁定：变更不会追溯改变历史周考的截止时间' });
      }
      fields.push('timezone = ?'); params.push(String(timezone));
    }
    if (shareVoice !== undefined) { fields.push('share_voice = ?'); params.push(shareVoice ? 1 : 0); }
    if (prefs) { fields.push('prefs_json = ?'); params.push(JSON.stringify(prefs).slice(0, 4000)); }
    if (!fields.length) return res.json({ user: publicUser(req.auth.user) });
    params.push(req.auth.user.id);
    run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', [req.auth.user.id])) });
  });

  router.get('/me/export', requireAuth, (req, res) => {
    const uid = req.auth.user.id;
    res.json({
      exportedAt: nowIso(),
      user: publicUser(req.auth.user),
      ledger: ledger(uid, { limit: 500 }),
      learningTasks: all('SELECT id, group_id, task_type, status, first_pass_correct, first_pass_total, corrected_mastery, completed_at FROM learning_tasks WHERE user_id=?', [uid]),
      reviewTasks: all('SELECT group_id, kind, due_at, status, completed_at FROM review_tasks WHERE user_id=?', [uid]),
      study: studyTimeSummary(uid, req.auth.user.timezone, { days: 120 }),
      note: '导出仅包含本人有权访问的数据。',
    });
  });

  /* ---------------------------- 邀请与小组 ---------------------------- */
  router.post('/invites', requireWrite, requireGroup, (req, res) => {
    const { ttlDays = CONFIG.social.inviteExpiryDays, maxUses = 1, note = null } = req.body || {};
    const inv = createInvite({ groupId: req.group.id, createdBy: req.auth.user.id, ttlDays, maxUses, note });
    run('INSERT INTO content_audit (id, actor_user_id, action, target_type, target_id, detail_json, created_at) VALUES (?,?,?,?,?,?,?)',
      [uuid('ca'), req.auth.user.id, 'create_invite', 'invite', inv.id, JSON.stringify({ ttlDays, maxUses }), nowIso()]);
    res.json({ invite: inv, link: `/join?token=${inv.token}`, tokenShownOnce: true });
  });

  router.get('/invites', requireAuth, requireGroup, (req, res) => {
    res.json({ invites: listInvites(req.group.id) });
  });

  router.post('/invites/:id/revoke', requireWrite, requireGroup, (req, res) => {
    revokeInvite(req.params.id, req.auth.user.id);
    res.json({ ok: true });
  });

  router.get('/join/preview', (req, res) => {
    const token = String(req.query.token || '');
    const invite = findInviteByToken(token);
    if (!invite) return res.status(404).json({ error: 'INVITE_NOT_FOUND' });
    const g = get('SELECT id, name, timezone FROM study_groups WHERE id = ?', [invite.group_id]);
    const expired = Date.parse(invite.expires_at) < Date.now();
    const used = invite.uses >= invite.max_uses;
    const revoked = Boolean(invite.revoked_at);
    res.json({
      group: g,
      valid: !expired && !used && !revoked,
      reason: revoked ? 'revoked' : (expired ? 'expired' : (used ? 'used' : 'ok')),
      memberCount: groupMemberCount(invite.group_id),
      maxMembers: CONFIG.product.maxGroupMembers,
    });
  });

  router.post('/join', (req, res) => {
    const { token, email, displayName, password } = req.body || {};
    const invite = findInviteByToken(String(token || ''));
    if (!invite) return res.status(404).json({ error: 'INVITE_NOT_FOUND', message: '邀请无效' });
    if (invite.revoked_at) return res.status(410).json({ error: 'INVITE_REVOKED' });
    if (Date.parse(invite.expires_at) < Date.now()) return res.status(410).json({ error: 'INVITE_EXPIRED' });
    if (invite.uses >= invite.max_uses) return res.status(410).json({ error: 'INVITE_USED' });
    let user = req.auth?.user ?? null;
    if (!user) {
      if (!email || !password) return res.status(400).json({ error: 'NEED_ACCOUNT', message: '请提供邮箱与密码以创建账号' });
      try {
        user = createUser({ email, displayName, password });
      } catch (e) {
        return res.status(e.status || 400).json({ error: e.code || 'CREATE_FAILED', message: e.message });
      }
    }
    const result = joinGroup({ userId: user.id, invite });
    if (result.joined) run('UPDATE invites SET uses = uses + 1 WHERE id = ?', [invite.id]);
    const session = createSession(user.id, req.headers['user-agent']);
    res.setHeader('Set-Cookie', sessionCookie(session.token));
    res.json({ user: publicUser(user), csrfToken: session.csrf, groupId: invite.group_id, ...result });
  });

  router.get('/group/summary', requireAuth, requireGroup, (req, res) => {
    res.json({ ...groupSummary({ groupId: req.group.id, userId: req.auth.user.id, timeZone: req.group.timezone }), members: listGroupMembers(req.group.id).map((m) => ({ displayName: m.display_name, role: m.role })) });
  });

  router.get('/leaderboard', requireAuth, requireGroup, (req, res) => {
    const scope = req.query.scope === 'total' ? 'total' : 'week';
    res.json(leaderboard({ groupId: req.group.id, timeZone: req.group.timezone, scope }));
  });

  /* ---------------------------- 课程 ---------------------------- */
  router.get('/course/levels', requireAuth, (req, res) => {
    const lv = req.auth.user.level;
    const levels = CONFIG.levels.map((l) => {
      const published = tableCount2('word_groups', 'level = ? AND editorial_status = ?', [l.id, 'published']);
      const completed = get(
        `SELECT COUNT(*) AS c FROM learning_tasks WHERE user_id=? AND task_type='new_words' AND status='completed' AND group_id IN (SELECT id FROM word_groups WHERE level=?)`,
        [req.auth.user.id, l.id],
      );
      const gate = get('SELECT * FROM level_gate_attempts WHERE user_id=? AND level=? ORDER BY started_at DESC LIMIT 1', [req.auth.user.id, l.id]);
      const gatePack = gatePackStatus(l.id);
      return {
        id: l.id,
        name: l.name,
        groupsPlanned: l.groups,
        groupsPublished: published,
        wordsPlanned: l.words,
        suggestedWeeks: l.suggestedWeeks,
        completedGroups: Number(completed.c) || 0,
        unlocked: l.id <= lv,
        current: l.id === lv,
        gate: { plan: gateQuestionPlan(l.id), lastAttempt: gate ? { status: gate.status, passed: Boolean(gate.passed) } : null, materialsReady: gatePack.ready, materialsDetail: gatePack },
      };
    });
    res.json({ levels, userLevel: lv, rulesVersion: 'rules-v1' });
  });

  function tableCount2(table, where, params) {
    const row = get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, params);
    return row ? Number(row.c) : 0;
  }

  router.get('/course/groups/:id', requireAuth, (req, res) => {
    const g = getGroup(req.params.id);
    if (!g || g.editorial_status !== 'published') return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    if (g.level > req.auth.user.level) return res.status(403).json({ error: 'LEVEL_LOCKED', message: '该级别尚未解锁' });
    const progress = all('SELECT * FROM word_progress WHERE user_id=? AND group_id=?', [req.auth.user.id, g.id]);
    const demonstrated = new Set(progress.filter((p) => p.demonstrated_count > 0).map((p) => p.word_id));
    const tasks = all('SELECT id, task_type, status, first_pass_correct, first_pass_total, corrected_mastery, completed_at FROM learning_tasks WHERE user_id=? AND group_id=? ORDER BY created_at DESC', [req.auth.user.id, g.id]);
    res.json({
      group: {
        id: g.id,
        level: g.level,
        index: g.index,
        title: g.title,
        topic: g.topic,
        editorialStatus: g.editorial_status,
        wordCount: g.words.length,
      },
      words: g.words.map((w) => ({ ...w, demonstrated: demonstrated.has(w.id) })),
      articles: g.articles.map((a) => ({
        id: a.id, role: a.role, title: a.title, type: a.type, level: a.level, wordCount: a.wordCount,
        coverageCovered: a.coverageCovered, authors: a.authors, textOrigin: a.textOrigin,
        translationOrigin: a.translationOrigin, rightsStatus: a.rightsStatus, attribution: a.attribution,
      })),
      tasks,
      progress: { demonstrated: demonstrated.size, total: g.words.length },
    });
  });

  /* ---------------------------- openIELTS 资料库 ---------------------------- */
  router.get('/listening-library', requireAuth, (req, res) => {
    const catalog = listeningCatalog();
    const states = new Map(all('SELECT * FROM listening_library_states WHERE user_id=?',[req.auth.user.id]).map(s=>[s.track_id,s]));
    res.json({...catalog, tracks:catalog.tracks.map(t=>({...t,state:states.get(t.id)||null}))});
  });
  router.patch('/listening-library/:id', requireWrite, (req,res) => {
    if(!listeningCatalog().tracks.some(t=>t.id===req.params.id)) return res.status(404).json({error:'TRACK_NOT_FOUND'});
    const previous=get('SELECT * FROM listening_library_states WHERE user_id=? AND track_id=?',[req.auth.user.id,req.params.id]);
    const position=Number(req.body.positionSeconds ?? previous?.position_seconds ?? 0);
    if(!Number.isFinite(position)||position<0||position>86400) return res.status(400).json({error:'INVALID_POSITION'});
    const note=String(req.body.note ?? previous?.note ?? '').slice(0,5000);
    const completed=req.body.completed===undefined?Boolean(previous?.completed):Boolean(req.body.completed);
    run('INSERT INTO listening_library_states(user_id,track_id,position_seconds,note,completed,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,track_id) DO UPDATE SET position_seconds=excluded.position_seconds,note=excluded.note,completed=excluded.completed,updated_at=excluded.updated_at',[req.auth.user.id,req.params.id,position,note,completed?1:0,nowIso()]);
    res.json({ok:true,positionSeconds:position,note,completed});
  });
  router.get('/resources', requireAuth, (req, res) => {
    const catalog = resourceCatalog();
    const states = new Map(all('SELECT * FROM resource_states WHERE user_id=?', [req.auth.user.id]).map((row) => [row.resource_id, row]));
    const resources = catalog.resources.map((item) => {
      const state = states.get(item.id);
      return {
        ...item,
        state: state ? {
          favorite: Boolean(state.favorite), status: state.status, progressPercent: state.progress_percent,
          lastPage: state.last_page, note: state.note, updatedAt: state.updated_at,
        } : { favorite: false, status: 'not_started', progressPercent: 0, lastPage: 1, note: '', updatedAt: null },
      };
    });
    res.json({ source: catalog.source, generatedAt: catalog.generatedAt, stats: catalog.stats, resources });
  });

  router.get('/resources/search', requireAuth, (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 120);
    const category = String(req.query.category || 'all');
    const format = String(req.query.format || 'all');
    const results = searchResources({ query, category, format, limit: req.query.limit });
    res.json({ query, count: results.length, results });
  });

  router.get('/resources/decks', requireAuth, (req, res) => {
    const decks=resourceDecks();
    const words=decks.flatMap(d=>d.words);
    const states=all('SELECT deck_id, COUNT(*) AS seen, SUM(CASE WHEN next_review_at<=? THEN 1 ELSE 0 END) AS due FROM resource_word_states WHERE user_id=? GROUP BY deck_id',[now().toISOString(),req.auth.user.id]);
    res.json({ decks: decks.map(({ words, ...deck }) => ({...deck,progress:states.find(s=>s.deck_id===deck.id)||{seen:0,due:0}})), stats:{entries:words.length, uniqueHeadwords:new Set(words.map(w=>w.lemma.trim().toLowerCase())).size, examples:words.filter(w=>w.example).length} });
  });

  router.get('/resources/decks/:id', requireAuth, (req, res) => {
    const deck = publicDeck(deckById(req.params.id), { offset: req.query.offset, limit: req.query.limit });
    if (!deck) return res.status(404).json({ error: 'DECK_NOT_FOUND', message: '词表不存在' });
    const progressRows = all('SELECT * FROM resource_word_states WHERE user_id=? AND deck_id=?', [req.auth.user.id, deck.id]);
    const progress = new Map(progressRows.map((row) => [row.word_id, row]));
    const words = deck.words.map((word) => {
      const row = progress.get(word.id);
      return {
        ...word,
        progress: row ? { familiarity: row.familiarity, seenCount: row.seen_count, nextReviewAt: row.next_review_at } : null,
      };
    });
    const summary = progressRows.reduce((out, row) => {
      out[row.familiarity] = (out[row.familiarity] || 0) + 1;
      out.seen += 1;
      if (row.next_review_at && Date.parse(row.next_review_at) <= now().getTime()) out.due += 1;
      return out;
    }, { seen: 0, due: 0, again: 0, fuzzy: 0, known: 0 });
    res.json({ deck: { ...deck, words }, summary });
  });

  router.patch('/resources/decks/:deckId/words/:wordId', requireWrite, (req, res) => {
    const deck = deckById(req.params.deckId);
    const word = deck?.words.find((item) => item.id === req.params.wordId);
    if (!deck || !word) return res.status(404).json({ error: 'RESOURCE_WORD_NOT_FOUND', message: '词条不存在' });
    const rating = String(req.body?.rating || '');
    const delays = { again: 1, fuzzy: 3, known: 7 };
    if (!(rating in delays)) return res.status(400).json({ error: 'BAD_RATING', message: '熟悉度无效' });
    const previous = get('SELECT * FROM resource_word_states WHERE user_id=? AND deck_id=? AND word_id=?', [req.auth.user.id, deck.id, word.id]);
    const reviewedAt = now();
    const nextReviewAt = new Date(reviewedAt.getTime() + delays[rating] * 86400000).toISOString();
    run(
      `INSERT INTO resource_word_states (user_id, deck_id, word_id, familiarity, seen_count, next_review_at, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id, deck_id, word_id) DO UPDATE SET familiarity=excluded.familiarity,
         seen_count=resource_word_states.seen_count+1, next_review_at=excluded.next_review_at, updated_at=excluded.updated_at`,
      [req.auth.user.id, deck.id, word.id, rating, (previous?.seen_count || 0) + 1, nextReviewAt, reviewedAt.toISOString()],
    );
    res.json({ wordId: word.id, rating, seenCount: (previous?.seen_count || 0) + 1, nextReviewAt });
  });

  router.get('/resources/:id', requireAuth, (req, res) => {
    const item = resourceById(req.params.id);
    if (!item) return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', message: '资料不存在' });
    const state = get('SELECT * FROM resource_states WHERE user_id=? AND resource_id=?', [req.auth.user.id, item.id]);
    const text = resourceText(item.id) || '';
    res.json({
      resource: item,
      state: state ? {
        favorite: Boolean(state.favorite), status: state.status, progressPercent: state.progress_percent,
        lastPage: state.last_page, note: state.note, updatedAt: state.updated_at,
      } : { favorite: false, status: 'not_started', progressPercent: 0, lastPage: 1, note: '', updatedAt: null },
      extractedText: text,
      textTruncated: false,
    });
  });

  router.patch('/resources/:id/state', requireWrite, (req, res) => {
    const item = resourceById(req.params.id);
    if (!item) return res.status(404).json({ error: 'RESOURCE_NOT_FOUND', message: '资料不存在' });
    const previous = get('SELECT * FROM resource_states WHERE user_id=? AND resource_id=?', [req.auth.user.id, item.id]);
    const allowedStatus = new Set(['not_started', 'reading', 'completed']);
    const favorite = req.body?.favorite === undefined ? Boolean(previous?.favorite) : Boolean(req.body.favorite);
    const status = allowedStatus.has(req.body?.status) ? req.body.status : (previous?.status || 'reading');
    const progressPercent = Math.max(0, Math.min(100, Math.round(Number(req.body?.progressPercent ?? previous?.progress_percent ?? (status === 'completed' ? 100 : 0)))));
    const lastPage = Math.max(1, Math.min(Math.max(1, item.pages || 9999), Math.round(Number(req.body?.lastPage ?? previous?.last_page ?? 1))));
    const note = String(req.body?.note ?? previous?.note ?? '').slice(0, 5000);
    const time = nowIso();
    run(
      `INSERT INTO resource_states (user_id, resource_id, favorite, status, progress_percent, last_page, note, opened_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, resource_id) DO UPDATE SET favorite=excluded.favorite, status=excluded.status,
         progress_percent=excluded.progress_percent, last_page=excluded.last_page, note=excluded.note, updated_at=excluded.updated_at`,
      [req.auth.user.id, item.id, favorite ? 1 : 0, status, progressPercent, lastPage, note, previous?.opened_at || time, time],
    );
    res.json({ state: { favorite, status, progressPercent, lastPage, note, updatedAt: time } });
  });

  /* ---------------------------- 今日总览 ---------------------------- */
  router.get('/today', requireAuth, requireGroup, (req, res) => {
    const uid = req.auth.user.id;
    const tz = req.group.timezone;
    const overdue = overdueReviews(uid, now());
    const upcoming = upcomingReviews(uid, now());
    const openTask = get(`SELECT * FROM learning_tasks WHERE user_id=? AND status IN ('first_test','remediation') ORDER BY created_at DESC LIMIT 1`, [uid]);
    const next = nextGroupForUser(uid, req.auth.user.level);
    const exam = examStateFor({ userId: uid, groupId: req.group.id, timeZone: tz, now: now() });
    const todayKey = weekKeyOf(now(), tz);
    const study = studyTimeSummary(uid, tz, { days: 7 });
    const reviewPlan = describeReviewSchedule(now(), tz);
    const weeklyReviews = all(`SELECT group_id, status, completed_at FROM review_tasks WHERE user_id=? AND kind='weekly_group' AND status='completed'`, [uid]);
    const carryover = all(
      `SELECT lt.group_id FROM learning_tasks lt WHERE lt.user_id=? AND lt.task_type='new_words' AND lt.status='completed'
        AND lt.completed_at > ?`,
      [uid, examWindow(todayKey, tz).openAt.toISOString()],
    ).map((r) => r.group_id);
    res.json({
      today: weekKeyOf(now(), tz) === todayKey,
      serverTime: nowIso(),
      timezone: tz,
      user: { level: req.auth.user.level, displayName: req.auth.user.display_name },
      points: { total: totalPoints(uid), ...weekPoints(uid, tz) },
      tasks: {
        overdueReviews: overdue.map(reviewBrief),
        upcomingReviews: upcoming.map(reviewBrief),
        openTask: openTask ? { id: openTask.id, groupId: openTask.group_id, status: openTask.status, taskType: openTask.task_type } : null,
        nextGroup: next ? { id: next.id, title: next.title, idx: next.idx, level: next.level } : null,
      },
      weekly: {
        weekKey: exam.weekKey,
        state: exam.state.status,
        reason: exam.state.reason,
        openAt: exam.window.openAt,
        deadlineAt: exam.window.deadlineAt,
        eligibleWords: exam.eligible.length,
        score: exam.row?.score_percent ?? null,
        firstScore: exam.row?.first_score_percent ?? null,
        bestMakeup: exam.row?.best_makeup_score ?? null,
        penaltyApplied: Boolean(exam.row?.penalty_applied),
        penaltyRefunded: Boolean(exam.row?.penalty_refunded),
        completedGroupsThisWeek: carryover.length,
        weeklyGroupReviewsDone: weeklyReviews.length,
      },
      study,
      plan: reviewPlan,
      dailyAllocation: CONFIG.plan.dailyAllocationMinutes,
      newWordDaysIso: CONFIG.plan.newWordDaysIso,
      weeklyGroupReview: weeklyGroupReviewStatus(uid, req.group.id, tz, now()),
    });
  });

  function reviewBrief(r) {
    return { id: r.id, groupId: r.group_id, groupTitle: r.group_title, kind: r.kind, dueAt: r.due_at, overdue: Date.parse(r.due_at) <= now().getTime() };
  }

  /* ---------------------------- 学习任务 ---------------------------- */
  router.post('/tasks/new', requireWrite, requireGroup, (req, res) => {
    const uid = req.auth.user.id;
    const gate = canStartNewWords(uid, now());
    if (!gate.allowed) {
      return res.status(409).json({ error: 'OVERDUE_REVIEWS', message: '请先完成到期复习', overdue: gate.overdue.map(reviewBrief) });
    }
    const groupId = req.body?.groupId || nextGroupForUser(uid, req.auth.user.level)?.id;
    if (!groupId) return res.status(404).json({ error: 'NO_MORE_GROUPS', message: '本级已发布词组都已学习完成' });
    const g = get('SELECT * FROM word_groups WHERE id = ?', [groupId]);
    if (!g) return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    if (g.level > req.auth.user.level) return res.status(403).json({ error: 'LEVEL_LOCKED' });
    const task = createLearningTask({ userId: uid, groupId, taskType: 'new_words' });
    res.json({ task: taskView(task, uid) });
  });

  router.get('/tasks/:id', requireAuth, (req, res) => {
    if (!isValidTaskId(req.params.id)) return res.status(400).json({ error: 'BAD_TASK_ID' });
    const t = loadTask(req.params.id, req.auth.user.id);
    if (!t) return res.status(404).json({ error: 'TASK_NOT_FOUND' });
    res.json({ task: taskView(t, req.auth.user.id) });
  });

  router.post('/tasks/:id/answer', requireWrite, (req, res) => {
    const { answer, clientRequestId, index } = req.body || {};
    try {
      const result = submitAnswer({ taskId: req.params.id, userId: req.auth.user.id, answer, clientRequestId, index, now: now() });
      delete result._tx;
      res.json(result);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'ANSWER_FAILED', message: e.message });
    }
  });

  /* ---------------------------- 复习 ---------------------------- */
  router.get('/reviews', requireAuth, (req, res) => {
    const uid = req.auth.user.id;
    res.json({
      overdue: overdueReviews(uid, now()).map(reviewBrief),
      upcoming: upcomingReviews(uid, now()).map(reviewBrief),
      schedule: describeReviewSchedule(now(), req.group?.timezone || req.auth.user.timezone),
    });
  });

  router.post('/reviews/:reviewTaskId/start', requireWrite, (req, res) => {
    try {
      const info = startReviewTask({ userId: req.auth.user.id, reviewTaskId: req.params.reviewTaskId });
      const task = createLearningTask({
        userId: req.auth.user.id,
        groupId: info.reviewTask.group_id,
        taskType: info.taskType,
        attemptNo: info.attempt,
      });
      res.json({ task: taskView(task, req.auth.user.id), reviewTaskId: req.params.reviewTaskId });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'REVIEW_START_FAILED', message: e.message });
    }
  });

  router.post('/reviews/weekly-group/complete', requireWrite, requireGroup, (req, res) => {
    try {
      const wk = weekKeyNow(now(), req.group.timezone);
      const r = completeWeeklyGroupReview({ userId: req.auth.user.id, groupId: req.body.groupId, weekKey: wk, timeZone: req.group.timezone, now: now() });
      res.json(r);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'FAILED', message: e.message });
    }
  });

  /* ---------------------------- 周考 ---------------------------- */
  router.get('/exam/state', requireAuth, requireGroup, (req, res) => {
    const st = examStateFor({ userId: req.auth.user.id, groupId: req.group.id, timeZone: req.group.timezone, now: now() });
    res.json({
      weekKey: st.weekKey,
      state: st.state.status,
      reason: st.state.reason,
      window: st.window,
      eligibleWords: st.eligible.length,
      score: st.row?.score_percent ?? null,
      firstScore: st.row?.first_score_percent ?? null,
      bestMakeup: st.row?.best_makeup_score ?? null,
      makeupCount: st.row?.makeup_count ?? 0,
      penaltyApplied: Boolean(st.row?.penalty_applied),
      penaltyRefunded: Boolean(st.row?.penalty_refunded),
      passPercent: CONFIG.weekly.passPercent,
      deduct: CONFIG.weekly.deductOnFailureOrAbsence,
      rules: [
        '周从周一 00:00 到下一周周一 00:00，按小组时区计算。',
        '周日 00:00 开放考试，下周周一 00:00 截止。',
        `成绩 = 正确数 / 题目数 × 100，按未取整原值判断是否 ≥ ${CONFIG.weekly.passPercent} 分。`,
        '首考不及格立即扣 10 分；补考通过返还一次；补考再失败不追加扣分。',
        '本周无任何可考词条时记为 NOT_APPLICABLE，不对空试卷扣分。',
      ],
    });
  });

  router.post('/exam/start', requireWrite, requireGroup, (req, res) => {
    try {
      const kind = req.body?.kind === 'makeup' ? 'makeup' : 'first';
      const r = startWeeklyExam({ userId: req.auth.user.id, groupId: req.group.id, timeZone: req.group.timezone, now: now(), kind });
      res.json(r);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'EXAM_START_FAILED', message: e.message });
    }
  });

  router.get('/exam/current', requireAuth, requireGroup, (req, res) => {
    const r = resumeWeeklyExam({ userId: req.auth.user.id, groupId: req.group.id, timeZone: req.group.timezone, now: now() });
    res.json(r || { resumed: false });
  });

  router.post('/exam/submit', requireWrite, requireGroup, (req, res) => {
    try {
      const kind = req.body?.kind === 'makeup' ? 'makeup' : 'first';
      const r = submitWeeklyExam({
        userId: req.auth.user.id, groupId: req.group.id, timeZone: req.group.timezone, now: now(),
        kind, answers: req.body?.answers || {},
      });
      res.json(r);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'EXAM_SUBMIT_FAILED', message: e.message });
    }
  });

  router.post('/exam/repair', requireWrite, requireGroup, (req, res) => {
    const weekKey = weekKeyNow(now(), req.group.timezone);
    const exam = get('SELECT * FROM weekly_exams WHERE user_id=? AND group_id=? AND week_key=?', [req.auth.user.id, req.group.id, weekKey]);
    if (!exam) return res.status(404).json({ error: 'NO_EXAM' });
    const r = repairExamWord({ userId: req.auth.user.id, examId: exam.id, wordId: req.body?.wordId });
    res.json(r);
  });

  /* ---------------------------- 关卡 ---------------------------- */
  router.get('/gate/state', requireAuth, requireGroup, (req, res) => {
    const uid = req.auth.user.id;
    const level = req.auth.user.level;
    const lv = LEVEL_BY_ID.get(level);
    const completed = get(
      `SELECT COUNT(*) AS c FROM learning_tasks WHERE user_id=? AND task_type='new_words' AND status='completed'
        AND group_id IN (SELECT id FROM word_groups WHERE level=?)`,
      [uid, level],
    );
    const published = tableCount2('word_groups', 'level=? AND editorial_status=?', [level, 'published']);
    const overdue = overdueReviews(uid, now());
    const pack = gatePackStatus(level);
    res.json({
      level,
      levelName: lv.name,
      eligibility: {
        completedGroups: Number(completed.c),
        requiredGroups: Math.min(lv.groups, published),
        publishedGroups: published,
        overdueReviews: overdue.length,
        eligible: Number(completed.c) >= Math.min(lv.groups, published) && overdue.length === 0 && published >= lv.groups,
      },
      plan: gateQuestionPlan(level),
      materials: pack,
      currentAttempt: (() => {
        const a = get(`SELECT * FROM level_gate_attempts WHERE user_id=? AND level=? AND status='in_progress' ORDER BY started_at DESC LIMIT 1`, [uid, level]);
        return a ? { id: a.id, startedAt: a.started_at } : null;
      })(),
      lastAttempt: (() => {
        const a = get(`SELECT * FROM level_gate_attempts WHERE user_id=? AND level=? AND status!='in_progress' ORDER BY started_at DESC LIMIT 1`, [uid, level]);
        return a ? { status: a.status, passed: Boolean(a.passed), submittedAt: a.submitted_at, detail: jsonParse(a.detail_json, {}) } : null;
      })(),
      note: '失败不扣积分，可练习后隔日再考；题干与答案不提前展示。',
    });
  });

  router.post('/gate/start', requireWrite, requireGroup, (req, res) => {
    const uid = req.auth.user.id;
    const level = req.auth.user.level;
    const pack = gatePackStatus(level);
    const forms = pack.forms || [];
    if (!forms.length) {
      return res.status(409).json({ error: 'GATE_MATERIALS_NOT_READY', message: '待补充关卡材料：不重复背熟的文章冒充陌生迁移测试', detail: pack });
    }
    const form = pickGateForm(forms, uid);
    const existing = get(`SELECT * FROM level_gate_attempts WHERE user_id=? AND level=? AND status='in_progress'`, [uid, level]);
    if (existing) {
      const detail = jsonParse(existing.detail_json, {});
      return res.json({
        attemptId: existing.id,
        resumed: true,
        questions: sanitizeGateQuestions(detail.questions),
        materials: gateMaterialsPayload(jsonParse(existing.materials_json, {}).formNo ?? form.formNo, level),
        listenCount: detail.listenCount ?? 0,
        rules: GATE_RULES,
      });
    }
    const id = uuid('lg');
    const questions = buildGateQuestions({ level, userId: uid, form });
    run(
      `INSERT INTO level_gate_attempts (id, user_id, level, status, started_at, materials_json, detail_json, vocab_total, reading_total, listening_total)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, uid, level, 'in_progress', nowIso(), JSON.stringify({ reading: form.reading.id, listening: form.listening.id, formNo: form.formNo }),
        JSON.stringify({ questions, listenCount: 0 }), CONFIG.gate.vocabQuestions, CONFIG.gate.readingQuestions, CONFIG.gate.listeningQuestions],
    );
    res.json({
      attemptId: id,
      questions: sanitizeGateQuestions(questions),
      formNo: form.formNo,
      materials: gateMaterialsPayload(form.formNo, level),
      listenCount: 0,
      rules: GATE_RULES,
    });
  });

  /** 关卡听力只允许完整播放一遍（原速、无字幕） */
  router.post('/gate/listen', requireWrite, requireGroup, (req, res) => {
    const attempt = get('SELECT * FROM level_gate_attempts WHERE id=? AND user_id=?', [req.body?.attemptId, req.auth.user.id]);
    if (!attempt) return res.status(404).json({ error: 'GATE_ATTEMPT_NOT_FOUND' });
    const detail = jsonParse(attempt.detail_json, {});
    const count = Number(detail.listenCount ?? 0) + 1;
    if (count > 1) {
      return res.status(409).json({
        error: 'LISTEN_LIMIT_REACHED',
        message: '关卡听力只允许原速完整播放一遍（首遍作答）。这是为了验证真实迁移能力，不是限制训练。',
        listenCount: detail.listenCount ?? 0,
      });
    }
    run('UPDATE level_gate_attempts SET detail_json=? WHERE id=?', [JSON.stringify({ ...detail, listenCount: count }), attempt.id]);
    res.json({ listenCount: count, allowed: true });
  });

  router.post('/gate/submit', requireWrite, requireGroup, (req, res) => {
    const uid = req.auth.user.id;
    const attempt = get(`SELECT * FROM level_gate_attempts WHERE id=? AND user_id=?`, [req.body?.attemptId, uid]);
    if (!attempt) return res.status(404).json({ error: 'GATE_ATTEMPT_NOT_FOUND' });
    if (attempt.status !== 'in_progress') return res.status(409).json({ error: 'GATE_ALREADY_SUBMITTED' });
    const detail = jsonParse(attempt.detail_json, {});
    const answers = req.body?.answers || {};
    const counts = { vocab: 0, reading: 0, listening: 0 };
    const perQuestion = [];
    for (const [i, q] of (detail.questions || []).entries()) {
      const a = answers[i];
      let correct = false;
      if (a !== undefined && a !== null && String(a).trim() !== '') {
        if (q.type === 'mcq' && Array.isArray(q.choices)) {
          // 客户端可能提交选项序号（"2"）或选项原文，两种都接受，但都对同一依据作答
          const expectedText = String((q.acceptedAnswers || [])[0] ?? '');
          const picked = String(a).trim();
          if (/^\d+$/.test(picked) && Number(picked) < q.choices.length) {
            correct = q.choices[Number(picked)] === expectedText;
          } else {
            correct = picked.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
              === expectedText.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
          }
        } else {
          const norm = String(a).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
          correct = (q.acceptedAnswers || []).map((x) => String(x).toLowerCase()).includes(norm);
        }
      }
      if (correct) counts[q.section] += 1;
      perQuestion.push({ index: i, section: q.section, questionId: q.questionId, correct });
    }
    const vocab = scoreSection({ section: 'vocab', correct: counts.vocab, total: CONFIG.gate.vocabQuestions });
    const reading = scoreSection({ section: 'reading', correct: counts.reading, total: CONFIG.gate.readingQuestions });
    const listening = scoreSection({ section: 'listening', correct: counts.listening, total: CONFIG.gate.listeningQuestions });
    const passed = vocab.passed && reading.passed && listening.passed;
    run(
      `UPDATE level_gate_attempts SET status=?, submitted_at=?, vocab_correct=?, reading_correct=?, listening_correct=?, passed=?, detail_json=? WHERE id=?`,
      [passed ? 'passed' : 'failed', nowIso(), counts.vocab, counts.reading, counts.listening, passed ? 1 : 0,
        JSON.stringify({ ...detail, counts, perQuestion }), attempt.id],
    );
    if (passed) {
      const nextLevel = Math.min(attempt.level + 1, CONFIG.levels.length);
      run('UPDATE users SET level = ? WHERE id = ?', [nextLevel, uid]);
      run('INSERT INTO content_audit (id, actor_user_id, action, target_type, target_id, detail_json, created_at) VALUES (?,?,?,?,?,?,?)',
        [uuid('ca'), uid, 'level_up', 'user', uid, JSON.stringify({ from: attempt.level, to: nextLevel }), nowIso()]);
    }
    res.json({
      passed,
      sections: { vocab, reading, listening },
      unlockedLevel: passed ? Math.min(attempt.level + 1, CONFIG.levels.length) : attempt.level,
      penalty: 0,
      note: '失败保留本级、不扣积分；可隔日再考。',
    });
  });

  /* ---------------------------- 文章与播放 ---------------------------- */
  router.get('/articles/:id', requireAuth, (req, res) => {
    const a = get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'ARTICLE_NOT_FOUND' });
    const group = get('SELECT level FROM word_groups WHERE id = ?', [a.group_id]);
    if (group && group.level > req.auth.user.level) return res.status(403).json({ error: 'LEVEL_LOCKED' });
    const st = articleState(req.auth.user.id, a.id);
    const media = get('SELECT * FROM media_assets WHERE article_id = ?', [a.id]);
    const unlocked = Boolean(st?.unlocked_at);
    const forceUnlock = req.query.unlock === 'review' && st?.unlocked_at; // 已解锁的历史材料可自由重听
    const paragraphs = jsonParse(a.paragraphs_json, []);
    const comprehension = jsonParse(a.comprehension_json, []);
    const base = {
      id: a.id,
      groupId: a.group_id,
      role: a.role,
      title: a.title,
      type: a.type,
      level: a.level,
      topics: jsonParse(a.topics_json, []),
      authors: jsonParse(a.authors_json, []),
      attribution: a.attribution,
      licenseNote: a.license_note,
      textOrigin: a.text_origin,
      translationOrigin: a.translation_origin,
      rightsStatus: a.rights_status,
      wordCount: a.word_count,
      media: media ? {
        id: media.id,
        url: media.url,
        durationSeconds: media.duration_seconds,
        human: Boolean(media.is_human),
        synthetic: Boolean(media.is_synthetic),
        voice: media.voice,
        provider: media.tts_model,
        license: media.license,
        sha256: media.sha256,
        format: media.format,
        verifiedPlayable: Boolean(media.verified_playable),
        alignmentSource: media.alignment_source,
        alignmentPrecision: media.alignment_precision,
      } : null,
      firstListen: {
        hideEnglish: CONFIG.listening.hideEnglishFirstPass && !unlocked,
        hideChinese: CONFIG.listening.hideChineseFirstPass && !unlocked,
        hideGlossary: CONFIG.listening.hideGlossaryFirstPass && !unlocked,
        unlocked,
        unlockedAt: st?.unlocked_at ?? null,
        unlockRule: '真实连续播放区间并集覆盖率 ≥98% 且有自然播放结束证据才会解锁',
      },
      policy: playbackPolicy(),
      progress: st ? { position: st.last_position_seconds, rate: st.last_rate, listenSeconds: st.listen_seconds } : null,
    };
    if (!unlocked) {
      // 首听：只给主题、题目、音频信息，绝不返回正文、译文或词汇释义
      return res.json({ ...base, paragraphs: null, comprehension: null, locked: true });
    }
    const occurrences = all(
      `SELECT word_id, paragraph_index, sentence, form FROM article_word_occurrences WHERE article_id = ? ORDER BY paragraph_index`,
      [a.id],
    );
    res.json({
      ...base,
      locked: false,
      paragraphs: paragraphs.map((p, i) => ({ index: i, en: p.en, zh: p.zh, segments: [{ en: p.en, zh: p.zh, start: null, end: null }] })),
      comprehension,
      occurrences: occurrences.map((o) => ({ wordId: o.word_id, paragraph: o.paragraph_index, sentence: o.sentence, form: o.form })),
      coverage: {
        covered: a.coverage_covered,
        total: 20,
        note: '覆盖率按当组教学材料正文的唯一目标词并集计算；例句栏、标题、释义栏不计。',
      },
    });
  });

  router.get('/articles/:id/glossary', requireAuth, (req, res) => {
    const a = get('SELECT * FROM articles WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'ARTICLE_NOT_FOUND' });
    const st = articleState(req.auth.user.id, a.id);
    if (!st?.unlocked_at) {
      return res.status(423).json({ error: 'LOCKED_FIRST_LISTEN', message: '首听未完成，词汇释义侧栏暂不可用（防止提前泄露答案）' });
    }
    const words = all(
      `SELECT w.*, i.position FROM word_group_items i JOIN words w ON w.id = i.word_id WHERE i.group_id = ? ORDER BY i.position`,
      [a.group_id],
    );
    const occ = all('SELECT word_id, paragraph_index, sentence FROM article_word_occurrences WHERE article_id = ?', [a.id]);
    res.json({
      words: words.map((w) => ({
        id: w.id,
        lemma: w.lemma,
        partOfSpeech: w.part_of_speech,
        coreMeaningZh: w.core_meaning_zh,
        phonetic: w.phonetic,
        collocations: jsonParse(w.collocations_json, []),
        confusionPairs: jsonParse(w.confusion_json, []),
        occurrences: occ.filter((o) => o.word_id === w.id).map((o) => ({ paragraph: o.paragraph_index, sentence: o.sentence })),
      })),
    });
  });

  router.get('/media/:articleId/audio', (req, res) => {
    const media = get('SELECT * FROM media_assets WHERE article_id = ?', [req.params.articleId]);
    if (!media) return res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
    const filePath = media.local_path;
    if (!filePath || !existsSync(filePath)) {
      return res.status(503).json({ error: 'AUDIO_NOT_AVAILABLE', message: '该音频文件缺失（不会用占位文件冒充）' });
    }
    res.setHeader('Content-Type', media.format === 'wav' ? 'audio/wav' : 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.resolve(filePath));
  });

  router.post('/playback/event', requireWrite, (req, res) => {
    const { mediaId, event } = req.body || {};
    try {
      const r = recordPlayback({
        userId: req.auth.user.id,
        mediaId,
        event,
        now: now(),
        timeZone: req.group?.timezone || req.auth.user.timezone,
      });
      res.json(r);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'PLAYBACK_FAILED', message: e.message });
    }
  });

  router.post('/articles/:id/position', requireWrite, (req, res) => {
    saveArticlePosition({ userId: req.auth.user.id, articleId: req.params.id, positionSeconds: req.body?.position, rate: req.body?.rate });
    res.json({ ok: true, syncedAt: nowIso() });
  });

  router.get('/playback/policy', (req, res) => res.json(playbackPolicy()));

  /* ---------------------------- 词汇本 ---------------------------- */
  router.get('/wordbook', requireAuth, (req, res) => {
    const uid = req.auth.user.id;
    const importance = importanceMapForUser(uid);
    const rows = all(
      `SELECT p.*, w.lemma, w.part_of_speech, w.core_meaning_zh, w.topic, w.level, w.id AS wid
       FROM word_progress p JOIN words w ON w.id = p.word_id WHERE p.user_id = ? ORDER BY p.valid_wrong_count DESC, w.lemma`,
      [uid],
    );
    res.json({
      total: rows.length,
      words: rows.map((r) => ({
        wordId: r.wid,
        lemma: r.lemma,
        partOfSpeech: r.part_of_speech,
        coreMeaningZh: r.core_meaning_zh,
        topic: r.topic,
        level: r.level,
        groupId: r.group_id,
        demonstrated: r.demonstrated_count > 0,
        validWrongCount: r.valid_wrong_count,
        importance: (importance.get(r.wid) || { label: '常规', level: 0 }).label,
        archived: Boolean(r.archived),
        firstSeenAt: r.first_seen_at,
        lastCorrectAt: r.last_correct_at,
        lastWrongAt: r.last_wrong_at,
      })),
      legend: CONFIG.vocabulary.importanceLabels,
    });
  });

  /* ---------------------------- 语音 ---------------------------- */
  router.get('/voice/capabilities', requireAuth, async (req, res) => {
    res.json(await voiceCapabilities({ now: now() }));
  });

  router.post('/voice/session', requireWrite, requireGroup, async (req, res) => {
    try {
      const s = await startVoiceSession({ userId: req.auth.user.id, scenarioId: req.body?.scenarioId, mode: req.body?.mode, now: now() });
      res.json(s);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'VOICE_SESSION_FAILED', message: e.message });
    }
  });

  router.post('/voice/turn', requireWrite, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '8mb' }), async (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      const r = await runVoiceTurn({
        sessionId,
        userId: req.auth.user.id,
        audioBuffer: Buffer.isBuffer(req.body) ? req.body : null,
        sampleRate: Number(req.query.sampleRate) || 16000,
        text: req.query.text ? String(req.query.text) : null,
        manualTranscript: req.query.manualTranscript ? String(req.query.manualTranscript) : null,
        now: now(),
      });
      res.json(r);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'VOICE_TURN_FAILED', message: e.message });
    }
  });

  router.post('/voice/turn-text', requireWrite, async (req, res) => {
    try {
      const r = await runVoiceTurn({
        sessionId: req.body?.sessionId, userId: req.auth.user.id,
        audioBuffer: null, text: req.body?.text ?? null, manualTranscript: null, now: now(),
        forceText: true,
      });
      res.json(r);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.code || 'VOICE_TURN_FAILED', message: e.message });
    }
  });

  router.post('/voice/session/:id/end', requireWrite, (req, res) => {
    res.json(endVoiceSession({ sessionId: req.params.id, userId: req.auth.user.id, reason: req.body?.reason || 'user_stopped' }));
  });

  router.get('/voice/scenarios', requireAuth, (req, res) => {
    const level = req.auth.user.level;
    const groups = all(`SELECT * FROM word_groups WHERE level=? AND editorial_status='published' ORDER BY idx LIMIT 5`, [level]);
    res.json({
      scenarios: groups.map((g) => ({ groupId: g.id, groupTitle: g.title, note: '情景定义在课程内容文件的 scenarios 字段中' })),
      mode: 'scenario_constrained',
    });
  });

  /* ---------------------------- 管理 ---------------------------- */
  router.get('/admin/audit', requireAuth, requireAdmin, (req, res) => {
    res.json({
      contentStats: contentStats(),
      recentAudit: all('SELECT * FROM content_audit ORDER BY created_at DESC LIMIT 100'),
      mediaHumanRatio: (() => {
        const row = get('SELECT SUM(is_human) AS h, COUNT(*) AS c FROM media_assets');
        return { human: Number(row.h || 0), total: Number(row.c || 0) };
      })(),
    });
  });

  router.post('/admin/import-content', requireWrite, requireAdmin, async (req, res) => {
    try {
      const r = await importContent({ contentRoot: CONTENT_ROOT });
      run('INSERT INTO content_audit (id, actor_user_id, action, target_type, target_id, detail_json, created_at) VALUES (?,?,?,?,?,?,?)',
        [uuid('ca'), req.auth.user.id, 'import_content', 'course', 'course-v1', JSON.stringify(r), nowIso()]);
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: 'IMPORT_FAILED', message: e.message });
    }
  });

  router.post('/admin/settle', requireWrite, requireAdmin, (req, res) => {
    const actions = settleClosedWeeks({ now: now() });
    res.json({ settled: actions.length, actions });
  });

  /* ---------------------------- 错误处理 ---------------------------- */
  router.use((req, res) => res.status(404).json({ error: 'NOT_FOUND', path: req.path }));

  return router;
}

/* ------------------------- 关卡材料（待补充时明确标记） ------------------------- */

/** 关卡规则文案（客户端与关卡入口共用；规则值全部来自集中配置） */
const GATE_RULES = {
  vocab: `词汇 ${CONFIG.gate.vocabQuestions} 题，首次独立正确 ≥${CONFIG.gate.vocabCorrectMin} 才算达标；补错后满分不能替代这一项。`,
  reading: `未学过的等难度阅读材料 ${CONFIG.gate.readingQuestions} 题，≥${CONFIG.gate.readingCorrectMin} 题正确。`,
  listening: `不同的未学听力材料 ${CONFIG.gate.listeningQuestions} 题，原速、无中英文字、首遍作答，≥${CONFIG.gate.listeningCorrectMin} 题正确。`,
  note: '失败不扣积分，可练习后隔日再考。客户端改 URL / localStorage 不能越级：级别只由服务端判定更新。',
};

/**
 * 关卡材料的可见载荷。
 * 关键：听力材料**绝不返回 transcript**（R08 要求原速、无中英文字、首遍作答）；
 * 阅读材料可以看全文。答案同样不下发。
 */
/**
 * 下发给客户端的关卡题目：**必须剥掉答案**。
 * 只保留题型、题面、提示与选项；vocab 题的 acceptedAnswers 和 mcq 题的正确答案都不能出现。
 */
function sanitizeGateQuestions(questions) {
  return (questions || []).map((q) => ({
    index: q.index,
    section: q.section,
    type: q.type,
    prompt: q.prompt,
    hintZh: q.hintZh ?? null,
    choices: q.type === 'mcq' ? q.choices : undefined,
    questionId: q.questionId,
  }));
}

function gateMaterialsPayload(formNo, level) {
  const rows = all('SELECT * FROM gate_materials WHERE level = ? AND form_no = ?', [level, formNo]);
  const out = {};
  for (const r of rows) {
    const paragraphs = jsonParse(r.paragraphs_json, []);
    if (r.section === 'reading') {
      out.reading = {
        id: r.id,
        title: r.title,
        type: r.type,
        paragraphs: paragraphs.map((p, i) => ({ index: i, en: p.en, zh: p.zh })),
        words: paragraphs.reduce((s, p) => s + String(p.en || '').split(/\s+/).filter(Boolean).length, 0),
        transcriptVisible: true,
        note: '这是你从未学过的材料，用于验证真实迁移能力。',
      };
    } else {
      out.listening = {
        id: r.id,
        title: r.title,
        type: r.type,
        audioUrl: r.audio_url,
        durationSeconds: r.duration_seconds,
        transcript: null,
        transcriptVisible: false,
        listenRules: { speed: 1, transcriptVisible: false, playsAllowed: 1 },
        note: '原速播放、无中英文字；只允许完整播放一遍。',
      };
    }
  }
  return out;
}

function gatePackStatus(level) {
  const rows = all(`SELECT * FROM gate_materials WHERE level = ? ORDER BY form_no, section`, [level]);
  const forms = new Map();
  for (const r of rows) {
    if (!forms.has(r.form_no)) forms.set(r.form_no, { formNo: r.form_no, reading: null, listening: null });
    forms.get(r.form_no)[r.section] = { id: r.id, title: r.title, questionCount: jsonParse(r.questions_json, []).length };
  }
  const complete = [...forms.values()].filter((f) => f.reading && f.listening && f.reading.questionCount === CONFIG.gate.readingQuestions && f.listening.questionCount === CONFIG.gate.listeningQuestions);
  const ready = complete.length >= CONFIG.content.heldoutGateFormsPerLevel;
  return {
    level,
    ready,
    requiredForms: CONFIG.content.heldoutGateFormsPerLevel,
    availableForms: complete.length,
    forms: complete,
    message: ready ? '关卡材料已就绪' : '待补充关卡材料：需要至少 2 套互不相同、且未纳入学习路径的阅读与听力材料。',
  };
}

function buildGateQuestions({ level, userId, form }) {
  const questions = [];
  // 词汇抽测：本级目标词 20 个，首次独立作答（补错后满分不能替代）
  const pool = all(
    `SELECT w.* FROM words w WHERE w.level = ? AND w.id NOT IN (
       SELECT word_id FROM word_progress WHERE user_id = ?
     ) ORDER BY w.id LIMIT ?`,
    [level, userId, CONFIG.gate.vocabQuestions],
  );
  const fallback = all('SELECT * FROM words WHERE level = ? ORDER BY id LIMIT ?', [level, CONFIG.gate.vocabQuestions]);
  const chosen = pool.length >= CONFIG.gate.vocabQuestions ? pool : fallback;
  for (const [i, w] of chosen.entries()) {
    questions.push({
      index: i, section: 'vocab', type: 'definition',
      prompt: w.core_meaning_zh, hintZh: `词性：${w.part_of_speech}`,
      questionId: `gate-${level}-v-${i}`,
      acceptedAnswers: all(`SELECT form FROM word_forms WHERE word_id=? AND kind IN ('canonical','spelling_variant')`, [w.id]).map((r) => r.form),
    });
  }
  for (const section of ['reading', 'listening']) {
    const mat = form[section];
    const row = get('SELECT questions_json FROM gate_materials WHERE id=?', [mat.id]);
    const qs = jsonParse(row?.questions_json, []);
    for (const [i, q] of qs.entries()) {
      questions.push({
        index: questions.length, section, type: 'mcq',
        prompt: q.prompt, choices: q.choices, questionId: q.id || `${section}-${i}`,
        acceptedAnswers: [q.choices[q.answerIndex]],
        materialId: mat.id,
      });
    }
  }
  return questions;
}

/** 两套试卷交替使用，避免重复练习同一套 */
function pickGateForm(forms, userId) {
  const used = new Set(
    all('SELECT materials_json FROM level_gate_attempts WHERE user_id = ?', [userId])
      .map((r) => jsonParse(r.materials_json, {})?.formNo)
      .filter((x) => x !== undefined),
  );
  const unused = forms.filter((f) => !used.has(f.formNo));
  return (unused.length ? unused : forms)[0];
}
