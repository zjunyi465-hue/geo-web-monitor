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
import {createBackup} from '../src/backup.js';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'geo-changes-')),path=join(dir,'test.db'),db=openDatabase(path),now='2026-10-08T00:00:00Z',brand={name:'星河工具',aliases:'星河',website:'https://example.com'},task={name:'变化演示',question_ids_json:'[1]',account_ids_json:'[1]',platforms_json:'["doubao"]',brand_id:1},conditions={search:{value:true},thinking:{value:false},model:{value:'演示模式'}};
 for(const [id,name] of [[1,brand.name],[2,'海风工具']])db.prepare('INSERT INTO brands(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(id,name,now,now);
 db.prepare("INSERT INTO questions(id,brand_id,text,kind,source,created_at) VALUES(1,1,'有哪些工具？','discovery','manual',?)").run(now);
 db.prepare("INSERT INTO tasks(id,brand_id,name,platforms_json,question_ids_json,account_ids_json,schedule_type,created_at) VALUES(1,1,'变化演示','[\"doubao\"]','[1]','[1]','manual',?)").run(now);
 db.prepare("INSERT INTO institution_reviews(brand_id,name_key,name,category,notes,updated_at) VALUES(1,'海岚公司','海岚公司','peer','',?)").run(now);
 for(let id=1;id<=25;id++){
  const time=new Date(Date.UTC(2026,9,1,0,id)).toISOString();
  db.prepare("INSERT INTO runs(id,task_id,status,total,done,started_at,finished_at,task_snapshot_json,brand_snapshot_json) VALUES(?,1,'completed',1,1,?,?,?,?)").run(id,time,time,JSON.stringify(task),JSON.stringify(brand));
  db.prepare("INSERT INTO results(id,run_id,question_id,platform,account_id,account_label,status,answer,citations_json,reported_citation_count,diagnostics_json,started_at,finished_at) VALUES(?,?,1,'doubao',1,'演示账号','succeeded',?, ?,1,?,?,?)").run(id,id,(id%2?'星河工具和海岚公司':'海岚公司')+' <img src=x onerror=window.changeBad=true>',JSON.stringify([{url:'https://source.example/'+id%2,title:'演示来源'}]),JSON.stringify({monitorConditions:conditions,conditionsAfter:conditions}),time,time);
 }
 db.close();const listener=net.createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));const port=listener.address().port;await new Promise(done=>listener.close(done));
 const child=spawn(process.execPath,['src/server.js'],{cwd:resolve('.'),env:{...process.env,GEO_PORT:String(port),GEO_DB_PATH:path,GEO_RESULTS_ROOT:join(dir,'results'),GEO_PROFILE_ROOT:join(dir,'profiles')},stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',c=>errors+=c);
 const base='http://127.0.0.1:'+port;let cookie='';const call=async(url,method='GET',input,headers={})=>{const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:input===undefined?undefined:JSON.stringify(input)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,data:await res.json()};};
 let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error(errors);try{await call('/api/bootstrap');ready=true;break;}catch{}await new Promise(done=>setTimeout(done,100));}assert.ok(ready);
 return {dir,path,base,call,close:async()=>{if(child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}}};
}
test('变化动态接口：隔离品牌、分页、跟进冲突、名单重算与备份恢复',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/api/change-feed?brandId=1')).status,401);await f.call('/api/setup','POST',{username:'admin',password:'sample-password-123'});
  const feed=(await f.call('/api/change-feed?brandId=1')).data.feed;assert.equal(feed.summary.events,24);assert.equal(feed.events.length,20);assert.equal(feed.pageCount,2);assert.equal(feed.events[0].streak.peers['海岚公司'],25);
  const second=(await f.call('/api/change-feed?brandId=1&page=2')).data.feed;assert.equal(second.events.length,4);assert.equal(new Set([...feed.events,...second.events].map(e=>e.key)).size,24);
  assert.equal((await f.call('/api/change-feed?brandId=2')).data.feed.events.length,0);
  for(const query of ['from=2026-02-30','status=bogus','type=bogus','page=0'])assert.equal((await f.call('/api/change-feed?brandId=1&'+query)).status,400);
  const baseline=(await f.call('/api/analytics?brandId=1')).data.report.summary,event=feed.events[0],input={brandId:1,key:event.key,status:'watch',expectedUpdatedAt:null};
  const results=await Promise.all([f.call('/api/change-feed/tracking','PUT',input),f.call('/api/change-feed/tracking','PUT',{...input,status:'seen'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.call('/api/change-feed/tracking','PUT',{...input,brandId:2})).status,409);assert.equal((await f.call('/api/change-feed/tracking','PUT',input,{Origin:'https://untrusted.example'})).status,403);
  assert.deepEqual((await f.call('/api/analytics?brandId=1')).data.report.summary,baseline);
  const backup=await createBackup({dbPath:f.path,resultsRoot:join(f.dir,'results'),backupRoot:join(f.dir,'backup')}),restored=new DatabaseSync(join(backup,'geo-monitor.db'));
  assert.equal(restored.prepare('SELECT count(*) n FROM change_annotations').get().n,1);restored.exec('PRAGMA foreign_keys=ON');restored.prepare('DELETE FROM results WHERE id=?').run(event.after.resultId);assert.equal(restored.prepare('SELECT count(*) n FROM change_annotations').get().n,0);restored.close();
  const db=new DatabaseSync(f.path);db.exec('PRAGMA busy_timeout=3000');db.prepare("UPDATE institution_reviews SET category='ignore' WHERE brand_id=1").run();db.close();
  const fresh=(await f.call('/api/change-feed?brandId=1')).data.feed;assert.equal(fresh.events[0].tracking.status,'new');assert.equal(fresh.peerBasis.length,0);assert.equal((await f.call('/api/change-feed/tracking','PUT',input)).status,409);
  const unknownDb=new DatabaseSync(f.path);unknownDb.exec("UPDATE results SET diagnostics_json='{}'");unknownDb.close();
  const unknown=(await f.call('/api/change-feed?brandId=1')).data.feed;assert.equal(unknown.summary.matched,0);assert.equal(unknown.summary.observationPairs,24);assert.equal(unknown.observations.length,20);assert.equal(unknown.summary.selectedObservations,24);assert.equal(unknown.exclusionReasons[0].count,24);
  assert.equal((await f.call('/api/change-feed?brandId=1&status=watch')).data.feed.observations.length,0);
  const observed=(await f.call('/api/change-feed?brandId=1&comparison=all')).data.feed;assert.equal(observed.itemTotal,24);assert.equal(observed.items.length,20);assert.equal(observed.pageCount,2);assert.ok(observed.items.every(e=>e.comparison==='observed'));
  const observed2=(await f.call('/api/change-feed?brandId=1&comparison=observed&page=2')).data.feed;assert.equal(observed2.items.length,4);assert.equal(new Set([...observed.items,...observed2.items].map(e=>e.after.resultId)).size,24);
  assert.equal((await f.call('/api/change-feed?brandId=1&comparison=confirmed')).data.feed.itemTotal,0);
  assert.equal((await f.call('/api/change-feed?brandId=1&comparison=invalid')).status,400);
  const mixedDb=new DatabaseSync(f.path),known={search:{value:true},thinking:{value:false},model:{value:'演示模式'}};mixedDb.prepare('UPDATE results SET diagnostics_json=? WHERE id<=12').run(JSON.stringify({monitorConditions:known,conditionsAfter:known}));mixedDb.close();
  const mixed=(await f.call('/api/change-feed?brandId=1&comparison=all')).data.feed,mixed2=(await f.call('/api/change-feed?brandId=1&comparison=all&page=2')).data.feed;
  assert.equal(mixed.itemTotal,24);assert.equal(new Set([...mixed.items,...mixed2.items].map(e=>e.after.resultId)).size,24);assert.ok(mixed.items.some(e=>e.comparison==='observed'));assert.ok(mixed.items.some(e=>e.comparison==='confirmed'));assert.equal(mixed2.items.length,4);
  const strict=(await f.call('/api/change-feed?brandId=1&comparison=confirmed')).data.feed;assert.equal(strict.itemTotal,11);assert.ok(strict.items.every(e=>e.comparison==='confirmed'));
  const observedOnly=(await f.call('/api/change-feed?brandId=1&comparison=observed')).data.feed;assert.equal(observedOnly.itemTotal,13);assert.ok(observedOnly.items.every(e=>e.comparison==='observed'));
  await f.call('/api/logout','POST',{});assert.equal((await f.call('/api/change-feed?brandId=1')).status,401);
 }finally{await f.close();}
});
test('变化动态界面可筛选、标记、并排核对原文并进入运行',{skip:!process.env.GEO_UI_TEST},async()=>{
 const f=await fixture();let browser;try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(f.base);
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.locator('[name=username]').fill('admin');await page.locator('[name=password]').fill('sample-password-123');await page.getByRole('button',{name:'创建管理员',exact:true}).click();await page.getByRole('button',{name:'变化动态',exact:true}).click();await page.locator('#changeFilterForm [name=brandId]').waitFor({timeout:5000}).catch(async e=>{throw Error(e.message+' '+pageErrors.join(' | ')+' '+await page.locator('main').innerText());});await page.locator('#changeFilterForm [name=brandId]').selectOption('1');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.locator('.change-event').first().waitFor({timeout:5000}).catch(async error=>{throw Error(error.message+' PAGE '+(await page.locator('main').innerText()).slice(0,2000));});
  assert.equal(await page.locator('.change-event').count(),20);assert.equal(await page.getByRole('button',{name:'上一页',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.change-advanced').getAttribute('open'),null);await page.locator('.change-event').first().getByText('查看前后回答',{exact:true}).click();assert.equal(await page.locator('.change-answer img').count(),0);assert.equal(await page.evaluate(()=>window.changeBad),undefined);
  await page.locator('.change-event').first().locator('.change-follow > summary').click();
  await page.locator('.change-event').first().getByRole('button',{name:'持续关注',exact:true}).click();await page.getByText('跟进状态已保存；原回答与报告统计不变。',{exact:true}).waitFor();
  await page.locator('.change-advanced > summary').click();await page.locator('#changeFilterForm [name=status]').selectOption('watch');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.change-event').length===1);
  await page.locator('.change-event').getByText('查看前后回答',{exact:true}).click();await mkdir(resolve('work'),{recursive:true});await page.screenshot({path:resolve('work/geo-change-feed.png'),fullPage:true});
  await page.locator('.change-answer').last().getByRole('button',{name:'查看完整运行',exact:true}).click();await page.getByRole('heading',{name:/运行 #25/}).waitFor();
  await page.getByRole('button',{name:'变化动态',exact:true}).click();await page.locator('.change-event').waitFor();assert.equal(await page.locator('#changeFilterForm [name=status]').inputValue(),'watch');
  await page.locator('#changeFilterForm [name=brandId]').selectOption('2');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.getByRole('heading',{name:'当前没有符合筛选的变化',exact:true}).waitFor();assert.equal(await page.locator('.change-event').count(),0);
  const unknownDb=new DatabaseSync(f.path);unknownDb.exec("UPDATE results SET diagnostics_json='{}'");unknownDb.close();
  await page.locator('#changeFilterForm [name=brandId]').selectOption('1');await page.locator('#changeFilterForm [name=status]').selectOption('');await page.getByRole('button',{name:'应用筛选',exact:true}).click();
  await page.locator('.change-observation').first().waitFor();await page.getByRole('heading',{name:'找到 24 条变化记录',exact:true}).waitFor();assert.equal(await page.locator('.change-observation').count(),20);
  await page.locator('.change-observation').first().locator('summary').first().click();assert.equal(await page.locator('.change-observation [data-action=changeTrack]').count(),0);assert.equal(await page.locator('.change-answer img').count(),0);
  await page.getByRole('button',{name:'下一页',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.change-observation').length===4);assert.equal(await page.locator('.change-event').count(),0);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('.change-timeline-scroll').evaluate(e=>e.clientHeight<=550&&getComputedStyle(e).overflowY==='auto'));
  await page.getByRole('button',{name:'清空筛选',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.change-observation').length===20);assert.equal(await page.locator('.change-advanced').getAttribute('open'),null);assert.equal(await page.locator('#changeFilterForm [name=comparison]').inputValue(),'all');
 }finally{await browser?.close();await f.close();}
});
