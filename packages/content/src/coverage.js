/**
 * 目标词覆盖率计算（C04 / C06）。
 * 规则：精确子串不算匹配（art 不匹配 part）；词族派生不是同一词项；
 * 覆盖率 = 正文匹配到的唯一目标 word_id 数 / 20；例句栏/标题/释义栏/题目不计。
 */

/** 转义正则 */
function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 允许在短语内部出现的分隔符：空格、连字符、可选撇号 */
function flexiblePhrase(phrase) {
  const parts = String(phrase).trim().split(/[\s\-]+/).filter(Boolean).map(esc);
  return parts.join(`[\\s\\-']+`);
}

/**
 * 为一个词项构建匹配正则。
 * 只使用 lemma + acceptedSpellings + inflections，绝不自动展开词族。
 */
export function buildWordMatcher(word) {
  const forms = new Set();
  for (const s of word.acceptedSpellings || []) forms.add(String(s).trim());
  for (const s of word.inflections || []) forms.add(String(s).trim());
  forms.add(String(word.lemma).trim());
  const cleaned = [...forms].filter(Boolean);
  const pattern = cleaned.map(flexiblePhrase).join('|');
  return {
    regex: new RegExp(`(?<![A-Za-z])(${pattern})(?![A-Za-z])`, 'gi'),
    forms: cleaned,
  };
}

/** 把段落拆成句子，保留字符偏移，便于定位“真实出现句” */
export function splitSentences(text) {
  const out = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (!raw.trim()) continue;
    out.push({ text: raw.trim(), start: m.index, end: m.index + raw.length });
  }
  return out;
}

/**
 * 计算覆盖率。
 * @param {Array} words 本组 20 词
 * @param {Array} materials [{ id, role, paragraphs:[{en,zh,segments?}] }]
 * @param {object} opts { excludeRegions: Array<{materialId, paragraph, note}> }
 * @returns {{ covered:number, total:number, ratio:number, matches:object, unmatched:string[] }}
 */
export function computeCoverage(words, materials, opts = {}) {
  const matches = {};
  const byId = new Map(words.map((w) => [w.id, w]));
  const materialTexts = materials.map((m) => ({
    id: m.id,
    role: m.role,
    paragraphs: (m.paragraphs || []).map((p, i) => ({
      index: i,
      en: String(p.en || ''),
      sentences: splitSentences(String(p.en || '')),
    })),
  }));

  for (const w of words) {
    matches[w.id] = [];
  }

  for (const m of materialTexts) {
    for (const w of words) {
      const { regex } = buildWordMatcher(w);
      for (const p of m.paragraphs) {
        regex.lastIndex = 0;
        let mm;
        while ((mm = regex.exec(p.en)) !== null) {
          const hitStart = mm.index;
          const sentence = p.sentences.find((s) => hitStart >= s.start && hitStart < s.end) || p.sentences[p.sentences.length - 1];
          matches[w.id].push({
            materialId: m.id,
            materialRole: m.role,
            paragraph: p.index,
            form: mm[1],
            sentence: sentence ? sentence.text : p.en.slice(Math.max(0, hitStart - 60), hitStart + 60),
          });
          if (regex.lastIndex === mm.index) regex.lastIndex += 1; // 防零宽
        }
      }
    }
  }

  // 同形异义风险：命中形式与 lemma 不同且不在 inflections 里 → 需要人工确认
  for (const w of words) {
    const inflections = new Set((w.inflections || []).map((s) => String(s).toLowerCase()));
    const accepted = new Set((w.acceptedSpellings || []).map((s) => String(s).toLowerCase()));
    for (const hit of matches[w.id]) {
      const f = String(hit.form).toLowerCase();
      if (!accepted.has(f) && !inflections.has(f) && f !== String(w.lemma).toLowerCase()) {
        hit.needsManualSenseCheck = true;
      }
    }
  }

  const covered = Object.values(matches).filter((arr) => arr.length > 0).length;
  const unmatched = words.filter((w) => matches[w.id].length === 0).map((w) => w.id);
  return {
    covered,
    total: byId.size,
    ratio: byId.size ? covered / byId.size : 0,
    matches,
    unmatched,
  };
}

/**
 * 反向检查：把明显不属于本组但被写进正文的词标出来没有意义；
 * 这里做的是“覆盖率不得靠词表堆砌”检查——检测正文末尾是否出现连续的目标词罗列。
 */
export function detectWordDumping(materials) {
  const problems = [];
  for (const m of materials) {
    for (const [i, p] of (m.paragraphs || []).entries()) {
      const en = String(p.en || '');
      // 逗号分隔的孤立短词序列 >= 8 个，视为词表堆砌
      const chunks = en.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const shortOnes = chunks.filter((c) => c.split(/\s+/).length <= 2 && /^[a-zA-Z\-\s']+$/.test(c));
      if (shortOnes.length >= 8 && shortOnes.length / Math.max(1, chunks.length) > 0.6) {
        problems.push({ materialId: m.id, paragraph: i, detail: '看起来像把词表塞进正文' });
      }
    }
  }
  return problems;
}

export function summarizeCoverageReport(groups) {
  let totalWords = 0;
  let totalCovered = 0;
  const failing = [];
  for (const g of groups) {
    totalWords += g.coverage.total;
    totalCovered += g.coverage.covered;
    if (g.coverage.covered < 14) failing.push({ groupId: g.id, covered: g.coverage.covered });
  }
  return {
    groups: groups.length,
    totalWords,
    totalCovered,
    overallRatio: totalWords ? totalCovered / totalWords : 0,
    groupsBelowTarget: failing,
  };
}
