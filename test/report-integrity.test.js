import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../src/reporting.js';
import {brandMentioned} from '../src/analysis.js';
const base={key:'1:1:1',run_id:1,task_id:1,question_id:1,question:'有哪些工具？',kind:'discovery',account_id:1,platform:'doubao',
  brand:{name:'星河',website:'https://brand.example.com'},status:'succeeded',answer:'星河',day:'2026-10-01',citations:[],brandBasis:'snapshot'};

test('同一引用编号对应不同链接时不判引用完整，已见官网仍保留',()=>{
  const citations=[{number:1,url:'https://other.example.org/a'},{number:1,url:'https://other.example.org/b'}];
  const r=buildReport([{...base,citations,reportedCitationCount:1}]);
  assert.equal(r.records[0].citationCompleteness,'inconsistent');
  assert.equal(r.records[0].ownCitation,null);
  const visible=buildReport([{...base,citations:[...citations,{number:1,url:'https://brand.example.com/a'}],reportedCitationCount:1}]);
  assert.equal(visible.records[0].ownCitation,true);
  const repeated=buildReport([{...base,citations:[citations[0],citations[0]],reportedCitationCount:1}]);
  assert.equal(repeated.records[0].citationCompleteness,'complete');
});
test('未知引用数量不判官网未引用，有可见官网链接仍能确认出现',()=>{
  let r=buildReport([base]);
  assert.equal(r.records[0].ownCitation,null);
  assert.equal(r.summary.ownSourceRate,null);
  assert.equal(r.summary.ownSourceUnknown,1);
  r=buildReport([{...base,citations:[{url:'https://brand.example.com/a'}],reportedCitationCount:5}]);
  assert.equal(r.records[0].citationCompleteness,'partial');
  assert.equal(r.records[0].ownCitation,true);
  assert.equal(r.summary.ownSourceRate,1);
  r=buildReport([{...base,citations:[{url:'https://other.example.org/a'}],reportedCitationCount:1}]);
  assert.equal(r.records[0].ownCitation,false);
  assert.equal(r.summary.ownSourceRate,0);
});
test('重复引用和无效链接不能虚凑出完整引用数量',()=>{
  const duplicate=buildReport([{...base,citations:[{url:'https://other.example.org/a'},{url:'https://other.example.org/a'}],reportedCitationCount:2}]);
  assert.equal(duplicate.records[0].citationCompleteness,'partial');
  assert.equal(duplicate.records[0].ownCitation,null);
  const invalid=buildReport([{...base,citations:[{url:'javascript:alert(1)'},{url:'ftp://brand.example.com/a'}],reportedCitationCount:0}]);
  assert.equal(invalid.records[0].ownCitation,null);
  assert.equal(invalid.sources.length,0);
  assert.equal(invalid.audit.discardedCitationLinks,2);
});
test('空正文和同一槽位重复成功记录不进入有效样本',()=>{
  const empty=buildReport([{...base,answer:' \n '}]);
  assert.equal(empty.summary.successful,0); assert.equal(empty.summary.invalid,1);
  assert.equal(empty.summary.mentionRate,null); assert.equal(empty.records[0].originalStatus,'succeeded');
  const duplicate=buildReport([base,{...base,key:'another'}]);
  assert.equal(duplicate.summary.successful,0);assert.equal(duplicate.audit.duplicateRecords,2);
  assert.equal(duplicate.summary.invalid,2);
});

test('问题类型筛选不能隐藏同一最终槽位的冲突记录',()=>{
  const entries=[base,{...base,key:'conflict',kind:'brand'}];
  const r=buildReport(entries,{kind:'discovery'});
  assert.equal(r.records.length,1);assert.equal(r.summary.successful,0);
  assert.equal(r.summary.mentionRate,null);assert.equal(r.audit.duplicateRecords,1);
  assert.equal(buildReport(entries,{kind:'brand'}).summary.successful,0);
  assert.equal(entries[0].status,'succeeded');
});

test('成功回答的引用差异附带完整性边界，不把含品牌的推荐题误称认知题',()=>{
  const r=buildReport([{...base,cohort:'fixed',question:'星河怎么样？'},
    {...base,key:'2:1:1',run_id:2,cohort:'fixed',question:'星河怎么样？',citations:[{url:'https://other.example.org/a'}]}]);
  assert.equal(r.comparisons[0].citationIncomplete,true);
  assert.equal(r.comparisons[0].mentionChange,'不属于主动提及样本：查看原文');
});
test('预期数量缺失不丢掉，不将未知样本伪分配到账号或问题',()=>{
  const manifest=[{id:1,task_id:1,day:base.day,total:4,located:1,cohort:null}];
  const r=buildReport([base],{},manifest);
  assert.equal(r.summary.total,4);assert.equal(r.summary.captureRate,.25);assert.equal(r.summary.pending,3);
  assert.equal(r.questionFacts[0].total,1);assert.equal(r.records.length,1);
  const scoped=buildReport([base],{accountId:'1'},manifest);
  assert.equal(scoped.summary.total,1);assert.equal(scoped.audit.unlocatedIncluded,false);assert.equal(scoped.audit.unlocatedExpected,3);
  const mismatch=buildReport([base],{},[{...manifest[0],total:0}]);
  assert.equal(mismatch.summary.captureRate,null);assert.equal(mismatch.audit.expectedMismatchRuns,1);
});

test('每日采样保留没有回答的日期及条件组，缺失不伪作零提及',()=>{
  const manifest=[{id:1,task_id:1,day:base.day,total:3,located:1,cohort:'fixed',task_name:'演示任务'},
    {id:2,task_id:1,day:'2026-10-02',total:2,located:0,cohort:'empty',task_name:'空批次'}];
  const r=buildReport([base],{},manifest);
  assert.equal(r.trend.length,2);assert.equal(r.trend[0].total,3);
  assert.equal(r.trend[0].captureRate,1/3);
  assert.equal(r.trend[1].total,2);assert.equal(r.trend[1].pending,2);
  assert.equal(r.trend[1].mentionRate,null);assert.equal(r.trend[1].unlocatedExpected,2);
  assert.ok(r.cohorts.some(c=>c.key==='empty'));
  const filtered=buildReport([base],{accountId:1},manifest);
  assert.equal(filtered.trend[0].total,1);assert.equal(filtered.trend[1].total,0);
  assert.equal(filtered.trend[1].captureRate,null);
  assert.equal(r.trend.reduce((n,d)=>n+d.total,0),r.summary.total);
});
test('旧品牌资料补算有明确标记，不伪称历史快照',()=>{
  assert.equal(buildReport([{...base,brandBasis:'current_fallback'}]).audit.fallbackBrandRecords,1);
});
test('单条回答对照同样排除类型口径变化，域名统计不把非网页官网当有效官网',()=>{
  const entries=[{...base,cohort:'same',kind:'brand'}, {...base,key:'2:1:1',run_id:2,cohort:'same'}];
  assert.equal(buildReport(entries).comparisons.length,0);
  const invalidWebsite=buildReport([{...base,brand:{name:'星河',website:'ftp://brand.example.com'},citations:[{url:'https://brand.example.com/a'}]}]);
  assert.equal(invalidWebsite.records[0].ownCitation,null);
  assert.equal(invalidWebsite.sources[0].ownAnswers,0);
});
test('英文名称有词边界且正则字符按字面匹配，不拼接跨单词命中',()=>{
  assert.equal(brandMentioned('AcmeCloud',{name:'Acme'}),false);
  assert.equal(brandMentioned('Acme tools',{name:'Acme'}),true);
  assert.equal(brandMentioned('使用ACME工具',{name:'Acme'}),true);
  assert.equal(brandMentioned('这是ＡＣＭＥ',{name:'Acme'}),true);
  assert.equal(brandMentioned('AxB',{name:'A.B'}),false);
  assert.equal(brandMentioned('A.B',{name:'A.B'}),true);
  assert.equal(brandMentioned('A CME',{name:'ACME'}),false);
  assert.equal(brandMentioned('星 河',{name:'星河'}),true);
});
