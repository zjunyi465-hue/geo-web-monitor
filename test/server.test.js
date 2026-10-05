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
    });
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
    const setup = await call('/api/setup', 'POST', { username: 'admin', password: 'sample-password-123' });
    assert.equal(setup.status, 201);
    const brand = await call('/api/brands', 'POST', { name: '星河', category: '数据分析工具', audience: '小型企业' });
    assert.equal(brand.status, 201);
    const id = brand.data.brand.id;
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
    for (let attempt = 0; attempt < 100; attempt++) {
      pooled = (await call('/api/runs/' + poolRun.data.run.id)).data;
      if (pooled.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(pooled.run.done, 2);
    assert.deepEqual(new Set(pooled.results.map(result => result.account_id)), new Set([defaultDoubao.id, extra.data.account.id]));
    assert.deepEqual(new Set(pooled.results.map(result => result.account_label)), new Set(['默认账号', '豆包门店二号']));
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
    for (let attempt = 0; attempt < 100; attempt++) {
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
    for (let attempt = 0; attempt < 100; attempt++) {
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
    for (let attempt = 0; attempt < 50; attempt++) {
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
    for (let attempt = 0; attempt < 50; attempt++) {
      resumedRun = (await call('/api/runs/' + started.data.run.id)).data;
      if (resumedRun.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(resumedRun.run.status, 'failed');
    assert.equal(resumedRun.run.done, 4);
    assert.equal(resumedRun.results.length, 4);
    const retry = await call('/api/runs/' + started.data.run.id + '/retry-failed', 'POST', {});
    assert.equal(retry.status, 200);
    let retriedRun;
    for (let attempt = 0; attempt < 50; attempt++) {
      retriedRun = (await call('/api/runs/' + started.data.run.id)).data;
      if (retriedRun.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.equal(retriedRun.run.status, 'failed');
    assert.equal(retriedRun.run.done, 4);
    assert.equal(retriedRun.results.length, 4);
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
    for (let attempt = 0; attempt < 100; attempt++) {
      selectedDetail = (await call('/api/runs/' + selectedRun.data.run.id)).data;
      if (selectedDetail.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.deepEqual(new Set(selectedDetail.results.map(r => r.account_id)), new Set([extra.data.account.id, deepseekAccount.data.account.id]));
    assert.deepEqual(new Set(selectedDetail.results.map(r => r.question_id)), new Set([questions.data.questions[0].id]));
    assert.deepEqual(JSON.parse((await call('/api/tasks')).data.tasks.find(t => t.id === unbound.data.task.id).account_ids_json), []);
    assert.equal((await call('/api/runs/' + selectedRun.data.run.id + '/retry-failed', 'POST', {})).status, 200);
    let retrySelection;
    for (let attempt = 0; attempt < 100; attempt++) {
      retrySelection = (await call('/api/runs/' + selectedRun.data.run.id)).data;
      if (retrySelection.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.deepEqual(new Set(retrySelection.results.map(r => r.account_id)), new Set([extra.data.account.id, deepseekAccount.data.account.id]));
    const changedAccounts = await call('/api/tasks/' + unbound.data.task.id + '/run', 'POST', { accountIds: [defaultDoubao.id] });
    assert.equal(changedAccounts.status, 201);
    assert.equal(changedAccounts.data.run.total, Math.min(2, questions.data.questions.length));
    assert.equal((await call('/api/users', 'POST', { username: 'member', password: 'member-password' })).status, 201);
    await call('/api/logout', 'POST', {});
    assert.equal((await call('/api/login', 'POST', { username: 'member', password: 'wrong-password' })).status, 401);
    assert.equal((await call('/api/login', 'POST', { username: 'member', password: 'member-password' })).status, 200);
    assert.equal((await call('/api/users')).status, 403);
    assert.equal((await call('/api/platform-accounts', 'POST', { platform: 'doubao', label: '不应创建' })).status, 403);
    assert.equal((await call('/api/platform-accounts/' + defaultDoubao.id, 'PUT', { label: '不应修改' })).status, 403);
    assert.equal((await call('/api/users', 'POST', { username: 'intruder', password: 'some-password' })).status, 403);
    assert.equal((await call('/api/setup', 'POST', { username: 'second', password: 'sample-password-123' })).status, 409);
    const crossOrigin = await fetch(base + '/api/brands', {
      method: 'POST', headers: { Cookie: cookie, Origin: 'https://example.org', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '外部请求', category: '软件' }),
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    child.kill();
    await new Promise(resolveExit => {
      if (child.exitCode !== null) resolveExit();
      else child.once('exit', resolveExit);
    });
  }
});
