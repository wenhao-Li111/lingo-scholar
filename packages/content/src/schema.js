/**
 * 内容 schema 与校验（C05 / C06）。
 * 这里定义的形状是导入器、校验脚本、覆盖率计算和前端共用的唯一真相。
 */

export const EDITORIAL_STATUS = ['draft', 'published', 'retired'];
export const RIGHTS_STATUS = ['original_work', 'public_domain', 'cc0', 'cc_by', 'cc_by_sa', 'permission_granted', 'link_only', 'unknown'];
export const TEXT_ORIGIN = ['original', 'adapted', 'verbatim'];
export const TRANSLATION_ORIGIN = ['human_existing', 'machine_assisted', 'editorial_original', 'none'];
export const PUBLISHABLE_RIGHTS = new Set(['original_work', 'public_domain', 'cc0', 'cc_by', 'cc_by_sa', 'permission_granted']);

export const PART_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'interjection', 'determiner'];

export function emptyWord() {
  return {
    id: '',
    lemma: '',
    partOfSpeech: '',
    coreMeaningZh: '',
    senseId: '',
    acceptedSpellings: [],
    inflections: [],
    collocations: [],
    confusionPairs: [],
    level: 0,
    topic: '',
    phonetic: null,
    frequencyRank: null,
    source: '',
    license: '',
    cloze: null,
    homographRisk: false,
  };
}

/**
 * 校验单个词项。
 * @returns {string[]} 错误列表（空数组表示通过）
 */
export function validateWord(word, ctx = {}) {
  const errs = [];
  const prefix = ctx.label || word?.id || '(word)';
  if (!word || typeof word !== 'object') return [`${prefix}: 不是对象`];
  if (!word.id || !/^w[0-9a-z_-]+$/i.test(word.id)) errs.push(`${prefix}: id 必须形如 w001`);
  if (!word.lemma || typeof word.lemma !== 'string') errs.push(`${prefix}: lemma 必填`);
  if (!word.partOfSpeech) errs.push(`${prefix}: partOfSpeech 必填`);
  if (!PART_OF_SPEECH.includes(word.partOfSpeech)) errs.push(`${prefix}: partOfSpeech 非法（${word.partOfSpeech}）`);
  if (!word.coreMeaningZh) errs.push(`${prefix}: coreMeaningZh 必填`);
  if (!word.senseId) errs.push(`${prefix}: senseId 必填`);
  if (!Array.isArray(word.acceptedSpellings) || word.acceptedSpellings.length === 0) errs.push(`${prefix}: acceptedSpellings 至少一项`);
  else if (!word.acceptedSpellings.map((s) => String(s).toLowerCase()).includes(String(word.lemma).toLowerCase())) {
    errs.push(`${prefix}: acceptedSpellings 必须包含 lemma 本身`);
  }
  if (!Array.isArray(word.inflections)) errs.push(`${prefix}: inflections 必须为数组`);
  if (!Array.isArray(word.collocations)) errs.push(`${prefix}: collocations 必须为数组`);
  if (!Array.isArray(word.confusionPairs)) errs.push(`${prefix}: confusionPairs 必须为数组`);
  if (!word.topic) errs.push(`${prefix}: topic 必填`);
  if (!word.source) errs.push(`${prefix}: source 必填（来源或 “editorial”）`);
  if (!word.license) errs.push(`${prefix}: license 必填`);
  return errs;
}

/** 歧义检查：同一组内中文释义过于接近且无词性/语境区分 → 拒绝发布（A02） */
export function detectAmbiguousDefinitions(words) {
  const problems = [];
  const norm = (s) => String(s || '').replace(/[；;，,、\s（）()]/g, '').toLowerCase();
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      const a = words[i];
      const b = words[j];
      const na = norm(a.coreMeaningZh);
      const nb = norm(b.coreMeaningZh);
      if (!na || !nb) continue;
      const identical = na === nb;
      const overlapping = na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na));
      if (identical) {
        problems.push({ severity: 'error', code: 'duplicate_definition', words: [a.id, b.id], detail: `中文释义完全相同：“${a.coreMeaningZh}”` });
      } else if (overlapping) {
        // 允许：词性不同，或提供了上下文（cloze）可区分
        const disambiguated = a.partOfSpeech !== b.partOfSpeech || (a.cloze && b.cloze);
        if (!disambiguated) {
          problems.push({ severity: 'error', code: 'ambiguous_definition', words: [a.id, b.id], detail: `释义重叠且无词性/语境区分：“${a.coreMeaningZh}” vs “${b.coreMeaningZh}”` });
        } else {
          problems.push({ severity: 'warn', code: 'near_definition', words: [a.id, b.id], detail: `释义接近，已用词性/语境区分：“${a.coreMeaningZh}” vs “${b.coreMeaningZh}”` });
        }
      }
    }
  }
  return problems;
}

export function validateWordGroup(group, ctx = {}) {
  const errs = [];
  const warns = [];
  const label = group?.id || '(group)';
  if (!group || typeof group !== 'object') return { errors: [`${label}: 不是对象`], warnings: [] };
  for (const k of ['id', 'version', 'level', 'index', 'title', 'topic', 'editorialStatus', 'words', 'materials']) {
    if (group[k] === undefined || group[k] === null) errs.push(`${label}: 缺少字段 ${k}`);
  }
  if (!Array.isArray(group.words)) errs.push(`${label}: words 必须是数组`);
  else if (group.words.length !== 20) errs.push(`${label}: 每个正式词组必须恰好 20 个词项，当前 ${group.words.length}`);

  const ids = new Set();
  for (const w of group.words || []) {
    errs.push(...validateWord(w, { label: `${label}/${w?.id}` }));
    if (ids.has(w.id)) errs.push(`${label}: 词项 id 重复 ${w.id}`);
    ids.add(w.id);
    if (w.level !== group.level) errs.push(`${label}/${w.id}: level (${w.level}) 与组级别 (${group.level}) 不一致`);
    if (!w.cloze || !w.cloze.en || !w.cloze.answer || !w.cloze.hintZh) {
      errs.push(`${label}/${w.id}: 缺少 cloze {en, answer, hintZh}`);
    } else if (!w.acceptedSpellings.map((s) => String(s).toLowerCase()).includes(String(w.cloze.answer).toLowerCase())) {
      errs.push(`${label}/${w.id}: cloze.answer 必须是 acceptedSpellings 之一`);
    }
  }

  if (!Array.isArray(group.materials) || group.materials.length === 0) errs.push(`${label}: 至少 1 篇主材料`);
  else {
    const maxM = ctx.maxMaterialsPerGroup ?? 3;
    if (group.materials.length > maxM) errs.push(`${label}: 材料最多 ${maxM} 篇，当前 ${group.materials.length}`);
    const mains = group.materials.filter((m) => m.role === 'main');
    if (mains.length !== 1) errs.push(`${label}: 必须恰好 1 篇主材料，当前 ${mains.length}`);
  }

  if (!Array.isArray(group.scenarios) || group.scenarios.length !== 4) {
    errs.push(`${label}: 每组必须 4 个情景练习，当前 ${group.scenarios?.length ?? 0}`);
  }

  const amb = detectAmbiguousDefinitions(group.words || []);
  for (const p of amb) {
    if (p.severity === 'error') errs.push(`${label}: ${p.code} — ${p.detail}`);
    else warns.push(`${label}: ${p.code} — ${p.detail}`);
  }
  return { errors: errs, warnings: warns };
}

export function validateArticle(article, ctx = {}) {
  const errs = [];
  const label = article?.id || '(article)';
  if (!article || typeof article !== 'object') return [`${label}: 不是对象`];
  for (const k of ['id', 'version', 'title', 'type', 'level', 'textOrigin', 'translationOrigin', 'rightsStatus', 'paragraphs']) {
    if (article[k] === undefined || article[k] === null) errs.push(`${label}: 缺少字段 ${k}`);
  }
  if (!['article', 'dialogue'].includes(article.type)) errs.push(`${label}: type 必须为 article/dialogue`);
  if (!TEXT_ORIGIN.includes(article.textOrigin)) errs.push(`${label}: textOrigin 非法`);
  if (!TRANSLATION_ORIGIN.includes(article.translationOrigin)) errs.push(`${label}: translationOrigin 非法`);
  if (!RIGHTS_STATUS.includes(article.rightsStatus)) errs.push(`${label}: rightsStatus 非法`);
  if (!Array.isArray(article.paragraphs) || article.paragraphs.length === 0) errs.push(`${label}: 至少一个段落`);
  else {
    article.paragraphs.forEach((p, i) => {
      if (!p.en || !String(p.en).trim()) errs.push(`${label}: 段落 ${i} 缺少英文原文`);
      if (p.zh === undefined) errs.push(`${label}: 段落 ${i} 缺少中文译文（可为空字符串，但字段必须存在）`);
    });
  }
  if (!article.media || !article.media.audioUrl) errs.push(`${label}: 缺少 media.audioUrl（不允许占位音频）`);
  else {
    if (article.media.human === undefined) errs.push(`${label}: media.human 必须显式标注`);
    if (!article.media.durationSeconds || article.media.durationSeconds <= 0) errs.push(`${label}: media.durationSeconds 必须 > 0`);
    if (!article.media.license) errs.push(`${label}: media.license 必填`);
  }
  if (ctx.publish && !PUBLISHABLE_RIGHTS.has(article.rightsStatus)) {
    errs.push(`${label}: rightsStatus=${article.rightsStatus} 不允许发布（授权不明只能 LINK_ONLY）`);
  }
  const items = article.comprehension || [];
  if (items.length === 0) errs.push(`${label}: 缺少 comprehension 题目`);
  items.forEach((q, i) => {
    if (!q.id) errs.push(`${label}: 题目 ${i} 缺少 id`);
    if (!q.prompt) errs.push(`${label}: 题目 ${i} 缺少 prompt`);
    if (!Array.isArray(q.choices) || q.choices.length < 3) errs.push(`${label}: 题目 ${i} 需要至少 3 个选项`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= (q.choices?.length || 0)) {
      errs.push(`${label}: 题目 ${i} answerIndex 越界`);
    }
    if (!q.evidence) errs.push(`${label}: 题目 ${i} 缺少正文/音频依据（evidence）`);
  });
  return errs;
}

export function validateScenario(scenario, groupWordIds, labelPrefix = '(scenario)') {
  const errs = [];
  const label = scenario?.id || labelPrefix;
  if (!scenario || typeof scenario !== 'object') return [`${label}: 不是对象`];
  for (const k of ['id', 'title', 'role', 'userGoal', 'targetWordIds', 'openingLine', 'branches']) {
    if (scenario[k] === undefined || scenario[k] === null) errs.push(`${label}: 缺少字段 ${k}`);
  }
  if (!Array.isArray(scenario.targetWordIds) || scenario.targetWordIds.length < 3 || scenario.targetWordIds.length > 8) {
    errs.push(`${label}: targetWordIds 应为 3–8 个（每组 4 个情景覆盖 20 词）`);
  } else {
    for (const id of scenario.targetWordIds) if (!groupWordIds.has(id)) errs.push(`${label}: targetWordId ${id} 不属于本组`);
  }
  if (!Array.isArray(scenario.branches) || scenario.branches.length < 2) {
    errs.push(`${label}: 至少 2 个分支（否则只是固定台词）`);
  } else {
    for (const b of scenario.branches) {
      if (!b.id) errs.push(`${label}: 分支缺少 id`);
      if (!Array.isArray(b.when?.anyOf) && !b.when?.default) errs.push(`${label}: 分支 ${b.id} 必须有 when.anyOf 或 when.default`);
      if (!b.reply) errs.push(`${label}: 分支 ${b.id} 缺少 reply`);
    }
    if (!scenario.branches.some((b) => b.when?.default)) errs.push(`${label}: 必须有一个 default 兜底分支`);
  }
  return errs;
}
