/**
 * 定时任务与补结算。
 * 说明：不能依赖用户打开网页才触发罚分；进程重启也要能补算（幂等）。
 * 浏览器/Service Worker 的后台定时不可靠，因此调度必须发生在服务端。
 */

import { nowIso, run, uuid } from './db.js';
import { settleClosedWeeks } from './services/review.js';
import { cleanupTtsCache } from '../../../services/voice/src/tts.js';
import { systemClock } from '@lingo/domain';

export function runDueJobs({ clock = systemClock() } = {}) {
  const now = clock.now();
  const results = {};
  try {
    results.weeklySettlement = settleClosedWeeks({ now });
  } catch (e) {
    results.weeklySettlementError = e.message;
  }
  try {
    results.ttsCleanup = cleanupTtsCache({ maxAgeHours: 24 });
  } catch (e) {
    results.ttsCleanupError = e.message;
  }
  run(
    `INSERT INTO job_runs (id, name, started_at, finished_at, detail_json) VALUES (?,?,?,?,?)`,
    [uuid('jr'), 'scheduled_suite', now.toISOString(), nowIso(), JSON.stringify({
      settlements: results.weeklySettlement?.length ?? 0,
      ttsRemoved: results.ttsCleanup?.removed ?? 0,
    })],
  );
  return results;
}

export function startJobRunner({ intervalMs = 5 * 60 * 1000, clock = systemClock() } = {}) {
  const tick = () => {
    try {
      const r = runDueJobs({ clock });
      if (r.weeklySettlement?.length) console.log(`[jobs] 周结算处理 ${r.weeklySettlement.length} 项`);
    } catch (e) {
      console.error('[jobs] 执行失败:', e.message);
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
