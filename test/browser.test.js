import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS, askBrowser, closeBrowsers, extractDeepSeekAnswer } from '../src/browser.js';

test('豆包只重试明确未提交的系统异常，已提交的问题不重复发送', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  let sends = 0;
  const fixture = http.createServer((req, res) => {
    if (req.url === '/send') { res.end(String(++sends)); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><button id="new">新对话</button><p id="welcome">有什么我能帮你的吗？</p>' +
      '<div data-testid="chat_input_input"><div class="tiptap" contenteditable="true" style="min-height:40px"></div></div><button data-testid="chat_input_send_button" id="send">发送</button>' +
      '<div data-testid="union_message"><div data-testid="receive_message"><div data-testid="message_text_content" id="answer"></div></div>' +
      '<div data-testid="message_action_bar" style="height:20px"></div></div><script>' +
      'document.querySelector("#new").onclick=()=>{};document.querySelector("#send").onclick=async()=>{' +
      'const editor=document.querySelector(".tiptap"),q=editor.innerText,n=await(await fetch("/send")).text();' +
      'if(q==="已提交异常"){editor.innerText="";document.querySelector("#welcome").remove();document.body.insertAdjacentHTML("beforeend","<div>系统异常</div>");return;}' +
      'if(n==="1"){document.body.insertAdjacentHTML("beforeend","<div>系统异常</div>");return;}' +
      'editor.innerText="";document.querySelector("#answer").textContent="回答："+q;};</script>');
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const oldUrl = PLATFORMS.doubao.url;
  const env = Object.fromEntries(['GEO_PROFILE_ROOT', 'GEO_RESULTS_ROOT', 'GEO_HEADLESS'].map(k => [k, process.env[k]]));
  const root = await mkdtemp(join(tmpdir(), 'geo-retry-test-'));
  PLATFORMS.doubao.url = 'http://127.0.0.1:' + fixture.address().port;
  process.env.GEO_PROFILE_ROOT = join(root, 'profiles');
  process.env.GEO_RESULTS_ROOT = join(root, 'results');
  process.env.GEO_HEADLESS = '1';
  try {
    const attempts = [];
    const job = { platform: 'doubao', question_id: 1, question: '重试测试' };
    const answer = await askBrowser(job, { runId: 1, onAttempt: a => attempts.push(a) });
    assert.match(answer.text, /回答：重试测试/);
    assert.equal(sends, 2);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].errorCode, 'PROVIDER_ERROR');
    assert.equal(attempts[0].diagnostics.automaticRetry, true);
    assert.equal(attempts[0].diagnostics.editor.questionRetained, true);
    assert.ok((await stat(attempts[0].screenshot)).size > 0);
    await assert.rejects(askBrowser({ ...job, question: '已提交异常' }, { runId: 1, onAttempt: a => attempts.push(a) }),
      error => error.code === 'PROVIDER_ERROR' && !error.safeToRetry);
    assert.equal(sends, 3);
    assert.equal(attempts.length, 1);
  } finally {
    await closeBrowsers();
    PLATFORMS.doubao.url = oldUrl;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise(done => fixture.close(done));
  }
});

test('DeepSeek 引用角标不混入正文，搜索结果标题与引用分别保存', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  const browser = await (await import('playwright')).chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<meta charset="utf-8"><div class="ds-markdown"><p>示例工具推荐' +
      '<a href="https://example.org/one"><span class="ds-markdown-cite"><span style="opacity:0">-</span><span style="position:absolute">1</span></span></a>。</p></div>' +
      '<button onclick="document.getElementById(\'panel\').style.display=\'block\'">搜索到 2 个网页</button>' +
      '<div id="panel" style="display:none"><a href="https://example.org/one"><span class="ds-markdown-cite">1</span><div class="search-view-card__title">示例工具介绍</div></a>' +
      '<a href="https://example.net/two"><span class="ds-markdown-cite">2</span><div class="search-view-card__title">其他网页</div></a></div>');
    const result = await extractDeepSeekAnswer(page, page.locator('.ds-markdown'));
    assert.equal(result.text, '示例工具推荐。');
    assert.deepEqual(result.citations, [{ url: 'https://example.org/one', title: '示例工具介绍', number: 1 }]);
    assert.equal(result.reportedSearchCount, 2);
    assert.equal(result.searchedSites.length, 2);
    assert.equal(result.searchedSites[1].title, '其他网页');
  } finally { await browser.close(); }
});

for (const platform of ['deepseek', 'doubao']) test(platform + '：输入区延迟替换后仍能发送、提取回答与引用并截图', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  const fixture = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8">' +
      '<button id="new">新对话</button><div data-testid="chat_input_input"><textarea></textarea></div><button data-testid="chat_input_send_button" aria-label="发送" id="send">发送</button>' +
      '<a href="https://sidebar.invalid/">侧栏不是来源</a><div data-testid="message_text_content">用户问题不能作为回答</div>' +
      (platform === 'doubao' ? '<div role="dialog" id="promo" style="position:fixed;inset:0;z-index:99;background:white">下载电脑版 使用完整功能 <button id="later">下次提醒我</button></div>' : '') +
      '<div data-testid="union_message"><div data-testid="receive_message"><div id="source-summary" style="cursor:pointer">搜索 1 个关键词，参考 2 篇资料</div><div id="sources" style="display:none"><a href="https://source1.example/">来源一</a><a href="https://source2.example/">来源二</a></div><div id="fixture-answer" data-testid="message_text_content" class="' + (platform === 'doubao' ? 'md-box-root' : 'ds-markdown') + '"></div></div><div data-testid="message_action_bar" style="height:20px"></div></div><script>' +
      'document.getElementById("source-summary").onclick=()=>document.getElementById("sources").style.display="block";' +
      (platform === 'doubao' ? 'document.getElementById("later").onclick=()=>document.getElementById("promo").remove();' : '') +
      'document.getElementById("new").onclick=()=>{document.querySelector("#fixture-answer").innerHTML="";' +
      'document.querySelector("textarea").disabled=true;setTimeout(()=>{const editor=document.createElement("div");editor.className="tiptap";editor.contentEditable="true";editor.style.minHeight="60px";document.querySelector("textarea").replaceWith(editor)},2200)};' +
      'let sendClicks=0;document.getElementById("send").onclick=()=>{const editor=document.querySelector("[contenteditable=true]");const q=editor.innerText;' +
      (platform === 'doubao' ? 'if(++sendClicks===1){document.body.insertAdjacentHTML("beforeend","<div role=\\"dialog\\" id=\\"promo-again\\" style=\\"position:fixed;inset:0;z-index:99;background:white\\">下载电脑版 使用完整功能 <button onclick=\\"this.parentElement.remove()\\">下次提醒我</button></div>");return;}' : '') +
      'if(q==="验证"){document.body.insertAdjacentHTML("beforeend","<div>请选择所有符合上述描述的图片，并拖拽到下方</div>");return;}' +
      'if(q==="区域"){location.href="/security/doubao-region-ban?source=1";return;}' +
      'if(q==="异常"){document.body.insertAdjacentHTML("beforeend","<div>系统异常</div>");return;}' +
      'editor.innerText="";' +
      'setTimeout(()=>document.querySelector("#fixture-answer").innerHTML=' +
      '"回答："+q+" <a href=\\"https://example.org/evidence\\">证据页</a>",400)};' +
      '</script>');
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const originalUrl = PLATFORMS[platform].url;
  const originalProfile = process.env.GEO_PROFILE_ROOT;
  const originalResults = process.env.GEO_RESULTS_ROOT;
  const originalHeadless = process.env.GEO_HEADLESS;
  const root = await mkdtemp(join(tmpdir(), 'geo-browser-test-'));
  PLATFORMS[platform].url = 'http://127.0.0.1:' + fixture.address().port;
  process.env.GEO_PROFILE_ROOT = join(root, 'profiles');
  process.env.GEO_RESULTS_ROOT = join(root, 'results');
  process.env.GEO_HEADLESS = '1';
  try {
    const answer = await askBrowser({ question_id: 7, question: '测试问题', platform }, { runId: 3 });
    assert.match(answer.text, /回答：测试问题/);
    assert.deepEqual(answer.citations, platform === 'doubao' ? [
      { title: '来源一', url: 'https://source1.example/' },
      { title: '来源二', url: 'https://source2.example/' },
      { title: '证据页', url: 'https://example.org/evidence' },
    ] : [{ title: '证据页', url: 'https://example.org/evidence' }]);
    assert.equal(answer.captureMethod, 'web_ui');
    if (platform === 'doubao') assert.equal(answer.reportedCitationCount, 2);
    assert.ok((await stat(answer.screenshot)).size > 0);
    if (platform === 'doubao') {
      const retried = await askBrowser({ question_id: 7, question: '测试问题', platform }, { runId: 3 });
      assert.notEqual(retried.screenshot, answer.screenshot);
      assert.ok((await stat(answer.screenshot)).size > 0);
      assert.ok((await stat(retried.screenshot)).size > 0);
    }
    const second = await askBrowser({ question_id: 7, question: '测试问题', platform,
      account_id: 42, profile_key: 'separate-profile' }, { runId: 3 });
    assert.match(second.text, /回答：测试问题/);
    assert.notEqual(second.screenshot, answer.screenshot);
    assert.ok((await stat(second.screenshot)).size > 0);
    if (platform === 'doubao') await assert.rejects(
      askBrowser({ question_id: 9, question: '区域', platform }, { runId: 3 }),
      error => error.code === 'REGION_RESTRICTED' && /受区域限制/.test(error.message));
    if (platform === 'doubao') await assert.rejects(
      askBrowser({ question_id: 10, question: '异常', platform }, { runId: 3 }),
      error => error.code === 'PROVIDER_ERROR' && /系统异常/.test(error.message));
    await assert.rejects(askBrowser({ question_id: 8, question: '验证', platform }, { runId: 3 }), error => {
      assert.equal(error.code, 'HUMAN_VERIFICATION_REQUIRED');
      assert.match(error.message, /人工验证/);
      return true;
    });
  } finally {
    await closeBrowsers();
    PLATFORMS[platform].url = originalUrl;
    if (originalProfile === undefined) delete process.env.GEO_PROFILE_ROOT;
    else process.env.GEO_PROFILE_ROOT = originalProfile;
    if (originalResults === undefined) delete process.env.GEO_RESULTS_ROOT;
    else process.env.GEO_RESULTS_ROOT = originalResults;
    if (originalHeadless === undefined) delete process.env.GEO_HEADLESS;
    else process.env.GEO_HEADLESS = originalHeadless;
    await new Promise(done => fixture.close(done));
  }
});
