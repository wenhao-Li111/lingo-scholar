/**
 * 情景限定对话引擎（明确标记为“情景限定模式”，不是通用自由对话）。
 *
 * 诚实边界：
 *  - 只在课程作者编写的分支范围内回应；用户说得不同 → 回应不同（基于关键词 + 槽位 + 当前步骤）。
 *  - 语法反馈只覆盖显式编写的模式；超出能力的回答会明说“未能判断”，绝不返回万能好评。
 *  - 不做发音评估，不返回伪造置信度。
 */

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60',
  seventy: '70', eighty: '80', ninety: '90', hundred: '100',
};

export function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[^A-Za-z0-9'£$.,:\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractSlots(transcript) {
  const t = normalize(transcript);
  const slots = {};
  const money = t.match(/£\s?(\d[\d,]*)/) || t.match(/(\d[\d,]*)\s?(pounds|dollars|euros)/);
  if (money) slots.amount = money[1].replace(/,/g, '');
  const time = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s*(o'clock|oclock|am|pm|in the|on))?/);
  const explicitTime = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|o'clock)?\b/);
  if (explicitTime && Number(explicitTime[1]) >= 0 && Number(explicitTime[1]) <= 24) slots.time = explicitTime[0].trim();
  else if (time) slots.time = time[1];
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const day = days.find((d) => t.includes(d));
  if (day) slots.day = day;
  if (/\b(yes|yeah|yep|sure|of course|correct|right)\b/.test(t)) slots.polarity = 'yes';
  else if (/\b(no|nope|not|never|wrong)\b/.test(t)) slots.polarity = 'no';
  const words = t.split(' ').filter(Boolean);
  for (const w of words) {
    if (NUMBER_WORDS[w] && !slots.number) slots.number = NUMBER_WORDS[w];
  }
  return slots;
}

/** 关键词打分：完整短语命中权重更高 */
export function scoreBranch(branch, transcript) {
  const t = normalize(transcript);
  const keys = branch?.when?.anyOf || [];
  if (!keys.length) return 0;
  let score = 0;
  for (const k of keys) {
    const key = normalize(k);
    if (!key) continue;
    if (key.includes(' ')) {
      if (t.includes(key)) score += 3;
      else {
        const parts = key.split(' ').filter((p) => p.length > 2);
        const hits = parts.filter((p) => t.includes(p)).length;
        if (parts.length && hits === parts.length) score += 2;
      }
    } else if (new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(t)) {
      score += 2;
    }
  }
  return score;
}

export function detectTargetWords(transcript, targetWords) {
  const t = ` ${normalize(transcript)} `;
  const used = [];
  for (const w of targetWords) {
    const forms = [w.lemma, ...(w.acceptedSpellings || []), ...(w.inflections || [])]
      .map(normalize)
      .filter(Boolean);
    const hit = forms.some((f) => new RegExp(`(^|[^a-z])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(t));
    if (hit) used.push(w.id);
  }
  return used;
}

/** 明确编写的语法检查：只在能判断时给结论，其余返回 unknown */
export function grammarFeedback(transcript, grammarFocus = []) {
  const t = String(transcript || '').trim();
  const out = [];
  const lower = normalize(t);
  if (!t) return out;

  if (/\bi\s+(am|'m)\s+(want|need)\b/.test(lower)) {
    out.push({ type: 'grammar', severity: 'error', original: 'I am want / I am need', suggestion: 'I want / I need', reasonZh: 'want 与 need 本身就是动词，前面不加 am。' });
  }
  if (/\bhow much (is|are)?\s*(the\s+)?rent\s*(are|is)\b/.test(lower)) {
    out.push({ type: 'grammar', severity: 'error', original: 'How much the rent are?', suggestion: 'How much is the rent?', reasonZh: 'rent 为不可数名词，be 动词用 is；疑问句需倒装。' });
  }
  if (/\bexplain me\b/.test(lower)) {
    out.push({ type: 'grammar', severity: 'error', original: 'explain me', suggestion: 'explain to me', reasonZh: 'explain 后面接 to + 人。' });
  }
  if (/\b\d+\s*(pound|pounds)\b/.test(lower) && !/£/.test(t)) {
    out.push({ type: 'style', severity: 'info', original: '数字 + pounds', suggestion: '£850 或 eight hundred and fifty pounds', reasonZh: '听力中金额常读成英文单词，写作时用 £ 更简洁。' });
  }
  if (/^\s*(i want|give me)\b/.test(lower)) {
    out.push({ type: 'politeness', severity: 'warn', original: 'I want / Give me', suggestion: "I would like ... / Could you ...?", reasonZh: '电话或服务场景中用 I would like 或 Could you 更礼貌。' });
  }
  for (const g of grammarFocus) {
    if (g.pattern && normalize(g.pattern).startsWith('is it') && lower.startsWith('is it')) {
      out.push({ type: 'grammar', severity: 'info', original: t, suggestion: g.example, reasonZh: g.note });
    }
  }
  return out;
}

/**
 * 处理一个用户回合。
 * @param {object} p
 * @param {object} p.scenario  情景定义（来自课程内容）
 * @param {object} p.session   会话状态 { stepIndex, turns }
 * @param {string} p.transcript
 * @param {Array}  p.targetWords 本情景目标词（含 lemma/acceptedSpellings/inflections）
 * @param {boolean} p.transcriptManuallyEdited 用户是否手工修正过转录
 */
export function runTurn({ scenario, session, transcript, targetWords, transcriptManuallyEdited = false }) {
  const steps = scenario.steps || [];
  const stepIndex = Math.min(session.stepIndex ?? 0, Math.max(0, steps.length - 1));
  const currentStep = steps[stepIndex] || null;
  const slots = extractSlots(transcript);
  const usedTargets = detectTargetWords(transcript, targetWords);
  const expected = currentStep?.expects || [];

  const candidates = (scenario.branches || []).filter((b) => !b.when?.default);
  let best = null;
  let bestScore = 0;
  for (const b of candidates) {
    if (b.when?.step && currentStep && b.when.step !== currentStep.id) continue;
    const s = scoreBranch(b, transcript);
    if (s > bestScore) { best = b; bestScore = s; }
  }
  const fallback = (scenario.branches || []).find((b) => b.when?.default);
  const chosen = bestScore > 0 ? best : fallback;

  const matchedExpected = expected.filter((w) => usedTargets.includes(w));
  const missingExpected = expected.filter((w) => !usedTargets.includes(w));
  const feedback = grammarFeedback(transcript, scenario.grammarFocus);

  if (!best && fallback) {
    feedback.unshift({
      type: 'coverage', severity: 'info',
      original: transcript,
      suggestion: currentStep?.sampleUserLine || '',
      reasonZh: '这句话没有落在当前情景的关键信息上，所以系统没有推进。可以按提示换一种说法。',
    });
  } else if (missingExpected.length) {
    const names = missingExpected
      .map((id) => targetWords.find((w) => w.id === id)?.lemma)
      .filter(Boolean);
    if (names.length) {
      feedback.unshift({
        type: 'target_words', severity: 'warn', original: transcript,
        suggestion: currentStep?.sampleUserLine || '',
        reasonZh: `本轮还没用到这些目标词：${names.join(', ')}。可以再试一次，把它们说出来。`,
      });
    }
  }

  const advance = Boolean(chosen?.advance) && bestScore > 0;
  const nextStepIndex = advance ? Math.min(stepIndex + 1, Math.max(0, steps.length - 1)) : stepIndex;

  return {
    engine: 'scenario_constrained',
    intent: chosen?.id || (best ? best.id : 'no_match'),
    matchedStep: currentStep?.id ?? null,
    slots,
    usedTargetWordIds: usedTargets,
    missingTargetWordIds: missingExpected,
    reply: chosen?.reply || fallback?.reply || 'I did not catch that. Could you say it again?',
    advance,
    stepIndex: nextStepIndex,
    stepHint: steps[nextStepIndex]?.hint ?? null,
    sampleUserLine: steps[nextStepIndex]?.sampleUserLine ?? null,
    referenceAnswer: currentStep?.sampleUserLine
      ? { prompt: currentStep.hint, answer: currentStep.sampleUserLine }
      : null,
    feedback,
    feedbackBasis: transcriptManuallyEdited ? 'manual_transcript' : 'asr_transcript',
    limitations: [
      '仅覆盖本情景编写好的分支，超出的表达会明确说明未识别。',
      '不做发音评估；不给出 IELTS 口语分数。',
      '语法反馈只覆盖已显式编写的模式，未命中不等于没有错误。',
    ],
  };
}

export function scenarioReady(scenario) {
  return Boolean(scenario && scenario.openingLine && Array.isArray(scenario.branches) && scenario.branches.length > 1);
}
