import {spawn} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';
import {allocateTopicId} from '../src/topics.js';
import { createBackup } from '../src/backup.js';

test('数据库与截图一起备份，登录资料不进入备份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'geo-backup-test-'));
  const dbPath = join(root, 'data', 'monitor.db');
  const resultsRoot = join(root, 'results');
  const db = openDatabase(dbPath);
  db.prepare("INSERT INTO brands(name,category,created_at,updated_at) VALUES('样本','服务','2026-01-01','2026-01-01')").run();
  db.prepare("INSERT INTO source_annotations(brand_id,url,category,favorite,notes,updated_at) VALUES(1,'https://source.example/a','owned',1,'人工标注','2026-10-07')").run();
  db.prepare("INSERT INTO institution_reviews(brand_id,name_key,name,category,notes,updated_at) VALUES(1,'云海集团','云海集团','peer','机构核对','2026-10-07')").run();
  db.close();
  await mkdir(resultsRoot);
  await writeFile(join(resultsRoot, 'evidence.txt'), 'evidence');
  const folder = await createBackup({ dbPath, resultsRoot, backupRoot: join(root, 'backups') });
  const restored = new DatabaseSync(join(folder, 'geo-monitor.db'), { readOnly: true });
  try { assert.equal(restored.prepare('SELECT name FROM brands').get().name, '样本');
    assert.equal(restored.prepare('SELECT notes FROM source_annotations').get().notes,'人工标注');
    assert.equal(restored.prepare('SELECT favorite FROM source_annotations').get().favorite,1);
    assert.equal(restored.prepare('SELECT notes FROM institution_reviews').get().notes,'机构核对');
  }
  finally { restored.close(); }
  assert.equal(await readFile(join(folder, 'results', 'evidence.txt'), 'utf8'), 'evidence');
  assert.match(await readFile(join(folder, 'README.txt'), 'utf8'), /不包含 profiles/);
});

test('专题成员与不复用编号随备份恢复',async()=>{
 const root=await mkdtemp(join(tmpdir(),'geo-topic-backup-')),dbPath=join(root,'monitor.db');const db=openDatabase(dbPath);
 db.prepare("INSERT INTO brands(id,name,created_at,updated_at) VALUES(1,'示例','now','now')").run();
 db.prepare("INSERT INTO questions(id,brand_id,text,kind,source,created_at) VALUES(1,1,'示例问题','discovery','manual','now')").run();
 const first=allocateTopicId(db);db.prepare("INSERT INTO question_topics(id,brand_id,name,created_at) VALUES(?,1,'专题','now')").run(first);db.prepare('INSERT INTO topic_questions VALUES(?,1)').run(first);
 const deleted=allocateTopicId(db);db.prepare("INSERT INTO question_topics(id,brand_id,name,created_at) VALUES(?,1,'被删专题','now')").run(deleted);db.prepare('DELETE FROM question_topics WHERE id=?').run(deleted);db.close();
 const folder=await createBackup({dbPath,resultsRoot:join(root,'no-results'),backupRoot:join(root,'backups')});
 const restored=openDatabase(join(folder,'geo-monitor.db'));try{assert.equal(restored.prepare('SELECT question_id FROM topic_questions WHERE topic_id=?').get(first).question_id,1);assert.equal(allocateTopicId(restored),deleted+1);}finally{restored.close();}
});


test('数据库短暂外部写锁有界等待后可以保存，不立即丢弃写入',async()=>{
 const root=await mkdtemp(join(tmpdir(),'geo-lock-test-')),path=join(root,'monitor.db'),db=openDatabase(path);
 assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,3000);
 const locker=spawn(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.disconnect();},600);",path],{stdio:['ignore','ignore','pipe','ipc']});
 let errors='';locker.stderr.on('data',chunk=>errors+=chunk);
 try{await new Promise((resolve,reject)=>{locker.once('message',resolve);locker.once('error',reject);locker.once('exit',code=>reject(new Error('锁测试进程提前退出 '+code+' '+errors)));});
  db.prepare("INSERT INTO brands(name,created_at,updated_at) VALUES('虚构锁测试','2026-10-08','2026-10-08')").run();
  assert.equal(db.prepare('SELECT count(*) AS n FROM brands').get().n,1);
 }finally{db.close();if(locker.exitCode===null){await new Promise(resolve=>locker.once('exit',resolve));}}
});


test('人工复核及原文引用随数据库备份恢复，不改原回答',async()=>{
 const root=await mkdtemp(join(tmpdir(),'geo-review-backup-')),path=join(root,'monitor.db'),db=openDatabase(path);
 db.prepare("INSERT INTO brands(id,name,created_at,updated_at) VALUES(1,'样本','now','now')").run();db.prepare("INSERT INTO questions(id,brand_id,text,kind,source,created_at) VALUES(1,1,'样本问题','discovery','manual','now')").run();db.prepare("INSERT INTO tasks(id,brand_id,name,platforms_json,question_ids_json,schedule_type,created_at) VALUES(1,1,'样本','[]','[1]','manual','now')").run();db.prepare("INSERT INTO runs(id,task_id,status,started_at) VALUES(1,1,'completed','now')").run();db.prepare("INSERT INTO results(id,run_id,question_id,platform,status,answer,started_at,finished_at) VALUES(1,1,1,'doubao','succeeded','原始回答','now','now')").run();db.prepare("INSERT INTO answer_reviews(result_id,answer_revision,status,notes,excerpt_start,excerpt_end,excerpt_text,updated_at) VALUES(1,'saved-revision','inaccurate','待核对',0,2,'原始','now')").run();db.close();
 const folder=await createBackup({dbPath:path,resultsRoot:join(root,'none'),backupRoot:join(root,'backups')}),restored=openDatabase(join(folder,'geo-monitor.db'));
 try{const review=restored.prepare('SELECT * FROM answer_reviews WHERE result_id=1').get();assert.equal(review.status,'inaccurate');assert.equal(review.notes,'待核对');assert.equal(review.excerpt_text,'原始');assert.equal(restored.prepare('SELECT answer FROM results WHERE id=1').get().answer,'原始回答');assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);restored.prepare('DELETE FROM results WHERE id=1').run();assert.equal(restored.prepare('SELECT count(*) AS n FROM answer_reviews').get().n,0);}finally{restored.close();}
});
