/**
 * 内容载入与批量校验。
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { validateWordGroup, validateArticle, validateScenario, PUBLISHABLE_RIGHTS } from './schema.js';
import { computeCoverage, detectWordDumping } from './coverage.js';
import { listGateFiles, validateGatePack } from './gates.js';

export const CONTENT_ROOT_DEFAULT = path.resolve(process.cwd(), 'content');

export async function listGroupFiles(contentRoot = CONTENT_ROOT_DEFAULT) {
  const coursesDir = path.join(contentRoot, 'courses');
  if (!existsSync(coursesDir)) return [];
  const out = [];
  for (const levelDir of await readdir(coursesDir)) {
    const full = path.join(coursesDir, levelDir);
    if (!(await stat(full)).isDirectory()) continue;
    for (const f of await readdir(full)) {
      if (f.endsWith('.json')) out.push({ level: levelDir, file: path.join(full, f) });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export async function loadGroup(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/** 校验单个组，返回 { errors, warnings, coverage } */
export function auditGroup(group, opts = {}) {
  const { errors, warnings } = validateWordGroup(group, opts);
  const articleErrors = [];
  for (const m of group.materials || []) {
    articleErrors.push(...validateArticle(m, { publish: group.editorialStatus === 'published' }));
  }
  const ids = new Set((group.words || []).map((w) => w.id));
  const scenarioErrors = [];
  for (const s of group.scenarios || []) scenarioErrors.push(...validateScenario(s, ids));

  const coverage = computeCoverage(group.words || [], group.materials || []);
  const dumping = detectWordDumping(group.materials || []);
  const coverageErrors = [];
  const min = opts.articleTargetWordMinimum ?? 14;
  if (group.editorialStatus === 'published' && coverage.covered < min) {
    coverageErrors.push(`${group.id}: 文章覆盖率 ${coverage.covered}/20 低于 ${min}`);
  }
  for (const d of dumping) coverageErrors.push(`${group.id}/${d.materialId} 段落 ${d.paragraph}: ${d.detail}`);

  return {
    errors: [...errors, ...articleErrors, ...scenarioErrors, ...coverageErrors],
    warnings,
    coverage,
  };
}

export async function auditAll(contentRoot = CONTENT_ROOT_DEFAULT) {
  const files = await listGroupFiles(contentRoot);
  const results = [];
  const canonicalKeys = new Map();
  const wordIdOwners = new Map();
  for (const { file } of files) {
    const group = await loadGroup(file);
    const audit = auditGroup(group);
    results.push({ file, group, ...audit });
    for (const w of group.words || []) {
      const key = `${String(w.lemma).toLowerCase()}|${String(w.partOfSpeech).toLowerCase()}`;
      if (canonicalKeys.has(key)) {
        audit.errors.push(`跨组核心词重复: ${key}（${canonicalKeys.get(key)} 与 ${group.id}）`);
      } else canonicalKeys.set(key, group.id);
      if (wordIdOwners.has(w.id)) {
        audit.errors.push(`词项 id 全局重复: ${w.id}（${wordIdOwners.get(w.id)} 与 ${group.id}）`);
      } else wordIdOwners.set(w.id, group.id);
    }
  }
  return results;
}

/** 返回可直接入库的“已发布”内容 */
export async function loadPublishedContent(contentRoot = CONTENT_ROOT_DEFAULT) {
  const audits = await auditAll(contentRoot);
  const published = audits.filter((a) => a.group.editorialStatus === 'published' && a.errors.length === 0);
  const rejected = audits.filter((a) => a.group.editorialStatus === 'published' && a.errors.length > 0);
  return { published, rejected, all: audits };
}

export function rightsIsPublishable(rightsStatus) {
  return PUBLISHABLE_RIGHTS.has(rightsStatus);
}

/* --------------------------- 关卡材料 --------------------------- */

/** 用于跨材料去重的正文指纹：取全部英文段落的前若干字符归一化 */
export function textFingerprint(material) {
  return (material.paragraphs || [])
    .map((p) => String(p.en || ''))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * 载入并校验全部关卡材料。
 * 同时检查：关卡材料不得与学习路径中的任何材料正文重复（防止用背熟的文章冒充陌生迁移测试）。
 */
export async function loadGateMaterials(contentRoot = CONTENT_ROOT_DEFAULT, options = {}) {
  const files = listGateFiles(contentRoot);
  const materials = [];
  const parseErrors = [];
  for (const file of files) {
    try {
      materials.push(JSON.parse(await readFile(file, 'utf8')));
    } catch (e) {
      parseErrors.push(`${path.basename(file)}: JSON 解析失败 — ${e.message}`);
    }
  }

  // 学习路径正文指纹（拒绝重复）
  const courseAudits = await auditAll(contentRoot);
  const courseFingerprints = new Map();
  for (const a of courseAudits) {
    for (const m of a.group.materials || []) courseFingerprints.set(textFingerprint(m), `${a.group.id}/${m.id}`);
  }

  const byLevel = new Map();
  for (const m of materials) {
    if (!byLevel.has(m.level)) byLevel.set(m.level, []);
    byLevel.get(m.level).push(m);
  }

  const packs = [];
  const errors = [...parseErrors];
  for (const [level, list] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const pack = validateGatePack(list, {
      level,
      requiredForms: options.heldoutGateFormsPerLevel ?? 2,
      questionCounts: { reading: 10, listening: 10 },
    });
    // 与学习路径查重
    for (const m of list) {
      const fp = textFingerprint(m);
      if (courseFingerprints.has(fp)) {
        const msg = `L${level} 关卡材料 ${m.id} 与学习路径材料 ${courseFingerprints.get(fp)} 正文重复`;
        pack.errors.push(msg);
        errors.push(msg);
      }
      for (const [k, owner] of courseFingerprints) {
        if (k && fp && k.length > 40 && (k.includes(fp.slice(0, 40)) || fp.includes(k.slice(0, 40)))) {
          const msg = `L${level} 关卡材料 ${m.id} 与学习路径材料 ${owner} 高度相似`;
          if (!pack.warnings.includes(msg)) pack.warnings.push(msg);
        }
      }
    }
    errors.push(...pack.errors);
    packs.push(pack);
  }

  return { files, materials, byLevel, packs, errors, warnings: packs.flatMap((p) => p.warnings) };
}

/** 把关卡材料转成数据库行形状 */
export function gateMaterialRow(material, courseVersion = 'course-v1') {
  return {
    id: material.id,
    level: material.level,
    formNo: material.formNo,
    section: material.section,
    title: material.title,
    type: material.type,
    textOrigin: material.textOrigin || 'original',
    rightsStatus: material.rightsStatus || 'original_work',
    paragraphs: material.paragraphs || [],
    questions: material.questions || [],
    audioUrl: material.media?.audioUrl ?? null,
    durationSeconds: material.media?.durationSeconds ?? null,
    transcriptHidden: material.section === 'listening' ? true : false,
    courseVersion,
  };
}
