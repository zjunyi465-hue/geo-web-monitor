import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';
import { createBackup } from '../src/backup.js';

test('数据库与截图一起备份，登录资料不进入备份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'geo-backup-test-'));
  const dbPath = join(root, 'data', 'monitor.db');
  const resultsRoot = join(root, 'results');
  const db = openDatabase(dbPath);
  db.prepare("INSERT INTO brands(name,category,created_at,updated_at) VALUES('样本','服务','2026-01-01','2026-01-01')").run();
  db.close();
  await mkdir(resultsRoot);
  await writeFile(join(resultsRoot, 'evidence.txt'), 'evidence');
  const folder = await createBackup({ dbPath, resultsRoot, backupRoot: join(root, 'backups') });
  const restored = new DatabaseSync(join(folder, 'geo-monitor.db'), { readOnly: true });
  try { assert.equal(restored.prepare('SELECT name FROM brands').get().name, '样本'); }
  finally { restored.close(); }
  assert.equal(await readFile(join(folder, 'results', 'evidence.txt'), 'utf8'), 'evidence');
  assert.match(await readFile(join(folder, 'README.txt'), 'utf8'), /不包含 profiles/);
});
