import {sourceAssets} from '../src/source-library.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverInstitutions,institutionKey,institutionReport,institutionEvidence,institutionDetail,validateInstitutionMerge} from '../src/institutions.js';
const brand={name:'星河公司',aliases:'星河'};
const record=(id,answer,extra={})=>({id,run_id:id,question_id:1,account_id:1,question:'有哪些机构可选？',question_kind:'discovery',platform:'doubao',status:'succeeded',answer,started_at:'2026-10-07T00:00:00Z',...extra});
const review=(name,category='peer',merge=null)=>({name,name_key:institutionKey(name),category,merge_into:merge});
test('从名称结构发现候选，分隔连接词与过滤泛称，不假定推荐或身份',()=>{
 assert.deepEqual(discoverInstitutions('推荐星河公司和云海集团。可选择明川大学附属研究院。大型研究机构。'),['星河公司','云海集团','明川大学附属研究院']);
 assert.deepEqual(discoverInstitutions('这家中心、当地中心、一家机构、中心、某某中心'),[]);
 assert.ok(discoverInstitutions('不推荐云海集团').includes('云海集团'));
});
test('相同公共分母、重复/空/失败排除、点名问题单列与四象限守恒',()=>{
 const records=[record(1,'星河公司与云海集团'),record(2,'云海集团'),record(3,'星河公司'),record(4,'没有匹配名称'),record(5,'云海集团',{question:'云海集团好吗？'}),record(6,'云海集团',{status:'failed'}),record(7,' '),record(8,'云海集团'),record(9,'云海集团',{run_id:8})];
 const original=JSON.stringify(records),r=institutionReport(records,brand,[review('云海集团')]);
 assert.equal(r.summary.successful,5);assert.equal(r.summary.eligible,4);assert.equal(r.summary.ownMentions,2);
 const g=r.groups.find(g=>g.name==='云海集团');assert.equal(g.body,3);assert.equal(g.eligibleMentions,2);assert.equal(g.both,1);assert.equal(g.withoutOwn,1);assert.equal(g.ownOnly,1);assert.equal(g.neither,1);assert.equal(g.both+g.withoutOwn+g.ownOnly+g.neither,r.summary.eligible);
 assert.deepEqual(institutionEvidence(r,g.key,'withoutOwn').map(e=>e.resultId),[2]);assert.ok(institutionEvidence(r,g.key)[0].nameEvidence.matched);assert.equal(JSON.stringify(records),original);
});
test('标题与正文独立、坏来源排除、同回答两别名只算一次且解除可恢复',()=>{
 const records=[record(1,'云海集团与云海公司。',{citations_json:JSON.stringify([{title:'清泉公司介绍',url:'https://source.example/a'},{title:'幽灵公司',url:'javascript:bad'}]),searched_sites_json:JSON.stringify([{title:'云海集团',url:'https://search.example/a'}])})];
 const merged=institutionReport(records,brand,[review('云海集团'),review('云海公司','pending',institutionKey('云海集团'))]);const cloud=merged.groups.find(g=>g.name==='云海集团');assert.equal(cloud.body,1);assert.equal(cloud.searchTitles,1);assert.equal(merged.summary.eligible,1);assert.equal(merged.groups.find(g=>g.name==='清泉公司').body,0);assert.equal(merged.groups.find(g=>g.name==='清泉公司').citationTitles,1);assert.ok(!merged.reviews.some(r=>r.name==='幽灵公司'));
 const split=institutionReport(records,brand,[review('云海集团'),review('云海公司','peer')]);assert.equal(split.groups.filter(g=>g.category==='peer').length,2);
});
test('筛选不改变名单识别，空专题无数据、日期账号隔离、当前品牌重命名不与自己比较',()=>{
 const records=[record(1,'云海集团'),record(2,'星河公司',{account_id:2,platform:'deepseek'}),record(3,'清泉公司',{started_at:'坏日期'})],annotations=[review('云海集团')];
 assert.equal(institutionReport(records,brand,annotations,{questionIds:[]}).summary.successful,0);assert.equal(institutionReport(records,brand,annotations,{accountId:2}).summary.ownMentions,1);assert.equal(institutionReport(records,brand,annotations,{from:'2026-10-07'}).summary.successful,2);
 const renamed=institutionReport(records,{name:'云海集团'},annotations);assert.equal(renamed.summary.peerCount,0);assert.ok(!renamed.groups.some(g=>g.name==='云海集团'));
});
test('合并拒绝自身、直接循环和经过既有链条的循环',()=>{
 assert.throws(()=>validateInstitutionMerge('a','a',[]));assert.throws(()=>validateInstitutionMerge('b','a',[{name_key:'a',merge_into:'b'}]));assert.throws(()=>validateInstitutionMerge('a','c',[{name_key:'a',merge_into:'b'},{name_key:'c',merge_into:'a'}]));assert.doesNotThrow(()=>validateInstitutionMerge('a','b',[]));
});

test('机构详情分组守恒、别名不重复、点名不入分母、来源关联不冒充归属',()=>{
 const url='https://source.example/shared?a=1',named='https://source.example/named';
 const records=[record(1,'星河公司和云海集团、云海公司',{citations_json:JSON.stringify([{title:'通用介绍',url},{title:'重复',url}])}),record(2,'云海公司',{account_id:2,platform:'deepseek',question_id:2,citations_json:JSON.stringify([{title:'通用介绍',url}]),searched_sites_json:JSON.stringify([{title:'云海集团介绍',url}])}),record(3,'星河公司',{account_id:2,platform:'deepseek',question_id:2,citations_json:JSON.stringify([{title:'云海集团介绍',url:named}])}),record(4,'没有名称',{account_id:null}),record(5,'云海集团',{question:'云海集团好吗？'}),record(6,'云海集团',{status:'failed'})];
 const report=institutionReport(records,brand,[review('云海集团'),review('云海公司','pending','云海集团')]);const d=institutionDetail(report,'云海集团');
 assert.equal(d.summary.valid,5);assert.equal(d.summary.eligible,4);assert.equal(d.summary.body,3);assert.equal(d.summary.withoutOwn,1);
 for(const field of ['valid','eligible','body','peer','own','both','withoutOwn','ownOnly','neither'])for(const group of [d.questions,d.platforms,d.accounts])assert.equal(group.reduce((n,b)=>n+b[field],0),d.summary[field],field);
 for(const group of [d.questions,d.platforms,d.accounts])for(const b of group)assert.equal(b.both+b.withoutOwn+b.ownOnly+b.neither,b.eligible);
 assert.equal(d.accounts.find(a=>a.accountId===null).valid,1);
 const generic=d.sources.find(s=>s.url===url&&s.kind==='citation');assert.equal(generic.body,2);assert.equal(generic.named,0);
 const title=d.sources.find(s=>s.url===named);assert.equal(title.body,0);assert.equal(title.named,1);
 assert.equal(d.sources.filter(s=>s.url===url).length,2,'正文引用和搜索结果独立');
 assert.deepEqual(institutionEvidence(report,d.key,'withoutOwn',{questionId:2,detailPlatform:'deepseek',detailAccount:2}).map(e=>e.resultId),[2]);
 assert.deepEqual(institutionEvidence(report,d.key,'body',{sourceUrl:url,sourceKind:'citation',sourceRelation:'body'}).map(e=>e.resultId),[1,2]);
 assert.deepEqual(institutionEvidence(report,d.key,'citation',{sourceUrl:named,sourceKind:'citation',sourceRelation:'named'}).map(e=>e.resultId),[3]);
 assert.deepEqual(institutionEvidence(report,d.key,'body',{detailPlatform:'doubao',detailAccount:2}),[]);
 assert.equal(institutionDetail(institutionReport(records,brand,[review('云海集团','pending')]),'云海集团').comparable,false);
 const empty=institutionDetail(institutionReport(records,brand,[review('云海集团')],{questionIds:[]}), '云海集团');assert.equal(empty.summary.eligible,0);assert.deepEqual(empty.sources,[]);
});


test('机构与信源库链接准入一致，单问题筛选与专题取交集',()=>{
 const links=[{url:'https://source.example/good',title:'云海集团资料'},{url:'https://source.example/trailing ',title:'误识别公司'},{url:' https://source.example/leading',title:'误识别公司'},{url:'https://user:pass@source.example/a',title:'误识别公司'},{url:'javascript:bad',title:'误识别公司'},{url:['https://source.example/array'],title:'误识别公司'}];
 const records=[record(1,'云海集团',{citations_json:JSON.stringify(links)}),record(2,'没有名称',{question_id:2})],annotations=[review('云海集团')];
 const report=institutionReport(records,brand,annotations),detail=institutionDetail(report,'云海集团');
 assert.deepEqual(detail.sources.map(s=>s.url),sourceAssets(records).map(s=>s.url));assert.equal(detail.sources.length,1);assert.ok(!report.groups.some(g=>g.name==='误识别公司'));
 const selected=institutionReport(records,brand,annotations,{questionId:2});assert.equal(selected.summary.successful,1);assert.equal(selected.summary.eligible,1);assert.equal(selected.groups.find(g=>g.key==='云海集团').body,0);assert.equal(institutionDetail(selected,'云海集团').questions[0].id,2);
 assert.equal(institutionReport(records,brand,annotations,{questionId:2,questionIds:[1]}).summary.successful,0);
 assert.deepEqual(institutionEvidence(selected,'云海集团'),[]);
});


test('完整机构名中的分隔符不拆成短别名，正文标题点名与高亮统一',()=>{
 const name='Alpha, Beta公司',alias='Cloud，Group公司',key=institutionKey(name),annotations=[review(name),review(alias,'pending',key)],url='https://source.example/a';
 const records=[record(1,name),record(2,'Alpha 是另一个词',{citations_json:JSON.stringify([{title:'Alpha 资料',url}])}),record(3,alias,{question_id:2,searched_sites_json:JSON.stringify([{title:alias,url}])}),record(4,'无名称',{question:'Alpha 有哪些选项？'}),record(5,name,{question:name+' 有哪些选项？'}),record(6,'Group公司和Cloud',{question:'Cloud有哪些选项？'})];
 const report=institutionReport(records,brand,annotations),g=report.groups.find(g=>g.key===key),d=institutionDetail(report,key);
 assert.equal(g.body,3);assert.equal(g.citationTitles,0);assert.equal(g.searchTitles,1);assert.equal(report.summary.eligible,5);assert.equal(d.summary.peer,2);
 const proof=institutionEvidence(report,key);assert.deepEqual(proof.map(e=>e.resultId),[1,3,5]);assert.ok(proof.every(e=>e.nameEvidence.matched));assert.deepEqual(proof[1].nameEvidence.names.map(n=>n.name),[alias.normalize('NFKC')]);assert.equal(proof[1].nameEvidence.excerpts[0].parts.filter(p=>p.highlight).map(p=>p.text).join(''),alias);
 assert.equal(d.sources.length,1);assert.equal(d.sources[0].kind,'search');assert.equal(d.sources[0].body,1);assert.equal(d.sources[0].named,1);
 assert.deepEqual(institutionEvidence(report,key,'search',{sourceUrl:url,sourceKind:'search',sourceRelation:'named'}).map(e=>e.resultId),[3]);
});
