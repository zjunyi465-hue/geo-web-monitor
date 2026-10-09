import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS, askBrowser, closeBrowsers } from '../src/browser.js';

test('关闭采集浏览器会明确失败，新会话重试仍可重新发送并采集', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  let sends = 0;
  const fixture = http.createServer((req, res) => {
    if (req.url === '/send') { sends++; res.end('ok'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<button>新对话</button><div data-testid="chat_input_input"><div class="tiptap" contenteditable="true" style="min-height:40px"></div></div>' +
      '<button data-testid="chat_input_send_button">发送</button><div data-testid="union_message"><div data-testid="receive_message"><div data-testid="message_text_content" id="answer"></div></div><div data-testid="message_action_bar" style="height:20px"></div></div>' +
      '<script>document.querySelector("[data-testid=chat_input_send_button]").onclick=async()=>{await fetch("/send");document.querySelector(".tiptap").innerText="";document.querySelector("#answer").textContent="演示回答";};</script>');
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const oldUrl = PLATFORMS.doubao.url;
  const env = Object.fromEntries(['GEO_HEADLESS', 'GEO_PROFILE_ROOT', 'GEO_RESULTS_ROOT'].map(key => [key, process.env[key]]));
  const root = await mkdtemp(join(tmpdir(), 'geo-fresh-retry-'));
  process.env.GEO_HEADLESS = '1'; process.env.GEO_PROFILE_ROOT = join(root, 'profiles'); process.env.GEO_RESULTS_ROOT = join(root, 'results');
  PLATFORMS.doubao.url = `http://127.0.0.1:${fixture.address().port}/`;
  const job = { platform: 'doubao', account_id: 1, question_id: 1, question: '演示问题' };
  try {
    await assert.rejects(askBrowser(job, { runId: 1, onCheckpoint: () => closeBrowsers() }),
      error => error.code === 'BROWSER_CLOSED' && /最小化/.test(error.message));
    assert.equal(sends, 0);
    const answer = await askBrowser({ ...job, retryMode: 'fresh' }, { runId: 1 });
    assert.equal(answer.text, '演示回答'); assert.equal(sends, 1);
    assert.equal(answer.diagnostics.retryMode, 'fresh');
  } finally {
    await closeBrowsers(); PLATFORMS.doubao.url = oldUrl;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fixture.closeAllConnections(); await new Promise(done => fixture.close(done));
  }
});
