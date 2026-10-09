import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAssets,sourceLibrary} from '../src/source-library.js';
const record=(id,extra={})=>({id,run_id:id,question_id:1,question:'演示问题',account_id:1,platform:'doubao',task_id:1,status:'succeeded',answer:'演示回答',started_at:'2026-10-01T00:00:00Z',finished_at:'2026-10-01T00:01:00Z',citations_json:JSON.stringify([{url:'https://source.example/a',title:'参考页面'},{url:'https://source.example/a',title:'重复编号'}]),searched_sites_json:JSON.stringify([{url:'https://source.example/a',title:'搜索标题'}]),...extra});
test('同URL合并，正文与搜索覆盖分别去重，不合并查询参数，保留证据',()=>{
 const records=[record(1),record(2,{citations_json:JSON.stringify([{url:'https://source.example/a?version=1',title:'另一页面'}])})];
 const snapshot=JSON.stringify(records),assets=sourceAssets(records);
 assert.equal(assets.length,2);const a=assets.find(a=>a.url.endsWith('/a'));assert.equal(a.citationAnswers,1);assert.equal(a.searchAnswers,2);assert.equal(a.answers,2);assert.deepEqual(a.evidence.find(e=>e.resultId===1).types,['citation','search']);
 const library=sourceLibrary(records,[],{});assert.equal(library.domains[0].pages,2);assert.equal(library.domains[0].citationAnswers,2);assert.equal(library.domains[0].searchAnswers,2);assert.equal(JSON.stringify(records),snapshot);
});
test('失败空正文和重复归属排除，非网页链接排除，分类与筛选一致',()=>{
 const records=[record(1),record(2,{status:'failed'}),record(3,{answer:' '}),record(4),record(5,{run_id:4}),record(6,{citations_json:JSON.stringify([{url:'javascript:alert(1)'},{url:'https://user:pass@source.example/a'}]),searched_sites_json:'[]'})];
 const annotations=[{url:'https://source.example/a',category:'owned',favorite:1,notes:'人工核对'}];
 const a=sourceAssets(records,annotations,{category:'owned',favorite:true,q:'核对'})[0];assert.equal(a.answers,1);assert.equal(a.notes,'人工核对');
 assert.equal(sourceAssets(records,annotations,{category:'competitor'}).length,0);assert.equal(sourceAssets(records,[],{platform:'deepseek'}).length,0);
 const search=sourceAssets(records,annotations,{kind:'search'});assert.equal(search[0].citationAnswers,0);assert.equal(search[0].searchAnswers,1);
 assert.equal(sourceAssets(records,[],{from:'2026-10-02'}).length,0);
});
test('网站与链接分页、空筛选和元资料保留',()=>{
 const records=Array.from({length:24},(_,i)=>record(i+1,{citations_json:JSON.stringify([{url:'https://source.example/'+i,title:'页面'+i}]),searched_sites_json:'[]'}));
 const page=sourceLibrary(records,[],{page:2});assert.equal(page.pageCount,2);assert.equal(page.items.length,4);assert.equal(page.totalPages,24);
 assert.equal(sourceLibrary(records,[],{page:100}).page,2);assert.equal(sourceLibrary(records,[],{host:'other.example'}).items.length,0);
 assert.equal(sourceLibrary(records,[],{q:'无匹配'}).pageCount,1);
});
test('搜索保留同URL历次标题，不被较新的标题覆盖',()=>{
 const records=[record(1,{citations_json:JSON.stringify([{url:'https://source.example/a',title:'旧标题独有词'}]),searched_sites_json:'[]'}),record(2,{citations_json:JSON.stringify([{url:'https://source.example/a',title:'新标题'}]),searched_sites_json:'[]'})];
 const assets=sourceAssets(records,[],{q:'旧标题独有词'});assert.equal(assets.length,1);assert.equal(assets[0].answers,2);assert.equal(assets[0].titles.length,2);
});
test('异常链接类型不破坏列表，未知时间不虚构日期，时区排序按实际时刻',()=>{
 const bad=record(1,{run_started_at:'invalid',started_at:'invalid',finished_at:'invalid',citations_json:JSON.stringify([{url:['https://source.example/b']},{url:' https://source.example/b'},{url:'https://source.example/a'}]),searched_sites_json:'[]'});
 const assets=sourceAssets([bad]);assert.equal(assets.length,1);assert.equal(assets[0].firstSeen,undefined);assert.equal(assets[0].evidence[0].observedAt,null);
 assert.equal(sourceAssets([bad],[],{from:'2026-10-01'}).length,0);
 const dates=sourceAssets([record(2,{finished_at:'2026-10-01T08:30:00+08:00'}),record(3,{finished_at:'2026-10-01T01:00:00Z'})])[0];
 assert.equal(dates.firstSeen,'2026-10-01T00:30:00.000Z');assert.equal(dates.lastSeen,'2026-10-01T01:00:00.000Z');
});
