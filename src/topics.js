export function listTopics(db,brandId) {
  return db.prepare('SELECT * FROM question_topics WHERE brand_id=? ORDER BY id').all(brandId).map(t=>({...t,questionIds:db.prepare('SELECT question_id FROM topic_questions WHERE topic_id=? ORDER BY question_id').all(t.id).map(q=>q.question_id)}));
}
export function topicSelection(db,brandId,ids=[]) {
  if(!Array.isArray(ids)||ids.length>100)throw new Error('专题选择无效');
  const selected=[...new Set(ids.map(Number))];
  if(selected.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('专题选择无效');
  const topics=listTopics(db,brandId),snapshot=selected.map(id=>topics.find(t=>t.id===id));
  if(snapshot.some(t=>!t))throw new Error('专题已删除或不属于当前品牌');
  return {ids:selected,snapshot:snapshot.map(t=>({id:t.id,name:t.name,questionIds:t.questionIds})),questionIds:[...new Set(snapshot.flatMap(t=>t.questionIds))].sort((a,b)=>a-b)};
}
export function topicTaskState(db,task) {
  const ids=JSON.parse(task.topic_ids_json||'[]');if(!ids.length)return {topicNames:[],topicsChanged:false};
  const saved=JSON.parse(task.topic_snapshot_json||'[]'),current=listTopics(db,task.brand_id);
  const signature=list=>JSON.stringify(list.map(t=>[t.id,[...t.questionIds].sort((a,b)=>a-b)]).sort((a,b)=>a[0]-b[0]));
  const selected=ids.map(id=>current.find(t=>t.id===id));
  return {topicNames:ids.map(id=>current.find(t=>t.id===id)?.name||(saved.find(t=>t.id===id)?.name||'历史专题')+'（已删除）'),topicsChanged:selected.some(t=>!t)||signature(selected)!==signature(saved),topicsMissing:selected.some(t=>!t)};
}

// Preserve deleted IDs: task/run snapshots can retain a topic after its deletion.
export function initializeTopicSequence(db) {
  db.exec('CREATE TABLE IF NOT EXISTS topic_sequence (singleton INTEGER PRIMARY KEY CHECK(singleton=1),last_id INTEGER NOT NULL)');
  let maximum=db.prepare('SELECT COALESCE(MAX(id),0) n FROM question_topics').get().n;
  const inspect=raw=>{try{for(const id of JSON.parse(raw||'[]'))if(Number.isSafeInteger(id)&&id>maximum)maximum=id;}catch{}};
  for(const task of db.prepare('SELECT topic_ids_json FROM tasks').all())inspect(task.topic_ids_json);
  for(const run of db.prepare('SELECT task_snapshot_json FROM runs WHERE task_snapshot_json IS NOT NULL').all())try{inspect(JSON.parse(run.task_snapshot_json).topic_ids_json);}catch{}
  db.prepare('INSERT INTO topic_sequence(singleton,last_id) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)').run(maximum);
}
export function allocateTopicId(db) {
  const maximum=db.prepare('SELECT COALESCE(MAX(id),0) n FROM question_topics').get().n;
  return db.prepare('UPDATE topic_sequence SET last_id=MAX(last_id,?)+1 WHERE singleton=1 RETURNING last_id').get(maximum).last_id;
}
