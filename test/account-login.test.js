import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { openDatabase } from '../src/db.js';
import { PLATFORMS, inspectAccountLogin, waitForAccountLogin, checkAccountLogin, accountBrowserBusy, closeBrowsers } from '../src/browser.js';

test('新增登录检查字段不会覆盖账号、采集状态与历史资料', () => {
  const db = openDatabase(':memory:');
  try {
    const account = db.prepare('SELECT * FROM platform_accounts LIMIT 1').get();
    assert.equal(account.login_check_json, null);
    db.prepare('UPDATE platform_accounts SET login_check_json=? WHERE id=?').run(JSON.stringify({ status: 'unconfirmed' }), account.id);
    const updated = db.prepare('SELECT * FROM platform_accounts WHERE id=?').get(account.id);
    assert.equal(updated.profile_key, account.profile_key);
    assert.equal(updated.label, account.label);
    assert.equal(updated.last_status, account.last_status);
  } finally { db.close(); }
});

test('登录检查保守识别、账号互斥且不发送问题', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  let markup = '';
  let documentDelay = 0;
  const requests = [];
  const fixture = http.createServer((req, res) => {
    requests.push(req.method);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (documentDelay) { res.write(markup); setTimeout(() => res.end(), documentDelay); }
    else res.end(markup);
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const oldUrls = Object.fromEntries(Object.entries(PLATFORMS).map(([id, p]) => [id, p.url]));
  const env = Object.fromEntries(['GEO_HEADLESS', 'GEO_PROFILE_ROOT', 'GEO_RESULTS_ROOT'].map(key => [key, process.env[key]]));
  const root = await mkdtemp(join(tmpdir(), 'geo-account-check-'));
  process.env.GEO_HEADLESS = '1';
  process.env.GEO_PROFILE_ROOT = join(root, 'profiles');
  process.env.GEO_RESULTS_ROOT = join(root, 'results');
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  for (const p of Object.values(PLATFORMS)) p.url = url;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url);
    for (const platform of ['deepseek', 'doubao']) {
      const editor = platform === 'deepseek' ? '<textarea></textarea>' : '<div data-testid="chat_input_input"><div class="tiptap" contenteditable="true"></div></div>';
      await page.setContent(editor);
      assert.equal((await inspectAccountLogin(page, platform)).status, 'unconfirmed', '游客输入框不代表已登录');
      await page.setContent('<p>190******47</p>' + editor);
      assert.equal((await inspectAccountLogin(page, platform)).status, 'valid');
      await page.setContent('<button>登录</button><p>190******47</p>' + editor);
      assert.equal((await inspectAccountLogin(page, platform)).status, 'login_required');
      await page.setContent('<p>请完成安全验证</p>' + editor);
      assert.equal((await inspectAccountLogin(page, platform)).status, 'verification_required');
      await page.setContent('<button hidden>登录</button><p>190******47</p>' + editor);
      assert.equal((await inspectAccountLogin(page, platform)).status, 'valid', '隐藏登录控件不应误报');
    }
    await page.goto(url + 'security/doubao-region-ban');
    await page.setContent('<p>受区域限制</p>');
    assert.equal((await inspectAccountLogin(page, 'doubao')).status, 'unconfirmed');
    await page.goto(url);
    const doubaoEditor = '<div data-testid="chat_input_input"><div class="tiptap" contenteditable="true"></div></div>';
    await page.setContent('<p>用户123456</p>' + doubaoEditor);
    assert.equal((await inspectAccountLogin(page, 'doubao')).status, 'unconfirmed', '正文昵称不能当作账号控件');
    const nickname = '<div style="position:fixed;left:20px;bottom:20px">用户123456</div>';
    await page.setContent(nickname + '<div aria-busy="true">' + doubaoEditor + '</div>');
    assert.equal((await inspectAccountLogin(page, 'doubao')).status, 'unconfirmed', '输入框尚在加载时不提前确认');
    await page.setContent(nickname + '<div id="loading">加载中</div>');
    await page.evaluate(editor => setTimeout(() => { document.querySelector('#loading').outerHTML = editor; }, 13500), doubaoEditor);
    const slow = await waitForAccountLogin(page, 'doubao');
    assert.equal(slow.status, 'valid', '超过旧12秒期限的页面仍应继续等待');
    assert.ok(slow.elapsedMs >= 13500);
    markup = '<p>190******47</p><textarea></textarea>';
    const account = { platform: 'deepseek', id: 900, profile_key: 'test-900' };
    const pending = checkAccountLogin(account);
    assert.equal(accountBrowserBusy(account), true);
    await assert.rejects(checkAccountLogin(account), e => e.code === 'ACCOUNT_BUSY');
    assert.equal((await pending).status, 'valid');
    assert.equal(accountBrowserBusy(account), false);
    documentDelay = 2500;
    const lateNavigation = await checkAccountLogin({ ...account, id: 902, profile_key: 'test-902' }, { navigationTimeoutMs: 300 });
    assert.equal(lateNavigation.navigationTimedOut, true);
    assert.equal(lateNavigation.status, 'valid', '导航超时之后仍继续检查页面');
    documentDelay = 0;
    markup = '<p>加载中</p>';
    const stillLoading = await checkAccountLogin({ ...account, id: 903, profile_key: 'test-903' }, { timeoutMs: 1800 });
    assert.equal(stillLoading.status, 'unconfirmed');
    assert.match(stillLoading.reason, /等待达到上限/);
    assert.ok(stillLoading.elapsedMs >= 1800);
    markup = '<button>登录</button>';
    const login = await checkAccountLogin({ ...account, id: 901, profile_key: 'test-901' });
    assert.equal(login.status, 'login_required');
    assert.match(login.screenshot, /^\/account-check-screenshots\/account-901-\d+\.png$/);
    assert.ok(requests.every(method => method === 'GET'), '检查不得发送问答请求');
  } finally {
    await browser.close(); await closeBrowsers();
    for (const [id, url] of Object.entries(oldUrls)) PLATFORMS[id].url = url;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise(done => fixture.close(done));
  }
});
