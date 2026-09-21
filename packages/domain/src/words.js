/**
 * 词项与答案判定（R01 / R02）。
 * 原则：
 *  - 允许 Unicode 正规化、首尾空白清理、通常不计大小写。
 *  - 词条显式声明的英美拼写变体可接受；同义词不能代替本组目标词。
 *  - 词形由题目 accepted_answers 明确规定，不泛化接受所有词形。
 */

import { CONFIG } from './config.js';

/** 答案正规化：NFKC + 折叠常见排版引号/连字符 + 去首尾空白 + 折叠内部空白 + 小写 */
export function normalizeAnswer(input) {
  if (input === null || input === undefined) return '';
  let s = String(input);
  s = s.normalize('NFKC');
  // 折叠排版引号
  s = s.replace(/[\u2018\u2019\u02BC\u2032]/g, "'");
  s = s.replace(/[\u201C\u201D]/g, '"');
  // 折叠各种连字符
  s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-');
  s = s.replace(/\s+/g, ' ');
  s = s.trim().toLowerCase();
  return s;
}

/**
 * 词形派生用的简易词干折叠（仅用于展示与相似度提示，不用于判定得分）。
 * 先把 y/ies/ied 这类不规则变化折到同一个基形，否则 utility 与 utilities 会被判成不同词。
 */
export function roughStem(word) {
  let w = normalizeAnswer(word).replace(/[^a-z'\- ]/g, '');
  // y 类变化：辅音 + ies/ied/ier/iest → y
  w = w.replace(/([^aeiou])ies$/, '$1y')
    .replace(/([^aeiou])ied$/, '$1y')
    .replace(/([^aeiou])ier$/, '$1y')
    .replace(/([^aeiou])iest$/, '$1y');
  for (const suf of ['ational', 'iveness', 'fulness', 'ousness', 'ization', 'ations', 'ingly', 'ments', 'ness', 'tion', 'sion', 'ance', 'ence', 'able', 'ible', 'ally', 'ing', 'ers', 'est', 'ess', 'ed', 'es', 'ly', 's']) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

/** 把 `ies/ied` 类词形折成基形，供词干比较使用 */
export function foldYForms(word) {
  return roughStem(word);
}

/**
 * 判定一道默写题的作答。
 * @param {string} rawAnswer 用户输入
 * @param {object} question   { acceptedAnswers: string[], requiredForm?: 'single'|'plural'|'verb', answerCanonical: string }
 * @returns {{ correct: boolean, reason: string, normalized: string }}
 */
export function gradeSpelling(rawAnswer, question) {
  const normalized = normalizeAnswer(rawAnswer);
  if (!normalized) {
    return { correct: false, reason: 'empty', normalized };
  }
  const accepted = (question.acceptedAnswers || []).map(normalizeAnswer);
  const canonical = normalizeAnswer(question.answerCanonical || accepted[0] || '');

  if (accepted.includes(normalized)) {
    return { correct: true, reason: 'exact', normalized };
  }
  // 显式声明的英美拼写变体已经在 acceptedAnswers 里，无需额外宽松匹配。
  // 只额外容忍一种情况：短语内部的连字符/空格互换（如 well-being / wellbeing）
  const squashed = normalized.replace(/[-\s]/g, '');
  for (const a of accepted) {
    if (squashed && squashed === a.replace(/[-\s]/g, '')) {
      return { correct: true, reason: 'spacing-variant', normalized };
    }
  }
  if (canonical && roughStem(normalized) === roughStem(canonical) && normalized !== canonical) {
    return { correct: false, reason: 'wrong-form', normalized };
  }
  return { correct: false, reason: 'incorrect', normalized };
}

/**
 * 同义词检测：用于给用户更精准的反馈（“你写的是同义词，本组要求目标词原文”）。
 * 仅当题目作者显式给出 synonymHints 时才提示，不做自动语义判断。
 */
export function matchSynonymHint(normalizedAnswer, question) {
  const hints = question.synonymHints || [];
  const n = normalizeAnswer(normalizedAnswer);
  for (const h of hints) {
    if (Array.isArray(h.answers) && h.answers.map(normalizeAnswer).includes(n)) return h.label || h.answers[0];
    if (typeof h === 'string' && normalizeAnswer(h) === n) return h;
  }
  return null;
}

/** 重要等级：0次常规；1次关注；2–3次重点；4–6次高频错；>=7次顽固错 */
export function importanceOf(validWrongCount) {
  const n = Number(validWrongCount) || 0;
  const ranges = CONFIG.vocabulary.importanceErrorRanges;
  for (let i = 0; i < ranges.length; i += 1) {
    const [min, max] = ranges[i];
    if (n >= min && (max === null || n <= max)) {
      return { level: i, label: CONFIG.vocabulary.importanceLabels[i] };
    }
  }
  const last = ranges.length - 1;
  return { level: last, label: CONFIG.vocabulary.importanceLabels[last] };
}

export function isHighFrequencyError(validWrongCount) {
  return (Number(validWrongCount) || 0) >= CONFIG.vocabulary.highErrorMinimumWrongSubmissions;
}

/**
 * 组内完成度：20 词各自至少一次“无提示正确回忆”后 mastery=100%。
 * demonstrated 集合由服务端维护（只有服务端确认的正确作答才写入）。
 */
export function correctedMasteryPercent(demonstratedWordIds, totalWords = CONFIG.plan.newWordGroupSize) {
  const unique = new Set(demonstratedWordIds);
  if (totalWords <= 0) return 0;
  return Math.min(100, Math.round((unique.size / totalWords) * 100));
}

export function isGroupComplete(demonstratedWordIds, totalWords = CONFIG.plan.newWordGroupSize) {
  return new Set(demonstratedWordIds).size >= totalWords;
}

/** 词项身份：lemma + part_of_speech 决定 canonical word_id；义项另存。 */
export function canonicalWordKey(lemma, partOfSpeech) {
  return `${normalizeAnswer(lemma)}|${String(partOfSpeech || '').toLowerCase()}`;
}
