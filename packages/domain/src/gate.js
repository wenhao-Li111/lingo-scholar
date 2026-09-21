/**
 * 五级晋级（R08）。
 * 所有账号从 L1 开始；客户端改 URL / localStorage / 请求体都不能越级——
 * 判定完全在服务端，依据已入库的学习事实。
 */

import { CONFIG, LEVEL_BY_ID } from './config.js';

export const GATE_REQUIREMENTS = Object.freeze({
  vocabQuestions: CONFIG.gate.vocabQuestions,
  vocabCorrectMin: CONFIG.gate.vocabCorrectMin,
  readingQuestions: CONFIG.gate.readingQuestions,
  readingCorrectMin: CONFIG.gate.readingCorrectMin,
  listeningQuestions: CONFIG.gate.listeningQuestions,
  listeningCorrectMin: CONFIG.gate.listeningCorrectMin,
});

/**
 * 晋级资格（学习任务层面）。
 * @param {object} p
 * @param {number} p.level
 * @param {number} p.completedGroupsInLevel
 * @param {number} p.requiredGroupsInLevel
 * @param {number} p.overdueReviewCount  当前到期未完成的复习数（>0 阻止晋级）
 */
export function checkLevelEligibility({ level, completedGroupsInLevel, requiredGroupsInLevel, overdueReviewCount }) {
  const reasons = [];
  if (CONFIG.gate.requiresAllLevelGroups && completedGroupsInLevel < requiredGroupsInLevel) {
    reasons.push({
      code: 'incomplete_level_groups',
      detail: `本级已完成 ${completedGroupsInLevel}/${requiredGroupsInLevel} 组`,
    });
  }
  if (CONFIG.gate.requiresNoOverdueReview && overdueReviewCount > 0) {
    reasons.push({ code: 'overdue_reviews', detail: `有 ${overdueReviewCount} 项到期未完成复习` });
  }
  return { eligible: reasons.length === 0, reasons };
}

export function levelMeta(level) {
  const lv = LEVEL_BY_ID.get(Number(level));
  if (!lv) throw new Error(`未知级别: ${level}`);
  return lv;
}

/** 单部分判定（边界值严格：18/20 通过，17/20 不通过） */
export function scoreSection({ section, correct, total }) {
  const map = {
    vocab: CONFIG.gate.vocabCorrectMin,
    reading: CONFIG.gate.readingCorrectMin,
    listening: CONFIG.gate.listeningCorrectMin,
  };
  const expected = { vocab: CONFIG.gate.vocabQuestions, reading: CONFIG.gate.readingQuestions, listening: CONFIG.gate.listeningQuestions };
  if (!(section in map)) throw new Error(`未知关卡部分: ${section}`);
  if (total !== expected[section]) {
    return { passed: false, error: 'question_count_mismatch', expected: expected[section], actual: total };
  }
  return { passed: correct >= map[section], required: map[section], correct, total, percent: (correct / total) * 100 };
}

/**
 * 整关判定：三部分都独立达标才解锁下一级。
 * independentFirstPassCorrect 是首次独立作答的正确数（不能用补错后满分替代）。
 */
export function evaluateGateAttempt({ level, vocab, reading, listening, materials }) {
  const sections = {
    vocab: scoreSection({ section: 'vocab', correct: vocab.firstPassCorrect, total: vocab.total }),
    reading: scoreSection({ section: 'reading', correct: reading.firstPassCorrect, total: reading.total }),
    listening: scoreSection({ section: 'listening', correct: listening.firstPassCorrect, total: listening.total }),
  };

  const materialErrors = [];
  if (CONFIG.gate.requireUnseenDistinctReadingListening) {
    if (!materials || materials.readingArticleId === materials.listeningArticleId) {
      materialErrors.push('阅读与听力不得复用同一篇材料');
    }
    if (materials?.readingArticleId && materials?.readingAlreadyStudied) {
      materialErrors.push('阅读材料必须未在该账号学习过');
    }
    if (materials?.listeningArticleId && materials?.listeningAlreadyStudied) {
      materialErrors.push('听力材料必须未在该账号学习过');
    }
  }
  const allPassed = sections.vocab.passed && sections.reading.passed && sections.listening.passed && materialErrors.length === 0;
  return {
    level,
    sections,
    materialErrors,
    passed: allPassed,
    unlockedLevel: allPassed ? Math.min(Number(level) + 1, CONFIG.levels.length) : Number(level),
    reward: CONFIG.gate.reward,
    /** 失败不扣分，可隔日再考 */
    penalty: 0,
  };
}

export function nextLevel(level) {
  const n = Number(level);
  return n >= CONFIG.levels.length ? null : n + 1;
}

export function gateQuestionPlan(level) {
  const lv = levelMeta(level);
  return {
    level: lv.id,
    levelName: lv.name,
    vocab: { questions: CONFIG.gate.vocabQuestions, needCorrect: CONFIG.gate.vocabCorrectMin, pool: `L${lv.id} 本级目标词` },
    reading: { questions: CONFIG.gate.readingQuestions, needCorrect: CONFIG.gate.readingCorrectMin, rules: '未学过的等难度阅读材料；不得与听力复用' },
    listening: { questions: CONFIG.gate.listeningQuestions, needCorrect: CONFIG.gate.listeningCorrectMin, rules: `原速 ${CONFIG.gate.listenSpeed}x、无字幕、首遍作答` },
  };
}
