import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChangeFeed} from '../src/change-feed.js';
const conditions={search:{value:true},thinking:{value:false},model:{value:'演示模式'}};
const task={name:'演示任务',question_ids_json:'[1]',account_ids_json:'[1]'};
const brand={name:'星河工具',aliases:'星河',website:'https://example.com'};
const run=id=>({id,task_id:1,status:'completed',started_at:`2026-10-${String(id).padStart(2,'0')}T00:00:00Z`,task_snapshot_json:JSON.stringify(task),brand_snapshot_json:JSON.stringify(brand)});
const record=(id,answer)=>({id,run_id:id,question_id:1,question:'有哪些工具？',question_kind:'discovery',platform:'doubao',account_id:1,account_label:'演示',status:'succeeded',answer,citations_json:'[]',searched_sites_json:'[]',reported_citation_count:0,diagnostics_json:JSON.stringify({monitorConditions:conditions,conditionsAfter:conditions})});
const peers=[{key:'海岚公司',name:'海岚公司',names:['海岚公司','海岚工具']}];
const fixture=()=>({runs:[1,2,3,4].map(run),records:[record(1,'星河工具和海岚公司'),record(2,'海岚公司'),{...record(3,'海岚公司'),citations_json:'[{"url":"https://source.example/a"}]',reported_citation_count:1},record(4,'星河工具和海岚公司')],peers});

test('变化动态来自相邻原文，同条件比较、连续计数、来源和筛选独立',()=>{
 const input=fixture(),raw=JSON.stringify(input),feed=buildChangeFeed(input);
 assert.equal(feed.summary.matched,3);assert.equal(feed.events.length,3);
 const lost=feed.events.find(e=>e.after.runId===2);assert.deepEqual(lost.changes.map(c=>c.type),['own_lost','peer_only']);assert.equal(lost.streak.own,1);assert.equal(lost.peerStreaks[0].count,2);
 const third=feed.events.find(e=>e.after.runId===3);assert.equal(third.streak.own,2);assert.equal(third.peerStreaks[0].count,3);assert.equal(third.sources[0].complete,true);
 assert.equal(buildChangeFeed({...input,filters:{from:'2026-10-03',to:'2026-10-03'}}).events[0].before.runId,2);
 assert.equal(buildChangeFeed({...input,filters:{questionIds:[]}}).summary.matched,0);
 assert.equal(buildChangeFeed({...input,filters:{accountId:'2'}}).events.length,0);
 assert.deepEqual(buildChangeFeed({...input,runs:[...input.runs].reverse(),records:[...input.records].reverse()}),feed);assert.equal(JSON.stringify(input),raw);
});
test('失败、缺失、重复和条件未知是比较屏障，不跳过或记作品牌消失',()=>{
 for(const mutate of [x=>x.records[1].status='failed',x=>x.records.splice(1,1),x=>x.records.push({...x.records[1],id:99}),x=>x.records[1].account_id=null,x=>x.records[1].diagnostics_json='{}',x=>x.records[1].question='换一个问题',x=>x.runs[1].brand_snapshot_json='{}',x=>x.runs[1].task_snapshot_json=JSON.stringify({...task,account_ids_json:'[2]'})]){
  const input=fixture();mutate(input);const feed=buildChangeFeed(input);assert.equal(feed.summary.matched,1);assert.equal(feed.events.length,1);assert.equal(feed.events[0].before.runId,3);assert.ok(feed.summary.excluded>=2);
 }
 const input=fixture();input.records[1].diagnostics_json=JSON.stringify({monitorConditions:conditions,conditionsAfter:{...conditions,thinking:{value:true}}});assert.equal(buildChangeFeed(input).summary.matched,1);
});
test('原文和名单变化重置跟进；不完整来源只说明保存集合，拒绝危险链接',()=>{
 const input=fixture(),event=buildChangeFeed(input).events.find(e=>e.after.runId===2),annotations=[{event_key:event.key,status:'watch',updated_at:'t',reviewer:'演示'}];
 assert.equal(buildChangeFeed({...input,annotations}).events.find(e=>e.after.runId===2).tracking.status,'watch');
 input.records[1].answer+='。';assert.equal(buildChangeFeed({...input,annotations}).events.find(e=>e.after.runId===2).tracking.status,'new');
 input.records[1].answer='海岚公司';assert.equal(buildChangeFeed({...input,annotations,peers:[]}).events.find(e=>e.after.runId===2).tracking.status,'new');
 input.records[2].reported_citation_count=null;input.records[2].searched_sites_json='[{"url":"javascript:alert(1)"},{"url":"https://user:pass@example.com"},{"url":"https://source.example/b","title":"搜索"}]';
 const third=buildChangeFeed(input).events.find(e=>e.after.runId===3);assert.equal(third.sources[0].complete,false);assert.equal(third.after.search.length,1);
});

test('未知条件原文单列，不混入严格动态；已知冲突和缺失仍阻断',()=>{
 const input=fixture();input.records.forEach(r=>r.diagnostics_json='{}');
 const feed=buildChangeFeed(input);assert.equal(feed.summary.matched,0);assert.equal(feed.events.length,0);assert.equal(feed.summary.observationPairs,3);assert.equal(feed.observations.length,3);assert.equal(feed.summary.excluded,3);
 assert.equal(feed.observations[0].before.runId,3);assert.equal(feed.observations[0].after.runId,4);assert.equal(feed.observations[0].tracking,undefined);
 assert.equal(buildChangeFeed({...input,filters:{type:'own_gained'}}).observations.length,1);
 assert.equal(buildChangeFeed({...input,filters:{status:'watch'}}).observations.length,0);
 input.records[1].status='failed';assert.equal(buildChangeFeed(input).observations.length,1);
 const conflict=fixture();conflict.records.forEach(r=>r.diagnostics_json='{}');
 conflict.records[0].diagnostics_json=JSON.stringify({conditionsAfter:{search:{value:true}}});
 conflict.records[1].diagnostics_json=JSON.stringify({monitorConditions:{search:{value:false}}});
 assert.ok(!buildChangeFeed(conflict).observations.some(e=>e.after.runId===2));
 const mixed=fixture();mixed.records[1].diagnostics_json='{}';
 const m=buildChangeFeed(mixed);assert.equal(m.summary.matched,1);assert.equal(m.observations.length,2);assert.equal(m.events[0].streak.own,1);
});
