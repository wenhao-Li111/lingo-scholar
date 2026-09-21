#!/usr/bin/env node
/**
 * 启动入口：一条命令同时提供网站与后端 API。
 * 默认只绑定 localhost（不对外开放）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, resolveDbPath } from './app.js';
import { asrAvailability } from '../../../services/voice/src/asr.js';
import { ttsAvailability } from '../../../services/voice/src/tts.js';
import { startJobRunner } from './jobs.js';
import { contentStats } from './content.js';
import { resourceCatalog, resourceDecks } from './resources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();
const server = app.listen(PORT, HOST, async () => {
  const dbPath = resolveDbPath();
  const c = contentStats();
  const r = resourceCatalog();
  const resourceDeckWords = resourceDecks().reduce((total, deck) => total + (deck.words?.length || 0), 0);
  const asr = asrAvailability();
  const tts = await ttsAvailability();
  console.log('');
  console.log('  Lingo Scholar · 听词研习室');
  console.log('  ────────────────────────────────────────────');
  console.log(`  网站入口      http://${HOST}:${PORT}/`);
  console.log(`  健康检查      http://${HOST}:${PORT}/api/health`);
  console.log(`  数据库        ${dbPath}`);
  console.log(`  课程内容      已发布词组 ${c.groups}｜词项 ${c.words}｜材料 ${c.articles}｜可播放音频 ${c.playable_media}`);
  console.log(`  综合资料库    资料 ${r.stats.total}｜可检索 ${r.stats.searchable}｜学习词条 ${resourceDeckWords}（跨词库含重复）`);
  console.log(`  语音 ASR      ${asr.available ? `${asr.modelName}（离线，零费用）` : '未就绪，运行 npm run voice:fetch'}`);
  console.log(`  语音 TTS      ${tts.available ? `${tts.voice}（本地合成）` : '未就绪'}`);
  console.log('  停止方式      Ctrl + C');
  console.log('');
});

startJobRunner({ intervalMs: 5 * 60 * 1000 });

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
