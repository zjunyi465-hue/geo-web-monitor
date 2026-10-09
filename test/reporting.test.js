import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/reporting.js';

test('跨运行报告按有效推荐回答计提及，引用按回答去重且保留证据', () => {
  const brand = { name: '星河', website: 'https://example.com' };
  const base = { question_id: 1, question: '有哪些工具？', kind: 'discovery', platform: 'doubao', account_id: 1, account_label: '演示', brand, citations: [], searchedSites: [] };
  const entries = [
    { ...base, key:'1', run_id:1, day:'2026-10-01', status:'succeeded', answer:'星河可以考虑', citations:[{url:'https://example.com/a'},{url:'https://example.com/b'}] },
    { ...base, key:'2', run_id:2, question_id:2, day:'2026-10-02', status:'failed', answer:'星河' },
    { ...base, key:'3', run_id:2, day:'2026-10-02', status:'succeeded', answer:'其他工具' },
    { ...base, key:'4', run_id:3, question_id:2, day:'2026-10-03', status:'pending' },
    { ...base, key:'5', run_id:3, day:'2026-10-03', kind:'brand', question:'星河是什么？', status:'succeeded', answer:'星河是工具' },
    { ...base, key:'6', run_id:4, day:'2026-10-04', question:'星河怎么样？', status:'succeeded', answer:'星河不错' },
  ];
  const r = buildReport(entries);
  assert.equal(r.summary.mentionRate, .5);
  assert.equal(r.summary.successful, 4);
  assert.equal(r.summary.pending, 1);
  assert.equal(r.sources[0].answers, 1);
  assert.equal(r.sources[0].count, 2);
  assert.equal(r.sources[0].ownAnswers, 1);
  assert.deepEqual(r.sources[0].evidenceIds, ['1']);
  assert.equal(r.trend[2].mentionRate, null);
  const filtered = buildReport(entries, { from:'2026-10-02', to:'2026-10-02', accountId:'1', platform:'doubao', kind:'discovery' });
  assert.equal(filtered.summary.total, 2);
  assert.equal(filtered.summary.mentionRate, 0);
  assert.equal(buildReport(entries,{accountId:'999'}).summary.mentionRate,null);
  const renamed = buildReport([{...entries[0], brand:{name:'新品牌'}}]);
  assert.equal(renamed.summary.mentions,0);
});
test('回答比较不跨账号、任务条件组或缺失快照，失败不作为对照',()=>{
  const base={ question_id:1, question:'推荐哪些工具？', kind:'discovery', platform:'doubao', account_id:1, account_label:'演示',
    brand:{name:'星河'}, task_id:1, task_name:'监测', cohort:'fixed', citations:[], searchedSites:[], day:'2026-10-01',status:'succeeded' };
  const entries=[
    {...base,key:'1:1:1',run_id:1,answer:'星河',citations:[{url:'https://example.com/old'},{url:'https://example.com/old'}]},
    {...base,key:'2:1:1',run_id:2,answer:'',status:'failed'},
    {...base,key:'3:1:1',run_id:3,answer:'其他',citations:[{url:'https://example.com/new'}]},
    {...base,key:'4:2:1',run_id:4,account_id:2,answer:'星河'},
    {...base,key:'5:1:1',run_id:5,cohort:'changed',answer:'星河'},
    {...base,key:'6:1:1',run_id:6,cohort:null,answer:'星河'},
  ];
  const r=buildReport(entries);
  assert.equal(r.comparisons.length,1);
  assert.equal(r.comparisons[0].beforeId,'1:1:1');
  assert.equal(r.comparisons[0].afterId,'3:1:1');
  assert.equal(r.comparisons[0].mentionChange,'本次未再出现品牌');
  assert.deepEqual(r.comparisons[0].removedSources,['https://example.com/old']);
  assert.equal(r.pages.find(p=>p.url.endsWith('/old')).answers,1);
  assert.equal(buildReport(entries,{cohort:'changed'}).summary.total,1);
  assert.equal(buildReport(entries,{taskId:'999'}).summary.total,0);
  assert.match(r.quality[0].reasons[0],/采集失败/);
  const absent=buildReport([1,2,3].map(i=>({...base,key:String(i),run_id:i,answer:'其他'})));
  assert.equal(absent.questionFacts[0].nameMentions,0);
  assert.equal(absent.questionFacts[0].absentIds.length,3);
});
test('问题数据与两组信源分布仅包含成功回答，保留分母与官网未知状态',()=>{
  const base={question_id:1,question:'有哪些工具？',kind:'discovery',account_id:1,account_label:'演示',brand:{name:'星河',website:'https://brand.example.com'},
    task_id:1,task_name:'任务',cohort:'same',day:'2026-10-01',reportedCitationCount:1,citations:[{url:'https://reference.example.org/article',title:'参考资料'}],searchedSites:[],status:'succeeded'};
  const entries=[...Array.from({length:3},(_,i)=>({...base,key:'low'+i,run_id:i+1,platform:'doubao',answer:'其他工具'})),
    ...Array.from({length:3},(_,i)=>({...base,key:'high'+i,run_id:i+4,platform:'deepseek',answer:'星河'})),
    {...base,key:'failed',run_id:7,platform:'doubao',status:'failed',answer:''}];
  const r=buildReport(entries);
  const fact=r.questionFacts[0];
  assert.equal(fact.successful,6);
  assert.equal(fact.nameMentions,3);
  assert.deepEqual(fact.absentIds,['low0','low1','low2']);
  assert.equal(fact.sourceSplit[0].mentioned,3);
  assert.equal(fact.sourceSplit[0].absent,3);
  assert.equal(fact.sourceSplit[0].evidenceIds.length,6);
  assert.equal(fact.platforms.find(p=>p.first.platform==='doubao').nameMentions,0);
  assert.equal(fact.ownAbsentIds.length,3);
  assert.equal(r.summary.ownSourceEligible,3);
  assert.equal(r.summary.ownSourceRate,0);
  assert.ok(!fact.evidenceIds.includes('failed'));
  assert.equal(r.quality[0].failed,1);
  assert.equal(buildReport(entries.filter(e=>e.status==='failed')).questionFacts[0].nameMentionRate,null);
  assert.equal('opportunities' in r,false);
  const own={...entries[3],citations:[{url:'https://docs.brand.example.com/a'}]};
  assert.equal(buildReport([own]).questionFacts[0].ownPresentIds.length,1);
  assert.equal(buildReport([own]).summary.ownSourceRate,1);
  assert.equal(buildReport([{...entries[3],citationGap:true}]).questionFacts[0].ownAbsentIds.length,0);
  assert.equal(buildReport([{...entries[3],brand:{name:'星河'}}]).questionFacts[0].ownUnknown,1);
  assert.equal(buildReport([{...entries[3],brand:{name:'星河'}}]).summary.ownSourceRate,null);
});
test('提问含品牌名不混入主动提及，重复引用只计一个回答，未知来源不补造',()=>{
  const base={key:'a',run_id:1,question_id:1,question:'星河是什么？',kind:'brand',platform:'doubao',account_id:1,brand:{name:'星河'},day:'2026-10-01',status:'succeeded',answer:'星河是工具',citations:[{url:'https://example.com/a'},{url:'https://example.com/a'}]};
  const r=buildReport([base]); const q=r.questionFacts[0];
  assert.equal(q.eligible,0);
  assert.equal(q.mentionRate,null);
  assert.equal(q.nameMentionRate,1);
  assert.equal(q.sourceSplit[0].mentioned,1);
  assert.equal(q.sourceSplit[0].absent,0);
  const noSources=buildReport([{...base,citations:[]}]).questionFacts[0];
  assert.equal(noSources.sourceSplit.length,0);
  assert.equal(noSources.noCitations,1);
});
