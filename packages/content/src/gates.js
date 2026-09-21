/**
 * 关卡材料（gate materials）的读取与校验。
 *
 * 硬性要求（对应 RULES R08 与 config.gate）：
 *  - 每个级别至少 2 套；每套必须有 1 篇阅读 + 1 篇听力，且二者不得是同一篇。
 *  - 每部分恰好 10 题，每题 4 个选项、answerIndex 合法、必须有 evidence。
 *  - 材料必须与学习路径（content/courses/**）完全不同，不能拿背熟的文章冒充陌生迁移测试。
 *  - 听力材料必须有真实可播放音频（durationSeconds > 0）才算就绪。
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

export const GATE_SECTIONS = ['reading', 'listening'];

/** 递归列出 content/gates/** 下的所有 json（按 level 目录分） */
export function listGateFiles(contentRoot) {
  const dir = path.join(contentRoot, 'gates');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const levelDir of readdirSync(dir)) {
    const full = path.join(dir, levelDir);
    if (!statSync(full).isDirectory()) continue;
    for (const f of readdirSync(full)) if (f.endsWith('.json')) out.push(path.join(full, f));
  }
  return out.sort();
}

/** 校验单份关卡材料。ctx.expectedSection 用于确认文件位置与声明一致。 */
export function validateGateMaterial(material, ctx = {}) {
  const errs = [];
  const warns = [];
  const label = material?.id || ctx.file || '(gate)';

  if (!material || typeof material !== 'object') return { errors: [`${label}: 不是对象`], warnings: [] };
  for (const k of ['id', 'level', 'formNo', 'section', 'title', 'type', 'paragraphs', 'questions']) {
    if (material[k] === undefined || material[k] === null) errs.push(`${label}: 缺少字段 ${k}`);
  }
  if (!GATE_SECTIONS.includes(material.section)) errs.push(`${label}: section 必须为 reading 或 listening`);
  if (!Number.isInteger(material.level) || material.level < 1 || material.level > 5) errs.push(`${label}: level 必须是 1–5`);
  if (!Number.isInteger(material.formNo) || material.formNo < 1) errs.push(`${label}: formNo 必须是正整数`);
  if (!['article', 'dialogue'].includes(material.type)) errs.push(`${label}: type 必须为 article 或 dialogue`);
  if (material.rightsStatus !== 'original_work' && material.rightsStatus !== 'public_domain' && material.rightsStatus !== 'cc_by' && material.rightsStatus !== 'cc_by_sa') {
    errs.push(`${label}: rightsStatus=${material.rightsStatus} 不允许用于关卡发布`);
  }

  if (!Array.isArray(material.paragraphs) || material.paragraphs.length === 0) {
    errs.push(`${label}: 至少一个段落`);
  } else {
    material.paragraphs.forEach((p, i) => {
      if (!p.en || !String(p.en).trim()) errs.push(`${label}: 段落 ${i} 缺少英文原文`);
      if (p.zh === undefined) errs.push(`${label}: 段落 ${i} 缺少中文译文字段`);
    });
  }

  const questions = Array.isArray(material.questions) ? material.questions : [];
  if (questions.length !== ctx.expectedQuestions) {
    errs.push(`${label}: 必须有 ${ctx.expectedQuestions} 道题，当前 ${questions.length}`);
  }
  const ids = new Set();
  questions.forEach((q, i) => {
    if (!q.id) errs.push(`${label}: 题目 ${i} 缺少 id`);
    else if (ids.has(q.id)) errs.push(`${label}: 题目 id 重复 ${q.id}`);
    else ids.add(q.id);
    if (!q.prompt) errs.push(`${label}: 题目 ${i} 缺少 prompt`);
    if (!Array.isArray(q.choices) || q.choices.length !== 4) errs.push(`${label}: 题目 ${i} 必须恰好 4 个选项，当前 ${q.choices?.length ?? 0}`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= (q.choices?.length || 0)) {
      errs.push(`${label}: 题目 ${i} answerIndex 越界`);
    }
    if (!q.evidence) errs.push(`${label}: 题目 ${i} 缺少 evidence（答案依据）`);
    if (!q.explanation) warns.push(`${label}: 题目 ${i} 缺少 explanation`);
    if (new Set(q.choices || []).size !== (q.choices || []).length) errs.push(`${label}: 题目 ${i} 选项有重复`);
  });

  // 答案分布检查：避免答案全落在同一位置（真实题目应分散）
  if (questions.length >= 8) {
    const dist = [0, 0, 0, 0];
    for (const q of questions) if (Number.isInteger(q.answerIndex) && q.answerIndex < 4) dist[q.answerIndex] += 1;
    if (Math.max(...dist) === questions.length) {
      errs.push(`${label}: 全部答案都在同一个选项位置，疑似占位内容`);
    }
  }

  if (material.section === 'listening') {
    const media = material.media;
    if (!media) errs.push(`${label}: 听力材料必须有 media`);
    else {
      if (!media.audioUrl) errs.push(`${label}: media.audioUrl 必填`);
      if (media.human === undefined) errs.push(`${label}: media.human 必须显式标注`);
      if (!media.speakText || String(media.speakText).length < 80) errs.push(`${label}: media.speakText 缺失或过短`);
      if (!(media.durationSeconds > 0)) errs.push(`${label}: 音频尚未生成（durationSeconds 必须 > 0 才能作为关卡材料）`);
      if (!media.license) errs.push(`${label}: media.license 必填`);
      if (material.transcriptHidden !== true) warns.push(`${label}: 建议显式设置 transcriptHidden=true（关卡听力不得给字幕）`);
    }
  }
  if (material.section === 'reading' && material.media) {
    errs.push(`${label}: 阅读材料不应挂音频`);
  }

  return { errors: errs, warnings: warns };
}

/**
 * 校验整套关卡（一个级别的全部 form）。
 * @returns {{ forms:Array, errors:string[], warnings:string[], readyForms:Array, ready:boolean }}
 */
export function validateGatePack(materials, { level, requiredForms = 2, questionCounts = { reading: 10, listening: 10 } } = {}) {
  const errors = [];
  const warnings = [];
  for (const m of materials) {
    const r = validateGateMaterial(m, { expectedQuestions: questionCounts[m.section] });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }

  const forms = new Map();
  for (const m of materials) {
    if (!forms.has(m.formNo)) forms.set(m.formNo, { formNo: m.formNo, reading: null, listening: null });
    const f = forms.get(m.formNo);
    if (f[m.section]) errors.push(`L${level} form${m.formNo}: ${m.section} 有多份材料`);
    f[m.section] = m;
  }

  const normalized = [];
  for (const f of [...forms.values()].sort((a, b) => a.formNo - b.formNo)) {
    if (!f.reading) errors.push(`L${level} form${f.formNo}: 缺少阅读材料`);
    if (!f.listening) errors.push(`L${level} form${f.formNo}: 缺少听力材料`);
    if (f.reading && f.listening) {
      // 同一套内阅读与听力必须是不同材料
      if (f.reading.id === f.listening.id) errors.push(`L${level} form${f.formNo}: 阅读与听力不能是同一份材料`);
      const sameText = firstParagraph(f.reading) && firstParagraph(f.reading) === firstParagraph(f.listening);
      if (sameText) errors.push(`L${level} form${f.formNo}: 阅读与听力正文相同，存在泄题`);
      normalized.push({
        formNo: f.formNo,
        reading: summary(f.reading),
        listening: summary(f.listening),
        comparable: true,
      });
    }
  }

  // 跨套去重：不同 form 之间也不能重复材料
  const seen = new Map();
  for (const m of materials) {
    const key = normalizeForCompare(firstParagraph(m));
    if (seen.has(key)) errors.push(`L${level}: 材料 ${m.id} 与 ${seen.get(key)} 正文重复`);
    else seen.set(key, m.id);
  }

  const ready = normalized.filter((f) => f.comparable && !errors.some((e) => e.includes(`form${f.formNo}`))).length >= requiredForms;
  return { level, forms: normalized, errors, warnings, readyForms: normalized, ready };
}

function firstParagraph(m) {
  return String(m?.paragraphs?.[0]?.en || '').slice(0, 60).toLowerCase().replace(/\s+/g, ' ').trim();
}
function normalizeForCompare(s) {
  return s;
}
function summary(m) {
  return {
    id: m.id,
    title: m.title,
    type: m.type,
    paragraphs: m.paragraphs.length,
    words: m.paragraphs.reduce((s, p) => s + String(p.en || '').split(/\s+/).filter(Boolean).length, 0),
    questionCount: m.questions.length,
    audioUrl: m.media?.audioUrl ?? null,
    durationSeconds: m.media?.durationSeconds ?? null,
    human: m.media?.human ?? null,
  };
}
