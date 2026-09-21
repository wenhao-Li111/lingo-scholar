#!/usr/bin/env node
/**
 * 一次性初始化：创建数据库、导入课程内容、生成 bootstrap 令牌。
 * 令牌只在本次输出中展示一次，不写入仓库。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, getMeta, setMeta, nowIso, tableCount } from '../apps/server/src/db.js';
import { importContent, CONTENT_ROOT, contentStats } from '../apps/server/src/content.js';
import { issueBootstrapToken, hasAnyUser } from '../apps/server/src/auth.js';
import { resolveDbPath } from '../apps/server/src/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const dbPath = resolveDbPath();
  console.log('== 初始化 Lingo Scholar ==');
  openDatabase(dbPath);
  console.log(`数据库：${dbPath}`);

  const r = await importContent({ contentRoot: CONTENT_ROOT, log: (m) => console.log(`  ${m}`) });
  setMeta('content_seeded_at', nowIso());
  setMeta('content_seed_summary', JSON.stringify(r));

  const c = contentStats();
  console.log('');
  console.log('课程内容统计：');
  console.log(`  已发布词组：${c.groups}`);
  console.log(`  词项：${c.words}`);
  console.log(`  教学材料：${c.articles}`);
  console.log(`  可播放音频：${c.playable_media}（其中真人录音 ${c.human_media}）`);

  console.log('');
  if (!hasAnyUser()) {
    const { token, expiresAt } = issueBootstrapToken({ ttlMinutes: 120 });
    console.log('== 首次管理员令牌（只显示这一次）==');
    console.log(`  ${token}`);
    console.log(`  有效期至：${expiresAt}`);
    console.log('  使用方式：打开网站首页 → “创建管理员”，粘贴上面的令牌。');
    console.log('  说明：默认关闭公开注册；朋友通过你生成的邀请链接加入。');
  } else {
    console.log(`已存在 ${tableCount('users')} 个账号，跳过 bootstrap 令牌生成。`);
    console.log('如需重发令牌：npm run bootstrap-token');
  }
  console.log('');
  console.log('下一步：npm start  然后访问 http://127.0.0.1:5173/');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('初始化失败：', e);
  process.exit(1);
});
