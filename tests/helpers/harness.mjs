/**
 * 测试脚手架：每个测试用独立的临时数据库与可注入时钟启动真实服务。
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../apps/server/src/app.js';
import { closeDatabase } from '../../apps/server/src/db.js';
import { importContent, CONTENT_ROOT } from '../../apps/server/src/content.js';
import { fixedClock } from '@lingo/domain';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function startHarness({ startTime = '2026-09-21T09:00:00+08:00', timeZone = 'Asia/Shanghai', seed = true, getStarDecks } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lingo-test-'));
  const dbPath = path.join(dir, 'test.db');
  const clock = fixedClock(startTime, timeZone);
  const app = createApp({ clock, autoSeed: false, dbPath, getStarDecks });
  if (seed) await importContent({ contentRoot: CONTENT_ROOT });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const client = makeClient(baseUrl);

  return {
    baseUrl,
    dbPath,
    clock,
    dir,
    client,
    projectRoot: ROOT,
    async close() {
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      closeDatabase();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
    advanceDays(days) {
      clock.advanceDays(days);
    },
    setNow(iso) {
      clock.set(iso);
    },
  };
}

export function makeClient(baseUrl) {
  let cookie = null;
  let csrf = null;

  async function request(method, url, body, opts = {}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (cookie) headers.cookie = cookie;
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : (opts.raw ? body : JSON.stringify(body)),
      redirect: 'manual',
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      if (pair.startsWith('lingo_session=')) cookie = pair;
    }
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: res.status, body: json, headers: res.headers, raw: text };
  }

  return {
    get: (u, o) => request('GET', u, null, o),
    post: (u, b, o) => request('POST', u, b, o),
    patch: (u, b, o) => request('PATCH', u, b, o),
    setCsrf: (v) => { csrf = v; },
    getCsrf: () => csrf,
    setCookie: (v) => { cookie = v; },
    getCookie: () => cookie,
    baseUrl,
  };
}

/** 用一次性令牌创建管理员，并同步 CSRF */
export async function bootstrapAdmin(client, { email = 'owner@example.com', password = 'HarbourLantern7', displayName = '组长', token = null } = {}) {
  const { issueBootstrapToken } = await import('../../apps/server/src/auth.js');
  const t = token || issueBootstrapToken({ ttlMinutes: 60 }).token;
  const res = await client.post('/api/bootstrap', { token: t, email, password, displayName, groupName: '测试小组' });
  if (res.body?.csrfToken) client.setCsrf(res.body.csrfToken);
  return res;
}

/** 通过邀请创建普通成员 */
export async function inviteMember(client, { email, password = 'MeadowCompass9', displayName }) {
  const inv = await client.post('/api/invites', { ttlDays: 7, maxUses: 1 });
  const newClient = makeClient(client.baseUrl);
  const join = await newClient.post('/api/join', { token: inv.body.invite.token, email, password, displayName });
  if (join.body?.csrfToken) newClient.setCsrf(join.body.csrfToken);
  return { client: newClient, invite: inv.body.invite, join };
}
