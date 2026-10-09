import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

test('关闭GEO前端网页后，后台问答仍完成并保存结果', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  let sends = 0;
  const provider = http.createServer((req, res) => {
    if (req.url === '/send') { sends++; res.end('ok'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<button>新对话</button><div data-testid="chat_input_input"><div class="tiptap" contenteditable="true" style="min-height:40px"></div></div>' +
      '<button data-testid="chat_input_send_button">发送</button><div data-testid="union_message"><div data-testid="receive_message"><div data-testid="message_text_content" id="answer"></div></div><div data-testid="message_action_bar" style="height:20px"></div></div>' +
      '<script>document.querySelector("[data-testid=chat_input_send_button]").onclick=async()=>{await fetch("/send");document.querySelector(".tiptap").innerText="";setTimeout(()=>document.querySelector("#answer").textContent="演示品牌回答",1000);};</script>');
  });
  await new Promise(done => provider.listen(0, '127.0.0.1', done));
  const listener = net.createServer();
  await new Promise(done => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const root = await mkdtemp(join(tmpdir(), 'geo-frontend-lifetime-'));
  const base = `http://127.0.0.1:${port}`;
  const providerUrl = `http://127.0.0.1:${provider.address().port}/`;
  const code = `import {PLATFORMS} from './src/browser.js'; PLATFORMS.doubao.url=${JSON.stringify(providerUrl)}; await import('./src/server.js');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: resolve('.'), env: { ...process.env, GEO_PORT: String(port), GEO_HEADLESS: '1',
      GEO_DB_PATH: join(root, 'test.db'), GEO_PROFILE_ROOT: join(root, 'profiles'), GEO_RESULTS_ROOT: join(root, 'results') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cookie;
  let browser;
  async function call(path, payload) {
    const response = await fetch(base + path, { method: payload ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: payload ? JSON.stringify(payload) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    assert.ok(response.ok, path + ' ' + response.status);
    return response.json();
  }
  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch(base + '/api/bootstrap'); break; } catch {}
      await new Promise(done => setTimeout(done, 100));
    }
    await call('/api/setup', { username: 'demo-admin', password: 'sample-password-123' });
    const { brand } = await call('/api/brands', { name: '演示品牌', category: '演示工具' });
    await call(`/api/brands/${brand.id}/questions`, { questions: [{ text: '演示问题', kind: 'discovery' }] });
    const { questions } = await call(`/api/brands/${brand.id}/questions`);
    const { accounts } = await call('/api/platform-accounts');
    const { task } = await call('/api/tasks', { brandId: brand.id, name: '关闭前端测试', accountIds: [accounts.find(a => a.platform === 'doubao').id], questionIds: [questions[0].id], scheduleType: 'manual' });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    await context.addCookies([{ name: 'geo_session', value: cookie.slice(cookie.indexOf('=') + 1), url: base }]);
    const page = await context.newPage(); await page.goto(base);
    const { run } = await page.evaluate(async id => (await fetch(`/api/tasks/${id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json(), task.id);
    assert.equal(run.status, 'running');
    await page.close();
    let detail;
    for (let i = 0; i < 200; i++) {
      detail = await call(`/api/runs/${run.id}`);
      if (detail.run.status !== 'running') break;
      await new Promise(done => setTimeout(done, 200));
    }
    assert.equal(detail.run.status, 'completed');
    assert.equal(detail.results[0].answer, '演示品牌回答');
    assert.equal(sends, 1);
  } finally {
    if (browser) await browser.close();
    child.kill();
    await new Promise(done => { if (child.exitCode !== null) done(); else child.once('exit', done); });
    provider.closeAllConnections(); await new Promise(done => provider.close(done));
  }
});
