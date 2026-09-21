/**
 * 账号、会话与安全（E04）。
 * - 密码：node:crypto scrypt（带随机盐，恒定时间比较）。
 * - 会话：随机 32 字节 token 只以 SHA-256 哈希落库，HttpOnly Cookie 携带明文。
 * - CSRF：double-submit，写操作必须带 X-CSRF-Token。
 * - 登录限速：内存滑动窗口（进程级，足够单机十人使用）。
 * - bootstrap：首次初始化使用一次性令牌创建管理员，绝不内置 admin/admin。
 */

import crypto from 'node:crypto';
import { all, get, nowIso, run, setMeta, getMeta, tx, uuid } from './db.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SESSION_DAYS = 30;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return { hash: hash.toString('hex'), salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== candidate.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function passwordProblem(password) {
  const pwd = String(password || '');
  if (pwd.length < 10) return '密码至少 10 个字符';
  if (pwd.length > 128) return '密码最多 128 个字符';
  if (!/[A-Za-z]/.test(pwd)) return '密码需包含字母';
  if (!/[0-9]/.test(pwd)) return '密码需包含数字';
  const weak = ['password', 'admin', '12345678', 'qwerty', 'abcd1234'];
  if (weak.some((w) => pwd.toLowerCase().includes(w))) return '密码过于常见';
  return null;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/* ------------------------------- 限速 ------------------------------- */
const buckets = new Map();

export function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
    return { allowed: false, retryAfter };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { allowed: true, remaining: limit - arr.length };
}

export function resetRateLimits() {
  buckets.clear();
}

/* ------------------------------ 用户 ------------------------------ */
export function createUser({ email, displayName, password, role = 'member', timezone = 'Asia/Shanghai', avatarSeed = null }) {
  const problem = passwordProblem(password);
  if (problem) throw Object.assign(new Error(problem), { status: 400, code: 'WEAK_PASSWORD' });
  const mail = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400, code: 'BAD_EMAIL' });
  if (get('SELECT id FROM users WHERE email = ?', [mail])) {
    throw Object.assign(new Error('该邮箱已被注册'), { status: 409, code: 'EMAIL_TAKEN' });
  }
  const { hash, salt } = hashPassword(password);
  const id = uuid('u');
  run(
    `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, avatar_seed, level, timezone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, mail, String(displayName || mail.split('@')[0]).slice(0, 40), hash, salt, role, avatarSeed || crypto.randomBytes(4).toString('hex'), timezone, nowIso()],
  );
  return findUserById(id);
}

export function findUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)]);
}

export function findUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    avatarSeed: row.avatar_seed,
    level: row.level,
    timezone: row.timezone,
    shareVoice: Boolean(row.share_voice),
    createdAt: row.created_at,
    planStartedAt: row.plan_started_at,
    prefs: JSON.parse(row.prefs_json || '{}'),
  };
}

/* ---------------------------- Bootstrap ---------------------------- */
/** 生成一次性 bootstrap 令牌（打印/写入文件，只展示一次），并锁定公开注册。 */
export function issueBootstrapToken({ ttlMinutes = 60 } = {}) {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  setMeta('bootstrap_token_hash', sha256(token));
  setMeta('bootstrap_token_expires_at', expiresAt);
  setMeta('bootstrap_consumed', '0');
  return { token, expiresAt };
}

export function bootstrapConsumed() {
  return getMeta('bootstrap_consumed', '0') === '1';
}

export function hasAnyUser() {
  const row = get('SELECT COUNT(*) AS c FROM users');
  return row && Number(row.c) > 0;
}

export function consumeBootstrap(token) {
  const hash = getMeta('bootstrap_token_hash');
  if (!hash) throw Object.assign(new Error('尚未生成 bootstrap 令牌，请先运行 npm run bootstrap-token'), { status: 400, code: 'NO_BOOTSTRAP' });
  if (getMeta('bootstrap_consumed', '0') === '1') throw Object.assign(new Error('bootstrap 令牌已被使用'), { status: 409, code: 'BOOTSTRAP_CONSUMED' });
  const exp = getMeta('bootstrap_token_expires_at');
  if (exp && Date.now() > Date.parse(exp)) throw Object.assign(new Error('bootstrap 令牌已过期'), { status: 410, code: 'BOOTSTRAP_EXPIRED' });
  if (sha256(token) !== hash) throw Object.assign(new Error('bootstrap 令牌不正确'), { status: 403, code: 'BOOTSTRAP_INVALID' });
  setMeta('bootstrap_consumed', '1');
  setMeta('bootstrap_token_hash', '');
  return true;
}

/* ----------------------------- 会话 ----------------------------- */
export function createSession(userId, userAgent = '') {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const id = uuid('s');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run(
    'INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, user_agent) VALUES (?,?,?,?,?,?,?)',
    [id, userId, sha256(token), csrf, nowIso(), expires, String(userAgent).slice(0, 200)],
  );
  run('UPDATE users SET last_seen_at = ? WHERE id = ?', [nowIso(), userId]);
  return { token, csrf, expiresAt: expires, sessionId: id };
}

export function resolveSession(token) {
  if (!token) return null;
  const row = get(
    `SELECT s.*, u.id AS uid FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
    [sha256(token)],
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  const user = findUserById(row.user_id);
  if (!user) return null;
  return { session: row, user };
}

export function revokeSession(token) {
  if (!token) return;
  run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [nowIso(), sha256(token)]);
}

export function revokeAllSessions(userId) {
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), userId]);
}

/* --------------------------- Cookie 工具 --------------------------- */
export const COOKIE_NAME = 'lingo_session';
export const CSRF_HEADER = 'x-csrf-token';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch { /* malformed cookies are ignored */ } }
  }
  return out;
}

export function sessionCookie(token, { secure = process.env.LINGO_SECURE_COOKIES === '1', maxAgeSeconds = SESSION_DAYS * 86400 } = {}) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return sessionCookie('', { maxAgeSeconds: 0 });
}

/* --------------------------- 邀请 --------------------------- */
export function createInvite({ groupId, createdBy, ttlDays = 7, maxUses = 1, note = null }) {
  const token = randomToken(24);
  const id = uuid('inv');
  const expires = new Date(Date.now() + ttlDays * 86400000).toISOString();
  run(
    'INSERT INTO invites (id, token_hash, group_id, created_by, created_at, expires_at, max_uses, uses, note) VALUES (?,?,?,?,?,?,?,0,?)',
    [id, sha256(token), groupId, createdBy, nowIso(), expires, maxUses, note],
  );
  return { id, token, expiresAt: expires, ttlDays };
}

export function findInviteByToken(token) {
  return get('SELECT * FROM invites WHERE token_hash = ?', [sha256(token)]);
}

export function revokeInvite(inviteId, actorUserId) {
  run('UPDATE invites SET revoked_at = ? WHERE id = ?', [nowIso(), inviteId]);
  return { inviteId, actorUserId };
}

export function consumeInvite(inviteId) {
  return tx(() => {
    const row = get('SELECT * FROM invites WHERE id = ?', [inviteId]);
    if (!row) throw Object.assign(new Error('邀请不存在'), { status: 404 });
    if (row.revoked_at) throw Object.assign(new Error('邀请已被撤销'), { status: 410, code: 'INVITE_REVOKED' });
    if (Date.parse(row.expires_at) < Date.now()) throw Object.assign(new Error('邀请已过期'), { status: 410, code: 'INVITE_EXPIRED' });
    if (row.uses >= row.max_uses) throw Object.assign(new Error('邀请已被使用'), { status: 410, code: 'INVITE_USED' });
    run('UPDATE invites SET uses = uses + 1 WHERE id = ?', [inviteId]);
    return row;
  });
}

export function listGroupMembers(groupId) {
  return all(
    `SELECT m.user_id, m.role, m.joined_at, u.display_name, u.level, u.avatar_seed, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = ? AND m.left_at IS NULL ORDER BY m.joined_at ASC`,
    [groupId],
  );
}

export function groupMemberCount(groupId) {
  const row = get('SELECT COUNT(*) AS c FROM memberships WHERE group_id = ? AND left_at IS NULL', [groupId]);
  return row ? Number(row.c) : 0;
}
