import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';
import { openDatabase } from '../src/db.js';

test('本地界面可完成品牌、问题和任务创建', { skip: !process.env.GEO_UI_TEST }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'geo-ui-test-'));
  await mkdir(resolve('work'), { recursive: true });
  const listener = net.createServer();
  await new Promise(done => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: resolve('.'),
    env: { ...process.env, GEO_PORT: String(port), GEO_DB_PATH: join(dir, 'test.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:' + port + '/api/bootstrap'); break; } catch {}
      await new Promise(done => setTimeout(done, 100));
    }
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://127.0.0.1:' + port);
    await page.locator('input[name="username"]').fill('admin');
    await page.locator('input[name="password"]').fill('sample-password-123');
    await page.getByRole('button', { name: '创建管理员' }).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.locator('input[name="username"]').fill('admin');
    await page.locator('input[name="password"]').fill('incorrect-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('用户名或密码错误', { exact: true }).waitFor();
    assert.equal(await page.locator('input[name="username"]').inputValue(), 'admin');
    await page.locator('input[name="password"]').fill('sample-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '品牌资料' }).click();
    await page.locator('input[name="name"]').fill('星河');
    await page.locator('input[name="category"]').fill('数据分析工具');
    await page.getByRole('button', { name: '保存品牌资料' }).click();
    await page.getByRole('button', { name: '新建品牌', exact: true }).click();
    await page.getByRole('button', { name: '问题池' }).click();
    const manualQuestion = '有哪些适合小企业的数据分析工具？';
    await page.locator('#manualQuestionsForm textarea').fill(manualQuestion);
    const saveRequest = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/questions'));
    await page.getByRole('button', { name: '加入问题池', exact: true }).click();
    const saved = await saveRequest;
    assert.equal(saved.status(), 201, '离开未保存的新品牌页面后，应使用下拉框显示的有效品牌保存问题');
    await page.getByText(manualQuestion, { exact: true }).waitFor({ timeout: 5000 });
    await page.locator('#manualQuestionsForm textarea').fill('x'.repeat(501));
    await page.getByRole('button', { name: '加入问题池', exact: true }).click();
    await page.getByText('问题过长', { exact: true }).waitFor();
    assert.equal((await page.locator('#manualQuestionsForm textarea').inputValue()).length, 501);
    await page.getByRole('button', { name: '根据品牌资料出题' }).click();
    await page.getByRole('button', { name: '审核后加入问题池' }).click();
    await page.getByText(/已加入 \d+ 个新问题/).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '监测任务' }).click();
    await page.getByRole('button', { name: '平台账号池' }).click();
    await page.locator('#accountForm input[name="label"]').fill('平台 A门店二号');
    await page.getByRole('button', { name: '添加账号' }).click();
    await page.getByText('平台 A门店二号', { exact: true }).waitFor();
    const defaultRow = page.locator('.accounts-table tbody tr').filter({ hasText: '平台 A' }).filter({ hasText: '默认会话' });
    await defaultRow.getByRole('button', { name: '编辑账号' }).click();
    await page.locator('#editAccountForm input[name="label"]').fill('平台 A主账号');
    await page.locator('#editAccountForm textarea[name="notes"]').fill('演示项目负责人');
    await page.getByRole('button', { name: '保存账号修改' }).click();
    await page.getByText('账号名称和备注已保存，登录状态与任务关联保持不变。').waitFor();
    await page.getByText('平台 A主账号', { exact: true }).waitFor();
    await page.locator('#accountFilterForm input[name="search"]').fill('负责人');
    await page.getByRole('button', { name: '筛选账号' }).click();
    assert.equal(await page.locator('.accounts-table tbody tr').count(), 1);
    assert.match(await page.locator('.accounts-table').innerText(), /平台 A主账号/);
    await page.locator('#accountFilterForm select[name="platform"]').selectOption('deepseek');
    await page.getByRole('button', { name: '筛选账号' }).click();
    await page.getByText('没有匹配的账号，请调整筛选条件。').waitFor();
    await page.locator('#accountFilterForm select[name="platform"]').selectOption('');
    await page.locator('#accountFilterForm input[name="search"]').fill('');
    await page.getByRole('button', { name: '筛选账号' }).click();
    await page.locator('.accounts-table tbody tr').filter({ hasText: '平台 A主账号' }).getByRole('button', { name: '编辑账号' }).click();
    await page.locator('#editAccountForm input[name="label"]').fill('平台 A门店二号');
    await page.getByRole('button', { name: '保存账号修改' }).click();
    await page.getByText('该平台已有同名账号，请换一个名称', { exact: true }).waitFor();
    assert.equal(await page.locator('#editAccountForm input[name="label"]').inputValue(), '平台 A门店二号');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByText('平台 A主账号', { exact: true }).waitFor();
    await page.screenshot({ path: resolve('work', 'geo-accounts.png'), fullPage: true });
    await page.getByRole('button', { name: '监测任务' }).click();
    await page.locator('#taskForm input[name="name"]').fill('首轮监测');
    await page.locator('#taskForm input[name="question"]').first().check();
    await page.getByRole('button', { name: '创建任务' }).click();
    await page.getByText('首轮监测', { exact: true }).waitFor({ timeout: 5000 });
    assert.match(await page.locator('main').innerText(), /首轮监测/);
    assert.match(await page.locator('main').innerText(), /运行时选择/);
    await page.locator('button[data-action="runTask"]').first().click();
    await page.locator('#runTaskForm').waitFor();
    assert.equal(await page.locator('#runTaskForm input[name="account"]:checked').count(), 0);
    assert.equal(await page.locator('#runTaskForm input[name="question"]:checked').count(), 1);
    await page.getByRole('button', { name: '开始本次监测' }).click();
    await page.getByText('请为本次运行选择至少一个账号', { exact: true }).waitFor();
    await page.locator('#runTaskForm .account-option').filter({ hasText: '平台 A门店二号' }).locator('input').check();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '平台账号池' }).click();
    await page.locator('#accountForm select[name="platform"]').selectOption('deepseek');
    await page.locator('#accountForm input[name="label"]').fill('平台 B 新账号');
    await page.getByRole('button', { name: '添加账号' }).click();
    await page.getByRole('button', { name: '监测任务' }).click();
    await page.locator('button[data-action="editTask"]').first().click();
    await page.locator('#editTaskForm select[name="scheduleType"]').selectOption('daily');
    await page.locator('#editTaskForm .account-option').filter({ hasText: '平台 B 新账号' }).locator('input').check();
    await page.getByRole('button', { name: '保存修改' }).click();
    await page.getByText('任务已更新，之后的新运行会使用新配置。').waitFor();
    assert.match(await page.locator('main').innerText(), /平台 B 新账号/);
    await page.screenshot({ path: resolve('work', 'geo-dashboard.png'), fullPage: true });
    const db = openDatabase(join(dir, 'test.db'));
    const task = db.prepare('SELECT * FROM tasks LIMIT 1').get();
    assert.deepEqual(JSON.parse(task.account_ids_json).map(accountId =>
      db.prepare('SELECT label FROM platform_accounts WHERE id=?').get(accountId).label), ['平台 B 新账号']);
    const question = db.prepare('SELECT * FROM questions WHERE brand_id=? LIMIT 1').get(task.brand_id);
    const runId = Number(db.prepare("INSERT INTO runs(task_id,status,total,done,started_at,finished_at) VALUES(?,'completed',1,1,?,?)")
      .run(task.id, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
    db.prepare("INSERT INTO results(run_id,question_id,platform,status,answer,citations_json,started_at,finished_at) VALUES(?,?,?,'succeeded',?,?,?,?)")
      .run(runId, question.id, 'doubao', '测试回答', JSON.stringify([
        { title: '参考资料一', url: 'https://example.org/a' },
        { title: '参考资料二', url: 'https://example.net/b' },
      ]), new Date().toISOString(), new Date().toISOString());
    db.prepare("INSERT INTO result_attempts(run_id,question_id,platform,status,error,error_code,started_at,finished_at,diagnostics_json) VALUES(?,?,?,'failed',?,?,?,?,?)")
      .run(runId, question.id, 'doubao', '系统异常', 'PROVIDER_ERROR', new Date().toISOString(), new Date().toISOString(),
        JSON.stringify({ stage: '提交问题', automaticRetry: true, editor: { inViewport: true, questionRetained: true } }));
    db.close();
    await page.getByRole('button', { name: '结果与报告' }).click();
    await page.getByRole('button', { name: '刷新' }).click();
    await page.getByRole('button', { name: '查看结果' }).click();
    await page.locator('main details > summary').filter({ hasText: question.text }).first().click();
    await page.getByText('测试回答', { exact: true }).waitFor({ timeout: 5000 });
    await page.getByText('按账号比较').waitFor();
    await page.getByText('正文引用（已采集 2 条）').click();
    assert.equal(await page.locator('a[href^="https://example."]').count(), 2);
    await page.getByText('执行记录（1 次，包含失败和重试）', { exact: true }).click();
    await page.locator('summary').filter({ hasText: '随后自动重试' }).click();
    await page.getByText('系统异常（PROVIDER_ERROR）', { exact: true }).waitFor();
    await page.getByText('输入框：在窗口可见范围内；原问题仍在输入框', { exact: true }).waitFor();
    await page.screenshot({ path: resolve('work', 'geo-results.png'), fullPage: true });
    const paginationDb = openDatabase(join(dir, 'test.db'));
    const insertRun = paginationDb.prepare("INSERT INTO runs(task_id,status,total,done,started_at,finished_at) VALUES(?,'completed',0,0,?,?)");
    for (let index = 0; index < 15; index++) insertRun.run(task.id, new Date().toISOString(), new Date().toISOString());
    paginationDb.close();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.getByText('共 16 条 · 每页 10 条 · 第 1 / 2 页', { exact: true }).waitFor();
    const records = page.locator('.card').filter({ has: page.locator('.runs-pagination') });
    assert.equal(await records.locator('tbody tr').count(), 10);
    assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    assert.equal(await records.locator('tbody tr').count(), 6);
    assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
    assert.match(await page.locator('main').innerText(), /运行 #1/);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    assert.equal(await records.locator('tbody tr').count(), 10);
    assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
  } finally {
    await browser?.close();
    child.kill();
    await new Promise(done => child.exitCode !== null ? done() : child.once('exit', done));
  }
});
