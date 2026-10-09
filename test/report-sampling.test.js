import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../src/reporting.js';
test('样本贡献可加总、条件未知不当完整，未知账号不跨运行合并',()=>{
 const base={key:'1',run_id:1,question_id:1,question:'哪些工具？',account_id:1,account_label:'演示',platform:'demo',kind:'discovery',brand:{name:'星河'},status:'succeeded',answer:'星河',citations:[],day:'2026-10-01'};
 const entries=[base,{...base,key:'2',run_id:2,day:'2026-10-02',question_id:2},
  {...base,key:'3',run_id:3,account_id:null}, {...base,key:'4',run_id:4,account_id:null},
  {...base,key:'failed',run_id:5,status:'failed'}, {...base,key:'empty',run_id:6,answer:''}];
 entries[1].monitorConditions={search:{value:false},thinking:{value:true},model:{value:'演示模型'}};
 const r=buildReport(entries),s=r.sampling;
 assert.equal(s.samples,4);assert.equal(s.questionCount,2);assert.equal(s.runs,4);assert.equal(s.accounts,1);
 assert.equal(s.unknownAccountSamples,2);assert.equal(s.settingsComplete,1);
 assert.equal(s.accountsDistribution.length,3);
 assert.equal(s.accountsDistribution.reduce((n,g)=>n+g.samples,0),s.samples);
 assert.equal(s.questionsDistribution.reduce((n,g)=>n+g.share,0),1);
 assert.ok(s.accountsDistribution.every(g=>g.evidenceIds.every(id=>!['failed','empty'].includes(id))));
 assert.equal(buildReport(entries,{accountId:1}).sampling.samples,2);
 assert.equal(buildReport(entries,{from:'2026-10-02'}).sampling.samples,1);
 assert.equal(buildReport(entries,{accountId:99}).sampling.samples,0);
});
