import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/db.js';

test('人工复核接口权限、精确引用、版本冲突与独立报告统计',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'geo-answer-review-')),path=join(dir,'test.db'),db=openDatabase(path),now='2026-10-08T00:00:00Z';
 db.prepare('INSERT INTO brands(id,name,created_at,updated_at) VALUES(1,?,?,?)').run('星河工具',now,now);
 db.prepare("INSERT INTO questions(id,brand_id,text,kind,source,created_at) VALUES(1,1,'有哪些工具可选？','discovery','manual',?)").run(now);
 db.prepare("INSERT INTO tasks(id,brand_id,name,platforms_json,question_ids_json,account_ids_json,schedule_type,created_at) VALUES(1,1,'复核样本','[\"doubao\"]','[1]','[1]','manual',?)").run(now);
 db.prepare("INSERT INTO runs(id,task_id,status,total,done,started_at,finished_at) VALUES(1,1,'completed',1,1,?,?)").run(now,now);
 const answer='星河工具\r\n😀 <script>原文</script>重复词；重复词';
 db.prepare("INSERT INTO results(id,run_id,question_id,platform,account_id,status,answer,started_at,finished_at) VALUES(1,1,1,'doubao',1,'succeeded',?,?,?)").run(answer,now,now);db.close();
 const listener=net.createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));const port=listener.address().port;await new Promise(done=>listener.close(done));
 const child=spawn(process.execPath,['src/server.js'],{cwd:resolve('.'),env:{...process.env,GEO_PORT:String(port),GEO_DB_PATH:path,GEO_RESULTS_ROOT:join(dir,'results'),GEO_PROFILE_ROOT:join(dir,'profiles')},stdio:['ignore','pipe','pipe']});let errors='',cookie='';child.stderr.on('data',c=>errors+=c);
 const call=async(url,method='GET',input,extra={})=>{const res=await fetch('http://127.0.0.1:'+port+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:input===undefined?undefined:JSON.stringify(input)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,data:await res.json()};};
 const payload=(review,status='accurate',notes='人工核对',excerpt=null)=>({status,notes,excerpt,expectedRevision:review.revision,expectedUpdatedAt:review.updatedAt});
 try{
  let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error(errors);try{await call('/api/bootstrap');ready=true;break;}catch{}await new Promise(done=>setTimeout(done,100));}assert.ok(ready);
  assert.equal((await call('/api/results/1/review')).status,401);assert.equal((await call('/api/results/1/review','PUT',{})).status,401);
  await call('/api/setup','POST',{username:'admin',password:'sample-password-123'});
  assert.equal((await call('/api/results/999/review')).status,404);
  const baseline=(await call('/api/analytics?brandId=1')).data.report,initial=(await call('/api/results/1/review')).data.review;
  assert.equal(baseline.manualReviews.pending,1);assert.equal(initial.status,'pending');
  const start=answer.lastIndexOf('重复词'),excerpt={start,end:start+3,text:'重复词'};
  assert.equal((await call('/api/results/1/review','PUT',payload(initial,'accurate','<img src=x onerror=bad>',excerpt))).status,200);
  const current=(await call('/api/results/1/review')).data.review;assert.equal(current.reviewer,'admin');assert.deepEqual(current.excerpt,excerpt);
  assert.equal((await call('/api/results/1/review','PUT',payload(initial,'inaccurate'))).status,409);
  const report=(await call('/api/analytics?brandId=1')).data.report;assert.deepEqual(report.summary,baseline.summary);assert.equal(report.manualReviews.accurate,1);assert.equal(report.manualReviews.total,1);assert.equal(report.records[0].review.effectiveStatus,'accurate');
  for(const bad of [{status:'fake'},{notes:'x'.repeat(2001)},{excerpt:{start:0,end:3,text:'伪造片段'}}])assert.equal((await call('/api/results/1/review','PUT',{...payload(current),...bad})).status,400);
  assert.equal((await call('/api/results/1/review','PUT',payload(current),{Origin:'https://untrusted.example'})).status,403);
  const changeDb=new DatabaseSync(path);changeDb.exec('PRAGMA busy_timeout=3000');changeDb.prepare('UPDATE results SET citations_json=? WHERE id=1').run('[{"url":"https://source.example/a","title":"更新来源"}]');changeDb.close();
  const stale=(await call('/api/results/1/review')).data.review;assert.equal(stale.stale,true);assert.equal(stale.effectiveStatus,'pending');assert.deepEqual(stale.excerpt,excerpt);
  const staleReport=(await call('/api/analytics?brandId=1')).data.report.manualReviews;assert.equal(staleReport.pending,1);assert.equal(staleReport.stale,1);assert.equal(staleReport.reviewed,0);
  assert.equal((await call('/api/results/1/review','PUT',payload(current))).status,409);
  await call('/api/users','POST',{username:'member',password:'sample-member-password'});await call('/api/logout','POST',{});await call('/api/login','POST',{username:'member',password:'sample-member-password'});
  assert.equal((await call('/api/results/1/review','PUT',payload(stale,'uncertain','团队核对'))).status,200);
  const shared=(await call('/api/runs/1')).data;assert.equal(shared.results[0].review.reviewer,'member');assert.equal(shared.manualReviewSummary.uncertain,1);assert.equal(shared.results[0].review.stale,false);
  const failedDb=new DatabaseSync(path);failedDb.prepare("UPDATE results SET status='failed' WHERE id=1").run();failedDb.close();const failed=(await call('/api/results/1/review')).data.review;
  assert.equal(failed.reviewable,false);assert.equal((await call('/api/results/1/review','PUT',payload(failed))).status,400);
  await call('/api/logout','POST',{});assert.equal((await call('/api/results/1/review')).status,401);
 }finally{if(child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}}
});
