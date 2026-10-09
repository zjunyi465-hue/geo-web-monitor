import test from 'node:test';
import assert from 'node:assert/strict';
import {searchAnswers,validateSearchFilters,savedSearchSources} from '../src/answer-search.js';
const row=(id,extra={})=>({id,run_id:id,task_id:1,question_id:1,question:'星河工具是什么？',account_id:1,account_label:'虚构账号',platform:'doubao',status:'succeeded',answer:'推荐星河工具；ABC [a+b]。💡',run_started_at:'2026-10-08T16:30:00Z',task_snapshot_json:'{"name":"历史名称"}',...extra});

test('字面搜索正文和两类保存来源，重叠计数不累加且不搜索问题文字',()=>{
 const records=[row(1,{citations_json:JSON.stringify([{title:'星河资料',url:'https://example.org/ABC'},{title:'星河资料',url:'https://example.org/ABC'}]),searched_sites_json:JSON.stringify([{title:'星河搜索',url:'https://search.example/1'}])}),row(2,{answer:'其他工具',citations_json:JSON.stringify([{title:'星河资料',url:'https://example.org/2'}])}),row(3,{answer:'其他内容'}),row(4,{status:'failed'}),row(5,{answer:'   '})];
 const before=JSON.stringify(records),all=searchAnswers(records,{q:'星河'});
 assert.equal(all.total,2);assert.equal(all.bodyAnswers,1);assert.equal(all.citationAnswers,2);assert.equal(all.searchAnswers,1);assert.equal(all.items.find(r=>r.resultId===1).citationCount,1);
 assert.equal(searchAnswers(records,{q:'星河',scope:'body'}).total,1);assert.equal(searchAnswers(records,{q:'星河',scope:'search'}).total,1);
 assert.equal(searchAnswers(records,{q:'[a+b]'}).total,1);assert.equal(searchAnswers(records,{q:'abc',scope:'body'}).total,1);
 assert.equal(searchAnswers(records,{q:'星河工具是什么'}).total,0);assert.equal(searchAnswers(records,{q:'xyz'}).total,0);assert.equal(searchAnswers(records,{q:'  '}).searched,false);
 const evidence=searchAnswers(records,{q:'[a+b]',scope:'body'},1);assert.equal(evidence.answer,records[0].answer);for(const r of evidence.bodyRanges)assert.equal(evidence.answer.slice(r.start,r.end),'[a+b]');assert.equal(evidence.task,'历史名称');assert.equal(JSON.stringify(records),before);
 assert.equal(searchAnswers(records,{q:'不匹配'},1),null);
});

test('范围交集、北京时间、未知日期账号及分页稳定且不更改旧回答',()=>{
 const records=Array.from({length:25},(_,i)=>row(i+1)),all=searchAnswers(records,{q:'星河'}),next=searchAnswers(records,{q:'星河',page:2});
 assert.equal(all.items.length,20);assert.equal(next.items.length,5);assert.equal(new Set([...all.items,...next.items].map(r=>r.resultId)).size,25);assert.deepEqual(searchAnswers([...records].reverse(),{q:'星河'}),all);
 assert.equal(searchAnswers(records,{q:'星河',page:99}).page,2);assert.equal(searchAnswers(records,{q:'星河',questionIds:[]}).total,0);
 for(const filters of [{taskId:2},{platform:'deepseek'},{accountId:2},{questionId:2},{questionIds:[2]},{from:'2026-10-08',to:'2026-10-08'}])assert.equal(searchAnswers(records,{q:'星河',...filters}).total,0);
 assert.equal(searchAnswers(records,{q:'星河',from:'2026-10-09',to:'2026-10-09'}).total,25);
 const old=row(30,{account_id:null,account_label:null,run_started_at:'invalid',started_at:'invalid'});assert.equal(searchAnswers([old],{q:'星河'}).items[0].account,'账号标识未保存');assert.equal(searchAnswers([old],{q:'星河',from:'2026-10-01'}).total,0);
});

test('来源危险URL和异常JSON不作为网页证据，原文预览有界且Unicode偏移可追溯',()=>{
 assert.deepEqual(savedSearchSources('{broken'),[]);assert.deepEqual(savedSearchSources('{}'),[]);
 const refs=[{url:'javascript:alert(1)',title:'星河'},{url:'https://u:p@example.org',title:'星河'},{url:' https://example.org',title:'星河'},{url:'https://example.org/a?b=1',title:'星河'},{url:'https://example.org/a?b=2',title:'星河'}];
 assert.equal(savedSearchSources(JSON.stringify(refs)).length,2);
 const answer='💡'.repeat(80)+'a'.repeat(10000),result=searchAnswers([row(1,{answer})],{q:'a'}).items[0];assert.equal(result.bodyCount,10000);assert.ok(result.bodySnippets.length<=3);for(const s of result.bodySnippets){assert.ok(s.text.length<=500);assert.equal(answer.slice(s.start,s.start+s.text.length),s.text);for(const r of s.ranges)assert.equal(s.text.slice(r.start,r.end),'a');assert.ok(!/^[\uDC00-\uDFFF]/.test(s.text));}
});

test('搜索参数拒绝过长、非法编号、日期和范围，保留查询字面符号',()=>{
 const parse=q=>validateSearchFilters(new URLSearchParams(q));assert.equal(parse({q:'  [a+b]  '}).q,'[a+b]');
 for(const q of [{q:'x'.repeat(201)},{scope:'wrong'},{page:'0'},{accountId:'1e2'},{topicId:'1.2'},{from:'2026-02-30'},{from:'2026-10-10',to:'2026-10-01'}])assert.throws(()=>parse(q));
});

test('异常URL与换行证据保持严格字面范围，不改写原文',()=>{
 const sources=[{url:'http:/example.org',title:'星河'},{url:'http:example.org',title:'星河'},{url:'https://example.org/a\nb',title:'星河'},{url:'HTTPS://example.org/a',title:'星河'}];
 assert.deepEqual(savedSearchSources(JSON.stringify(sources)),[sources[3]]);
 const answer='\r\n星河\r\n💡 星河\t[a+b]';const item=searchAnswers([row(1,{answer})],{q:'星河'},1);assert.equal(item.answer,answer);for(const r of item.bodyRanges)assert.equal(answer.slice(r.start,r.end),'星河');assert.equal(item.bodyCount,2);
});

test('独立计算多组筛选、正文和来源命中集合，顺序变化不影响结果',()=>{
 let seed=100909;const random=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
 const words=['星河','ABC','[a+b]','其他','https://example.org'];
 for(let group=0;group<60;group++){
  const records=Array.from({length:30},(_,i)=>row(i+1,{task_id:1+random(2),question_id:1+random(3),account_id:random(3)||null,platform:random(2)?'doubao':'deepseek',status:random(5)?'succeeded':'failed',answer:random(7)?words[random(words.length)]+' '+words[random(words.length)]:' ',citations_json:JSON.stringify([{url:'https://example.org/'+random(3),title:words[random(words.length)]}]),searched_sites_json:JSON.stringify([{url:'https://search.example/'+random(3),title:words[random(words.length)]}])}));
  for(const scope of ['all','body','citation','search'])for(const q of words){
   const filter={q,scope,accountId:group%3===0?1:'',questionIds:group%4===0?[]:group%4===1?[1,2]:undefined},eligible=records.filter(r=>r.status==='succeeded'&&r.answer.trim()&&(!filter.accountId||r.account_id===1)&&(!Array.isArray(filter.questionIds)||filter.questionIds.includes(r.question_id)));
   const contains=text=>text.toLowerCase().includes(q.toLowerCase()),sets={body:[],citation:[],search:[]};
   for(const r of eligible){if((scope==='all'||scope==='body')&&contains(r.answer))sets.body.push(r.id);for(const [kind,col] of [['citation','citations_json'],['search','searched_sites_json']])if((scope==='all'||scope===kind)&&JSON.parse(r[col]).some(c=>contains(c.title)||contains(c.url)))sets[kind].push(r.id);}
   const expected=new Set([...sets.body,...sets.citation,...sets.search]),actual=searchAnswers(records,filter),ids=actual.items.map(i=>i.resultId);if(actual.pageCount>1)ids.push(...searchAnswers(records,{...filter,page:2}).items.map(i=>i.resultId));
   assert.deepEqual([...ids].sort((a,b)=>a-b),[...expected].sort((a,b)=>a-b));assert.equal(actual.bodyAnswers,sets.body.length);assert.equal(actual.citationAnswers,sets.citation.length);assert.equal(actual.searchAnswers,sets.search.length);assert.deepEqual(searchAnswers([...records].reverse(),filter),actual);
  }
 }
});
