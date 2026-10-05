import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PLATFORMS, askBrowser, closeBrowsers, readAnswer, assertOriginalAnswer } from '../src/browser.js';

test('人工验证和重启后恢复原回答，不重复发送；问题不匹配时停止并保留地址', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  let verified = false, sends = 0, navigations = 0, wrongQuestion = false, followup = false;
  const fixture = http.createServer((req, res) => {
    if (req.url === '/send') { sends++; res.end('ok'); return; }
    if (req.url === '/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ verified })); return; }
    if (!['/', '/chat/original'].includes(req.url)) { res.end(); return; }
    navigations++;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/chat/original') {
      res.end('<p>' + (wrongQuestion ? '别的问题' : '测试验证') + '</p><div data-testid="union_message"><div data-testid="receive_message">' +
        '<div data-testid="message_text_content">原问题回答 <a href="https://example.org/evidence">参考资料</a></div></div>' +
        '<div data-testid="message_action_bar" style="height:20px"></div></div>' +
        (followup ? '<p>追加示例问题</p><div data-testid="receive_message"><div data-testid="message_text_content">追加问题回答</div></div>' : '')); return;
    }
    res.end('<button>新对话</button><div data-testid="chat_input_input"><div class="tiptap" contenteditable="true" style="min-height:40px"></div></div>' +
      '<button data-testid="chat_input_send_button">发送</button><div data-testid="union_message"><div data-testid="receive_message">' +
      '<div data-testid="message_text_content" id="answer"></div></div><div data-testid="message_action_bar" style="height:20px"></div></div>' +
      '<script>let pending=false;document.querySelector("[data-testid=chat_input_send_button]").onclick=async()=>{' +
      'await fetch("/send");history.pushState({},"","/chat/original");pending=true;document.querySelector("[data-testid=union_message]").insertAdjacentHTML("beforebegin","<p>测试验证</p>");document.body.insertAdjacentHTML("beforeend","<div id=challenge>请选择所有符合上述描述的图片</div>");};' +
      'setInterval(async()=>{const s=await(await fetch("/state")).json();' +
      'if(pending&&s.verified){pending=false;document.querySelector("#challenge").remove();document.querySelector(".tiptap").innerText="";' +
      'document.querySelector("#answer").textContent="原问题回答";const a=document.createElement("a");a.href="https://example.org/evidence";a.textContent="参考资料";document.querySelector("#answer").append(" ",a);}},200);</script>');
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const oldUrl = PLATFORMS.doubao.url;
  const env = Object.fromEntries(['GEO_PROFILE_ROOT', 'GEO_RESULTS_ROOT', 'GEO_HEADLESS'].map(k => [k, process.env[k]]));
  const root = await mkdtemp(join(tmpdir(), 'geo-resume-test-'));
  PLATFORMS.doubao.url = 'http://127.0.0.1:' + fixture.address().port;
  process.env.GEO_PROFILE_ROOT = join(root, 'profiles');
  process.env.GEO_RESULTS_ROOT = join(root, 'results');
  process.env.GEO_HEADLESS = '1';
  try {
    let checkpoint, persisted;
    const job = { platform: 'doubao', account_id: 91, question_id: 1, question: '测试验证' };
    await assert.rejects(askBrowser(job, { runId: 1, onCheckpoint: state => { persisted = state; } }), error => {
      checkpoint = error.diagnostics.resumeState;
      return error.code === 'HUMAN_VERIFICATION_REQUIRED' && checkpoint.mayHaveSubmitted;
    });
    assert.equal(persisted.mayHaveSubmitted, true);
    assert.equal(persisted.pageUrl, checkpoint.pageUrl);
    verified = true;
    await new Promise(done => setTimeout(done, 800));
    const answer = await askBrowser({ ...job, resumeState: checkpoint }, { runId: 1 });
    assert.equal(answer.text, '原问题回答 参考资料');
    assert.equal(answer.citations.length, 1);
    assert.equal(answer.diagnostics.resumedOriginal, true);
    assert.equal(sends, 1);
    assert.equal(navigations, 1);
    await closeBrowsers();
    const restored = await askBrowser({ ...job, resumeState: persisted }, { runId: 1 });
    assert.equal(restored.text, '原问题回答 参考资料');
    assert.equal(sends, 1);
    assert.equal(navigations, 2);
    await closeBrowsers();
    followup = true;
    await assert.rejects(askBrowser({ ...job, resumeState: persisted }, { runId: 1 }),
      error => error.code === 'RESUME_CONTEXT_LOST');
    assert.equal(sends, 1);
    await closeBrowsers();
    followup = false;
    wrongQuestion = true;
    await assert.rejects(askBrowser({ ...job, resumeState: checkpoint }, { runId: 1 }), error =>
      error.code === 'RESUME_CONTEXT_LOST' && error.diagnostics.resumeState.pageUrl === checkpoint.pageUrl);
    assert.equal(sends, 1);
  } finally {
    await closeBrowsers(); PLATFORMS.doubao.url = oldUrl;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fixture.closeAllConnections();
    await new Promise(done => fixture.close(done));
  }
});

for (const platform of ['doubao', 'deepseek']) test(platform + '：恢复拒绝已回答和未回答的追加问题，以及重复的原问题',
  { skip: !process.env.GEO_BROWSER_TEST }, async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const answer = platform === 'doubao'
      ? '<div data-testid="receive_message"><div data-testid="message_text_content">示例回答</div></div>'
      : '<div class="ds-markdown">示例回答</div>';
    try {
      const page = await browser.newPage();
      await page.setContent('<p>示例问题</p>' + answer + '<textarea></textarea>');
      await assertOriginalAnswer(page, platform, '示例问题');
      for (const tail of ['<p>另一个问题</p>', '<p>另一个问题</p>' + answer, '<p>示例问题</p>' + answer]) {
        await page.setContent('<p>示例问题</p>' + answer + tail + '<textarea></textarea>');
        await assert.rejects(assertOriginalAnswer(page, platform, '示例问题'), error => error.code === 'RESUME_CONTEXT_LOST');
      }
      await page.setContent('<p>示例问题</p><p>另一个问题</p>' + answer);
      await assert.rejects(assertOriginalAnswer(page, platform, '示例问题'), error => error.code === 'RESUME_CONTEXT_LOST');
    } finally { await browser.close(); }
  });

test('发送前保存检查点，保存失败时不点击发送', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  let sends = 0;
  const fixture = http.createServer((req, res) => {
    if (req.url === '/send') { sends++; res.end('ok'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<button>新对话</button><div data-testid="chat_input_input"><div class="tiptap" contenteditable="true" style="min-height:40px"></div></div>' +
      '<button data-testid="chat_input_send_button" onclick="fetch(\'/send\')">发送</button>');
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const oldUrl = PLATFORMS.doubao.url;
  const env = Object.fromEntries(['GEO_PROFILE_ROOT', 'GEO_RESULTS_ROOT', 'GEO_HEADLESS'].map(k => [k, process.env[k]]));
  const root = await mkdtemp(join(tmpdir(), 'geo-checkpoint-browser-'));
  PLATFORMS.doubao.url = 'http://127.0.0.1:' + fixture.address().port;
  process.env.GEO_PROFILE_ROOT = join(root, 'profiles');
  process.env.GEO_RESULTS_ROOT = join(root, 'results');
  process.env.GEO_HEADLESS = '1';
  let saved;
  try {
    await assert.rejects(askBrowser({ platform: 'doubao', account_id: 19, question_id: 1, question: '示例问题' }, {
      runId: 1, onCheckpoint: state => {
        saved = state;
        assert.equal(sends, 0);
        throw new Error('模拟保存失败');
      },
    }), /模拟保存失败/);
    assert.equal(saved.mayHaveSubmitted, true);
    assert.equal(saved.pageUrl, PLATFORMS.doubao.url + '/');
    assert.equal(sends, 0);
    const originalUrl = 'https://example.org/chat/demo';
    await assert.rejects(askBrowser({ platform: 'doubao', account_id: 19, question_id: 1, question: '示例问题',
      resumeState: { mayHaveSubmitted: true, pageUrl: originalUrl } }, {
      runId: 1, onCheckpoint: state => { saved = state; },
    }), error => error.code === 'RESUME_CONTEXT_LOST' && error.diagnostics.resumeState.pageUrl === originalUrl);
    assert.equal(saved.pageUrl, originalUrl, '错误页面不能覆盖原对话恢复地址');
    assert.equal(sends, 0);
  } finally {
    await closeBrowsers(); PLATFORMS.doubao.url = oldUrl;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise(done => fixture.close(done));
  }
});

test('账号心跳失败不提前终止，较晚出现的回答仍能成功采集', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div data-testid="union_message"><div data-testid="receive_message"><div data-testid="message_text_content" id="answer"></div></div>' +
      '<div data-testid="message_action_bar" style="height:20px"></div></div><script>setTimeout(()=>document.getElementById("answer").textContent="延迟回答",18000)</script>');
    const answer = await readAnswer(page, 'doubao', '', ['net::ERR_FAILED', 'net::ERR_FAILED']);
    assert.equal(answer.text, '延迟回答');
  } finally { await browser.close(); }
});
