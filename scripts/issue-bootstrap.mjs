#!/usr/bin/env node
/** 重新签发 bootstrap 令牌（仅用于尚未创建管理员，或管理员主动重置） */
import { openDatabase } from '../apps/server/src/db.js';
import { issueBootstrapToken, hasAnyUser } from '../apps/server/src/auth.js';
import { resolveDbPath } from '../apps/server/src/app.js';

openDatabase(resolveDbPath());
if (hasAnyUser() && !process.argv.includes('--force')) {
  console.log('已存在账号。若确实要重新签发，请加 --force（旧令牌立即失效，不会影响已有账号）。');
} else {
  const { token, expiresAt } = issueBootstrapToken({ ttlMinutes: 120 });
  console.log('新的 bootstrap 令牌（只显示这一次）：');
  console.log(token);
  console.log(`有效期至：${expiresAt}`);
}
process.exit(0);
