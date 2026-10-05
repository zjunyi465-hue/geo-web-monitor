import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS, askBrowser, browserModeFor, closeBrowsers, openPlatformForLogin } from '../src/browser.js';
import { captureForeground } from '../src/window-control.js';

test('登录窗口可见，新账号自动问答不切换前台，登录失效或人工验证暂停',
  { skip: !process.env.GEO_WINDOW_TEST }, async () => {
    const fixture = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
        ...(!req.headers.cookie?.includes('geo_test_login=1') ?
          { 'Set-Cookie': 'geo_test_login=1; Max-Age=3600; Path=/' } : {}) });
      if (!req.headers.cookie?.includes('geo_test_login=1')) return res.end('<h1>请登录</h1><button>登录</button>');
      res.end('<meta charset="utf-8"><button id="new">新对话</button>' +
        '<div data-testid="chat_input_input"><div class="tiptap" contenteditable="true"></div></div>' +
        '<button data-testid="chat_input_send_button">发送</button>' +
        '<div data-testid="union_message"><div data-testid="receive_message">' +
        '<div data-testid="message_text_content"></div></div><div data-testid="message_action_bar" style="height:20px"></div></div>' +
        '<script>if(localStorage.getItem("challenge")) document.body.insertAdjacentHTML("beforeend","<div>请选择所有符合上述描述的图片</div>");' +
        'document.querySelector("#new").onclick=()=>document.querySelector("[data-testid=message_text_content]").textContent="";' +
        'document.querySelector("[data-testid=chat_input_send_button]").onclick=()=>{' +
        'const q=document.querySelector(".tiptap").innerText;' +
        'if(q==="退出"){document.cookie="geo_test_login=; Max-Age=0; Path=/";location.reload();return;}' +
        'if(q==="验证"){localStorage.setItem("challenge","1");document.body.insertAdjacentHTML("beforeend","<div>请选择所有符合上述描述的图片</div>")}' +
        'else {document.querySelector(".tiptap").innerText="";document.querySelector("[data-testid=message_text_content]").textContent="回答："+q}};</script>');
    });
    await new Promise(done => fixture.listen(0, '127.0.0.1', done));
    const root = await mkdtemp(join(tmpdir(), 'geo-window-test-'));
    const oldUrl = PLATFORMS.doubao.url;
    const oldProfile = process.env.GEO_PROFILE_ROOT;
    const oldResults = process.env.GEO_RESULTS_ROOT;
    const oldHeadless = process.env.GEO_HEADLESS;
    PLATFORMS.doubao.url = 'http://127.0.0.1:' + fixture.address().port;
    process.env.GEO_PROFILE_ROOT = join(root, 'profiles');
    process.env.GEO_RESULTS_ROOT = join(root, 'results');
    delete process.env.GEO_HEADLESS;
    const account = { platform: 'doubao', id: 71, profile_key: 'mode-test', label: '测试账号' };
    try {
      await openPlatformForLogin(account);
      assert.equal(browserModeFor('doubao', 71), 'visible');
      const foreground = await captureForeground();
      await askBrowser({ platform: 'doubao', account_id: 72, profile_key: 'background-test',
        question_id: 1, question: '后台测试' }, { runId: 1 }).catch(error => {
        // The fresh profile starts at the fixture login page: it should pause in the background.
        assert.equal(error.code, 'LOGIN_REQUIRED');
      });
      if (foreground !== '0') assert.equal(await captureForeground(), foreground,
        '自动启动另一个账号不应抢占前台');
      assert.equal(browserModeFor('doubao', 72), 'visible');
      const job = { platform: 'doubao', account_id: 71, profile_key: 'mode-test',
        question_id: 1, question: '测试问题' };
      const answer = await askBrowser(job, { runId: 1 });
      assert.match(answer.text, /回答：测试问题/);
      assert.equal(answer.diagnostics.editor.inViewport, true);
      assert.ok(answer.diagnostics.editor.viewport.height < answer.diagnostics.editor.window.height);
      assert.ok((await stat(answer.screenshot)).size > 0);
      assert.equal(browserModeFor('doubao', 71), 'visible');
      await assert.rejects(askBrowser({ ...job, question: '退出' }, { runId: 2 }),
        error => error.code === 'LOGIN_REQUIRED');
      assert.equal(browserModeFor('doubao', 71), 'visible');
      await assert.rejects(askBrowser({ ...job, question: '验证' }, { runId: 2 }),
        error => error.code === 'HUMAN_VERIFICATION_REQUIRED');
      assert.equal(browserModeFor('doubao', 71), 'visible');
    } finally {
      await closeBrowsers();
      PLATFORMS.doubao.url = oldUrl;
      if (oldProfile === undefined) delete process.env.GEO_PROFILE_ROOT;
      else process.env.GEO_PROFILE_ROOT = oldProfile;
      if (oldResults === undefined) delete process.env.GEO_RESULTS_ROOT;
      else process.env.GEO_RESULTS_ROOT = oldResults;
      if (oldHeadless === undefined) delete process.env.GEO_HEADLESS;
      else process.env.GEO_HEADLESS = oldHeadless;
      await new Promise(done => fixture.close(done));
    }
  });
