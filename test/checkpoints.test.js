import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/db.js';
import { loadCheckpoint, clearCheckpoint } from '../src/checkpoints.js';

test('提交检查点在进程突然退出后保留，并隔离账号和批次；完成结果时可清除', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'geo-checkpoint-test-')), 'test.db');
  let db = openDatabase(file);
  db.exec("INSERT INTO brands(id,name,created_at,updated_at) VALUES(1,'示例工具','2026-01-01','2026-01-01');" +
    "INSERT INTO questions(id,brand_id,text,kind,source,created_at) VALUES(1,1,'示例问题','discovery','manual','2026-01-01');" +
    "INSERT INTO tasks(id,brand_id,name,platforms_json,question_ids_json,schedule_type,created_at) VALUES(1,1,'示例任务','[]','[1]','manual','2026-01-01');" +
    "INSERT INTO runs(id,task_id,status,started_at) VALUES(1,1,'running','2026-01-01');");
  db.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {openDatabase} from './src/db.js'; import {saveCheckpoint} from './src/checkpoints.js';" +
    "const db=openDatabase(process.argv[1]); saveCheckpoint(db,1,{question_id:1,account_id:1},{mayHaveSubmitted:true,pageUrl:'https://example.org/chat/demo'}); process.exit(9);",
    file], { encoding: 'utf8' });
  assert.equal(child.status, 9, child.stderr);
  db = openDatabase(file);
  try {
    assert.deepEqual(loadCheckpoint(db, 1, { question_id: 1, account_id: 1 }),
      { mayHaveSubmitted: true, pageUrl: 'https://example.org/chat/demo' });
    assert.equal(loadCheckpoint(db, 1, { question_id: 1, account_id: 2 }), null);
    assert.equal(loadCheckpoint(db, 2, { question_id: 1, account_id: 1 }), null);
    clearCheckpoint(db, 1, { question_id: 1, account_id: 1 });
    assert.equal(loadCheckpoint(db, 1, { question_id: 1, account_id: 1 }), null);
  } finally { db.close(); }
});
