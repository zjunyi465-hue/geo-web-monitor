import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/db.js';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'geo-answer-search-')),path=join(dir,'test.db'),db=openDatabase(path),time='2026-10-08T16:30:00Z';
 for(const [id,name] of [[1,'星河工具'],[2,'海风工具']])db.prepare('INSERT INTO brands(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(id,name,time,time);
 db.prepare("INSERT INTO questions(id,brand_id,text,kind,source,created_at) VALUES(1,1,'有哪些工具？','discovery','manual',?),(2,2,'另一品牌的问题','discovery','manual',?)").run(time,time);
 db.prepare("INSERT INTO tasks(id,brand_id,name,platforms_json,question_ids_json,schedule_type,created_at) VALUES(1,1,'检索演示','[\"doubao\"]','[1]','manual',?),(2,2,'另一任务','[\"doubao\"]','[2]','manual',?)").run(time,time);
 db.prepare("UPDATE platform_accounts SET platform='doubao',label='虚构账号',profile_key='demo-search' WHERE id=1").run();
 db.prepare("INSERT INTO question_topics(id,brand_id,name,created_at) VALUES(1,1,'空专题',?),(2,1,'工具专题',?)").run(time,time);db.prepare('INSERT INTO topic_questions(topic_id,question_id) VALUES(2,1)').run();
 for(let id=1;id<=28;id++){
  const other=id===28,taskId=other?2:1,qid=other?2:1,status=id===26?'failed':'succeeded',answer=id===27?'   ':'星河工具 ABC [a+b] 💡 <img src=x onerror=window.searchBad=true>';
  db.prepare("INSERT INTO runs(id,task_id,status,total,done,started_at,finished_at) VALUES(?,?,'completed',1,1,?,?)").run(id,taskId,time,time);
  db.prepare('INSERT INTO results(id,run_id,question_id,platform,account_id,account_label,status,answer,citations_json,searched_sites_json,started_at,finished_at) VALUES(?,?,?,\'doubao\',1,\'虚构账号\',?,?,?,?,?,?)').run(id,id,qid,status,answer,JSON.stringify([{url:'https://example.org/reference?id='+id,title:'星河资料'},{url:'javascript:alert(1)',title:'星河危险链接'}]),JSON.stringify([{url:'https://search.example/'+id,title:'搜索样例'}]),time,time);
 }
 db.close();const listener=net.createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));const port=listener.address().port;await new Promise(done=>listener.close(done));
 const child=spawn(process.execPath,['src/server.js'],{cwd:resolve('.'),env:{...process.env,GEO_PORT:String(port),GEO_DB_PATH:path,GEO_RESULTS_ROOT:join(dir,'results'),GEO_PROFILE_ROOT:join(dir,'profiles')},stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',c=>errors+=c);child.stdout.on('data',()=>{});
 const base='http://127.0.0.1:'+port;let cookie='';const call=async(url,method='GET',input)=>{const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:input===undefined?undefined:JSON.stringify(input)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,data:await res.json()};};
 let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error(errors);try{await call('/api/bootstrap');ready=true;break;}catch{}await new Promise(done=>setTimeout(done,100));}assert.ok(ready);
 return {dir,path,base,call,close:async()=>{if(child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}}};
}

test('历史回答检索接口：权限、品牌隔离、分页、范围交集和原文只读',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/api/answer-search?brandId=1&q=星河')).status,401);await f.call('/api/setup','POST',{username:'admin',password:'sample-password-123'});
  const read=()=>{const db=new DatabaseSync(f.path,{readOnly:true});const data=db.prepare('SELECT * FROM results ORDER BY id').all();db.close();return data;},before=read();
  const get=query=>f.call('/api/answer-search?brandId=1&'+new URLSearchParams({q:'星河',...query}));
  assert.equal((await get({q:'  '})).data.search.searched,false);assert.equal((await get({q:"' OR 1=1 --"})).data.search.total,0);
  const a=(await get({})).data.search,b=(await get({page:2})).data.search;assert.equal(a.total,25);assert.equal(a.items.length,20);assert.equal(b.items.length,5);assert.equal(new Set([...a.items,...b.items].map(r=>r.resultId)).size,25);assert.equal(a.citationAnswers,25);
  assert.equal((await f.call('/api/answer-search?brandId=2&q=星河')).data.search.total,1);assert.equal((await f.call('/api/answer-search?brandId=2&taskId=1&q=星河')).data.search.total,0);
  for(const q of [{topicId:1},{questionId:2},{accountId:2},{platform:'deepseek'},{to:'2026-10-08'}])assert.equal((await get(q)).data.search.total,0);assert.equal((await get({topicId:2,from:'2026-10-09',to:'2026-10-09'})).data.search.total,25);
  assert.equal((await get({scope:'search',q:'搜索样例'})).data.search.total,25);assert.equal((await get({scope:'body',q:'搜索样例'})).data.search.total,0);
  for(const q of [{page:0},{from:'2026-02-30'},{q:'x'.repeat(201)},{scope:'bad'},{platform:'bad'}])assert.equal((await get(q)).status,400);
  assert.equal((await f.call('/api/answer-search?brandId=999&q=星河')).status,404);assert.equal((await f.call('/api/answer-search?brandId=1','POST',{})).status,405);
  const evidence=(await f.call('/api/answer-search/evidence?brandId=1&q=星河&resultId=1')).data.evidence;assert.equal(evidence.answer,before[0].answer);assert.equal(evidence.citations.length,1);assert.equal(evidence.search.length,1);
  for(const query of ['brandId=1&q=星河&resultId=28','brandId=1&q=其他&resultId=1','brandId=1&q=星河&topicId=1&resultId=1'])assert.equal((await f.call('/api/answer-search/evidence?'+query)).status,404);
  assert.deepEqual(read(),before);await f.call('/api/logout','POST',{});assert.equal((await get({})).status,401);
 }finally{await f.close();}
});

test('检索界面：命中高亮、原文来源、完整运行、分页及品牌切换',{skip:!process.env.GEO_UI_TEST},async()=>{
 const f=await fixture();let browser;try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(f.base);
  await page.locator('[name=username]').fill('admin');await page.locator('[name=password]').fill('sample-password-123');await page.getByRole('button',{name:'创建管理员',exact:true}).click();await page.getByRole('button',{name:'历史回答检索',exact:true}).click();
  await page.locator('#answerSearchForm [name=brandId]').selectOption('1');await page.locator('#answerSearchForm [name=q]').fill('星河');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('heading',{name:'找到 25 条回答记录',exact:true}).waitFor();
  assert.equal(await page.locator('.answer-search-item').count(),20);assert.equal(await page.getByRole('button',{name:'上一页回答',exact:true}).isDisabled(),true);assert.ok(await page.locator('.answer-search-snippet mark').count()>0);
  await page.getByRole('button',{name:'下一页回答',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.answer-search-item').length===5);assert.equal(await page.getByRole('button',{name:'下一页回答',exact:true}).isDisabled(),true);
  await page.locator('.answer-search-item').first().getByRole('button',{name:'展开原文及来源',exact:true}).click();await page.locator('#answerSearchProof').waitFor();assert.equal(await page.locator('#answerSearchProof img').count(),0);assert.equal(await page.evaluate(()=>window.searchBad),undefined);assert.ok((await page.locator('.answer-search-original').textContent()).includes('<img'));assert.equal(await page.locator('#answerSearchProof a[href^="javascript:"]').count(),0);
  await mkdir(resolve('work'),{recursive:true});await page.screenshot({path:resolve('work/geo-answer-search.png'),fullPage:true});await page.locator('#answerSearchProof').getByRole('button',{name:'查看完整运行',exact:true}).click();await page.getByRole('heading',{name:/运行 #5/}).waitFor();assert.equal(await page.locator('details[data-result-id="5"]').getAttribute('open'),'');
  await page.getByRole('button',{name:'历史回答检索',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.answer-search-item').length===5);assert.equal(await page.locator('#answerSearchForm [name=q]').inputValue(),'星河');
  await page.locator('#answerSearchAdvanced > summary').click();await page.locator('#answerSearchForm [name=topicId]').selectOption('1');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('heading',{name:'没有找到匹配内容',exact:true}).waitFor();
  await page.locator('#answerSearchForm [name=brandId]').selectOption('2');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('heading',{name:'找到 1 条回答记录',exact:true}).waitFor();assert.equal(await page.locator('#answerSearchForm [name=topicId]').inputValue(),'');
  await page.route('**/api/answer-search?**',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟请求失败'})}));await page.locator('#answerSearchForm [name=q]').fill('改过的查询');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByText('模拟请求失败',{exact:true}).waitFor();assert.equal(await page.locator('#answerSearchForm [name=q]').inputValue(),'改过的查询');assert.equal(await page.locator('.answer-search-item').count(),1);await page.unroute('**/api/answer-search?**');
  await page.getByRole('button',{name:'清空筛选',exact:true}).click();await page.getByRole('heading',{name:'想找什么？',exact:true}).waitFor();assert.equal(await page.locator('.answer-search-item').count(),0);
 }finally{await browser?.close();await f.close();}
});

test('检索边界界面：原文换行、失效专题、历史账号及删除旧运行后刷新',{skip:!process.env.GEO_UI_TEST},async()=>{
 const f=await fixture();let browser;try{
  await f.call('/api/setup','POST',{username:'admin',password:'sample-password-123'});
  const original='\r\n星河工具\r\n💡 [a+b]\t <img src=x onerror=window.searchBad=true>';
  const mutate=fn=>{const db=new DatabaseSync(f.path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000');try{fn(db);}finally{db.close();}};
  mutate(db=>db.prepare('UPDATE results SET answer=?,citations_json=? WHERE id=25').run(original,JSON.stringify([{title:'星河 <img src=x onerror=window.sourceBad=true>',url:'https://example.org/?q=" onmouseover="window.sourceBad=true'}])));
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.goto(f.base);await page.locator('[name=username]').fill('admin');await page.locator('[name=password]').fill('sample-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'历史回答检索',exact:true}).click();
  await page.locator('#answerSearchForm [name=brandId]').selectOption('1');await page.locator('#answerSearchForm [name=q]').fill('星河');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('heading',{name:'找到 25 条回答记录',exact:true}).waitFor();
  await page.locator('.answer-search-item').first().getByRole('button',{name:'展开原文及来源',exact:true}).click();await page.locator('.answer-search-original').waitFor();assert.equal(await page.locator('.answer-search-original').textContent(),original);assert.equal(await page.locator('#answerSearchProof img').count(),0);assert.equal(await page.locator('#answerSearchProof [onmouseover]').count(),0);assert.equal(await page.evaluate(()=>window.sourceBad),undefined);
  await page.route('**/api/runs/25',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'模拟运行读取失败'})}));await page.locator('#answerSearchProof').getByRole('button',{name:'查看完整运行',exact:true}).click();await page.getByText('模拟运行读取失败',{exact:true}).waitFor();assert.equal(await page.locator('.answer-search-item').count(),20);assert.equal(await page.getByRole('heading',{name:'历史回答检索',exact:true}).count(),1);await page.unroute('**/api/runs/25');
  await page.locator('#answerSearchProof').getByRole('button',{name:'查看完整运行',exact:true}).click();await page.getByRole('heading',{name:/运行 #25/}).waitFor();await page.getByRole('button',{name:'历史回答检索',exact:true}).click();await page.locator('.answer-search-item').first().waitFor();
  await page.locator('#answerSearchAdvanced > summary').click();await page.locator('#answerSearchForm [name=accountId]').selectOption('1');await page.locator('#answerSearchForm [name=topicId]').selectOption('2');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#answerSearchForm [name=accountId]')?.value==='1'&&!document.querySelector('#answerSearchForm button')?.disabled);
  mutate(db=>{db.prepare('DELETE FROM runs WHERE id=25').run();db.prepare('DELETE FROM platform_accounts WHERE id=1').run();});await page.getByRole('button',{name:'刷新检索',exact:true}).click();await page.getByRole('heading',{name:'找到 24 条回答记录',exact:true}).waitFor();assert.equal(await page.locator('#answerSearchForm [name=accountId]').inputValue(),'1');assert.match(await page.locator('#answerSearchForm [name=accountId] option:checked').textContent(),/历史或已移除/);
  mutate(db=>db.prepare('DELETE FROM question_topics WHERE id=2').run());await page.getByRole('button',{name:'刷新检索',exact:true}).click();await page.getByRole('heading',{name:'当前检索范围需要重新选择',exact:true}).waitFor();assert.equal(await page.locator('.answer-search-item').count(),0);assert.equal(await page.locator('#answerSearchForm [name=topicId]').inputValue(),'2');
  await page.locator('#answerSearchForm [name=topicId]').selectOption('');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('heading',{name:'找到 24 条回答记录',exact:true}).waitFor();assert.equal(await page.locator('#answerSearchForm [name=accountId]').inputValue(),'1');
 }finally{await browser?.close();await f.close();}
});

test('检索UI：草稿保留、品牌条件联动、仅来源匹配及窄屏布局',{skip:!process.env.GEO_UI_TEST},async()=>{
 const f=await fixture();let browser;try{
  await f.call('/api/setup','POST',{username:'admin',password:'sample-password-123'});
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(f.base);await page.locator('[name=username]').fill('admin');await page.locator('[name=password]').fill('sample-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'历史回答检索',exact:true}).click();
  await page.locator('#answerSearchForm [name=brandId]').selectOption('1');await page.locator('#answerSearchForm [name=q]').fill('星河');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('heading',{name:'找到 25 条回答记录',exact:true}).waitFor();assert.equal(await page.locator('#answerSearchAdvanced').getAttribute('open'),null);
  const list=await page.locator('.search-list-scroll').evaluate(e=>({height:e.clientHeight,content:e.scrollHeight,overflow:getComputedStyle(e).overflowY,pagerInside:!!e.querySelector('.search-pager')}));assert.ok(list.height<=601);assert.ok(list.content>list.height);assert.equal(list.overflow,'auto');assert.equal(list.pagerInside,false);
  await page.locator('.search-list-scroll').focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('.search-list-scroll').scrollTop>0);await page.locator('.search-list-scroll').evaluate(e=>e.scrollTop=0);
  await page.locator('#answerSearchForm [name=q]').fill('未提交的查询');await page.locator('.answer-search-item').first().getByRole('button',{name:'展开原文及来源',exact:true}).click();await page.locator('#answerSearchProof').waitFor();assert.equal(await page.locator('#answerSearchForm [name=q]').inputValue(),'未提交的查询');assert.ok((await page.locator('[data-search-applied]').textContent()).includes('星河'));
  assert.ok(await page.locator('#answerSearchProof').evaluate(e=>e.clientHeight<=601&&getComputedStyle(e).overflowY==='auto'));
  await page.getByRole('button',{name:'关闭原文',exact:true}).click();await page.getByRole('button',{name:'下一页回答',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.answer-search-item').length===5);assert.equal(await page.locator('#answerSearchForm [name=q]').inputValue(),'未提交的查询');
  await page.locator('#answerSearchForm [name=q]').fill('搜索样例');await page.locator('#answerSearchForm [name=scope]').selectOption('search');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-search-applied]')?.textContent.includes('搜索样例'));await page.getByRole('heading',{name:'找到 25 条回答记录',exact:true}).waitFor();assert.equal(await page.locator('.answer-search-snippet').count(),0);assert.equal(await page.locator('.answer-search-item').first().locator('.search-matching-sources').getAttribute('open'),'');assert.ok(!(await page.locator('.search-results-list').innerText()).includes('undefined'));
  await mkdir(resolve('work'),{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve('work/geo-answer-search-ui-desktop.png'),fullPage:false});await page.locator('.answer-search-item').first().getByRole('button',{name:'展开原文及来源',exact:true}).click();await page.locator('#answerSearchProof').waitFor();await page.screenshot({path:resolve('work/geo-answer-search-ui-proof.png'),fullPage:false});await page.getByRole('button',{name:'关闭原文',exact:true}).click();
  await page.locator('#answerSearchForm [name=brandId]').selectOption('2');await page.locator('#answerSearchForm [name=q]').fill('星河');await page.locator('#answerSearchForm [name=scope]').selectOption('all');await page.locator('#answerSearchAdvanced > summary').click();await page.locator('#answerSearchForm [name=taskId]').selectOption('2');await page.locator('#answerSearchForm [name=questionId]').selectOption('2');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('heading',{name:'找到 1 条回答记录',exact:true}).waitFor();assert.equal(await page.locator('#answerSearchForm [name=taskId]').inputValue(),'2');assert.equal(await page.locator('#answerSearchForm [name=questionId]').inputValue(),'2');
  await page.locator('.answer-search-item').getByRole('button',{name:'展开原文及来源',exact:true}).click();await page.locator('#answerSearchProof').waitFor();await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('work/geo-answer-search-ui-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  assert.ok(await page.locator('#answerSearchProof').evaluate(e=>e.clientHeight<=507&&getComputedStyle(e).overflowY==='auto'));
  await page.route('**/api/brands/1/topics',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟品牌资料失败'})}));await page.locator('#answerSearchForm [name=brandId]').selectOption('1');await page.getByText('品牌筛选加载失败：模拟品牌资料失败',{exact:true}).waitFor();assert.equal(await page.locator('#answerSearchForm [name=brandId]').inputValue(),'2');assert.equal(await page.locator('.answer-search-item').count(),1);
 }finally{await browser?.close();await f.close();}
});
