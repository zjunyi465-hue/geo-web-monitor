import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { captureForeground, placeBrowserWindow } from './window-control.js';

// UI selectors are intentionally isolated here. They require verification with
// an actual logged-in account and will need updates when a provider changes UI.
export const PLATFORMS = {
  deepseek: {
    label: '平台 B',
    url: 'https://chat.deepseek.com/',
    input: ['textarea', '[contenteditable="true"]'],
    newChat: ['button:has-text("新对话")', 'button:has-text("New chat")', 'text=开启新对话'],
    answer: ['.ds-markdown', '[class*="markdown"]'],
    send: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]'],
  },
  doubao: {
    label: '平台 A',
    url: 'https://www.doubao.com/chat/',
    input: ['[data-testid="chat_input_input"] .tiptap[contenteditable="true"]'],
    newChat: ['button:has-text("新对话")', 'button:has-text("开启新对话")', 'text=新对话'],
    answer: ['[data-testid="receive_message"] [data-testid="message_text_content"]'],
    completed: '[data-testid="union_message"]:has([data-testid="receive_message"]) [data-testid="message_action_bar"]',
    send: ['button[data-testid="chat_input_send_button"]'],
  },
};

const contexts = new Map();
const launches = new Map();
const locks = new Map();

async function contextFor(platform, accountId = 0, profileKey = 'legacy-' + platform) {
  if (!PLATFORMS[platform]) throw new Error('不支持的平台：' + platform);
  const key = platform + ':' + accountId;
  const headless = process.env.GEO_HEADLESS === '1';
  if (launches.has(key)) await launches.get(key);
  const current = contexts.get(key);
  if (current?.headless === headless) return current.context;
  let storageState = null;
  if (current) {
    storageState = await current.context.storageState();
    contexts.delete(key);
    await current.context.close();
  }
  const pending = launchContext(platform, accountId, profileKey, key, headless, storageState);
  launches.set(key, pending);
  try { return await pending; }
  finally { launches.delete(key); }
}

async function launchContext(platform, accountId, profileKey, key, headless, storageState) {
  const profileName = profileKey === 'legacy-' + platform ? platform : platform + '-account-' + accountId;
  const profile = resolve(process.env.GEO_PROFILE_ROOT || 'profiles', profileName);
  await mkdir(profile, { recursive: true });
  const foreground = headless ? '0' : await captureForeground();
  const context = await chromium.launchPersistentContext(profile, {
    channel: process.env.GEO_BROWSER_CHANNEL || 'msedge',
    headless,
    viewport: headless ? { width: 1440, height: 950 } : null,
    args: headless ? [] : ['--start-minimized', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
    locale: 'zh-CN',
  });
  if (!headless) {
    try { await placeBrowserWindow(context, 'background', foreground); }
    catch (error) { await context.close(); throw new Error('无法设置监测浏览器后台窗口：' + error.message); }
  }
  if (storageState?.cookies.length) await context.addCookies(storageState.cookies);
  if (storageState?.origins.length) {
    await context.addInitScript(({ origins }) => {
      const saved = origins.find(item => item.origin === location.origin);
      if (!saved) return;
      for (const entry of saved.localStorage) localStorage.setItem(entry.name, entry.value);
    }, { origins: storageState.origins });
  }
  const entry = { context, headless };
  contexts.set(key, entry);
  context.on('close', () => { if (contexts.get(key) === entry) contexts.delete(key); });
  return context;
}

export function browserModeFor(platform, accountId = 0) {
  const entry = contexts.get(platform + ':' + accountId);
  return entry ? (entry.headless ? 'headless' : 'visible') : null;
}

async function withAccountLock(key, action) {
  const prior = locks.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  locks.set(key, prior.then(() => gate));
  await prior;
  try { return await action(); }
  finally { release(); }
}

async function showAttentionWindow(job, url) {
  if (process.env.GEO_HEADLESS === '1') return;
  const context = await contextFor(job.platform, job.account_id || 0,
    job.profile_key || 'legacy-' + job.platform);
  const page = context.pages().find(candidate => !candidate.isClosed()) || await context.newPage();
  if (page.url() === 'about:blank') {
    await page.goto(url && /^https?:/.test(url) ? url : PLATFORMS[job.platform].url,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
  }
  // Leave the account window available in the taskbar without taking focus.
}

export async function openPlatformForLogin(account) {
  const { platform, id, profile_key } = account;
  return withAccountLock(platform + ':' + id, async () => {
    const context = await contextFor(platform, id, profile_key);
    const page = context.pages().find(candidate => !candidate.isClosed()) || await context.newPage();
    let navigationWarning = '';
    try {
      await page.goto(PLATFORMS[platform].url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (error) {
      if (!/Timeout|ERR_TIMED_OUT|ERR_CONNECTION|ERR_FAILED/.test(String(error))) throw error;
      navigationWarning = ' 网页暂未加载成功，请在浏览器中检查网络后刷新。';
    }
    await page.bringToFront();
    if (process.env.GEO_HEADLESS !== '1') await placeBrowserWindow(context, 'foreground');
    return { platform, accountId: id, navigationWarning: Boolean(navigationWarning),
      message: '已打开“' + account.label + '”的专用浏览器。请在此窗口手动登录；后续监测窗口会在后台打开，需要时可从任务栏查看。' + navigationWarning };
  });
}

async function firstVisible(page, selectors, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const candidates = page.locator(selector);
      const count = await candidates.count().catch(() => 0);
      for (let index = count - 1; index >= 0; index--) {
        const item = candidates.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function waitForAnswer(page, selectors, beforeText, timeout = 120000, completedSelector, authFailures = [], onPoll = () => {}) {
  const deadline = Date.now() + timeout;
  let last = '';
  let stable = 0;
  while (Date.now() < deadline) {
    await checkPlatformRestriction(page);
    await checkLoginRequired(page);
    await checkHumanVerification(page);
    await checkProviderError(page);
    await onPoll();
    const answer = await firstVisible(page, selectors, 1000);
    const text = answer ? (await answer.innerText().catch(() => '')).trim() : '';
    if (text && text !== beforeText && text === last) stable++;
    else stable = 0;
    last = text;
    const stops = await page.getByRole('button', { name: /停止生成|停止回答|Stop generating|Stop response/i }).all();
    const stillGenerating = (await Promise.all(stops.map(button => button.isVisible()))).some(Boolean);
    const completion = completedSelector ? page.locator(completedSelector).last() : null;
    const completed = !completion || (await completion.count() > 0 && await completion.evaluate(node => {
      const style = getComputedStyle(node);
      return Number(style.opacity) > 0 && style.pointerEvents !== 'none' && node.getBoundingClientRect().height > 0;
    }).catch(() => false));
    if (stable >= 7 && text && !stillGenerating && completed) return answer;
    await page.waitForTimeout(1200);
  }
  const error = new Error('等待网页回答超时；请检查登录状态或页面定位规则' +
    (authFailures.length >= 2 ? '。期间账号校验请求出现异常，已保留诊断信息' : ''));
  error.code = 'ANSWER_TIMEOUT';
  throw error;
}

export async function readAnswer(page, platform, beforeText = '', authFailures = [], onPoll = () => {}) {
  const config = PLATFORMS[platform];
  const answer = await waitForAnswer(page, config.answer, beforeText, 120000, config.completed, authFailures, onPoll);
  await onPoll();
  if (platform === 'deepseek') return extractDeepSeekAnswer(page, answer);
  const text = (await answer.innerText()).trim();
  let reportedCitationCount = null;
  const assistantMessage = platform === 'doubao'
    ? answer.locator('xpath=ancestor::*[@data-testid="receive_message"][1]')
    : answer;
  if (platform === 'doubao') {
    const summary = assistantMessage.getByText(/搜索\s*\d+\s*个关键词，参考\s*\d+\s*篇资料/).first();
    if (await summary.count()) {
      reportedCitationCount = Number((await summary.innerText()).match(/参考\s*(\d+)\s*篇资料/)?.[1] || 0);
      await summary.click();
      if (reportedCitationCount > 0) {
        await page.waitForFunction(() => {
          const message = [...document.querySelectorAll('[data-testid="receive_message"]')].at(-1);
          return message?.querySelector('a[href]') !== null;
        }, null, { timeout: 5000 }).catch(() => {});
      }
    }
  }
  const links = await assistantMessage.locator('a[href]').evaluateAll(nodes =>
    nodes.filter(node => node.getClientRects().length > 0)
      .map(node => ({ title: (node.textContent || '').trim(), url: node.href }))
      .filter(item => /^https?:/.test(item.url)));
  return { text, citations: [...new Map(links.map(item => [item.url, item])).values()], reportedCitationCount };
}

export async function extractDeepSeekAnswer(page, answer) {
  const { text, cited } = await answer.evaluate(node => {
    const cited = [...node.querySelectorAll('a[href]')].filter(a => a.getClientRects().length > 0)
      .map(a => ({ url: a.href, number: Number((a.querySelector('.ds-markdown-cite')?.textContent || '').match(/\d+/)?.[0]) || null,
        label: a.querySelector('.ds-markdown-cite') ? '' : a.innerText.trim() }));
    const hidden = [...node.querySelectorAll('a[href]')].filter(a => a.querySelector('.ds-markdown-cite'))
      .map(a => [a, a.style.display]);
    for (const [a] of hidden) a.style.display = 'none';
    const text = node.innerText.trim();
    for (const [a, display] of hidden) a.style.display = display;
    return { text, cited };
  });
  const searchSummary = page.getByText(/搜索到\s*\d+\s*个网页/).last();
  let reportedSearchCount = null;
  let searchedSites = [];
  if (await searchSummary.isVisible().catch(() => false)) {
    reportedSearchCount = Number((await searchSummary.innerText()).match(/搜索到\s*(\d+)\s*个网页/)?.[1]) || null;
    const searchCards = page.locator('a[href]:has(.search-view-card__title)');
    if (!await searchCards.first().isVisible().catch(() => false)) await searchSummary.click().catch(() => {});
    if (reportedSearchCount) {
      await page.waitForFunction(expected =>
        [...document.querySelectorAll('a[href]:has(.search-view-card__title)')]
          .filter(a => a.getClientRects().length > 0).length >= expected,
      reportedSearchCount, { timeout: 5000 }).catch(() => {});
    }
    searchedSites = await searchCards.evaluateAll(nodes =>
      nodes.filter(a => a.getClientRects().length > 0).map(a => ({
        url: a.href,
        title: (a.querySelector('.search-view-card__title')?.textContent || '').trim(),
        number: Number((a.querySelector('.ds-markdown-cite')?.textContent || '').match(/\d+/)?.[0]) || null,
      })).filter(item => /^https?:/.test(item.url)));
  }
  const byUrl = new Map(searchedSites.map(site => [site.url, site]));
  const citations = [...new Map(cited.filter(item => /^https?:/.test(item.url)).map(item => {
    const site = byUrl.get(item.url);
    return [item.url, { url: item.url, title: site?.title || item.label || ('来源 ' + (item.number || '链接')),
      ...(item.number ? { number: item.number } : {}) }];
  })).values()];
  return { text, citations, searchedSites, reportedSearchCount, reportedCitationCount: null };
}

async function checkHumanVerification(page) {
  for (const frame of page.frames()) {
    const prompts = frame.getByText(/请选择所有符合上述描述的图片|拖拽到这里|请完成安全验证|请完成验证后继续/);
    for (const prompt of await prompts.all().catch(() => [])) {
      if (await prompt.isVisible().catch(() => false)) {
        const error = new Error('平台要求人工验证，任务已暂停，不会等待超时。请从任务栏打开对应浏览器，完成验证后点击“处理后继续运行”。');
        error.code = 'HUMAN_VERIFICATION_REQUIRED';
        throw error;
      }
    }
  }
}

async function checkLoginRequired(page) {
  const loginPage = /\/(login|signin|sign-in)(\/|\?|$)/i.test(page.url());
  const passwordField = await page.locator('input[type="password"]').filter({ visible: true }).first().isVisible().catch(() => false);
  const phoneOrCodeField = await page.locator('input[type="tel"],input[autocomplete="one-time-code"],input[placeholder*="手机号"],input[placeholder*="验证码"]').filter({ visible: true }).first().isVisible().catch(() => false);
  const loginPrompt = await page.getByRole('button', { name: /^(登录|立即登录|注册登录|登录注册|Sign in|Log in)$/i })
    .filter({ visible: true }).first().isVisible().catch(() => false);
  if (loginPage || passwordField || phoneOrCodeField || loginPrompt) {
    const error = new Error('平台账号需要登录，任务已暂停，不会等待超时。请从任务栏打开对应浏览器，完成登录后在结果页点击“处理后继续运行”。');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }
}

async function checkPlatformRestriction(page) {
  await checkLoginRequired(page);
  if (/\/security\/doubao-region-ban(?:[/?#]|$)/i.test(page.url())) {
    const error = new Error('豆包网页提示“受区域限制”，无法完成当前问答。请检查该账号在当前网络环境下能否正常使用网页版豆包。');
    error.code = 'REGION_RESTRICTED';
    throw error;
  }
}

async function checkProviderError(page) {
  const message = page.getByText('系统异常', { exact: true }).first();
  if (await message.isVisible().catch(() => false)) {
    const error = new Error('豆包网页提交问题后提示“系统异常”，未返回回答；请检查网络环境或稍后重试。');
    error.code = 'PROVIDER_ERROR';
    throw error;
  }
}

async function dismissNonBlockingDialogs(page) {
  for (const dialog of await page.getByRole('dialog').all()) {
    const visible = await dialog.isVisible().catch(() => false);
    if (!visible || !/下载电脑版|使用完整功能/.test(await dialog.innerText().catch(() => ''))) continue;
    const later = dialog.getByText('下次提醒我', { exact: true }).first();
    if (await later.isVisible().catch(() => false)) {
      await later.click({ timeout: 3000 });
      await dialog.waitFor({ state: 'hidden', timeout: 5000 });
      return true;
    }
  }
  return false;
}

async function submitQuestion(page, config, input, question, onSubmissionAttempt = () => {}) {
  let clicked = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissNonBlockingDialogs(page);
    const send = await firstVisible(page, config.send, 1200);
    if (send) {
      const enabledUntil = Date.now() + 12000;
      while (!await send.isEnabled().catch(() => false) && Date.now() < enabledUntil) {
        await checkLoginRequired(page);
        await checkHumanVerification(page);
        await checkProviderError(page);
        await page.waitForTimeout(300);
      }
      if (!await send.isEnabled().catch(() => false)) {
        if (clicked) return; // The provider can disable send while the submitted question is processing.
        await input.fill('');
        await input.fill(question);
        await page.waitForTimeout(1000);
        if (!await send.isEnabled().catch(() => false)) {
          throw new Error('发送按钮长时间不可用：问题仍在输入框，请检查豆包页面是否加载完成');
        }
      }
      try { await onSubmissionAttempt(); await send.click({ timeout: 5000 }); clicked = true; }
      catch (error) {
        if (!await dismissNonBlockingDialogs(page)) throw error;
        continue;
      }
    } else { await onSubmissionAttempt(); await input.press('Enter'); }
    // Some providers accept the click only to open a promotional dialog. The
    // editor clearing is the observable proof that the question was submitted.
    await page.waitForFunction(({ selector, value }) => {
      const editor = document.querySelector(selector);
      return !editor || ('value' in editor ? editor.value : editor.innerText).trim() !== value;
    }, { selector: config.input[0], value: question.trim() }, { timeout: 3500 }).catch(() => {});
    await checkHumanVerification(page);
    await checkLoginRequired(page);
    await checkProviderError(page);
    const remaining = await input.evaluate(node => ('value' in node ? node.value : node.innerText).trim()).catch(() => '');
    if (remaining !== question.trim()) return;
    if (await dismissNonBlockingDialogs(page)) continue;
    if (send && !await send.isEnabled().catch(() => false)) return;
  }
  throw new Error('问题未成功发送：输入框仍保留原问题，请检查网页弹窗或发送按钮');
}

// The page can replace its initial textarea while the rich editor loads.
// Re-resolve editable controls after hydration instead of retaining a stale locator.
async function fillQuestion(page, selectors, question, timeout = 30000, platform) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await checkPlatformRestriction(page);
    await checkHumanVerification(page);
    for (const selector of selectors) {
      const candidates = page.locator(selector);
      for (let index = (await candidates.count()) - 1; index >= 0; index--) {
        const input = candidates.nth(index);
        if (!await input.isVisible().catch(() => false) || !await input.isEditable().catch(() => false)) continue;
        try {
          await input.scrollIntoViewIfNeeded({ timeout: 1200 });
          if (platform === 'doubao') {
            await input.click({ timeout: 1200 });
            await input.press('ControlOrMeta+A');
            await input.pressSequentially(question, { delay: 10, timeout: 10000 });
          } else await input.fill(question, { timeout: 1200 });
          const value = await input.evaluate(node => 'value' in node ? node.value : node.innerText);
          if (value.trim() === question.trim()) return input;
        } catch { /* The editor changed; resolve the current control again. */ }
      }
    }
    await page.waitForTimeout(300);
  }
  await checkLoginRequired(page);
  const error = new Error('问题输入区未就绪：等待 30 秒后仍无法编辑；请检查页面是否加载完整、是否需要登录');
  error.code = 'INPUT_NOT_READY';
  throw error;
}

async function pageDiagnostics(page, config, question, stage, networkFailures) {
  const editor = await page.locator(config.input[0]).evaluateAll((nodes, question) => {
    const node = nodes.at(-1);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const value = 'value' in node ? node.value : node.innerText;
    return { visible: rect.width > 0 && rect.height > 0,
      inViewport: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
      questionRetained: value.trim() === question.trim(),
      viewport: { width: innerWidth, height: innerHeight },
      window: { width: outerWidth, height: outerHeight } };
  }, question).catch(() => null);
  const answerPresent = await page.locator(config.answer[0]).evaluateAll(nodes => Boolean(nodes.at(-1)?.innerText.trim())).catch(() => false);
  const url = new URL(page.url());
  return { stage, pageUrl: /^https?:$/.test(url.protocol) ? url.origin + url.pathname : page.url(), editor, answerPresent, networkFailures: networkFailures.slice(-8) };
}

// Every monitored question starts a fresh conversation. Recovery accepts only
// one question followed by one assistant answer; ambiguous histories stop.
export async function assertOriginalAnswer(page, platform, question) {
  const safe = await page.evaluate(({ selector, question }) => {
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const excluded = 'textarea,input,[contenteditable="true"],button,[role="button"],nav,aside,header,script,style';
    const answers = [...document.querySelectorAll(selector)].filter(visible);
    if (answers.length > 1) return false;
    const matches = [...document.querySelectorAll('body *')].filter(node => visible(node) &&
      !node.closest(excluded) && !node.closest(selector) && node.textContent.trim() === question.trim());
    const leaves = matches.filter(node => !matches.some(other => other !== node && node.contains(other)));
    if (leaves.length !== 1) return false;
    if (!answers.length) return true; // Still waiting for the original answer.
    const answer = answers[0], prompt = leaves[0];
    if (!(prompt.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
    if (!answer.innerText.trim()) return true;
    const message = answer.closest('[data-testid="receive_message"]') || answer;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode, parent = text.parentElement;
      if (!text.textContent.trim() || !visible(parent) || message.contains(parent) ||
        prompt.contains(parent) || parent.closest(excluded + ',a,[data-testid="message_action_bar"]')) continue;
      const afterPrompt = prompt.compareDocumentPosition(parent) & Node.DOCUMENT_POSITION_FOLLOWING;
      const beforeAnswer = parent.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (afterPrompt && beforeAnswer &&
        !/^(搜索到\s*\d+\s*个网页|搜索\s*\d+\s*个关键词，参考\s*\d+\s*篇资料)$/.test(text.textContent.trim())) return false;
      if (!(answer.compareDocumentPosition(parent) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      // Static platform footer is not a user follow-up. Any other unclassified
      // text after the answer makes attribution uncertain, including an
      // unanswered follow-up. Do not silently take the last answer.
      if (/^(内容由\s*AI\s*生成.*|AI\s*生成.*|请仔细甄别.*|仅供参考.*)$/i.test(text.textContent.trim())) continue;
      return false;
    }
    return true;
  }, { selector: PLATFORMS[platform].answer[0], question });
  if (!safe) {
    const error = new Error('原对话的问题与回答无法唯一对应，可能已有追加问答或页面结构变化。本次停止补采，未重复发送。');
    error.code = 'RESUME_CONTEXT_LOST';
    throw error;
  }
}

async function askUnlocked(job, { runId, onCheckpoint = () => {} }) {
  const config = PLATFORMS[job.platform];
  const captureId = Date.now();
  const context = await contextFor(job.platform, job.account_id || 0, job.profile_key || 'legacy-' + job.platform);
  const existingPage = context.pages().find(candidate => !candidate.isClosed());
  const page = existingPage || await context.newPage();
  const authFailures = [];
  const networkFailures = [];
  let stage = '打开网页';
  let checkpoint = job.resumeState || null;
  const persistCheckpoint = () => {
    if (!checkpoint) return;
    // Keep the last useful conversation URL if the window was replaced.
    const url = page.url();
    if (/^https?:/.test(url) && !job.resumeState) checkpoint.pageUrl = url;
    return onCheckpoint({ ...checkpoint });
  };
  const onRequestFailed = request => {
    try {
      const url = new URL(request.url());
      if (/\.(doubao|deepseek)\.com$|^(www\.)?(doubao|deepseek)\.com$/.test(url.hostname)) {
        networkFailures.push({ host: url.hostname, path: url.pathname, error: request.failure()?.errorText || '请求失败' });
      }
      if (new URL(request.url()).hostname === 'accounts.doubao.com'
        && /ERR_FAILED|ERR_TIMED_OUT|ERR_CONNECTION/.test(request.failure()?.errorText || '')) {
        authFailures.push(request.failure().errorText);
      }
    } catch { /* Ignore unrelated request URLs. */ }
  };
  const onResponse = response => {
    try {
      const url = new URL(response.url());
      if (response.status() >= 400 && /\.(doubao|deepseek)\.com$|^(www\.)?(doubao|deepseek)\.com$/.test(url.hostname)) {
        networkFailures.push({ host: url.hostname, path: url.pathname, status: response.status() });
      }
    } catch { /* Ignore non-HTTP URLs. */ }
  };
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  try {
    // Automated monitoring never explicitly activates the window.
    if (checkpoint?.mayHaveSubmitted) {
      // Verification may let the provider finish the original submitted question.
      // Resume that document rather than navigating away and sending it again.
      let sameDocument = await page.evaluate(token => Boolean(token) && window.__geoMonitorSubmissionToken === token, checkpoint.token).catch(() => false);
      if (checkpoint.legacyRecovery && page.url() === checkpoint.pageUrl) {
        sameDocument = await page.getByText(job.question, { exact: true }).evaluateAll(nodes => nodes.some(node =>
          node.getClientRects().length > 0 && !node.closest('[contenteditable="true"],textarea,input'))).catch(() => false);
      }
      const pausedConversation = checkpoint.pageUrl && !/\/chat\/?(?:[?#].*)?$/.test(checkpoint.pageUrl);
      const changedConversation = pausedConversation && page.url() !== checkpoint.pageUrl;
      if (!sameDocument || changedConversation) {
        let savedUrl;
        try { savedUrl = new URL(checkpoint.pageUrl); } catch {}
        const platformUrl = new URL(config.url);
        const canRestore = savedUrl && /^https?:$/.test(savedUrl.protocol) && savedUrl.origin === platformUrl.origin &&
          savedUrl.pathname !== platformUrl.pathname && /\/chat\/.+/.test(savedUrl.pathname);
        if (canRestore) {
          stage = '恢复原对话';
          await page.goto(savedUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await checkHumanVerification(page);
          await checkLoginRequired(page);
          const matchingQuestion = page.getByText(job.question, { exact: true }).filter({ visible: true });
          await matchingQuestion.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
          sameDocument = await matchingQuestion.evaluateAll(nodes => nodes.some(node => !node.closest('[contenteditable="true"],textarea,input'))).catch(() => false);
          if (sameDocument) await page.evaluate(token => { window.__geoMonitorSubmissionToken = token; }, checkpoint.token);
        } else sameDocument = false;
      }
      if (!sameDocument) {
        const error = new Error('原问答窗口已关闭或页面已切换，无法安全确认原问题是否已回答。本次未重复发送；请核对原对话后再新建一次运行。');
        error.code = 'RESUME_CONTEXT_LOST';
        throw error;
      }
      stage = '继续采集原回答';
      await checkHumanVerification(page);
      await checkLoginRequired(page);
      const answer = await readAnswer(page, job.platform, checkpoint.beforeText, authFailures, async () => {
        await persistCheckpoint();
        await assertOriginalAnswer(page, job.platform, job.question);
      });
      const screenshotDir = resolve(process.env.GEO_RESULTS_ROOT || 'results', 'screenshots', String(runId));
      await mkdir(screenshotDir, { recursive: true });
      const screenshot = join(screenshotDir, String(job.question_id) + '-' + job.platform + '-account-' + (job.account_id || 0) + '-' + captureId + '.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      return { ...answer, screenshot, captureMethod: 'web_ui',
        diagnostics: { ...await pageDiagnostics(page, config, job.question, '原回答采集完成', networkFailures), resumedOriginal: true } };
    }
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await dismissNonBlockingDialogs(page);
    await checkPlatformRestriction(page);
    const newChat = await firstVisible(page, config.newChat, 8000);
    if (!newChat) {
      await checkHumanVerification(page);
      await checkLoginRequired(page);
      throw new Error('找不到“新对话”入口；网页可能已改版');
    }
    stage = '新建对话';
    await newChat.click();
    await checkLoginRequired(page);
    const existingAnswer = await firstVisible(page, config.answer, 1000);
    const beforeText = existingAnswer ? (await existingAnswer.innerText().catch(() => '')).trim() : '';
    checkpoint = { token: runId + ':' + job.question_id + ':' + (job.account_id || 0) + ':' + captureId,
      beforeText, mayHaveSubmitted: false };
    await page.evaluate(token => { window.__geoMonitorSubmissionToken = token; }, checkpoint.token);
    stage = '准备输入框';
    const input = await fillQuestion(page, config.input, job.question, 30000, job.platform);
    stage = '提交问题';
    await submitQuestion(page, config, input, job.question, async () => {
      checkpoint.mayHaveSubmitted = true;
      await persistCheckpoint(); // Must complete before any send click or Enter.
    });

    stage = '等待回答';
    const answer = await readAnswer(page, job.platform, beforeText, authFailures, persistCheckpoint);
    const screenshotDir = resolve(process.env.GEO_RESULTS_ROOT || 'results', 'screenshots', String(runId));
    await mkdir(screenshotDir, { recursive: true });
    const screenshot = join(screenshotDir, String(job.question_id) + '-' + job.platform + '-account-' + (job.account_id || 0) + '-' + captureId + '.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    return { ...answer, screenshot, captureMethod: 'web_ui',
      diagnostics: await pageDiagnostics(page, config, job.question, '采集完成', networkFailures) };
  } catch (error) {
    if (!['LOGIN_REQUIRED', 'HUMAN_VERIFICATION_REQUIRED'].includes(error?.code)) {
      try { await checkLoginRequired(page); await checkHumanVerification(page); }
      catch (attention) { error = attention; }
    }
    if (error instanceof Error) {
      if (checkpoint?.mayHaveSubmitted) await persistCheckpoint();
      error.diagnostics = await pageDiagnostics(page, config, job.question, stage, networkFailures).catch(() => ({ stage }));
      if (checkpoint) {
        error.diagnostics.resumeState = { ...checkpoint, pageUrl: job.resumeState ? checkpoint.pageUrl : page.url() };
      }
      const home = await page.getByText(/有什么我能帮你的吗/).first().isVisible().catch(() => false);
      error.safeToRetry = job.platform === 'doubao' && error.code === 'PROVIDER_ERROR'
        && error.diagnostics.editor?.questionRetained && !error.diagnostics.answerPresent && home;
      if (error.safeToRetry) {
        checkpoint.mayHaveSubmitted = false;
        error.diagnostics.resumeState = { ...checkpoint };
        await persistCheckpoint();
      }
    }
    const needsAttention = ['HUMAN_VERIFICATION_REQUIRED', 'LOGIN_REQUIRED'].includes(error?.code);
    const pageUrl = needsAttention ? page.url() : null;
    const screenshotDir = resolve(process.env.GEO_RESULTS_ROOT || 'results', 'screenshots', String(runId));
    await mkdir(screenshotDir, { recursive: true });
    const failure = join(screenshotDir, String(job.question_id) + '-' + job.platform + '-account-' + (job.account_id || 0) + '-' + captureId + '-error.png');
    const saved = await page.screenshot({ path: failure, fullPage: true }).then(() => true, () => false);
    if (saved && error instanceof Error) error.screenshot = failure;
    if (needsAttention) {
      try { await showAttentionWindow(job, pageUrl); }
      catch (openError) { error.message += ' 打开浏览器失败：' + openError.message; }
    }
    throw error;
  } finally {
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
  }
}

export async function askBrowser(job, options) {
  const key = job.platform + ':' + (job.account_id || 0);
  return withAccountLock(key, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = new Date().toISOString();
      try {
        return { ...await askUnlocked(job, options), attemptStartedAt: startedAt };
      } catch (error) {
        error.attemptStartedAt = startedAt;
        if (attempt || !error.safeToRetry) throw error;
        if (options.onAttempt) await options.onAttempt({ ...job, status: 'failed', startedAt,
          finishedAt: new Date().toISOString(), error: error.message, errorCode: error.code,
          screenshot: error.screenshot, diagnostics: { ...error.diagnostics, automaticRetry: true } });
        await new Promise(done => setTimeout(done, 5000));
      }
    }
  });
}

export async function closeBrowsers() {
  await Promise.allSettled([...launches.values()]);
  await Promise.all([...contexts.values()].map(entry => entry.context.close().catch(() => {})));
}
