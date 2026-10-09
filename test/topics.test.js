import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.js';import {listTopics,topicSelection,topicTaskState,initializeTopicSequence,allocateTopicId} from '../src/topics.js';import {buildReport} from '../src/reporting.js';import {sourceLibrary} from '../src/source-library.js';
test('专题去重与跨品牌隔离，成员变化不改任务固定问题，删除不删原问题',()=>{
 const db=openDatabase(':memory:');try{
  for(let i=1;i<=2;i++)db.prepare('INSERT INTO brands(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(i,'品牌'+i,'now','now');
  for(let i=1;i<=3;i++)db.prepare("INSERT INTO questions(id,brand_id,text,kind,source,created_at) VALUES(?,?,?,'discovery','manual','now')").run(i,i===3?2:1,'问题'+i);
  for(let i=1;i<=3;i++)db.prepare("INSERT INTO question_topics(id,brand_id,name,created_at) VALUES(?,?,?,'now')").run(i,i===3?2:1,'专题'+i);
  db.exec('INSERT INTO topic_questions VALUES(1,1),(2,1),(2,2)');
  const selection=topicSelection(db,1,[1,2,1]);assert.deepEqual(selection.questionIds,[1,2]);assert.throws(()=>topicSelection(db,1,[3]));
  const task={brand_id:1,question_ids_json:'[1]',topic_ids_json:'[1]',topic_snapshot_json:JSON.stringify(topicSelection(db,1,[1]).snapshot)};
  assert.equal(topicTaskState(db,task).topicsChanged,false);db.exec('INSERT INTO topic_questions VALUES(1,2)');assert.equal(topicTaskState(db,task).topicsChanged,true);assert.equal(task.question_ids_json,'[1]');
  db.exec('DELETE FROM question_topics WHERE id=1');assert.equal(db.prepare('SELECT count(*) AS n FROM questions').get().n,3);assert.equal(topicTaskState(db,task).topicsMissing,true);assert.equal(listTopics(db,1).length,1);
 }finally{db.close();}
});
test('空专题筛选不回退全部，报告和信源只按当前问题ID集合筛选',()=>{
 const base={key:'one',run_id:1,question_id:1,question:'问题',account_id:1,platform:'doubao',kind:'discovery',status:'succeeded',answer:'星河',brand:{name:'星河'},citations:[],day:'2026-10-07'};
 const entries=[base,{...base,key:'two',question_id:2,answer:'其他'}];assert.equal(buildReport(entries,{questionIds:[1]}).summary.mentions,1);assert.equal(buildReport(entries,{questionIds:[]}).summary.successful,0);
 const source={id:1,run_id:1,question_id:1,status:'succeeded',answer:'回答',started_at:'2026-10-07T00:00:00Z',citations_json:'[{"url":"https://source.example/a"}]'};assert.equal(sourceLibrary([source],[],{questionIds:[]}).totalPages,0);
 const manifest=[{id:1,questionIds:[1,2],total:3,located:2,day:base.day}];assert.equal(buildReport(entries,{questionIds:[]},manifest).runCount,0);assert.equal(buildReport(entries,{questionIds:[1]},manifest).summary.total,1);
});

test('专题编号保留删除历史，重开与历史快照不复用',()=>{
 const db=openDatabase(':memory:');try{
 db.prepare("INSERT INTO brands(id,name,created_at,updated_at) VALUES(1,'示例','now','now')").run();
 db.prepare("INSERT INTO tasks(id,brand_id,name,platforms_json,question_ids_json,schedule_type,created_at,topic_ids_json) VALUES(1,1,'任务','[]','[]','manual','now','[8]')").run();
 db.prepare("INSERT INTO runs(task_id,status,started_at,task_snapshot_json) VALUES(1,'completed','now',?)").run(JSON.stringify({topic_ids_json:'[10]'}));
 initializeTopicSequence(db);assert.equal(allocateTopicId(db),11);initializeTopicSequence(db);assert.equal(allocateTopicId(db),12);
 db.prepare("INSERT INTO question_topics(id,brand_id,name,created_at) VALUES(30,1,'手工专题','now')").run();assert.equal(allocateTopicId(db),31);db.exec('DELETE FROM question_topics');assert.equal(allocateTopicId(db),32);
 }finally{db.close();}
});
