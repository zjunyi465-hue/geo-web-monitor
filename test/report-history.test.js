import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../src/reporting.js';
const r=(run,answer='星河',extra={})=>({key:'r'+run,run_id:run,run_status:'completed',run_started_at:'2026-10-07T00:00:00Z',day:'2026-10-07',
 question_id:1,question:'工具有哪些？',kind:'discovery',account_id:1,account_label:'演示账号',platform:'doubao',cohort:'fixed',
 brand:{name:'星河',website:'brand.example'},status:'succeeded',answer,reportedCitationCount:1,citations:[{url:'https://source.example/a'}],...extra});
test('历史日期分母守恒、来源去重且每段变化可追溯，不修改输入',()=>{
 const entries=[r(1,'其他',{citations:[{url:'https://source.example/a'},{url:'https://source.example/a'}]}),r(2,'星河',{reportedCitationCount:2,citations:[{url:'https://source.example/a'},{url:'https://source.example/b'}]}),r(3,'',{status:'failed'})];
 const snapshot=JSON.stringify(entries),h=buildReport(entries).history[0];
 assert.equal(h.summary.successful,2);assert.equal(h.summary.mentionRate,.5);assert.equal(h.daily[0].eligible,2);assert.equal(h.daily[0].failed,1);
 assert.equal(h.sources.find(s=>s.url.endsWith('/a')).evidenceIds.length,2);
 assert.deepEqual(h.points[1].change.keptSources,['https://source.example/a']);assert.deepEqual(h.points[1].change.addedSources,['https://source.example/b']);
 assert.equal(h.points[1].change.conditionsMatch,'unknown');assert.equal(h.points[0].conditionUnknown,true);
 assert.equal(h.points[2].change.reason,'相邻记录未全部成功');assert.deepEqual(h.points[2].change.removedSources,[]);
 assert.deepEqual(h.points[1].change.evidenceIds,['r1','r2']);assert.equal(JSON.stringify(entries),snapshot);
});
test('不跳过失败或跨口径拼历史变化，引用缺漏保留提示',()=>{
 const h=buildReport([r(1),r(2,'',{status:'failed'}),r(3,'星河',{reportedCitationCount:2}),r(4,'其他',{cohort:'changed'}),r(5,'星河',{cohort:'changed',reportedCitationCount:null})]).history[0];
 assert.equal(h.points[2].change.reason,'相邻记录未全部成功');assert.equal(h.points[3].change.reason,'任务条件或问题口径变化');
 assert.equal(h.daily.length,2);assert.equal(h.points[4].change.reason,null);assert.equal(h.points[4].change.citationIncomplete,true);
 assert.equal(h.points[4].change.beforeRun,4);assert.equal(h.points[4].change.afterRun,5);
});
test('账号与筛选隔离，每日证据ID不串行，已知设置变化不当品牌下降',()=>{
 const settings=search=>({search:{value:search},thinking:{value:false},model:{value:'演示模式'}});
 const entries=[r(1,'星河',{monitorConditions:settings(true)}),r(2,'其他',{monitorConditions:settings(false)}),r(1,'星河',{key:'other',account_id:2})];
 const report=buildReport(entries);assert.equal(report.history.length,2);
 assert.notEqual(report.history[0].daily[0].key,report.history[1].daily[0].key);
 assert.equal(report.history[0].points[1].change.reason,'已知页面设置变化');
 const selected=buildReport(entries,{accountId:2}).history;assert.equal(selected.length,1);assert.deepEqual(selected[0].evidenceIds,['other']);
});
test('运行清单中间有缺失时不跨过它比较引用',()=>{
 const manifest=[{id:2,cohort:'fixed',status:'failed',day:'2026-10-07',total:1,located:0}];
 const h=buildReport([r(1),r(3,'其他')],{},manifest).history[0];
 assert.equal(h.points[1].change.reason,'中间运行缺少该问题账号的记录');assert.deepEqual(h.points[1].change.removedSources,[]);
});
