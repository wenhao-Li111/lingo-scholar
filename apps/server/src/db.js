/**
 * 数据访问层：node:sqlite（Node 22 内置），无需原生编译。
 * 说明：所有写操作走短事务；WAL 提升并发读性能。
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let dbInstance = null;
let dbPath = null;

export function nowIso() {
  return new Date().toISOString();
}

export function uuid(prefix = '') {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function openDatabase(filePath) {
  if (dbInstance) return dbInstance;
  dbPath = filePath;
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  dbInstance = db;
  return db;
}

export function getDatabase() {
  if (!dbInstance) throw new Error('数据库尚未初始化，请先调用 openDatabase()');
  return dbInstance;
}

export function currentDatabasePath() {
  return dbPath;
}

export function closeDatabase() {
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
    dbInstance = null;
  }
}

/** 短事务包装 */
export function tx(fn) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

export function run(sql, params = []) {
  return getDatabase().prepare(sql).run(...params);
}

export function all(sql, params = []) {
  return getDatabase().prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return getDatabase().prepare(sql).get(...params) ?? null;
}

export function getOrNull(sql, params = []) {
  try {
    return get(sql, params);
  } catch {
    return null;
  }
}

export function setMeta(key, value) {
  run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
}

export function getMeta(key, fallback = null) {
  const row = get('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

export function tableCount(table) {
  const row = get(`SELECT COUNT(*) AS c FROM ${table}`);
  return row ? Number(row.c) : 0;
}

export function jsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function jsonStringify(value) {
  return JSON.stringify(value ?? null);
}
