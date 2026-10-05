import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path = resolve('data', 'geo-monitor.db')) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec([
    'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN (\'admin\',\'member\')), created_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS brands (id INTEGER PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT \'\', category TEXT NOT NULL DEFAULT \'\', description TEXT NOT NULL DEFAULT \'\', audience TEXT NOT NULL DEFAULT \'\', strengths TEXT NOT NULL DEFAULT \'\', website TEXT NOT NULL DEFAULT \'\', competitors TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE, text TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN (\'brand\',\'discovery\')), source TEXT NOT NULL CHECK(source IN (\'manual\',\'generated\')), created_at TEXT NOT NULL, UNIQUE(brand_id,text));',
    'CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE, name TEXT NOT NULL, platforms_json TEXT NOT NULL, question_ids_json TEXT NOT NULL, schedule_type TEXT NOT NULL CHECK(schedule_type IN (\'manual\',\'daily\',\'weekly\')), weekdays_json TEXT NOT NULL DEFAULT \'[]\', time_hhmm TEXT NOT NULL DEFAULT \'09:00\', enabled INTEGER NOT NULL DEFAULT 0, next_run_at TEXT, created_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT);',
    'CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, question_id INTEGER NOT NULL REFERENCES questions(id), platform TEXT NOT NULL, status TEXT NOT NULL, answer TEXT, citations_json TEXT NOT NULL DEFAULT \'[]\', screenshot TEXT, error TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS platform_accounts (id INTEGER PRIMARY KEY, platform TEXT NOT NULL, label TEXT NOT NULL, profile_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, UNIQUE(platform,label));',
    'CREATE TABLE IF NOT EXISTS result_attempts (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, question_id INTEGER NOT NULL REFERENCES questions(id), platform TEXT NOT NULL, account_id INTEGER, account_label TEXT, status TEXT NOT NULL, error TEXT, error_code TEXT, screenshot TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, diagnostics_json TEXT NOT NULL DEFAULT \'{}\');',
    'CREATE INDEX IF NOT EXISTS idx_attempts_run ON result_attempts(run_id);',
    'CREATE INDEX IF NOT EXISTS idx_questions_brand ON questions(brand_id);',
    'CREATE INDEX IF NOT EXISTS idx_tasks_next ON tasks(enabled,next_run_at);',
    'CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);',
  ].join('\n'));
  db.exec('CREATE TABLE IF NOT EXISTS submission_checkpoints (run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, question_id INTEGER NOT NULL REFERENCES questions(id), account_id INTEGER NOT NULL, state_json TEXT NOT NULL, PRIMARY KEY(run_id,question_id,account_id));');
  if (!db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'brand_snapshot_json')) {
    db.exec('ALTER TABLE runs ADD COLUMN brand_snapshot_json TEXT');
  }
  if (!db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'error')) {
    db.exec('ALTER TABLE runs ADD COLUMN error TEXT');
  }
  if (!db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'task_snapshot_json')) {
    db.exec('ALTER TABLE runs ADD COLUMN task_snapshot_json TEXT');
  }
  if (!db.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'account_ids_json')) {
    db.exec('ALTER TABLE tasks ADD COLUMN account_ids_json TEXT');
  }
  const resultColumns = db.prepare('PRAGMA table_info(results)').all().map(column => column.name);
  if (!resultColumns.includes('account_id')) db.exec('ALTER TABLE results ADD COLUMN account_id INTEGER');
  if (!resultColumns.includes('account_label')) db.exec('ALTER TABLE results ADD COLUMN account_label TEXT');
  if (!resultColumns.includes('error_code')) db.exec('ALTER TABLE results ADD COLUMN error_code TEXT');
  if (!resultColumns.includes('reported_citation_count')) db.exec('ALTER TABLE results ADD COLUMN reported_citation_count INTEGER');
  if (!resultColumns.includes('searched_sites_json')) db.exec("ALTER TABLE results ADD COLUMN searched_sites_json TEXT NOT NULL DEFAULT '[]'");
  if (!resultColumns.includes('reported_search_count')) db.exec('ALTER TABLE results ADD COLUMN reported_search_count INTEGER');
  if (!resultColumns.includes('diagnostics_json')) db.exec("ALTER TABLE results ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '{}'");
  db.exec(`INSERT INTO result_attempts(run_id,question_id,platform,account_id,account_label,status,error,error_code,screenshot,started_at,finished_at,diagnostics_json)
    SELECT r.run_id,r.question_id,r.platform,r.account_id,r.account_label,r.status,r.error,r.error_code,r.screenshot,r.started_at,r.finished_at,r.diagnostics_json
    FROM results r WHERE r.status IN ('succeeded','failed','needs_attention') AND NOT EXISTS (
      SELECT 1 FROM result_attempts a WHERE a.run_id=r.run_id AND a.question_id=r.question_id AND a.platform=r.platform
        AND a.account_id IS r.account_id AND a.started_at=r.started_at AND a.finished_at=r.finished_at)`);
  const accountColumns = db.prepare('PRAGMA table_info(platform_accounts)').all().map(column => column.name);
  if (!accountColumns.includes('notes')) db.exec("ALTER TABLE platform_accounts ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  if (!accountColumns.includes('last_status')) db.exec("ALTER TABLE platform_accounts ADD COLUMN last_status TEXT NOT NULL DEFAULT 'unknown'");
  if (!accountColumns.includes('last_error')) db.exec('ALTER TABLE platform_accounts ADD COLUMN last_error TEXT');
  if (!accountColumns.includes('last_checked_at')) db.exec('ALTER TABLE platform_accounts ADD COLUMN last_checked_at TEXT');
  const seed = db.prepare('INSERT OR IGNORE INTO platform_accounts(platform,label,profile_key,created_at) VALUES(?,?,?,?)');
  for (const platform of ['doubao', 'deepseek']) {
    seed.run(platform, '默认账号', 'legacy-' + platform, new Date().toISOString());
  }
  return db;
}
