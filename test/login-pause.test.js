import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS, askBrowser, closeBrowsers } from '../src/browser.js';

test('区域页登录和手机号登录优先暂停，纯区域限制仍失败', { skip: !process.env.GEO_BROWSER_TEST }, async () => {
  let mode = 'login';
  const fixture = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<p>受区域限制</p>' + (mode === 'login' ? '<button hidden>登录</button><button>登录</button>'
      : mode === 'phone' ? '<input hidden type="tel"><input type="tel" placeholder="手机号"><button>发送验证码</button>' : ''));
  });
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const savedUrl = PLATFORMS.doubao.url;
  const keys = ['GEO_HEADLESS', 'GEO_PROFILE_ROOT', 'GEO_RESULTS_ROOT'];
  const savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const root = await mkdtemp(join(tmpdir(), 'geo-login-pause-'));
  process.env.GEO_HEADLESS = '1';
  process.env.GEO_PROFILE_ROOT = join(root, 'profiles');
  process.env.GEO_RESULTS_ROOT = join(root, 'results');
  PLATFORMS.doubao.url = `http://127.0.0.1:${fixture.address().port}/security/doubao-region-ban`;
  try {
    for (mode of ['login', 'phone', 'region']) {
      const started = Date.now();
      await assert.rejects(askBrowser({ platform: 'doubao', question_id: 1, question: '演示问题' }, { runId: 1 }),
        error => error.code === (mode === 'region' ? 'REGION_RESTRICTED' : 'LOGIN_REQUIRED'));
      assert.ok(Date.now() - started < 30000, '暂停不应等到输入框超时');
    }
  } finally {
    await closeBrowsers();
    PLATFORMS.doubao.url = savedUrl;
    for (const key of keys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
    await new Promise(done => fixture.close(done));
  }
});
