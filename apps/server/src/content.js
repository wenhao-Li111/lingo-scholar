/**
 * 内容导入：把 content/courses/** 中通过发布闸门的词组写入数据库。
 * 幂等：重复运行不会产生重复数据；已发布内容的词项 id 与课程版本保持不变。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, jsonParse, nowIso, run, tx, uuid } from './db.js';
import { loadPublishedContent, loadGateMaterials, gateMaterialRow } from '@lingo/content';
import { CONFIG, COURSE_VERSION, RULES_VERSION } from '@lingo/domain';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');
export const CONTENT_ROOT = path.join(PROJECT_ROOT, 'content');

export async function seedLevels() {
  for (const lv of CONFIG.levels) {
    run(
      `INSERT INTO levels (id, name, groups_target, words_target, suggested_weeks) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, groups_target=excluded.groups_target,
         words_target=excluded.words_target, suggested_weeks=excluded.suggested_weeks`,
      [lv.id, lv.name, lv.groups, lv.words, lv.suggestedWeeks],
    );
  }
  run(
    `INSERT INTO course_versions (id, rules_version, content_version, created_at, note)
     VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`,
    [COURSE_VERSION, RULES_VERSION, COURSE_VERSION, nowIso(), '首次导入'],
  );
}

export async function importContent({ contentRoot = CONTENT_ROOT, log = () => {} } = {}) {
  seedLevels();
  const gated = await importGateMaterials({ contentRoot, log });
  const { published, rejected } = await loadPublishedContent(contentRoot);
  let imported = 0;
  let updated = 0;

  for (const audit of published) {
    const g = audit.group;
    tx(() => {
      const existed = get('SELECT id FROM word_groups WHERE id = ?', [g.id]);
      run(
        `INSERT INTO word_groups (id, code, level, idx, title, topic, version, editorial_status, words_json)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, topic=excluded.topic, editorial_status=excluded.editorial_status,
           version=excluded.version, words_json=excluded.words_json`,
        [g.id, g.code || g.id, g.level, g.index, g.title, g.topic, g.version, g.editorialStatus, JSON.stringify(g.words.map((w) => w.id))],
      );
      if (existed) updated += 1; else imported += 1;

      for (const [pos, w] of g.words.entries()) {
        run(
          `INSERT INTO words (id, canonical_key, lemma, part_of_speech, sense_id, core_meaning_zh, level, topic,
             phonetic, frequency_rank, homograph_risk, collocations_json, confusion_json, cloze_json, source, license, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET lemma=excluded.lemma, part_of_speech=excluded.part_of_speech,
             sense_id=excluded.sense_id, core_meaning_zh=excluded.core_meaning_zh, level=excluded.level, topic=excluded.topic,
             phonetic=excluded.phonetic, frequency_rank=excluded.frequency_rank, homograph_risk=excluded.homograph_risk,
             collocations_json=excluded.collocations_json, confusion_json=excluded.confusion_json, cloze_json=excluded.cloze_json,
             source=excluded.source, license=excluded.license`,
          [
            w.id, `${String(w.lemma).toLowerCase()}|${String(w.partOfSpeech).toLowerCase()}`, w.lemma, w.partOfSpeech,
            w.senseId, w.coreMeaningZh, w.level, w.topic, w.phonetic ?? null, w.frequencyRank ?? null,
            w.homographRisk ? 1 : 0, JSON.stringify(w.collocations || []), JSON.stringify(w.confusionPairs || []),
            JSON.stringify(w.cloze || {}), w.source, w.license, nowIso(),
          ],
        );
        run('DELETE FROM word_forms WHERE word_id = ?', [w.id]);
        run('INSERT INTO word_forms (word_id, form, kind) VALUES (?,?,?)', [w.id, String(w.lemma).toLowerCase(), 'canonical']);
        for (const s of w.acceptedSpellings || []) {
          run('INSERT OR IGNORE INTO word_forms (word_id, form, kind) VALUES (?,?,?)', [w.id, String(s).toLowerCase(), 'spelling_variant']);
        }
        for (const s of w.inflections || []) {
          run('INSERT OR IGNORE INTO word_forms (word_id, form, kind) VALUES (?,?,?)', [w.id, String(s).toLowerCase(), 'inflection']);
        }
        run('INSERT OR REPLACE INTO word_group_items (group_id, word_id, position) VALUES (?,?,?)', [g.id, w.id, pos]);
      }

      for (const m of g.materials) {
        const wordCount = (m.paragraphs || []).reduce((s, p) => s + String(p.en || '').split(/\s+/).filter(Boolean).length, 0);
        // 用 UPSERT 而不是 DELETE+INSERT：
        //  1) article/media 被 user_article_states、playback_events、user_media_coverage 引用，
        //     直接删除会触发外键失败，也会抹掉用户已解锁/已听的进度；
        //  2) 重新导入内容（如修正译文、重建音频）必须保持幂等。
        run(
          `INSERT INTO articles (id, version, group_id, role, title, type, level, topics_json, source_url, authors_json,
             publication_date, original_language, text_origin, translation_origin, rights_status, attribution, license_note,
             paragraphs_json, comprehension_json, editorial_status, word_count, coverage_covered, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             version=excluded.version, group_id=excluded.group_id, role=excluded.role, title=excluded.title,
             type=excluded.type, level=excluded.level, topics_json=excluded.topics_json, source_url=excluded.source_url,
             authors_json=excluded.authors_json, publication_date=excluded.publication_date,
             original_language=excluded.original_language, text_origin=excluded.text_origin,
             translation_origin=excluded.translation_origin, rights_status=excluded.rights_status,
             attribution=excluded.attribution, license_note=excluded.license_note,
             paragraphs_json=excluded.paragraphs_json, comprehension_json=excluded.comprehension_json,
             editorial_status=excluded.editorial_status, word_count=excluded.word_count,
             coverage_covered=excluded.coverage_covered`,
          [
            m.id, m.version, g.id, m.role, m.title, m.type, m.level, JSON.stringify(m.topics || []), m.sourceUrl ?? null,
            JSON.stringify(m.authors || []), m.publicationDate ?? null, m.originalLanguage || 'en', m.textOrigin,
            m.translationOrigin, m.rightsStatus, m.attribution ?? null, m.licenseNote ?? null,
            JSON.stringify(m.paragraphs || []), JSON.stringify(m.comprehension || []), g.editorialStatus,
            wordCount, audit.coverage.covered, nowIso(),
          ],
        );
        // 对齐段落：无真实时间戳时只记录段落级，不伪造逐句时间。
        // 这是派生的展示数据，无人引用，直接重建即可。
        run('DELETE FROM aligned_segments WHERE article_id = ?', [m.id]);
        let seg = 0;
        for (const [pi, p] of (m.paragraphs || []).entries()) {
          run(
            `INSERT INTO aligned_segments (id, article_id, paragraph_index, segment_index, en, zh, start_seconds, end_seconds, alignment_source, alignment_precision)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [uuid('seg'), m.id, pi, seg, p.en, p.zh ?? null, null, null, m.media?.alignmentSource || 'paragraph', m.media?.alignmentPrecision || 'paragraph'],
          );
          seg += 1;
        }
        // media_assets 被 playback_events / user_media_coverage 引用，必须 UPSERT 而不是删除重建
        const media = m.media || {};
        run(
          `INSERT INTO media_assets (id, article_id, url, local_path, duration_seconds, is_human, is_synthetic, tts_model, voice,
             license, sha256, format, verified_playable, verification_note, alignment_source, alignment_precision, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             article_id=excluded.article_id, url=excluded.url, local_path=excluded.local_path,
             duration_seconds=excluded.duration_seconds, is_human=excluded.is_human, is_synthetic=excluded.is_synthetic,
             tts_model=excluded.tts_model, voice=excluded.voice, license=excluded.license, sha256=excluded.sha256,
             format=excluded.format, verified_playable=excluded.verified_playable,
             verification_note=excluded.verification_note, alignment_source=excluded.alignment_source,
             alignment_precision=excluded.alignment_precision`,
          [
            `m-${m.id}`, m.id, media.audioUrl, path.join(contentRoot, String(media.audioUrl || '').replace(/^\/media\/audio\//, 'audio/')),
            Number(media.durationSeconds || 0), media.human ? 1 : 0, media.synthetic === false ? 0 : 1,
            media.provider || null, media.voice || null, media.license || 'unknown', media.sha256 || null,
            media.format || 'wav', media.durationSeconds > 0 ? 1 : 0,
            media.durationSeconds > 0 ? `本地合成音频已生成并解析时长 ${media.durationSeconds}s` : '音频缺失',
            media.alignmentSource || 'paragraph', media.alignmentPrecision || 'paragraph', nowIso(),
          ],
        );
        run('DELETE FROM article_word_occurrences WHERE article_id = ?', [m.id]);
        for (const [wordId, hits] of Object.entries(audit.coverage.matches)) {
          for (const h of hits) {
            run(
              `INSERT INTO article_word_occurrences (id, article_id, word_id, paragraph_index, sentence, form, material_role, needs_sense_check)
               VALUES (?,?,?,?,?,?,?,?)`,
              [uuid('occ'), m.id, wordId, h.paragraph, h.sentence, h.form, h.materialRole || m.role, h.needsManualSenseCheck ? 1 : 0],
            );
          }
        }
      }

      run(
        `INSERT INTO source_licenses (id, source, fetched_at, code_license, text_license, translation_license, audio_license,
           license_url, attribution_required, allow_cache, allow_adapt, review_status, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET notes=excluded.notes, review_status=excluded.review_status`,
        [
          `sl-${g.id}`, g.materials.map((m) => m.authors?.join('/') || 'editorial').join('; '), nowIso(),
          null, 'original-work（本项目编辑部原创）', 'editorial_original（编辑部自行翻译）', 'windows-sapi（本机合成，非真人）',
          null, 0, 1, 1, 'verified',
          `词组 ${g.id}：英文正文与中文译文均为本项目原创；音频由本机 SAPI 合成并已核验可播放。`,
        ],
      );
    });
  }

  run(
    `INSERT INTO content_audit (id, actor_user_id, action, target_type, target_id, detail_json, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [uuid('ca'), null, 'import_content', 'course', COURSE_VERSION, JSON.stringify({ imported, updated, rejected: rejected.length }), nowIso()],
  );
  log(`内容导入完成：新增 ${imported} 组，更新 ${updated} 组，被发布闸门拒绝 ${rejected.length} 组`);
  return { imported, updated, rejected: rejected.map((r) => ({ id: r.group.id, errors: r.errors })), gates: gated };
}

/**
 * 导入晋级关卡材料。
 * 只有通过全部校验（10 题、4 选项、answerIndex 合法、有 evidence、听力有真实音频、
 * 不与学习路径正文重复）的材料才会入库；未通过的逐条记录，不静默丢弃。
 */
export async function importGateMaterials({ contentRoot = CONTENT_ROOT, log = () => {} } = {}) {
  const { materials, packs, errors, warnings } = await loadGateMaterials(contentRoot);
  const errorByMaterial = new Map();
  for (const pack of packs) {
    for (const e of pack.errors) {
      const m = e.match(/材料 (\S+)/) || e.match(/^(\S+?):/);
      const key = m ? m[1] : null;
      if (key && materials.some((x) => x.id === key)) {
        if (!errorByMaterial.has(key)) errorByMaterial.set(key, []);
        errorByMaterial.get(key).push(e);
      }
    }
  }

  let imported = 0;
  const skipped = [];
  for (const m of materials) {
    if (errorByMaterial.has(m.id)) {
      skipped.push({ id: m.id, errors: errorByMaterial.get(m.id) });
      continue;
    }
    const row = gateMaterialRow(m);
    tx(() => {
      run(
        `INSERT INTO gate_materials (id, level, form_no, section, title, type, text_origin, rights_status,
           paragraphs_json, questions_json, audio_url, duration_seconds, transcript_hidden, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(level, form_no, section) DO UPDATE SET
           id = excluded.id, title = excluded.title, type = excluded.type,
           text_origin = excluded.text_origin, rights_status = excluded.rights_status,
           paragraphs_json = excluded.paragraphs_json, questions_json = excluded.questions_json,
           audio_url = excluded.audio_url, duration_seconds = excluded.duration_seconds,
           transcript_hidden = excluded.transcript_hidden`,
        [row.id, row.level, row.formNo, row.section, row.title, row.type, row.textOrigin, row.rightsStatus,
          JSON.stringify(row.paragraphs), JSON.stringify(row.questions), row.audioUrl, row.durationSeconds,
          row.transcriptHidden ? 1 : 0, nowIso()],
      );
    });
    imported += 1;
  }

  if (materials.length) {
    log(`关卡材料导入：${imported}/${materials.length} 份入库${skipped.length ? `，${skipped.length} 份被校验拒绝` : ''}`);
  }
  return { imported, total: materials.length, skipped, errors, warnings, packs: packs.map((p) => ({ level: p.level, ready: p.ready, forms: p.forms.length })) };
}

export function contentStats() {
  const row = get(`SELECT
      (SELECT COUNT(*) FROM word_groups WHERE editorial_status='published') AS groups,
      (SELECT COUNT(*) FROM words) AS words,
      (SELECT COUNT(*) FROM articles) AS articles,
      (SELECT COUNT(*) FROM media_assets WHERE verified_playable=1) AS playable_media,
      (SELECT COUNT(*) FROM media_assets WHERE is_human=1) AS human_media`);
  return row;
}

export function listGroupsForLevel(level) {
  return all('SELECT * FROM word_groups WHERE level = ? AND editorial_status = ? ORDER BY idx', [level, 'published']);
}

export function getGroup(groupId) {
  const g = get('SELECT * FROM word_groups WHERE id = ?', [groupId]);
  if (!g) return null;
  const words = all(
    `SELECT w.* FROM word_group_items i JOIN words w ON w.id = i.word_id
     WHERE i.group_id = ? ORDER BY i.position`,
    [groupId],
  ).map(hydrateWord);
  const articles = all('SELECT * FROM articles WHERE group_id = ? ORDER BY role DESC, id', [groupId]).map(hydrateArticle);
  return { ...g, words, articles };
}

export function hydrateWord(row) {
  return {
    id: row.id,
    lemma: row.lemma,
    partOfSpeech: row.part_of_speech,
    senseId: row.sense_id,
    coreMeaningZh: row.core_meaning_zh,
    level: row.level,
    topic: row.topic,
    phonetic: row.phonetic,
    frequencyRank: row.frequency_rank,
    homographRisk: Boolean(row.homograph_risk),
    collocations: jsonParse(row.collocations_json, []),
    confusionPairs: jsonParse(row.confusion_json, []),
    cloze: jsonParse(row.cloze_json, {}),
    source: row.source,
    license: row.license,
  };
}

export function hydrateArticle(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    version: row.version,
    role: row.role,
    title: row.title,
    type: row.type,
    level: row.level,
    topics: jsonParse(row.topics_json, []),
    authors: jsonParse(row.authors_json, []),
    sourceUrl: row.source_url,
    textOrigin: row.text_origin,
    translationOrigin: row.translation_origin,
    rightsStatus: row.rights_status,
    attribution: row.attribution,
    licenseNote: row.license_note,
    paragraphs: jsonParse(row.paragraphs_json, []),
    comprehension: jsonParse(row.comprehension_json, []),
    wordCount: row.word_count,
    coverageCovered: row.coverage_covered,
  };
}

export function wordForms(wordId) {
  return all('SELECT form, kind FROM word_forms WHERE word_id = ?', [wordId]);
}
