/** openIELTS 本地资料库：目录、全文检索与结构化词表。 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {wordDefinitions} from './word-definitions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RESOURCE_ROOT = path.resolve(__dirname, '../../../content/resources/openielts');
export const SUPPLEMENT_ROOT = path.resolve(__dirname, '../../../content/resources/supplemental');
const CATALOG_PATH = path.join(RESOURCE_ROOT, 'catalog.json');
const DECKS_PATH = path.join(RESOURCE_ROOT, 'decks.json');

let catalogCache = null;
let deckCache = null;
let enrichedCache = null;
const textCache = new Map();

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function resourceCatalog() {
  if (!catalogCache) catalogCache = readJson(CATALOG_PATH, {
    source: { name: 'openIELTS', repository: 'https://github.com/mcxiaoxiao/openIELTS', license: 'not_declared' },
    stats: { total: 0, pdf: 0, docx: 0, searchable: 0, scanned: 0, sizeBytes: 0, categories: {} },
    resources: [], failures: [],
  });
  const added = readJson(path.join(SUPPLEMENT_ROOT, 'catalog.json'), { resources: [] });
  const localized=readJson(path.join(SUPPLEMENT_ROOT,'localized-documents.json'),{});
  const resources = [...catalogCache.resources, ...added.resources].map(r=>({...r,...localized[r.id]}));
  const stats = { ...catalogCache.stats, total: resources.length, sizeBytes: 0, categories: {}, local: 0, remote: 0, pdf: 0, docx: 0, searchable: 0, scanned: 0 };
  for (const item of resources) {
    stats.sizeBytes += item.sizeBytes || 0;
    stats.categories[item.category] = (stats.categories[item.category] || 0) + 1;
    stats[item.storage === 'remote' ? 'remote' : 'local']++;
    if (item.format === 'pdf') stats.pdf++;
    if (item.format === 'docx') stats.docx++;
    if (item.textCharacters > 0) stats.searchable++;
    if (item.scanned) stats.scanned++;
  }
  return { ...catalogCache, resources, stats };
}

export function resourceDecks() {
  if(enrichedCache)return enrichedCache;
  if (!deckCache) deckCache = readJson(DECKS_PATH, { decks: [] });
  const dictionary=readJson(path.join(SUPPLEMENT_ROOT,'dictionary.json'),{entries:{}}).entries;
  const translations=readJson(path.join(SUPPLEMENT_ROOT,'sentence-translations.json'),{});
  const phonetics=readJson(path.join(SUPPLEMENT_ROOT,'phonetic-supplement.json'),{});
  const corrections=readJson(path.join(SUPPLEMENT_ROOT,'sentence-corrections.json'),{});
  enrichedCache=[...new Map([...(deckCache.decks || []), ...readJson(path.join(SUPPLEMENT_ROOT, 'decks.json'), { decks: [] }).decks].map(d => [d.id, d])).values()].map(d=>({...d,words:d.words.map(w=>{
    const entry=dictionary[w.lemma.toLowerCase()];
    const definitions=wordDefinitions(w,entry);
    w={...w,definitions,meaningDisplay:definitions.map(s=>`${s.partOfSpeech} ${s.meaningZh}`).join('\n')};
    const correction=corrections[w.example];
    if(correction)w={...w,example:correction.en,exampleZh:correction.zh,exampleSource:`${w.exampleSource} · 拼写校正`};
    const supplementalPhonetic=phonetics[w.lemma];
    const additional=(entry?.translation||'').split('\n').filter(line=>line.trim().length>1&&!/^\s*\[|人名/.test(line));
    const senses=[w.meaningZh,...additional].flatMap(line=>line.split(/【记忆】|【词根】|【搭配】/)[0].replace(/\(\s*(?:n|v|vt|vi|adj|adv|a|ad)\.\s*\)/g,'').replace(/\b(?:n|v|vt|vi|adj|adv|a|ad)\.\s*/g,'；').split(/[；;，,\n]/)).map(x=>x.replace(/\(\s*\)/g,'').trim()).filter(Boolean);
    return {...w,phonetic:w.phonetic||entry?.phonetic?.replace(/[\[\]\/]/g,'')||supplementalPhonetic?.phonetic||'',phoneticSource:supplementalPhonetic?.source||'来源词典音标',phoneticLocale:entry?.phoneticLocale||supplementalPhonetic?.locale||'',meaningZh:[...new Set(senses)].join('；'),exampleZh:translations[w.example]||w.exampleZh||''};
  })}));
  return enrichedCache;
}

export function listeningCatalog() {
  const catalog=readJson(path.join(SUPPLEMENT_ROOT, 'listening.json'), { tracks: [] });
  catalog.tracks=catalog.tracks.map(t=>t.id==='zl-2dfed2b57fd9f5bd'?{...t,title:'Test4.Section4（原站文件误标 Section5）'}:t);
  catalog.tracks=catalog.tracks.map(t=>t.id==='zl-55f4b04fa74d8a3e'?{...t,note:'原站此文件在约 8:30 后还附带 Test 3 Section 1。同步字幕覆盖整个文件，原书对照区也包含附带内容；未将其重复计作新增音频。'}:t);
  return {...catalog,tracks:catalog.tracks.map(t=>existsSync(path.join(SUPPLEMENT_ROOT,'audio',`${t.id}.${t.format}`))?{...t,remoteUrl:t.url,url:`/resources/supplemental/audio/${t.id}.${t.format}`,storage:'local'}:t)};
}
export function listeningTranscript(id){
  if(!/^zl-[a-f0-9]{16}$/.test(id))return null;
  const script=readJson(path.join(SUPPLEMENT_ROOT,'transcripts.json'),{tracks:{}}).tracks[id];
  let original=readJson(path.join(SUPPLEMENT_ROOT,'original-translations',`${id}.json`),null);
  if(id==='zl-55f4b04fa74d8a3e'&&original){const extra=readJson(path.join(SUPPLEMENT_ROOT,'original-translations','zl-afde1e2b96216aea.json'),null);if(extra)original={...original,paragraphs:[...original.paragraphs,{en:'Additional recording: Test 3, Section 1.',zh:'文件附带录音：Test 3，Section 1。'},...extra.paragraphs]};}
  const aligned=readJson(path.join(SUPPLEMENT_ROOT,'aligned',`${id}.json`),null);
  if(aligned)return {...script,...aligned,resourceId:script?.resourceId,page:script?.page,original,paragraphs:aligned.segments.map(s=>s.en)};
  if(!script)return null;
  const paragraphs=[];let chunk='';
  for(const sentence of script.en.match(/[^.!?]+[.!?]*/g)||[]){
    if(Buffer.byteLength(chunk+sentence,'utf8')>450&&chunk){paragraphs.push(chunk.trim());chunk='';}
    // Split unusually long OCR segments below the translation service's 500-byte limit.
    for(const word of sentence.split(/\s+/)){if(Buffer.byteLength(chunk+' '+word)>450){paragraphs.push(chunk.trim());chunk='';}chunk+=' '+word;}
  }
  if(chunk.trim())paragraphs.push(chunk.trim());
  return {...script,paragraphs};
}

export function resourceById(id) {
  return resourceCatalog().resources.find((item) => item.id === id) || null;
}

export function deckById(id) {
  return resourceDecks().find((item) => item.id === id) || null;
}

export function resourceText(id) {
  if (!resourceById(id)) return null;
  if (textCache.has(id)) return textCache.get(id);
  const file = path.join(id.startsWith('oi-') ? RESOURCE_ROOT : SUPPLEMENT_ROOT, 'text', `${id}.txt`);
  const value = existsSync(file) ? readFileSync(file, 'utf8') : '';
  textCache.set(id, value);
  return value;
}

function plain(value) {
  return String(value || '').toLocaleLowerCase('zh-CN');
}

function snippetFor(text, query, size = 230) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const at = plain(compact).indexOf(plain(query));
  if (at < 0) return compact.slice(0, size);
  const start = Math.max(0, at - Math.floor(size * 0.36));
  const end = Math.min(compact.length, start + size);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

export function searchResources({ query = '', category = 'all', format = 'all', limit = 40 } = {}) {
  const q = plain(query).trim();
  const max = Math.max(1, Math.min(80, Number(limit) || 40));
  const hits = [];
  for (const item of resourceCatalog().resources) {
    if (category !== 'all' && item.category !== category) continue;
    if (format !== 'all' && item.format !== format) continue;
    const metadata = plain(`${item.title} ${item.description} ${(item.tags || []).join(' ')} ${item.sourcePath}`);
    let match = !q || metadata.includes(q);
    let snippet = item.searchPreview || '';
    let matchSource = match && q ? 'metadata' : 'catalog';
    if (q && !match && item.textCharacters > 0) {
      const text = resourceText(item.id) || '';
      if (plain(text).includes(q)) {
        match = true;
        matchSource = 'full_text';
        snippet = snippetFor(text, q);
      }
    }
    if (!match) continue;
    hits.push({ ...item, snippet, matchSource });
    if (hits.length >= max) break;
  }
  return hits;
}

export function publicDeck(deck, { offset = 0, limit = 50 } = {}) {
  if (!deck) return null;
  const start = Math.max(0, Number(offset) || 0);
  const count = Math.max(1, Math.min(1000, Number(limit) || 50));
  return {
    ...deck,
    words: deck.words.slice(start, start + count),
    offset: start,
    limit: count,
    hasMore: start + count < deck.words.length,
  };
}
