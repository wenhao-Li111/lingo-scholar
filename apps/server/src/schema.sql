-- Lingo Scholar · 听词研习室
-- 数据库结构（SQLite / WAL）。所有积分、任务与晋级状态以服务端为准。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================ 账号与小组 ============================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',      -- member | admin
  avatar_seed   TEXT NOT NULL DEFAULT 'seed',
  level         INTEGER NOT NULL DEFAULT 1,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  plan_started_at TEXT,
  share_voice   INTEGER NOT NULL DEFAULT 0,
  prefs_json    TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS study_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  timezone_locked_at TEXT,                            -- 时区迁移限制：锁定后不追溯历史周
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id),
  group_id  TEXT NOT NULL REFERENCES study_groups(id),
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  left_at   TEXT,
  UNIQUE(user_id, group_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  group_id   TEXT NOT NULL REFERENCES study_groups(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
);

-- ============================ 课程与内容 ============================
CREATE TABLE IF NOT EXISTS course_versions (
  id             TEXT PRIMARY KEY,
  rules_version  TEXT NOT NULL,
  content_version TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  note           TEXT
);

CREATE TABLE IF NOT EXISTS levels (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  groups_target INTEGER NOT NULL,
  words_target  INTEGER NOT NULL,
  suggested_weeks INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  id                TEXT PRIMARY KEY,
  canonical_key     TEXT NOT NULL UNIQUE,            -- lemma|pos
  lemma             TEXT NOT NULL,
  part_of_speech    TEXT NOT NULL,
  sense_id          TEXT NOT NULL,
  core_meaning_zh   TEXT NOT NULL,
  level             INTEGER NOT NULL,
  topic             TEXT NOT NULL,
  phonetic          TEXT,
  frequency_rank    INTEGER,
  homograph_risk    INTEGER NOT NULL DEFAULT 0,
  collocations_json TEXT NOT NULL DEFAULT '[]',
  confusion_json    TEXT NOT NULL DEFAULT '[]',
  cloze_json        TEXT NOT NULL DEFAULT '{}',
  source            TEXT NOT NULL,
  license           TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_forms (
  word_id TEXT NOT NULL REFERENCES words(id),
  form    TEXT NOT NULL,
  kind    TEXT NOT NULL,                             -- canonical | spelling_variant | inflection
  PRIMARY KEY (word_id, form, kind)
);

CREATE TABLE IF NOT EXISTS word_groups (
  id                TEXT PRIMARY KEY,                -- g001
  code              TEXT NOT NULL UNIQUE,
  level             INTEGER NOT NULL,
  idx               INTEGER NOT NULL,                -- 全局连续组号
  title             TEXT NOT NULL,
  topic             TEXT NOT NULL,
  version           TEXT NOT NULL,
  editorial_status  TEXT NOT NULL,                   -- draft | published | retired
  words_json        TEXT NOT NULL DEFAULT '[]'       -- 服务端只读快照，便于审计
);

CREATE TABLE IF NOT EXISTS word_group_items (
  group_id TEXT NOT NULL REFERENCES word_groups(id),
  word_id  TEXT NOT NULL REFERENCES words(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (group_id, word_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id                TEXT PRIMARY KEY,
  version           TEXT NOT NULL,
  group_id          TEXT NOT NULL REFERENCES word_groups(id),
  role              TEXT NOT NULL,                   -- main | supplement
  title             TEXT NOT NULL,
  type              TEXT NOT NULL,                   -- article | dialogue
  level             INTEGER NOT NULL,
  topics_json       TEXT NOT NULL DEFAULT '[]',
  source_url        TEXT,
  authors_json      TEXT NOT NULL DEFAULT '[]',
  publication_date  TEXT,
  original_language TEXT NOT NULL DEFAULT 'en',
  text_origin       TEXT NOT NULL,                   -- original | adapted | verbatim
  translation_origin TEXT NOT NULL,                  -- human_existing | machine_assisted | editorial_original | none
  rights_status     TEXT NOT NULL,
  attribution       TEXT,
  license_note      TEXT,
  paragraphs_json   TEXT NOT NULL DEFAULT '[]',
  comprehension_json TEXT NOT NULL DEFAULT '[]',
  editorial_status  TEXT NOT NULL,
  word_count        INTEGER NOT NULL DEFAULT 0,
  coverage_covered  INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aligned_segments (
  id              TEXT PRIMARY KEY,
  article_id      TEXT NOT NULL REFERENCES articles(id),
  paragraph_index INTEGER NOT NULL,
  segment_index   INTEGER NOT NULL,
  en              TEXT NOT NULL,
  zh              TEXT,
  start_seconds   REAL,
  end_seconds     REAL,
  alignment_source TEXT,                              -- manual | forced_alignment | tts_word_timing | paragraph
  alignment_precision TEXT                            -- sentence | paragraph | none
);

CREATE TABLE IF NOT EXISTS media_assets (
  id                 TEXT PRIMARY KEY,
  article_id         TEXT REFERENCES articles(id),
  url                TEXT NOT NULL,
  local_path         TEXT,
  duration_seconds   REAL NOT NULL,
  is_human           INTEGER NOT NULL DEFAULT 0,
  is_synthetic       INTEGER NOT NULL DEFAULT 1,
  tts_model          TEXT,
  voice              TEXT,
  license            TEXT NOT NULL,
  sha256             TEXT,
  format             TEXT NOT NULL,
  verified_playable  INTEGER NOT NULL DEFAULT 0,
  verification_note  TEXT,
  alignment_source   TEXT,
  alignment_precision TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_licenses (
  id                 TEXT PRIMARY KEY,
  source             TEXT NOT NULL,
  fetched_at         TEXT NOT NULL,
  code_license       TEXT,
  text_license       TEXT,
  translation_license TEXT,
  audio_license      TEXT,
  license_url        TEXT,
  attribution_required INTEGER NOT NULL DEFAULT 0,
  allow_cache        INTEGER NOT NULL DEFAULT 0,
  allow_adapt        INTEGER NOT NULL DEFAULT 0,
  review_status      TEXT NOT NULL,                  -- verified | link_only | unknown
  notes              TEXT
);

CREATE TABLE IF NOT EXISTS article_word_occurrences (
  id              TEXT PRIMARY KEY,
  article_id      TEXT NOT NULL REFERENCES articles(id),
  word_id         TEXT NOT NULL REFERENCES words(id),
  paragraph_index INTEGER NOT NULL,
  sentence        TEXT NOT NULL,
  form            TEXT NOT NULL,
  material_role   TEXT NOT NULL,
  needs_sense_check INTEGER NOT NULL DEFAULT 0
);

-- ============================ 学习进度 ============================
CREATE TABLE IF NOT EXISTS word_progress (
  user_id            TEXT NOT NULL REFERENCES users(id),
  word_id            TEXT NOT NULL REFERENCES words(id),
  group_id           TEXT REFERENCES word_groups(id),
  first_seen_at      TEXT,
  demonstrated_count INTEGER NOT NULL DEFAULT 0,
  valid_wrong_count  INTEGER NOT NULL DEFAULT 0,
  independent_failed INTEGER NOT NULL DEFAULT 0,
  correct_streak     INTEGER NOT NULL DEFAULT 0,
  last_correct_at    TEXT,
  last_wrong_at      TEXT,
  archived           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, word_id)
);

CREATE TABLE IF NOT EXISTS learning_tasks (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  group_id           TEXT NOT NULL REFERENCES word_groups(id),
  task_type          TEXT NOT NULL,                  -- new_words | day3_review | long_term | weekly_review
  status             TEXT NOT NULL,                  -- not_started | learning | first_test | remediation | completed
  attempt_no         INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  started_at         TEXT,
  completed_at       TEXT,
  first_pass_correct INTEGER,
  first_pass_total   INTEGER NOT NULL DEFAULT 20,
  corrected_mastery  INTEGER NOT NULL DEFAULT 0,
  question_plan_json TEXT NOT NULL DEFAULT '[]',
  remediation_state_json TEXT NOT NULL DEFAULT '{}',
  rule_version       TEXT NOT NULL,
  course_version     TEXT NOT NULL,
  reward_idempotency_key TEXT,
  UNIQUE(user_id, group_id, task_type, attempt_no)
);

CREATE TABLE IF NOT EXISTS answer_attempts (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES learning_tasks(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  word_id        TEXT NOT NULL REFERENCES words(id),
  question_type  TEXT NOT NULL,                      -- definition | cloze
  phase          TEXT NOT NULL,                      -- first_test | remediation
  prompt         TEXT NOT NULL,
  submitted      TEXT NOT NULL,
  normalized     TEXT NOT NULL,
  is_correct     INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  client_request_id TEXT UNIQUE,
  index_in_plan  INTEGER,
  created_at     TEXT NOT NULL
);

-- ============================ 复习与考试 ============================
CREATE TABLE IF NOT EXISTS review_tasks (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  group_id           TEXT NOT NULL REFERENCES word_groups(id),
  kind               TEXT NOT NULL,                  -- day3 | weekly_group | long_term
  due_at             TEXT NOT NULL,
  sequence_no        INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL,                  -- pending | completed
  created_at         TEXT NOT NULL,
  completed_at       TEXT,
  first_pass_correct INTEGER,
  corrected_mastery  INTEGER NOT NULL DEFAULT 0,
  batch_id           TEXT,
  UNIQUE(user_id, group_id, kind, sequence_no)
);

CREATE TABLE IF NOT EXISTS weekly_exams (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  group_id          TEXT NOT NULL REFERENCES study_groups(id),
  week_key          TEXT NOT NULL,
  status            TEXT NOT NULL,                   -- not_open | open | in_progress | passed | failed | missed | not_applicable
  opened_at         TEXT,
  frozen_at         TEXT,
  scope_json        TEXT NOT NULL DEFAULT '{}',
  question_count    INTEGER NOT NULL DEFAULT 0,
  correct_count     INTEGER NOT NULL DEFAULT 0,
  score_percent     REAL,
  first_score_percent REAL,
  best_makeup_score REAL,
  makeup_count      INTEGER NOT NULL DEFAULT 0,
  settled_at        TEXT,
  penalty_applied   INTEGER NOT NULL DEFAULT 0,
  penalty_refunded  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, group_id, week_key)
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id             TEXT PRIMARY KEY,
  exam_id        TEXT NOT NULL REFERENCES weekly_exams(id),
  kind           TEXT NOT NULL,                      -- first | makeup
  attempt_no     INTEGER NOT NULL,
  started_at     TEXT NOT NULL,
  submitted_at   TEXT,
  question_count INTEGER NOT NULL DEFAULT 0,
  correct_count  INTEGER NOT NULL DEFAULT 0,
  score_percent  REAL,
  passed         INTEGER NOT NULL DEFAULT 0,
  answers_json   TEXT NOT NULL DEFAULT '[]',
  order_seed     TEXT,
  UNIQUE(exam_id, kind, attempt_no)
);

CREATE TABLE IF NOT EXISTS exam_word_results (
  id          TEXT PRIMARY KEY,
  exam_id     TEXT NOT NULL REFERENCES weekly_exams(id),
  attempt_id  TEXT NOT NULL REFERENCES exam_attempts(id),
  word_id     TEXT NOT NULL REFERENCES words(id),
  origin      TEXT NOT NULL,                         -- new_this_week | carryover | old_high_error
  is_correct  INTEGER NOT NULL,
  repaired_at TEXT,
  UNIQUE(attempt_id, word_id)
);

CREATE TABLE IF NOT EXISTS level_gate_attempts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  level             INTEGER NOT NULL,
  status            TEXT NOT NULL,                   -- in_progress | passed | failed
  started_at        TEXT NOT NULL,
  submitted_at      TEXT,
  vocab_correct     INTEGER,
  vocab_total       INTEGER NOT NULL DEFAULT 20,
  reading_correct   INTEGER,
  reading_total     INTEGER NOT NULL DEFAULT 10,
  listening_correct INTEGER,
  listening_total   INTEGER NOT NULL DEFAULT 10,
  passed            INTEGER NOT NULL DEFAULT 0,
  materials_json    TEXT NOT NULL DEFAULT '{}',
  detail_json       TEXT NOT NULL DEFAULT '{}'
);

-- ============================ 积分与时长 ============================
CREATE TABLE IF NOT EXISTS points_ledger (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  group_id         TEXT REFERENCES study_groups(id),
  points           INTEGER NOT NULL,
  reason           TEXT NOT NULL,
  week_key         TEXT NOT NULL,
  note             TEXT,
  ref_type         TEXT,
  ref_id           TEXT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  seconds    INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'playback'
);

-- 已合并的用户墙钟区间：跨设备去重的基础
CREATE TABLE IF NOT EXISTS study_intervals (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id),
  start_ms INTEGER NOT NULL,
  end_ms   INTEGER NOT NULL,
  source   TEXT NOT NULL,
  day_key  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_events (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  media_id      TEXT REFERENCES media_assets(id),
  article_id    TEXT REFERENCES articles(id),
  media_start   REAL NOT NULL,
  media_end     REAL NOT NULL,
  rate          REAL NOT NULL DEFAULT 1,
  wall_start_ms INTEGER NOT NULL,
  wall_end_ms   INTEGER NOT NULL,
  verified      INTEGER NOT NULL DEFAULT 0,
  reason        TEXT NOT NULL,
  added_seconds INTEGER NOT NULL DEFAULT 0,
  client_event_id TEXT UNIQUE,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_article_states (
  user_id             TEXT NOT NULL REFERENCES users(id),
  article_id          TEXT NOT NULL REFERENCES articles(id),
  unlocked_at         TEXT,
  unlock_evidence     TEXT,
  first_pass_finished_at TEXT,
  last_position_seconds REAL NOT NULL DEFAULT 0,
  last_rate           REAL NOT NULL DEFAULT 1,
  listen_seconds      INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE IF NOT EXISTS user_media_coverage (
  user_id     TEXT NOT NULL REFERENCES users(id),
  media_id    TEXT NOT NULL REFERENCES media_assets(id),
  intervals_json TEXT NOT NULL DEFAULT '[]',
  natural_end INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, media_id)
);

-- ============================ 语音 ============================
CREATE TABLE IF NOT EXISTS voice_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  group_id    TEXT REFERENCES word_groups(id),
  scenario_id TEXT NOT NULL,
  mode        TEXT NOT NULL,
  provider_json TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL,
  turn_count  INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  cancel_reason TEXT
);

CREATE TABLE IF NOT EXISTS voice_turns (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES voice_sessions(id),
  turn_index    INTEGER NOT NULL,
  transcript    TEXT,
  transcript_source TEXT,
  asr_confidence REAL,
  intent        TEXT,
  slots_json    TEXT NOT NULL DEFAULT '{}',
  feedback_json TEXT NOT NULL DEFAULT '[]',
  reply_text    TEXT,
  audio_url     TEXT,
  audio_provider TEXT,
  latency_json  TEXT NOT NULL DEFAULT '{}',
  audio_retained INTEGER NOT NULL DEFAULT 0,
  audio_path    TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(session_id, turn_index)
);

-- ============================ 运营 ============================
CREATE TABLE IF NOT EXISTS content_audit (
  id             TEXT PRIMARY KEY,
  actor_user_id  TEXT REFERENCES users(id),
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT,
  detail_json    TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  run_at     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  locked_at  TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(name, run_at)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS mock_exam_records (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  exam_date  TEXT NOT NULL,
  listening  REAL,
  reading    REAL,
  writing    REAL,
  speaking   REAL,
  overall    REAL,
  note       TEXT,
  created_at TEXT NOT NULL
);

-- 外部备考资料的个人阅读状态。资料本体保存在 content/resources，不写入数据库。
CREATE TABLE IF NOT EXISTS resource_states (
  user_id          TEXT NOT NULL REFERENCES users(id),
  resource_id      TEXT NOT NULL,
  favorite         INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'not_started', -- not_started | reading | completed
  progress_percent INTEGER NOT NULL DEFAULT 0,
  last_page        INTEGER NOT NULL DEFAULT 1,
  note             TEXT NOT NULL DEFAULT '',
  opened_at        TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (user_id, resource_id)
);

CREATE TABLE IF NOT EXISTS resource_word_states (
  user_id       TEXT NOT NULL REFERENCES users(id),
  deck_id       TEXT NOT NULL,
  word_id       TEXT NOT NULL,
  familiarity   TEXT NOT NULL DEFAULT 'new', -- new | again | fuzzy | known
  seen_count    INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, deck_id, word_id)
);

CREATE TABLE IF NOT EXISTS listening_library_states (
  user_id TEXT NOT NULL REFERENCES users(id),
  track_id TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, track_id)
);

-- 晋级关卡材料：每级至少 2 套，阅读与听力互不相同且未纳入学习路径
CREATE TABLE IF NOT EXISTS gate_materials (
  id             TEXT PRIMARY KEY,
  level          INTEGER NOT NULL,
  form_no        INTEGER NOT NULL,
  section        TEXT NOT NULL,               -- reading | listening
  title          TEXT NOT NULL,
  type           TEXT NOT NULL,               -- article | dialogue
  text_origin    TEXT NOT NULL,
  rights_status  TEXT NOT NULL,
  paragraphs_json TEXT NOT NULL DEFAULT '[]',
  questions_json TEXT NOT NULL DEFAULT '[]',
  audio_url      TEXT,
  duration_seconds REAL,
  transcript_hidden INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  UNIQUE(level, form_no, section)
);

-- ============================ 索引 ============================
CREATE TABLE IF NOT EXISTS library_sessions (
  user_id TEXT NOT NULL REFERENCES users(id),
  session_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY(user_id, session_key)
);
CREATE TABLE IF NOT EXISTS study_favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY(user_id, kind, item_id)
);
CREATE TABLE IF NOT EXISTS translation_cache (
  source_text TEXT PRIMARY KEY,
  translation TEXT NOT NULL
);
-- Cloud social features deliberately do not share legacy course points.
CREATE TABLE IF NOT EXISTS account_recovery (
  user_id TEXT PRIMARY KEY REFERENCES users(id), code_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(sender_id, recipient_id)
);
CREATE TABLE IF NOT EXISTS star_challenges (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), day_key TEXT NOT NULL,
  questions_json TEXT NOT NULL, answers_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS star_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  challenge_id TEXT NOT NULL UNIQUE REFERENCES star_challenges(id),
  stars INTEGER NOT NULL, week_key TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friends_recipient ON friendships(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_star_user_day ON star_challenges(user_id, day_key);
CREATE INDEX IF NOT EXISTS idx_star_ledger_user ON star_ledger(user_id, week_key);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_word_progress_user ON word_progress(user_id, archived);
CREATE INDEX IF NOT EXISTS idx_learning_tasks_user ON learning_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_review_tasks_due ON review_tasks(user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_task ON answer_attempts(task_id, phase);
CREATE INDEX IF NOT EXISTS idx_points_user_week ON points_ledger(user_id, week_key);
CREATE INDEX IF NOT EXISTS idx_study_intervals_user ON study_intervals(user_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_playback_user_media ON playback_events(user_id, media_id);
CREATE INDEX IF NOT EXISTS idx_exam_word_results ON exam_word_results(exam_id, word_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_word ON article_word_occurrences(word_id);
CREATE INDEX IF NOT EXISTS idx_resource_states_user ON resource_states(user_id, favorite, status);
CREATE INDEX IF NOT EXISTS idx_resource_word_states_due ON resource_word_states(user_id, deck_id, next_review_at);
