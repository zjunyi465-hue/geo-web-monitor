import test from 'node:test';
import assert from 'node:assert/strict';
import {brandMentioned} from '../src/analysis.js';
import {textEvidence} from '../src/brand-evidence.js';
import {buildReport} from '../src/reporting.js';
test('原文证据保持全角、组合字符与空白，英文边界和字面符号不误匹配',()=>{
 for(const [text,brand,expected] of [
  ['可以了解ＡＣＭＥ。',{name:'ACME'},'ＡＣＭＥ'],['Café 可了解',{name:'Cafe\u0301'},'Café'],
  ['星\n河工具可了解',{name:'星河工具',aliases:'星河'},'星\n河工具'],['A+B 是一个选项',{name:'A+B'},'A+B']]) {
  const e=textEvidence(text,brand);assert.equal(brandMentioned(text,brand),true);assert.equal(e.matched,true);
  assert.equal(e.excerpts[0].parts.filter(p=>p.highlight).map(p=>p.text).join(''),expected);
  assert.equal(e.excerpts[0].parts.map(p=>p.text).join(''),text);
 }
 for(const text of ['XACME','ACME_tools','ACMEs']) assert.equal(textEvidence(text,{name:'ACME'}).matched,false);
 assert.equal(textEvidence('DataBase',{name:'Data Base'}).matched,false);
});
test('名称类型、重叠与截断显式保留，不将文字证据当推荐判断',()=>{
 const brand={name:'星河工具',aliases:'星河，星河工具'};
 const e=textEvidence('不推荐星河工具；星河需要核对。',brand);
 assert.equal(e.occurrences,2);assert.deepEqual(e.names.map(n=>n.type),['brand_name','alias']);
 assert.equal(textEvidence('星河星河',brand).occurrences,2);
 const text=Array.from({length:8},()=> '星河'+ '。'.repeat(300)).join('');
 const limited=textEvidence(text,brand);assert.equal(limited.excerpts.length,5);assert.equal(limited.excerptCount,8);assert.equal(limited.occurrences,8);
 assert.equal(limited.excerpts[0].trailing,true);
 const unsafe=textEvidence('<script>alert(1)</script>星河',brand);assert.equal(unsafe.excerpts[0].parts[0].text,'<script>alert(1)</script>');
});
test('正文、引用标题和搜索标题分开，标题不抬高提及率，失败不展示有效证据',()=>{
 const base={key:'one',run_id:1,question_id:1,account_id:1,platform:'doubao',question:'工具有哪些？',kind:'discovery',status:'succeeded',brand:{name:'星河'},answer:'可以了解其他工具',citations:[{title:'星河资料',url:'https://source.example/a'}],searchedSites:[{title:'星河介绍',url:'https://source.example/b'}]};
 const entries=[base,{...base,key:'two',run_id:2,answer:'不推荐星河。'},{...base,key:'failed',run_id:3,status:'failed'}];
 const snapshot=JSON.stringify(entries),r=buildReport(entries),q=r.questionFacts[0];
 assert.equal(r.summary.mentionRate,.5);assert.deepEqual(q.nameLocations,{body:1,citationTitles:2,searchTitles:2,titleOnly:1});
 assert.equal(r.records[0].nameEvidence.body.matched,false);assert.equal(r.records[0].nameEvidence.citations.length,1);
 assert.equal(r.records[2].nameEvidence,null);assert.equal(JSON.stringify(entries),snapshot);
 assert.equal(buildReport(entries,{from:'9999'}).records.length,0);
});


test('别名数组保留每个名称内部标点，旧字符串别名继续使用分隔符',()=>{
 const identity={name:'星河工具',aliases:['Alpha, Beta公司','云海、清泉集团']};
 for(const name of identity.aliases){const e=textEvidence(name,identity);assert.equal(e.matched,true);assert.equal(e.names[0].name,name);}
 for(const fragment of ['Alpha','Beta公司','云海','清泉集团'])assert.equal(brandMentioned(fragment,identity),false);
 assert.equal(brandMentioned('云海',{name:'星河工具',aliases:'云海，清泉'}),true);
});
