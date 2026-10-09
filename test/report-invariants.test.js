import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../src/reporting.js';

test('混合采样下分母守恒、筛选可加总、配对可追溯且输入不被修改',()=>{
  const entries=[], manifest=[];
  for(let run=1;run<=6;run++) {
    const day=`2026-10-0${run}`, start=`${day}T00:00:00Z`;
    let located=0;
    for(let account=1;account<=2;account++) for(let q=1;q<=3;q++) {
      // Last run has no located records; other runs mix failure, empty and valid answers.
      if(run===6) continue;
      const index=run+account+q, status=index%4===0?'failed':'succeeded';
      entries.push({key:`${run}:demo:${account}:${q}`,run_id:run,task_id:1,cohort:'fixed',task_name:'演示任务',
        run_status:'completed',run_started_at:start,day,account_id:account,account_label:'演示'+account,
        platform:'demo',question_id:q,question:'工具问题'+q,kind:q===3?'brand':'discovery',
        brand:{name:'星河',website:'https://brand.example.com'},brandBasis:'snapshot',status,
        answer:status==='failed'?'':index%5===0?' ':index%2?'星河':'其他工具',
        citations:[],reportedCitationCount:index%3===0?null:0});
      located++;
    }
    manifest.push({id:run,task_id:1,cohort:'fixed',task_name:'演示任务',status:'completed',started_at:start,day,total:6,located});
  }
  const before=JSON.stringify(entries);
  const report=buildReport(entries,{},manifest), summary=report.summary;
  assert.equal(summary.total,36);
  assert.equal(summary.successful+summary.failed+summary.invalid+summary.pending,summary.total);
  assert.equal(report.trend.reduce((n,d)=>n+d.total,0),summary.total);
  assert.deepEqual(buildReport([...entries].reverse(),{},manifest).summary,summary);
  const splits=[1,2].map(accountId=>buildReport(entries,{accountId},manifest));
  for(const metric of ['successful','failed','invalid','eligible','mentions']) {
    assert.equal(splits.reduce((n,r)=>n+r.summary[metric],0),summary[metric]);
  }
  for(const group of [summary,...report.trend,...report.questions,...report.accounts,...report.matrix]) {
    assert.ok(group.mentions<=group.eligible && group.eligible<=group.successful);
    for(const metric of ['captureRate','mentionRate','ownSourceRate']) assert.ok(group[metric]===null||(group[metric]>=0&&group[metric]<=1));
    assert.equal(group.successful+group.failed+group.invalid+group.pending,group.total);
  }
  for(const change of report.runChanges) {
    assert.equal(Object.values(change.transitions).reduce((a,b)=>a+b,0),change.matched);
    assert.equal(change.matched,0); // Empty latest batch cannot become a brand decline.
    assert.equal(change.difference,null);
  }
  for(const q of report.questionFacts) {
    assert.equal(q.namedIds.length+q.absentIds.length,q.successful);
    assert.ok(q.evidenceIds.every(id=>report.records.some(r=>r.key===id&&r.status==='succeeded')));
  }
  assert.equal(JSON.stringify(entries),before);
});
