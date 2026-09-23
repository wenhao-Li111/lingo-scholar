/**
 * Express 应用装配。
 */

import express from 'express';
import {COOKIE_NAME,parseCookies,resolveSession} from './auth.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRouter } from './routes.js';
import { openDatabase, getDatabase, getMeta, setMeta, nowIso } from './db.js';
import { importContent, CONTENT_ROOT, contentStats } from './content.js';
import { RESOURCE_ROOT, resourceDecks } from './resources.js';
import { settleClosedWeeks } from './services/review.js';
import { cleanupTtsCache } from '../../../services/voice/src/tts.js';
import { systemClock, fixedClock } from '@lingo/domain';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export function resolveDbPath() {
  return process.env.LINGO_DB || path.join(PROJECT_ROOT, 'data', 'lingo.db');
}

export function createApp({ clock = systemClock(), autoSeed = true, dbPath = resolveDbPath(), getStarDecks = resourceDecks } = {}) {
  openDatabase(dbPath);
  const db = getDatabase();
  const app = express();
  app.set('trust proxy', process.env.LINGO_TRUST_PROXY==='1' ? 'loopback' : false);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // 课程音频（支持 Range/206，由 sendFile 处理）
  if(process.env.LINGO_PRIVATE_LIBRARY==='1')app.use(['/media','/resources'],(req,res,next)=>{
    if(!resolveSession(parseCookies(req.headers.cookie)[COOKIE_NAME]))return res.status(401).json({error:'UNAUTHENTICATED'});
    next();
  });
  app.use('/media/audio', express.static(path.join(PROJECT_ROOT, 'content', 'audio'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
    },
  }));

  // 语音回合产生的本地 TTS 音频
  const ttsRoot = path.join(process.env.LOCALAPPDATA || PROJECT_ROOT, 'LingoScholar', 'voice', 'tts-cache');
  app.use('/media/tts', express.static(ttsRoot, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
    },
  }));

  // openIELTS 本地学习资料。允许同源嵌入，供站内 PDF 阅读器使用。
  app.use('/resources/supplemental/audio',express.static(path.join(PROJECT_ROOT,'content/resources/supplemental/audio'),{setHeaders(res){res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, max-age=86400');}}));
  app.use('/resources/openielts/files', express.static(path.join(RESOURCE_ROOT, 'files'), {
    setHeaders(res, filePath) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
      res.setHeader('Cache-Control', 'private, max-age=86400');
    },
  }));

  app.use('/resources/supplemental/files', express.static(path.join(PROJECT_ROOT, 'content/resources/supplemental/files'), {
    setHeaders(res) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Cache-Control', 'private, max-age=86400');
    },
  }));

  if (autoSeed) {
    const seeded = getMeta('content_seeded_at');
    const count = contentStats();
    if (!seeded || Number(count.groups) === 0) {
      importContent({ contentRoot: CONTENT_ROOT, log: (m) => console.log(`[seed] ${m}`) }).then((r) => {
        setMeta('content_seeded_at', nowIso());
        setMeta('content_seed_summary', JSON.stringify(r));
      }).catch((e) => console.error('[seed] 内容导入失败:', e.message));
    }
  }

  // 启动补结算：进程重启跨过周截止时也要正确扣分（幂等）
  try {
    const actions = settleClosedWeeks({ now: clock.now() });
    if (actions.length) console.log(`[settle] 启动补结算处理 ${actions.length} 项`);
  } catch (e) {
    console.error('[settle] 启动补结算失败:', e.message);
  }
  try {
    cleanupTtsCache({ maxAgeHours: 24 });
  } catch { /* ignore */ }

  app.use('/api', buildRouter({ clock, getStarDecks }));

  // 前端静态资源（构建产物）；开发时由 Vite 提供
  const webDist = path.join(PROJECT_ROOT, 'apps', 'web', 'dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api|\/media).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  } else {
    app.get('/', (req, res) => {
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Lingo Scholar</title>
<body style="font-family:system-ui;padding:2rem;background:#F7F5EF;color:#172B2D">
<h1>Lingo Scholar · 听词研习室</h1>
<p>前端尚未构建。请运行 <code>npm run build:web</code>，或在开发模式下运行 <code>npm run dev</code>。</p>
<p>API 健康检查：<a href="/api/health">/api/health</a></p></body>`);
    });
  }

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err.message, err.stack?.split('\n')[1]);
    if (res.headersSent) return next(err);
    res.status(status).json({ error: err.code || 'INTERNAL_ERROR', message: status >= 500 ? '服务器内部错误' : err.message });
  });

  app.locals.clock = clock;
  return app;
}

export { fixedClock, systemClock };
