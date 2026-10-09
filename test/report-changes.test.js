import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../src/reporting.js';
function record(run,q,answer,status='succeeded',overrides={}) {
  return {key:`${run}:doubao:1:${q}`,run_id:run,run_status:'completed',run_started_at:`2026-10-0${run}T00:00:00Z`,
    task_name:'演示任务',cohort:'fixed',question_id:q,question:'问题'+q,kind:'discovery',account_id:1,account_label:'演示账号',
    platform:'doubao',brand:{name:'星河',website:'https://brand.example.com'},day:`2026-10-0${run}`,status,answer,reportedCitationCount:0,citations:[],...overrides};
}

test('最新结束批次没有可定位记录也不跳过，两个空批次仍保留未知对比',()=>{
  const entries=[record(1,1,'其他'),record(2,1,'星河')];
  const manifest=[1,2,3].map(id=>({id,cohort:'fixed',status:'completed',day:`2026-10-0${id}`,total:1,located:id===3?0:1,task_name:'演示任务',started_at:`2026-10-0${id}T00:00:00Z`}));
  const r=buildReport(entries,{},manifest), c=r.runChanges[0];
  assert.equal(c.beforeRun,2);assert.equal(c.afterRun,3);
  assert.equal(c.matched,0);assert.equal(c.afterRate,null);assert.equal(c.unlocatedAfter,1);
  assert.equal(c.excluded[0].reason,'一侧缺失');assert.equal(r.runCount,3);
  const empty=buildReport([],{},manifest.slice(1)).runChanges[0];
  assert.equal(empty.beforeRun,2);assert.equal(empty.afterRun,3);assert.equal(empty.matched,0);
  const filtered=buildReport(entries,{to:'2026-10-02'},manifest).runChanges[0];
  assert.equal(filtered.afterRun,2);assert.equal(filtered.matched,1);
});
test('固定两次运行用共同成功分母，四种变化互斥且失败/缺失不当下降',()=>{
  const entries=[record(1,1,'其他'),record(2,1,'星河'),record(1,2,'星河'),record(2,2,'其他'),
    record(1,3,'星河'),record(2,3,'星河'),record(1,4,'其他'),record(2,4,'其他'),
    record(1,5,'星河'),record(2,5,'','failed'),record(2,6,'星河'),
    record(1,7,'星河','succeeded',{kind:'brand'}),record(2,7,'星河','succeeded',{kind:'brand'})];
  const r=buildReport(entries), c=r.runChanges[0];
  assert.equal(c.beforeRun,1); assert.equal(c.afterRun,2);
  assert.equal(c.matched,5); assert.equal(c.excluded.length,2);
  assert.deepEqual(c.transitions,{gained:1,lost:1,kept:2,absent:1});
  assert.equal(c.beforeMentions,3);assert.equal(c.afterMentions,3);
  assert.equal(c.activeMatched,4);assert.equal(c.beforeActiveRate,.5);assert.equal(c.activeDifference,0);
  assert.equal(c.ownMatched,2);
  assert.ok(!c.pairs.some(p=>p.question==='问题5'));
  assert.equal(r.history.find(h=>h.question==='问题5').points[1].mentioned,null);
});
test('最新运行全失败不回退到较早成功运行，无配对比例为未知',()=>{
  const r=buildReport([record(1,1,'星河'),record(2,1,'星河'),record(3,1,'','failed',{run_status:'failed'}),
    record(4,1,'星河','succeeded',{run_status:'running'})]);
  const c=r.runChanges[0]; assert.equal(c.beforeRun,2);assert.equal(c.afterRun,3);
  assert.equal(c.matched,0);assert.equal(c.difference,null);assert.equal(c.beforeRate,null);
  assert.equal(c.transitions.lost,0); assert.equal(c.excluded.length,1);
  assert.equal(r.history[0].points.length,4);
});
test('条件变化与缺失标记保留，未知账号不拼成同一账号轨迹',()=>{
  const r=buildReport([record(1,1,'星河'),record(2,1,'其他','succeeded',{cohort:'changed'}),
    record(3,1,'星河','succeeded',{cohort:null}),
    record(1,2,'星河','succeeded',{account_id:null}),record(2,2,'其他','succeeded',{account_id:null})]);
  assert.equal(r.runChanges.length,1);
  assert.equal(r.runChanges[0].matched,0);
  const h=r.history.find(h=>h.question==='问题1');
  assert.equal(h.points[1].conditionChanged,true);assert.equal(h.points[2].conditionUnknown,true);
  assert.equal(r.history.filter(h=>h.question==='问题2').length,2);
});
test('不同问题口径和重复归属不进入配对，引用缺口不当作官网未引用',()=>{
  const r=buildReport([record(1,1,'星河'),record(2,1,'星河','succeeded',{question:'修改了问题'}),
    record(1,2,'星河'),record(2,2,'星河'),record(2,2,'星河','succeeded',{key:'duplicate'}),
    record(1,3,'星河','succeeded',{citations:[{url:'https://brand.example.com/a'}]}),
    record(2,3,'星河','succeeded',{citationGap:true})]);
  const c=r.runChanges[0]; assert.equal(c.matched,1);assert.equal(c.excluded.length,2);
  assert.equal(c.ownMatched,0); assert.equal(c.pairs[0].citationIncomplete,true);
});
