import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';

async function availablePort() {
  const server = net.createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

test('管理员可创建品牌、生成问题和创建监测任务', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'geo-monitor-test-'));
  const port = await availablePort();
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: resolve('.'),
    env: { ...process.env, GEO_PORT: String(port), GEO_DB_PATH: join(dir, 'test.db'),
      GEO_BROWSER_CHANNEL: 'intentionally-unavailable-test-browser', GEO_PROFILE_ROOT: join(dir, 'profiles'),
      GEO_RESULTS_ROOT: join(dir, 'results') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  let cookie = '';
  async function call(path, method = 'GET', payload) {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }).catch(error=>{throw new Error(method+' '+path+' 接口连接失败；服务退出码='+child.exitCode+'；stderr='+errors,{cause:error});});
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error('服务启动失败：' + errors);
      try { await fetch(base + '/api/bootstrap'); ready = true; break; } catch {}
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    assert.ok(ready, '服务应启动');
    assert.equal((await call('/api/brands')).status, 401);
    assert.equal((await call('/api/analytics?brandId=1')).status, 401);
    assert.equal((await call('/api/source-library?brandId=1')).status,401);
    const setup = await call('/api/setup', 'POST', { username: 'admin', password: 'sample-password-123' });
    assert.equal(setup.status, 201);
    const brand = await call('/api/brands', 'POST', { name: '星河', category: '数据分析工具', audience: '小型企业' });
    assert.equal(brand.status, 201);
    const id = brand.data.brand.id;
    const emptyReport = await call('/api/analytics?brandId=' + id);
    assert.equal(emptyReport.status, 200);
    assert.equal(emptyReport.data.report.summary.total, 0);
    assert.equal((await call('/api/analytics?brandId=' + id + '&from=2026-10-02&to=2026-10-01')).status, 400);
    assert.equal((await call('/api/analytics?brandId=' + id + '&from=2026-02-30')).status, 400);
    const invalidImport = await call('/api/brands/' + id + '/questions', 'POST', { questions: [
      { kind: 'discovery', text: '不得被部分保存的问题' }, { kind: 'discovery', text: '' },
    ] });
    assert.equal(invalidImport.status, 400);
    assert.equal((await call('/api/brands/' + id + '/questions')).data.questions.length, 0);
    const generated = await call('/api/brands/' + id + '/questions/generate');
    assert.ok(generated.data.questions.length >= 10);
    const added = await call('/api/brands/' + id + '/questions', 'POST', { questions: generated.data.questions });
    assert.equal(added.status, 201);
    const questions = await call('/api/brands/' + id + '/questions');
    const task = await call('/api/tasks', 'POST', {
      brandId: id, name: '首轮监测', platforms: ['deepseek', 'doubao'],
      questionIds: questions.data.questions.slice(0, 2).map(q => q.id),
      scheduleType: 'manual',
    });
    assert.equal(task.status, 201);
    const tasks = await call('/api/tasks');
    assert.equal(tasks.data.tasks.length, 1);
    const accountsBefore = await call('/api/platform-accounts');
    const defaultDoubao = accountsBefore.data.accounts.find(account => account.platform === 'doubao');
    assert.ok(defaultDoubao);
    assert.equal(defaultDoubao.loginCheck, null);
    assert.equal(defaultDoubao.inUse, false);
    assert.equal((await call('/api/platform-accounts/999999/check-login', 'POST', {})).status, 404);
    const checkFailure = await call('/api/platform-accounts/' + defaultDoubao.id + '/check-login', 'POST', {});
    assert.equal(checkFailure.status, 200);
    assert.equal(checkFailure.data.check.status, 'unconfirmed');
    assert.equal((await call('/api/platform-accounts')).data.accounts.find(a => a.id === defaultDoubao.id).loginCheck.status, 'unconfirmed');
    const extra = await call('/api/platform-accounts', 'POST', { platform: 'doubao', label: '豆包门店二号' });
    assert.equal(extra.status, 201);
    const twoAccounts = await call('/api/tasks', 'POST', {
      brandId: id, name: '双豆包账号', accountIds: [defaultDoubao.id, extra.data.account.id],
      questionIds: [questions.data.questions[0].id], scheduleType: 'manual',
    });
    assert.equal(twoAccounts.status, 201);
    assert.deepEqual(JSON.parse(twoAccounts.data.task.account_ids_json), [defaultDoubao.id, extra.data.account.id]);
    const poolRun = await call('/api/tasks/' + twoAccounts.data.task.id + '/run', 'POST', {});
    assert.equal(poolRun.data.run.total, 2);
    let pooled;
    for (let attempt = 0; attempt < 200; attempt++) {
      pooled = (await call('/api/runs/' + poolRun.data.run.id)).data;
      if (pooled.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(pooled.run.done, 2);
    assert.deepEqual(new Set(pooled.results.map(result => result.account_id)), new Set([defaultDoubao.id, extra.data.account.id]));
    assert.deepEqual(new Set(pooled.results.map(result => result.account_label)), new Set(['默认账号', '豆包门店二号']));
    const pausedDb = new DatabaseSync(join(dir, 'test.db'));
    pausedDb.prepare("UPDATE runs SET status='needs_attention' WHERE id=?").run(poolRun.data.run.id);
    const blocked = await call('/api/platform-accounts/' + defaultDoubao.id + '/check-login', 'POST', {});
    assert.equal(blocked.status, 409, '暂停中的问答账号也不能另开检查');
    assert.equal((await call('/api/platform-accounts')).data.accounts.find(a => a.id === defaultDoubao.id).inUse, true);
    pausedDb.prepare("UPDATE runs SET status='failed' WHERE id=?").run(poolRun.data.run.id);
    pausedDb.close();
    const deepseekAccount = await call('/api/platform-accounts', 'POST', { platform: 'deepseek', label: 'DeepSeek 新账号' });
    assert.equal(deepseekAccount.status, 201);
    const edited = await call('/api/tasks/' + twoAccounts.data.task.id, 'PUT', {
      name: '更换平台账号', accountIds: [extra.data.account.id, deepseekAccount.data.account.id],
      questionIds: [questions.data.questions[0].id], scheduleType: 'manual',
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(JSON.parse(edited.data.task.account_ids_json), [extra.data.account.id, deepseekAccount.data.account.id]);
    const historical = await call('/api/runs/' + poolRun.data.run.id);
    assert.deepEqual(JSON.parse(historical.data.run.task_snapshot_json).account_ids_json,
      JSON.stringify([defaultDoubao.id, extra.data.account.id]));
    assert.deepEqual(new Set(historical.data.results.map(result => result.account_id)),
      new Set([defaultDoubao.id, extra.data.account.id]));
    const historicalRetry = await call('/api/runs/' + poolRun.data.run.id + '/retry-failed', 'POST', {});
    assert.equal(historicalRetry.status, 200);
    let retriedHistory;
    for (let attempt = 0; attempt < 200; attempt++) {
      retriedHistory = (await call('/api/runs/' + poolRun.data.run.id)).data;
      if (retriedHistory.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.deepEqual(new Set(retriedHistory.results.map(result => result.account_id)),
      new Set([defaultDoubao.id, extra.data.account.id]));
    assert.equal(pooled.attempts.length, 2);
    assert.equal(retriedHistory.attempts.length, 4);
    assert.deepEqual(retriedHistory.attempts.slice(0, 2), pooled.attempts);
    const afterEdit = await call('/api/tasks/' + twoAccounts.data.task.id + '/run', 'POST', {});
    assert.equal(afterEdit.status, 201);
    let editedRun;
    for (let attempt = 0; attempt < 200; attempt++) {
      editedRun = (await call('/api/runs/' + afterEdit.data.run.id)).data;
      if (editedRun.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.deepEqual(new Set(editedRun.results.map(result => result.account_id)),
      new Set([extra.data.account.id, deepseekAccount.data.account.id]));
    const rejectedEdit = await call('/api/tasks/' + twoAccounts.data.task.id, 'PUT', {
      name: '错误配置', accountIds: [99999], questionIds: [questions.data.questions[0].id], scheduleType: 'manual',
    });
    assert.equal(rejectedEdit.status, 400);
    assert.equal((await call('/api/tasks')).data.tasks.find(item => item.id === twoAccounts.data.task.id).name, '更换平台账号');
    const badAccount = await call('/api/tasks', 'POST', {
      brandId: id, accountIds: [99999], questionIds: [questions.data.questions[0].id],
    });
    assert.equal(badAccount.status, 400);
    const started = await call('/api/tasks/' + task.data.task.id + '/run', 'POST', {});
    assert.equal(started.status, 201);
    let run;
    for (let attempt = 0; attempt < 200; attempt++) {
      run = (await call('/api/runs/' + started.data.run.id)).data;
      if (run.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(run.run.status, 'failed');
    assert.equal(run.run.done, 4);
    assert.equal(run.results.length, 4);
    assert.ok(run.results.every(result => result.status === 'failed' && result.error));
    await call('/api/brands/' + id, 'PUT', { name: '更名之后', category: '数据分析工具' });
    const report = (await call('/api/runs/' + started.data.run.id + '/report')).data;
    assert.equal(JSON.parse(report.run.brand_snapshot_json).name, '星河');
    assert.equal(report.report.discoveryMentionRate, null);
    assert.equal(report.report.failed, 4);
    const db = new DatabaseSync(join(dir, 'test.db'));
    try {
      db.prepare('DELETE FROM results WHERE id=?').run(run.results[0].id);
      db.prepare("UPDATE runs SET status='interrupted',done=3 WHERE id=?").run(started.data.run.id);
    } finally { db.close(); }
    const continued = await call('/api/runs/' + started.data.run.id + '/resume', 'POST', {});
    assert.equal(continued.status, 200);
    let resumedRun;
    for (let attempt = 0; attempt < 200; attempt++) {
      resumedRun = (await call('/api/runs/' + started.data.run.id)).data;
      if (resumedRun.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(resumedRun.run.status, 'failed');
    assert.equal(resumedRun.run.done, 4);
    assert.equal(resumedRun.results.length, 4);
    const retryDb = new DatabaseSync(join(dir, 'test.db'));
    const retainedSuccess = resumedRun.results[0];
    const failedToReset = resumedRun.results[1];
    retryDb.prepare("UPDATE results SET status='succeeded',answer='保留已成功回答' WHERE id=?").run(retainedSuccess.id);
    retryDb.prepare("UPDATE runs SET status='partial' WHERE id=?").run(started.data.run.id);
    const abandoned = { token: 'obsolete', mayHaveSubmitted: true, pageUrl: 'https://www.doubao.com/chat/local_obsolete', beforeText: '' };
    retryDb.prepare("UPDATE results SET error_code='RESUME_CONTEXT_LOST',diagnostics_json=? WHERE id=?")
      .run(JSON.stringify({ resumeState: abandoned }), failedToReset.id);
    retryDb.prepare('INSERT OR REPLACE INTO submission_checkpoints(run_id,question_id,account_id,state_json) VALUES(?,?,?,?)')
      .run(started.data.run.id, failedToReset.question_id, failedToReset.account_id, JSON.stringify(abandoned));
    const oldAttempts = retryDb.prepare('SELECT * FROM result_attempts WHERE run_id=? ORDER BY id').all(started.data.run.id);
    retryDb.close();
    const retry = await call('/api/runs/' + started.data.run.id + '/retry-failed', 'POST', {});
    assert.equal(retry.status, 200);
    let retriedRun;
    for (let attempt = 0; attempt < 200; attempt++) {
      retriedRun = (await call('/api/runs/' + started.data.run.id)).data;
      if (retriedRun.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(retriedRun.run.status, 'partial');
    assert.equal(retriedRun.run.done, 4);
    assert.equal(retriedRun.results.length, 4);
    assert.equal(retriedRun.results.find(r => r.id === retainedSuccess.id).answer, '保留已成功回答');
    const afterRetryDb = new DatabaseSync(join(dir, 'test.db'));
    assert.equal(afterRetryDb.prepare('SELECT count(*) AS n FROM submission_checkpoints WHERE run_id=?').get(started.data.run.id).n, 0);
    assert.deepEqual(afterRetryDb.prepare('SELECT * FROM result_attempts WHERE run_id=? ORDER BY id').all(started.data.run.id).slice(0, oldAttempts.length), oldAttempts);
    afterRetryDb.close();
    assert.ok(retriedRun.results.filter(r => r.status === 'failed').every(r => JSON.parse(r.diagnostics_json).retryMode === 'fresh'));
    const scheduled = await call('/api/tasks', 'POST', {
      brandId: id, platforms: ['deepseek'], questionIds: [questions.data.questions[0].id],
      scheduleType: 'weekly', weekdays: [1], timeHHMM: '09:00',
    });
    assert.equal(scheduled.status, 201);
    assert.ok(scheduled.data.task.next_run_at);
    const paused = await call('/api/tasks/' + scheduled.data.task.id + '/toggle', 'POST', {});
    assert.equal(paused.data.task.next_run_at, null);
    const resumed = await call('/api/tasks/' + scheduled.data.task.id + '/toggle', 'POST', {});
    assert.ok(resumed.data.task.next_run_at);
    const duplicate = await call('/api/brands/' + id + '/questions', 'POST', { questions: generated.data.questions });
    assert.equal(duplicate.data.added, 0);
    const badSchedule = await call('/api/tasks', 'POST', {
      brandId: id, platforms: ['deepseek'], questionIds: [questions.data.questions[0].id],
      scheduleType: 'weekly', weekdays: [], enabled: false,
    });
    assert.equal(badSchedule.status, 400);
    const other = await call('/api/brands', 'POST', { name: '其他', category: '软件' });
    assert.equal((await call('/api/tasks', 'POST', {
      brandId: other.data.brand.id, platforms: ['deepseek'], questionIds: [questions.data.questions[0].id],
    })).status, 400);
    const rename = await call('/api/platform-accounts/' + defaultDoubao.id, 'PUT', { label: '豆包主账号', notes: '用于演示项目' });
    assert.equal(rename.status, 200);
    assert.equal(rename.data.account.notes, '用于演示项目');
    assert.equal((await call('/api/platform-accounts/' + defaultDoubao.id, 'PUT', { label: '豆包门店二号' })).status, 409);
    assert.equal((await call('/api/platform-accounts/' + defaultDoubao.id, 'PUT', { label: '  ' })).status, 400);
    assert.equal((await call('/api/platform-accounts/99999', 'PUT', { label: '不存在' })).status, 404);
    const accountsAfterRename = (await call('/api/platform-accounts')).data.accounts;
    assert.equal(accountsAfterRename.find(a => a.id === defaultDoubao.id).is_default, 1);
    assert.equal((await call('/api/runs/' + poolRun.data.run.id)).data.results.find(r => r.account_id === defaultDoubao.id).account_label, '默认账号');
    const reopened = openDatabase(join(dir, 'test.db'));
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM platform_accounts').get().n, accountsAfterRename.length);
    assert.equal(reopened.prepare('SELECT profile_key FROM platform_accounts WHERE id=?').get(defaultDoubao.id).profile_key, 'legacy-doubao');
    reopened.close();
    const legacyCompatible = await call('/api/tasks', 'POST', { brandId: id, name: '改名后默认会话', platforms: ['doubao'], questionIds: [questions.data.questions[0].id] });
    assert.equal(legacyCompatible.status, 201);
    assert.deepEqual(JSON.parse(legacyCompatible.data.task.account_ids_json), [defaultDoubao.id]);
    const unbound = await call('/api/tasks', 'POST', { brandId: id, name: '自由选择账号', questionIds: questions.data.questions.slice(0, 2).map(q => q.id) });
    assert.equal(unbound.status, 201);
    assert.deepEqual(JSON.parse(unbound.data.task.account_ids_json), []);
    assert.equal((await call('/api/tasks/' + unbound.data.task.id + '/run', 'POST', {})).status, 400);
    assert.equal((await call('/api/tasks/' + unbound.data.task.id + '/run', 'POST', { accountIds: [99999] })).status, 400);
    assert.equal((await call('/api/tasks/' + unbound.data.task.id + '/run', 'POST', { accountIds: [], questionIds: [questions.data.questions[0].id] })).status, 400);
    const foreignQuestion = await call('/api/brands/' + other.data.brand.id + '/questions', 'POST', { questions: [{ text: '其他品牌的问题', kind: 'brand' }] });
    const foreignId = (await call('/api/brands/' + other.data.brand.id + '/questions')).data.questions[0].id;
    assert.equal(foreignQuestion.status, 201);
    assert.equal((await call('/api/tasks/' + unbound.data.task.id + '/run', 'POST', { accountIds: [defaultDoubao.id], questionIds: [foreignId] })).status, 400);
    const selectedRun = await call('/api/tasks/' + unbound.data.task.id + '/run', 'POST', {
      accountIds: [extra.data.account.id, deepseekAccount.data.account.id], questionIds: [questions.data.questions[0].id],
    });
    assert.equal(selectedRun.status, 201);
    assert.equal(selectedRun.data.run.total, 2);
    assert.deepEqual(JSON.parse(JSON.parse(selectedRun.data.run.task_snapshot_json).account_ids_json), [extra.data.account.id, deepseekAccount.data.account.id]);
    let selectedDetail;
    for (let attempt = 0; attempt < 200; attempt++) {
      selectedDetail = (await call('/api/runs/' + selectedRun.data.run.id)).data;
      if (selectedDetail.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.deepEqual(new Set(selectedDetail.results.map(r => r.account_id)), new Set([extra.data.account.id, deepseekAccount.data.account.id]));
    assert.deepEqual(new Set(selectedDetail.results.map(r => r.question_id)), new Set([questions.data.questions[0].id]));
    assert.deepEqual(JSON.parse((await call('/api/tasks')).data.tasks.find(t => t.id === unbound.data.task.id).account_ids_json), []);
    assert.equal((await call('/api/runs/' + selectedRun.data.run.id + '/retry-failed', 'POST', {})).status, 200);
    let retrySelection;
    for (let attempt = 0; attempt < 200; attempt++) {
      retrySelection = (await call('/api/runs/' + selectedRun.data.run.id)).data;
      if (retrySelection.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.deepEqual(new Set(retrySelection.results.map(r => r.account_id)), new Set([extra.data.account.id, deepseekAccount.data.account.id]));
    const changedAccounts = await call('/api/tasks/' + unbound.data.task.id + '/run', 'POST', { accountIds: [defaultDoubao.id] });
    assert.equal(changedAccounts.status, 201);
    assert.equal(changedAccounts.data.run.total, Math.min(2, questions.data.questions.length));
    const legacyTask=await call('/api/tasks','POST',{brandId:id,name:'旧记录完整性测试',accountIds:[defaultDoubao.id],questionIds:[questions.data.questions[0].id],scheduleType:'manual'});
    const legacyDb=new DatabaseSync(join(dir,'test.db'));
    const legacyRun=Number(legacyDb.prepare("INSERT INTO runs(task_id,status,total,done,started_at,finished_at) VALUES(?,'completed',2,1,?,?)").run(legacyTask.data.task.id,'2026-10-01T00:00:00Z','2026-10-01T00:00:01Z').lastInsertRowid);
    legacyDb.prepare("INSERT INTO results(run_id,question_id,account_id,platform,status,answer,started_at,finished_at) VALUES(?,?,?,'doubao','succeeded','更名之后',?,?)").run(legacyRun,questions.data.questions[0].id,defaultDoubao.id,'2026-10-01T00:00:00Z','2026-10-01T00:00:01Z');
    legacyDb.close();
    const legacyReport=(await call('/api/analytics?brandId='+id+'&taskId='+legacyTask.data.task.id)).data.report;
    assert.equal(legacyReport.summary.successful,1);
    assert.equal(legacyReport.summary.total,2);
    assert.equal(legacyReport.summary.captureRate,.5);
    assert.equal(legacyReport.audit.unlocatedExpected,1);
    assert.equal(legacyReport.audit.fallbackBrandRecords,1);
    assert.equal(legacyReport.records.length,1);
    const scopedLegacy=(await call('/api/analytics?brandId='+id+'&taskId='+legacyTask.data.task.id+'&accountId='+defaultDoubao.id)).data.report;
    assert.equal(scopedLegacy.audit.unlocatedIncluded,false);
    assert.equal(scopedLegacy.summary.total,1);
    const platformOnly=await call('/api/tasks','POST',{brandId:id,name:'旧平台快照',accountIds:[defaultDoubao.id],questionIds:[questions.data.questions[0].id],scheduleType:'manual'});
    const oldSnapshot={...platformOnly.data.task};delete oldSnapshot.account_ids_json;
    const oldDb=new DatabaseSync(join(dir,'test.db'));
    oldDb.prepare("INSERT INTO runs(task_id,status,total,done,started_at,finished_at,task_snapshot_json,brand_snapshot_json) VALUES(?,'completed',1,0,?,?,?,?)").run(platformOnly.data.task.id,'2026-10-02T00:00:00Z','2026-10-02T00:00:01Z',JSON.stringify(oldSnapshot),JSON.stringify(brand.data.brand));
    oldDb.close();
    const platformOnlyReport=(await call('/api/analytics?brandId='+id+'&taskId='+platformOnly.data.task.id)).data.report;
    assert.equal(platformOnlyReport.records.length,0,'不可用当前默认账号补历史缺失');
    assert.equal(platformOnlyReport.summary.total,1);
    assert.equal(platformOnlyReport.audit.unlocatedExpected,1);
    assert.equal(platformOnlyReport.cohorts.length,0,'没有历史账号ID不形成可比条件组');
    const sourceDb=new DatabaseSync(join(dir,'test.db'));
    const sourceLinks=Array.from({length:24},(_,n)=>({url:'https://source.example/page?item='+n,title:'资料'+n}));
    sourceDb.prepare('UPDATE results SET citations_json=?,searched_sites_json=? WHERE run_id=?').run(JSON.stringify([...sourceLinks,sourceLinks[0]]),JSON.stringify([sourceLinks[0]]),legacyRun);
    sourceDb.close();
    const sourceQuery='/api/source-library?brandId='+id+'&q=source.example';
    const sourceList=(await call(sourceQuery)).data.library;assert.equal(sourceList.totalPages,24);assert.equal(sourceList.items.length,20);assert.equal(sourceList.domains[0].citationAnswers,1);
    for(const suffix of ['&page=0','&page=-1','&page=1.5','&page=Infinity','&category=unknown','&kind=unknown','&favorite=true'])assert.equal((await call(sourceQuery+suffix)).status,400);
    assert.equal((await call(sourceQuery+'&page=2')).data.library.items.length,4);
    assert.equal((await call(sourceQuery+'&from=2026-02-30')).status,400);
    const annotation={brandId:id,url:sourceLinks[0].url,category:'owned',favorite:true,notes:'人工核对'};
    assert.equal((await call('/api/source-library/annotation','PUT',annotation)).status,200);
    assert.equal((await call('/api/source-library/annotation','PUT',{...annotation,brandId:other.data.brand.id})).status,404);
    assert.equal((await call('/api/source-library/annotation','PUT',{...annotation,category:'invalid'})).status,400);
    for(const invalid of [{favorite:'true'},{notes:'x'.repeat(2001)},{notes:null},{url:'https://missing.example/a'}])assert.ok([400,404].includes((await call('/api/source-library/annotation','PUT',{...annotation,...invalid})).status));
    const savedSources=(await call(sourceQuery+'&favorite=1')).data.library;assert.equal(savedSources.totalPages,1);assert.equal(savedSources.items[0].notes,'人工核对');assert.equal(savedSources.items[0].category,'owned');
    const evidenceQuery='/api/source-library/evidence?brandId='+id+'&url='+encodeURIComponent(sourceLinks[0].url);
    const sourceEvidence=(await call(evidenceQuery)).data;assert.equal(sourceEvidence.total,1);assert.deepEqual(sourceEvidence.evidence[0].types,['citation','search']);assert.equal(sourceEvidence.evidence[0].answer,'更名之后');
    assert.equal((await call(evidenceQuery+'&evidencePage=abc')).status,400);
    assert.equal((await call(evidenceQuery+'&host=other.example')).status,404,'证据接口也遵守当前网站筛选');
    const sourceReopen=openDatabase(join(dir,'test.db'));assert.equal(sourceReopen.prepare('SELECT notes FROM source_annotations WHERE brand_id=? AND url=?').get(id,sourceLinks[0].url).notes,'人工核对');sourceReopen.close();
    const topicCreate=await call('/api/brands/'+id+'/topics','POST',{name:'选择比较'});assert.equal(topicCreate.status,201);
    const topicId=topicCreate.data.topics.at(-1).id,q1=questions.data.questions[0].id,q2=questions.data.questions[1].id;
    assert.equal((await call('/api/brands/'+id+'/topics','POST',{name:'选择比较'})).status,409);
    assert.equal((await call('/api/topics/'+topicId,'PUT',{name:'场景研究'})).status,200);
    assert.equal((await call('/api/topics/'+topicId+'/questions','POST',{operation:'add',questionIds:[q1,q1]})).status,200);
    assert.deepEqual((await call('/api/brands/'+id+'/topics')).data.topics.find(t=>t.id===topicId).questionIds,[q1]);
    assert.equal((await call('/api/topics/'+topicId+'/questions','POST',{operation:'add',questionIds:[q2,999999]})).status,400);
    assert.deepEqual((await call('/api/brands/'+id+'/topics')).data.topics.find(t=>t.id===topicId).questionIds,[q1]);
    assert.equal((await call('/api/analytics?brandId='+other.data.brand.id+'&topicId='+topicId)).status,400);
    const fixedTask=await call('/api/tasks','POST',{brandId:id,name:'专题固定任务',accountIds:[defaultDoubao.id],questionIds:[q1],topicIds:[topicId],scheduleType:'manual'});assert.equal(fixedTask.status,201);
    const topicDb=new DatabaseSync(join(dir,'test.db'));
    const frozenRun=Number(topicDb.prepare("INSERT INTO runs(task_id,status,total,done,started_at,finished_at) VALUES(?,'completed',0,0,?,?)").run(fixedTask.data.task.id,'2026-10-03T00:00:00Z','2026-10-03T00:00:01Z').lastInsertRowid);
    await call('/api/topics/'+topicId+'/questions','POST',{operation:'add',questionIds:[q2]});
    let listed=(await call('/api/tasks')).data.tasks.find(t=>t.id===fixedTask.data.task.id);assert.equal(listed.topicsChanged,true);assert.deepEqual(JSON.parse(listed.question_ids_json),[q1]);
    const currentTopic=(await call('/api/brands/'+id+'/topics')).data.topics.find(t=>t.id===topicId);
    const expectedTask={questionIds:[q1],topicIds:[topicId]},expectedTopics=[{id:topicId,name:currentTopic.name,questionIds:currentTopic.questionIds}];
    assert.equal((await call('/api/tasks/'+listed.id+'/sync-topics','POST',{expectedTask,expectedTopics:[{...expectedTopics[0],questionIds:[q1]}]})).status,409,'旧专题快照拒绝更新');
    assert.equal((await call('/api/tasks/'+listed.id+'/sync-topics','POST',{expectedTask:{questionIds:[q2],topicIds:[topicId]},expectedTopics})).status,409,'旧任务清单拒绝更新');
    assert.equal((await call('/api/tasks/'+listed.id+'/sync-topics','POST',{})).status,409,'没有确认快照的旧页面拒绝更新');
    assert.equal(topicDb.prepare('SELECT task_snapshot_json FROM runs WHERE id=?').get(frozenRun).task_snapshot_json,null,'拒绝更新不写历史');
    assert.equal((await call('/api/tasks/'+listed.id+'/sync-topics','POST',{expectedTask,expectedTopics})).status,200);
    listed=(await call('/api/tasks')).data.tasks.find(t=>t.id===listed.id);assert.deepEqual(JSON.parse(listed.question_ids_json),[q1,q2].sort((a,b)=>a-b));assert.equal(listed.topicsChanged,false);
    assert.equal(JSON.parse(topicDb.prepare('SELECT task_snapshot_json FROM runs WHERE id=?').get(frozenRun).task_snapshot_json).question_ids_json,JSON.stringify([q1]));
    assert.equal(listed.account_ids_json,fixedTask.data.task.account_ids_json);assert.equal(listed.schedule_type,'manual');
    topicDb.prepare("UPDATE runs SET status='needs_attention' WHERE id=?").run(frozenRun);
    assert.equal((await call('/api/tasks/'+listed.id+'/sync-topics','POST',{})).status,400,'等待人工处理期间不能改固定清单');
    assert.equal((await call('/api/tasks/'+listed.id,'PUT',{name:'暂停中不得编辑',accountIds:[defaultDoubao.id],questionIds:[q1],topicIds:[topicId],scheduleType:'manual'})).status,400);
    topicDb.prepare("UPDATE runs SET status='completed' WHERE id=?").run(frozenRun);
    assert.equal((await call(sourceQuery+'&topicId='+topicId)).data.library.totalPages,24);
    await call('/api/topics/'+topicId+'/questions','POST',{operation:'remove',questionIds:[q1,q2]});
    assert.equal((await call('/api/analytics?brandId='+id+'&topicId='+topicId)).data.report.summary.total,0);
    assert.equal((await call(sourceQuery+'&topicId='+topicId)).data.library.totalPages,0);
    assert.equal((await call('/api/tasks/'+listed.id+'/sync-topics','POST',{})).status,400);
    assert.equal((await call('/api/topics/'+topicId,'DELETE')).status,200);
    const recreated=await call('/api/brands/'+id+'/topics','POST',{name:'新建专题'});assert.ok(recreated.data.topics.at(-1).id>topicId,'删除后编号不能复用');
    assert.equal((await call('/api/tasks')).data.tasks.find(t=>t.id===listed.id).topicsMissing,true,'旧任务不能绑定到新专题');
    assert.ok(topicDb.prepare('SELECT id FROM questions WHERE id=?').get(q1));assert.ok(topicDb.prepare('SELECT id FROM runs WHERE id=?').get(frozenRun));topicDb.close();
    const institutionDb=new DatabaseSync(join(dir,'test.db'));
    institutionDb.prepare('UPDATE results SET answer=? WHERE run_id=?').run('更名之后、云海集团和云海公司。<script>bad</script>',legacyRun);institutionDb.close();
    const institutionQuery='/api/institutions?brandId='+id;
    let institutionList=(await call(institutionQuery)).data.report;assert.ok(institutionList.groups.some(g=>g.name==='云海集团'));assert.ok(institutionList.groups.every(g=>g.category==='pending'));
    const institutionReview={brandId:id,name:'云海集团',category:'peer',mergeInto:'',notes:'人工确认',expectedUpdatedAt:null};
    assert.equal((await call('/api/institutions/review','PUT',{...institutionReview,name:'不存在的机构'})).status,404);
    assert.equal((await call('/api/institutions/review','PUT',{...institutionReview,brandId:other.data.brand.id})).status,404);
    assert.equal((await call('/api/institutions/review','PUT',institutionReview)).status,200);
    assert.equal((await call('/api/institutions/review','PUT',institutionReview)).status,409);
    assert.equal((await call('/api/institutions/review','PUT',{...institutionReview,name:'云海公司',category:'pending',mergeInto:'云海集团'})).status,200);
    institutionList=(await call(institutionQuery)).data.report;const cloudGroup=institutionList.groups.find(g=>g.name==='云海集团');assert.equal(cloudGroup.body,1);assert.ok(cloudGroup.names.includes('云海公司'));
    const cloudMeta=institutionList.reviews.find(g=>g.name==='云海集团');
    assert.equal((await call('/api/institutions/review','PUT',{...institutionReview,mergeInto:'云海公司',expectedUpdatedAt:cloudMeta.updatedAt})).status,400);
    const instituteProof=await call('/api/institutions/evidence?brandId='+id+'&key='+encodeURIComponent(cloudGroup.key));assert.equal(instituteProof.status,200);assert.equal(instituteProof.data.total,1);assert.match(instituteProof.data.evidence[0].answer,/云海集团/);
    assert.equal((await call(institutionQuery+'&topicId=999999')).status,400);assert.equal((await call(institutionQuery+'&page=0')).status,400);assert.equal((await call(institutionQuery+'&from=2026-02-30')).status,400);
    const detailPath='/api/institutions/detail?brandId='+id+'&key='+encodeURIComponent(cloudGroup.key);
    const detailResponse=await call(detailPath);assert.equal(detailResponse.status,200);assert.equal(detailResponse.data.detail.summary.body,1);assert.equal(detailResponse.data.detail.comparable,true);
    assert.equal(detailResponse.data.detail.questions.total,institutionList.questions.length);assert.equal((await call(detailPath+'&questionPage=0')).status,400);assert.equal((await call(detailPath+'&sourcePage=1.5')).status,400);
    const paginationDb=new DatabaseSync(join(dir,'test.db'));const savedCitation=paginationDb.prepare('SELECT id,citations_json FROM results WHERE run_id=?').get(legacyRun);
    paginationDb.prepare('UPDATE results SET citations_json=? WHERE id=?').run(JSON.stringify(Array.from({length:25},(_,i)=>({title:'通用资料 '+i,url:'https://detail.example/'+i}))),savedCitation.id);
    const pagedDetail=(await call(detailPath+'&sourcePage=2&questionPage=999')).data.detail;assert.equal(pagedDetail.sources.total,26);assert.equal(pagedDetail.sources.items.length,6);assert.equal(pagedDetail.sources.page,2);assert.equal(pagedDetail.questions.page,1);
    const sourceProof=await call('/api/institutions/evidence?brandId='+id+'&key='+encodeURIComponent(cloudGroup.key)+'&sourceUrl='+encodeURIComponent(pagedDetail.sources.items[0].url)+'&sourceKind='+pagedDetail.sources.items[0].kind+'&sourceRelation=body');assert.equal(sourceProof.data.total,1);
    paginationDb.prepare('UPDATE results SET citations_json=? WHERE id=?').run(savedCitation.citations_json,savedCitation.id);paginationDb.close();
    const pageDb=new DatabaseSync(join(dir,'test.db'));pageDb.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON');
    const fixtureRun=Number(pageDb.prepare("INSERT INTO runs(task_id,status,total,done,started_at,finished_at) VALUES(?,'completed',23,23,?,?)").run(legacyTask.data.task.id,'2026-10-04T00:00:00Z','2026-10-04T00:00:01Z').lastInsertRowid),fixtureQuestions=[];
    for(let n=0;n<23;n++){const qid=Number(pageDb.prepare("INSERT INTO questions(brand_id,text,kind,source,created_at) VALUES(?,?,'discovery','manual',?)").run(id,'详情隔离问题 '+n,'2026-10-04T00:00:00Z').lastInsertRowid);fixtureQuestions.push(qid);pageDb.prepare("INSERT INTO results(run_id,question_id,account_id,platform,status,answer,citations_json,started_at,finished_at) VALUES(?,?,?,'doubao','succeeded','云海集团',?,?,?)").run(fixtureRun,qid,defaultDoubao.id,JSON.stringify([{title:'通用资料',url:'https://detail.example/evidence'}]),'2026-10-04T00:00:00Z','2026-10-04T00:00:01Z');}
    const manyDetail=(await call(detailPath+'&questionPage=2')).data.detail;assert.equal(manyDetail.questions.total,detailResponse.data.detail.questions.total+23);assert.equal(manyDetail.questions.page,2);assert.ok(manyDetail.questions.items.length>0&&manyDetail.questions.items.length<=20);
    const singleDetail=(await call(detailPath+'&questionId='+fixtureQuestions[22])).data.detail;assert.equal(singleDetail.summary.valid,1);assert.equal(singleDetail.questions.total,1);assert.equal(singleDetail.questions.items[0].id,fixtureQuestions[22]);
    const absentDetail=(await call(detailPath+'&questionId=999999')).data.detail;assert.equal(absentDetail.summary.valid,0);assert.equal(absentDetail.sources.total,0);
    const moreProof='/api/institutions/evidence?brandId='+id+'&key='+encodeURIComponent(cloudGroup.key)+'&sourceUrl='+encodeURIComponent('https://detail.example/evidence')+'&sourceKind=citation&sourceRelation=body&detailPlatform=doubao&detailAccount='+defaultDoubao.id;
    const proofFirst=(await call(moreProof)).data,proofNext=(await call(moreProof+'&evidencePage=2')).data;assert.equal(proofFirst.total,23);assert.equal(proofFirst.evidence.length,10);assert.equal(proofNext.evidence.length,10);assert.ok(proofNext.evidence.every(e=>fixtureQuestions.includes(e.questionId)));assert.equal(new Set([...proofFirst.evidence,...proofNext.evidence].map(e=>e.resultId)).size,20,'证据翻页不重复且不丢来源范围');
    assert.equal((await call(moreProof+'&questionId='+fixtureQuestions[22]+'&evidencePage=2')).data.total,1,'问题与来源证据交集不扩大');
    pageDb.prepare('DELETE FROM runs WHERE id=?').run(fixtureRun);for(const qid of fixtureQuestions)pageDb.prepare('DELETE FROM questions WHERE id=?').run(qid);pageDb.close();
    const otherDetail=await call('/api/institutions/detail?brandId='+other.data.brand.id+'&key='+encodeURIComponent(cloudGroup.key));assert.equal(otherDetail.status,400);
    assert.equal((await call('/api/institutions/evidence?brandId='+id+'&key='+encodeURIComponent(cloudGroup.key)+'&questionId=999999')).data.total,0);
    assert.equal((await call('/api/institutions/evidence?brandId='+id+'&key='+encodeURIComponent(cloudGroup.key)+'&detailPlatform=invalid')).status,400);
    assert.equal((await call('/api/institutions/evidence?brandId='+id+'&key='+encodeURIComponent(cloudGroup.key)+'&sourceUrl=https%3A%2F%2Fexample.com&sourceKind=citation&sourceRelation=named')).status,400);
    const alias=institutionList.reviews.find(g=>g.name==='云海公司');
    assert.equal((await call('/api/institutions/review','PUT',{...institutionReview,name:'云海公司',category:'wrong',mergeInto:'云海集团',expectedUpdatedAt:alias.updatedAt})).status,400,'错误别名不能继续参与已合并对象统计');assert.equal((await call('/api/institutions/review','PUT',{...institutionReview,name:'云海公司',category:'ignore',mergeInto:'',expectedUpdatedAt:alias.updatedAt})).status,200);
    institutionList=(await call(institutionQuery)).data.report;assert.equal(institutionList.groups.find(g=>g.name==='云海公司').category,'ignore');
    assert.equal((await call('/api/institutions/review','PUT',{...institutionReview,name:'云海',category:'pending',mergeInto:'云海集团'})).status,200,'可手动补实际存在的简称');
    assert.equal((await call('/api/users', 'POST', { username: 'member', password: 'member-password' })).status, 201);
    await call('/api/logout', 'POST', {});
    assert.equal((await call('/api/login', 'POST', { username: 'member', password: 'wrong-password' })).status, 401);
    assert.equal((await call('/api/login', 'POST', { username: 'member', password: 'member-password' })).status, 200);
    assert.equal((await call('/api/users')).status, 403);
    assert.equal((await call(sourceQuery)).status,200,'成员能读取团队共享信源');
    assert.equal((await call('/api/source-library/annotation','PUT',{...annotation,notes:'成员核对'})).status,200,'成员按既定共享规则标注');
    const sourceOrigin=await fetch(base+'/api/source-library/annotation',{method:'PUT',headers:{Cookie:cookie,Origin:'https://outside.example','Content-Type':'application/json'},body:JSON.stringify({...annotation,notes:'被拒绝内容'})});assert.equal(sourceOrigin.status,403);
    assert.equal((await call(sourceQuery+'&favorite=1')).data.library.items[0].notes,'成员核对');
    assert.equal((await call('/api/platform-accounts', 'POST', { platform: 'doubao', label: '不应创建' })).status, 403);
    assert.equal((await call('/api/platform-accounts/' + defaultDoubao.id, 'PUT', { label: '不应修改' })).status, 403);
    assert.equal((await call('/api/users', 'POST', { username: 'intruder', password: 'some-password' })).status, 403);
    assert.equal((await call('/api/setup', 'POST', { username: 'second', password: 'sample-password-123' })).status, 409);
    const crossOrigin = await fetch(base + '/api/brands', {
      method: 'POST', headers: { Cookie: cookie, Origin: 'https://example.org', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '外部请求', category: '软件' }),
    });
    assert.equal(crossOrigin.status, 403);
    await call('/api/logout','POST',{});
    assert.equal((await call(sourceQuery)).status,401);assert.equal((await call(evidenceQuery)).status,401);
    assert.equal((await call('/api/source-library/annotation','PUT',annotation)).status,401);
    assert.equal((await call(detailPath)).status,401);assert.equal((await call(institutionQuery)).status,401);assert.equal((await call('/api/institutions/review','PUT',institutionReview)).status,401);
  } finally {
    child.kill();
    await new Promise(resolveExit => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
  }
});
