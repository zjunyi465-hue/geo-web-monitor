import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import net from 'node:net';
import { openDatabase } from '../src/db.js';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'geo-public-demo-'));
const output = join(root, 'docs', 'assets');
await mkdir(output, { recursive: true });
const dbPath = join(temp, 'demo.db');
const db = openDatabase(dbPath);
const timestamp = new Date().toISOString();
const brand = JSON.parse(await readFile(join(root, 'examples', 'brand-demo.json'), 'utf8'));
const brandId = Number(db.prepare('INSERT INTO brands(name,aliases,category,description,audience,strengths,website,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(brand.name, brand.aliases, brand.category, brand.description, brand.audience, brand.strengths, brand.website, timestamp, timestamp).lastInsertRowid);
db.prepare("UPDATE platform_accounts SET label='演示账号 A1',notes='虚构会话，不包含真实登录' WHERE platform='doubao'").run();
db.prepare("UPDATE platform_accounts SET label='演示账号 B1',notes='虚构会话，不包含真实登录' WHERE platform='deepseek'").run();
const accountId = db.prepare("SELECT id FROM platform_accounts WHERE platform='doubao'").get().id;
const texts = ['小型团队有哪些数据分析工具可以选择？', '选择数据分析工具时应关注哪些功能？'];
const questionIds = texts.map(text => Number(db.prepare("INSERT INTO questions(brand_id,text,kind,source,created_at) VALUES(?,?,'discovery','manual',?)")
  .run(brandId, text, timestamp).lastInsertRowid));
const taskId = Number(db.prepare("INSERT INTO tasks(brand_id,name,platforms_json,question_ids_json,account_ids_json,schedule_type,created_at) VALUES(?,?,'[]',?,'[]','manual',?)")
  .run(brandId, '虚构演示 · 工具推荐监测', JSON.stringify(questionIds), timestamp).lastInsertRowid);
const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
for (let index = 0; index < 12; index++) {
  const snapshot = { ...task, account_ids_json: JSON.stringify([accountId]), platforms_json: '["doubao"]' };
  const runId = Number(db.prepare("INSERT INTO runs(task_id,status,total,done,started_at,finished_at,brand_snapshot_json,task_snapshot_json) VALUES(?,'completed',2,2,?,?,?,?)")
    .run(taskId, timestamp, timestamp, JSON.stringify(brand), JSON.stringify(snapshot)).lastInsertRowid);
  for (let q = 0; q < questionIds.length; q++) {
    const answer = '【虚构演示数据 · 非 AI 平台真实回答】\n' + (q === 0
      ? '示例回答将星河工具列为候选之一，便于演示品牌提及统计。实际选型需要核对自己的需求。'
      : '示例回答讨论数据导入、协作和导出功能，用于演示未提及品牌的样本。');
    db.prepare("INSERT INTO results(run_id,question_id,platform,status,answer,citations_json,account_id,account_label,started_at,finished_at) VALUES(?,?,'doubao','succeeded',?,?,?,?,?,?)")
      .run(runId, questionIds[q], answer, JSON.stringify([{ title: '虚构来源 · 示例域名', url: 'https://example.org/demo' }]), accountId, '演示账号 A1', timestamp, timestamp);
    db.prepare("INSERT INTO result_attempts(run_id,question_id,platform,status,account_id,account_label,started_at,finished_at) VALUES(?,?,'doubao','succeeded',?,?,?,?)")
      .run(runId, questionIds[q], accountId, '演示账号 A1', timestamp, timestamp);
  }
}
db.close();
const listener = net.createServer();
await new Promise(done => listener.listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GEO_')));
const child = spawn(process.execPath, ['src/server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...cleanEnv, GEO_PORT: String(port), GEO_DB_PATH: dbPath, GEO_PROFILE_ROOT: join(temp, 'profiles'),
    GEO_RESULTS_ROOT: join(temp, 'results'), GEO_HEADLESS: '1', GEO_BROWSER_CHANNEL: 'disabled-for-public-demo' } });
let browser;
try {
  const url = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(url + '/api/bootstrap')).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  if (!ready) throw new Error('Demo service did not start');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url);
  await page.locator('input[name="username"]').fill('demo_admin');
  await page.locator('input[name="password"]').fill('fictional-demo-only-2026');
  await page.getByRole('button', { name: '创建管理员' }).click();
  await page.getByRole('button', { name: '平台账号池', exact: true }).waitFor();
  async function label() {
    await page.evaluate(() => {
      const neutral = text => text.replace(/豆包网页版|豆包/g, '平台 A').replace(/DeepSeek\s*网页版|DeepSeek|deepseek/g, '平台 B').replace(/doubao/g, '平台 A');
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) { const node = walk.currentNode; if (!['SCRIPT','STYLE'].includes(node.parentElement?.tagName)) node.textContent = neutral(node.textContent); }
      for (const node of document.querySelectorAll('[placeholder],[title],[aria-label]')) for (const key of ['placeholder','title','aria-label']) if (node.hasAttribute(key)) node.setAttribute(key, neutral(node.getAttribute(key)));
      const remaining = document.body.innerText + Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).join(' ');
      if (/豆包|deepseek|doubao/i.test(remaining)) throw new Error('Platform name remains in demonstration');
      const banner = document.createElement('p'); banner.textContent = '虚构演示数据 · 非平台真实回答';
      banner.style.cssText = 'padding:10px 14px;background:#fff5d9;border:1px solid #e6d5a0;border-radius:8px;color:#765900;font-weight:600';
      document.querySelector('main').prepend(banner);
    });
  }
  await label(); await page.screenshot({ path: join(output, 'overview.png') });
  await page.getByRole('button', { name: '平台账号池', exact: true }).click();
  await page.getByText('全部账号', { exact: true }).waitFor();
  await label(); await page.screenshot({ path: join(output, 'accounts.png') });
  await page.getByRole('button', { name: '监测任务', exact: true }).click();
  await page.locator('button[data-action="runTask"]').click();
  await page.locator('#runTaskForm').waitFor();
  await page.locator('#runTaskForm input[name="account"]').first().check();
  await label();
  await page.locator('#runTaskPanel').screenshot({ path: join(output, 'run-selection.png') });
  await page.getByRole('button', { name: '结果与报告', exact: true }).click();
  await page.locator('button[data-action="viewRun"]').first().click();
  await page.getByText('按账号比较', { exact: true }).waitFor();
  await page.locator('main details > summary').filter({ hasText: texts[0] }).first().click();
  await page.getByText('正文引用（已采集 1 条）', { exact: true }).first().click();
  const report = page.locator('.card').filter({ has: page.getByText('按账号比较', { exact: true }) });
  await label();
  await report.screenshot({ path: join(output, 'report.png') });
  console.log('Generated fictional screenshots in docs/assets. No live platform queries were sent.');
} finally {
  await browser?.close();
  child.kill();
  await new Promise(done => child.exitCode !== null ? done() : child.once('exit', done));
  if (!resolve(temp).startsWith(resolve(tmpdir()) + '\\geo-public-demo-') && !resolve(temp).startsWith(resolve(tmpdir()) + '/geo-public-demo-')) {
    throw new Error('Unexpected temporary directory; refusing cleanup');
  }
  await rm(temp, { recursive: true, force: true });
}
