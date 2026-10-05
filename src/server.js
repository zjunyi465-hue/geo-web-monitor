import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { openDatabase } from './db.js';
import { generateQuestions } from './questions.js';
import { summarizeRun } from './analysis.js';
import { PLATFORMS, askBrowser, openPlatformForLogin, closeBrowsers } from './browser.js';
import { runAccountJobs, runStatus } from './core.js';
import { nextRunAt } from './schedule.js';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from './checkpoints.js';

const db = openDatabase(process.env.GEO_DB_PATH || undefined);
db.prepare("UPDATE runs SET status='interrupted', finished_at=?,error='服务中断，未完成项可以继续运行' WHERE status='running'")
  .run(new Date().toISOString());
const publicRoot = resolve('public');
const host = process.env.GEO_HOST || '127.0.0.1';
const port = Number(process.env.GEO_PORT || 8790);

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function error(res, status, message) { json(res, status, { error: message }); }
function now() { return new Date().toISOString(); }
function row(sql, ...args) { return db.prepare(sql).get(...args); }
function rows(sql, ...args) { return db.prepare(sql).all(...args); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function passwordHash(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 300 || !value.trim()) {
    throw new Error('密码须为 10～300 位，且不能全部为空格');
  }
  return value;
}
function safeUser(user) { return { id: user.id, username: user.username, role: user.role }; }

async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1024 * 1024) throw new Error('提交内容超过 1MB');
  }
  try { return data ? JSON.parse(data) : {}; }
  catch { throw new Error('请求必须是有效 JSON'); }
}
function cookieToken(req) {
  const match = /(?:^|;\s*)geo_session=([^;]+)/.exec(req.headers.cookie || '');
  return match ? match[1] : null;
}
function currentUser(req) {
  const token = cookieToken(req);
  if (!token) return null;
  return row('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?', hash(token), now()) || null;
}
function requireUser(req, res, admin = false) {
  const user = currentUser(req);
  if (!user) { error(res, 401, '请先登录'); return null; }
  if (admin && user.role !== 'admin') { error(res, 403, '需要管理员权限'); return null; }
  return user;
}
function setSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .run(hash(token), userId, expires);
  return { 'Set-Cookie': 'geo_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800' };
}
function text(value, field, max = 4000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(field + '不能为空');
  if (value.length > max) throw new Error(field + '过长');
  return value.trim();
}
function optional(value, max = 4000) {
  const valueText = String(value ?? '').trim();
  if (valueText.length > max) throw new Error('输入内容过长');
  return valueText;
}
function parseId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('无效编号');
  return n;
}
function publicBrand(data) {
  return {
    name: text(data.name, '品牌名称', 150),
    aliases: optional(data.aliases, 1000),
    category: text(data.category, '产品/服务类别', 200),
    description: optional(data.description, 4000),
    audience: optional(data.audience, 1000),
    strengths: optional(data.strengths, 2000),
    website: optional(data.website, 500),
    competitors: optional(data.competitors, 1000),
  };
}
function defaultAccount(platform) {
  return row('SELECT * FROM platform_accounts WHERE profile_key=?', 'legacy-' + platform);
}
function accountsForTask(task) {
  const ids = task.account_ids_json ? JSON.parse(task.account_ids_json) :
    JSON.parse(task.platforms_json).map(platform => defaultAccount(platform)?.id);
  if (!ids.length || ids.some(id => !id)) throw new Error('任务没有有效的平台账号');
  return ids.map(id => {
    const account = row('SELECT * FROM platform_accounts WHERE id=?', id);
    if (!account) throw new Error('任务关联的平台账号不存在：' + id);
    return account;
  });
}
function taskInput(data) {
  const brandId = parseId(data.brandId);
  if (!row('SELECT id FROM brands WHERE id=?', brandId)) throw new Error('品牌不存在');
  const type = data.scheduleType || 'manual';
  if (!['manual', 'daily', 'weekly'].includes(type)) throw new Error('无效任务周期');
  const accountIds = Array.isArray(data.accountIds)
    ? [...new Set(data.accountIds.map(parseId))]
    : [...new Set(Array.isArray(data.platforms) ? data.platforms : [])].map(platform => defaultAccount(platform)?.id);
  if ((type !== 'manual' && !accountIds.length) || accountIds.some(id => !id)) throw new Error('请选择有效平台账号');
  const accounts = accountIds.map(id => row('SELECT * FROM platform_accounts WHERE id=?', id));
  if (accounts.some(account => !account || !PLATFORMS[account.platform])) throw new Error('平台账号不存在');
  const platforms = [...new Set(accounts.map(account => account.platform))];
  const questionIds = [...new Set((Array.isArray(data.questionIds) ? data.questionIds : []).map(parseId))];
  if (!questionIds.length) throw new Error('请至少选择一个问题');
  const placeholders = questionIds.map(() => '?').join(',');
  const owned = rows('SELECT id FROM questions WHERE brand_id=? AND id IN (' + placeholders + ')', brandId, ...questionIds);
  if (owned.length !== questionIds.length) throw new Error('问题不属于选定品牌');
  const weekdays = [...new Set((Array.isArray(data.weekdays) ? data.weekdays : []).map(Number))];
  if (weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('无效星期');
  const timeHHMM = optional(data.timeHHMM || '09:00', 5);
  const enabled = type !== 'manual' && data.enabled !== false;
  const scheduledNext = nextRunAt(type, timeHHMM, weekdays);
  return {
    brandId, platforms, accountIds, questionIds, type, weekdays, timeHHMM, enabled,
    name: text(data.name || '监测任务', '任务名称', 150),
    next: enabled ? scheduledNext : null,
  };
}

function recordAttempt(runId, result) {
  db.prepare('INSERT INTO result_attempts(run_id,question_id,platform,account_id,account_label,status,error,error_code,screenshot,started_at,finished_at,diagnostics_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(runId, result.question_id, result.platform, result.account_id, result.account_label,
      result.status, result.error || null, result.errorCode || null, result.screenshot || null,
      result.startedAt, result.finishedAt, JSON.stringify(result.diagnostics || {}));
}
async function executeRun(runId, task) {
  try {
    const ids = JSON.parse(task.question_ids_json);
    const selected = rows('SELECT * FROM questions WHERE brand_id=? AND id IN (' + ids.map(() => '?').join(',') + ')', task.brand_id, ...ids);
    const jobs = [];
    const accounts = accountsForTask(task);
    for (const question of selected) for (const account of accounts) {
      jobs.push({ id: String(jobs.length + 1), question_id: question.id, question: question.text,
        platform: account.platform, account_id: account.id, account_label: account.label, profile_key: account.profile_key });
    }
    const previous = rows('SELECT question_id,account_id,status,error_code,diagnostics_json FROM results WHERE run_id=?', runId);
    const finished = new Set(previous.filter(result => ['succeeded', 'failed'].includes(result.status))
      .map(result => result.question_id + ':' + result.account_id));
    const pending = jobs.filter(job => !finished.has(job.question_id + ':' + job.account_id)).map(job => {
      const paused = previous.find(r => r.question_id === job.question_id && r.account_id === job.account_id &&
        (r.status === 'needs_attention' || (r.status === 'retry_pending' && ['ANSWER_TIMEOUT', 'ACCOUNT_NETWORK_FAILED', 'RESUME_CONTEXT_LOST'].includes(r.error_code))));
      const diagnostics = paused ? JSON.parse(paused.diagnostics_json || '{}') : {};
      const legacyRecovery = paused?.error_code === 'ACCOUNT_NETWORK_FAILED' && diagnostics.pageUrl &&
        diagnostics.editor?.questionRetained === false ? { pageUrl: diagnostics.pageUrl, mayHaveSubmitted: true, beforeText: '', legacyRecovery: true } : null;
      let resumeState = loadCheckpoint(db, runId, job) || diagnostics.resumeState || legacyRecovery;
      if (paused && resumeState?.mayHaveSubmitted && !/^https?:\/\//.test(resumeState.pageUrl || '')) {
        const history = rows('SELECT error_code,diagnostics_json FROM result_attempts WHERE run_id=? AND question_id=? AND account_id=? ORDER BY id DESC', runId, job.question_id, job.account_id);
        for (const attempt of history) {
          const saved = JSON.parse(attempt.diagnostics_json || '{}');
          if (saved.resumeState?.mayHaveSubmitted && /^https?:\/\//.test(saved.resumeState.pageUrl || '')) { resumeState = saved.resumeState; break; }
          if (attempt.error_code === 'ACCOUNT_NETWORK_FAILED' && /^https?:\/\//.test(saved.pageUrl || '') && saved.editor?.questionRetained === false) {
            resumeState = { pageUrl: saved.pageUrl, beforeText: '', mayHaveSubmitted: true, legacyRecovery: true }; break;
          }
        }
      }
      return { ...job, resumeState };
    });
    await runAccountJobs(pending, job => askBrowser(job, { runId,
      onCheckpoint: state => saveCheckpoint(db, runId, job, state),
      onAttempt: result => recordAttempt(runId, result) }), {
      concurrency: Math.min(2, accounts.length),
      onResult: result => {
        db.exec('BEGIN');
        try {
          db.prepare("DELETE FROM results WHERE run_id=? AND question_id=? AND account_id=? AND status IN ('needs_attention','retry_pending')")
            .run(runId, result.question_id, result.account_id);
          db.prepare('INSERT INTO results(run_id,question_id,platform,status,answer,citations_json,screenshot,error,started_at,finished_at,account_id,account_label,error_code,reported_citation_count,searched_sites_json,reported_search_count,diagnostics_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(runId, result.question_id, result.platform, result.status, result.answer || null,
              JSON.stringify(result.citations || []), result.screenshot || null, result.error || null,
              result.startedAt, result.finishedAt, result.account_id, result.account_label, result.errorCode || null,
              result.reportedCitationCount ?? null, JSON.stringify(result.searchedSites || []),
              result.reportedSearchCount ?? null, JSON.stringify(result.diagnostics || {}));
          recordAttempt(runId, result);
          if (result.status === 'succeeded') clearCheckpoint(db, runId, result);
          const accountStatus = result.status === 'succeeded' ? 'recent_success'
            : result.errorCode === 'LOGIN_REQUIRED' ? 'login_required'
              : result.errorCode === 'HUMAN_VERIFICATION_REQUIRED' ? 'verification_required' : 'error';
          db.prepare('UPDATE platform_accounts SET last_status=?,last_error=?,last_checked_at=? WHERE id=?')
            .run(accountStatus, result.error || null, result.finishedAt, result.account_id);
          db.prepare("UPDATE runs SET done=(SELECT count(*) FROM results WHERE run_id=? AND status IN ('succeeded','failed')) WHERE id=?")
            .run(runId, runId);
          db.exec('COMMIT');
        } catch (err) { db.exec('ROLLBACK'); throw err; }
      },
    });
    const results = rows('SELECT status FROM results WHERE run_id=?', runId);
    const status = runStatus(results);
    db.prepare('UPDATE runs SET status=?, finished_at=?,error=NULL WHERE id=?').run(status, now(), runId);
  } catch (err) {
    db.prepare("UPDATE runs SET status='interrupted', finished_at=?,error=? WHERE id=?")
      .run(now(), err instanceof Error ? err.message : String(err), runId);
    process.stderr.write('运行 ' + runId + ' 失败：' + err.message + '\n');
  }
}
function startRun(taskId, selection = {}) {
  let task = row('SELECT * FROM tasks WHERE id=?', taskId);
  if (!task) throw new Error('任务不存在');
  if (selection.accountIds !== undefined || selection.questionIds !== undefined) {
    if (selection.accountIds !== undefined && !Array.isArray(selection.accountIds)) throw new Error('账号选择格式无效');
    if (selection.questionIds !== undefined && !Array.isArray(selection.questionIds)) throw new Error('问题选择格式无效');
    const config = taskInput({ brandId: task.brand_id, name: task.name, scheduleType: 'manual',
      accountIds: selection.accountIds ?? accountsForTask(task).map(a => a.id),
      questionIds: selection.questionIds ?? JSON.parse(task.question_ids_json) });
    task = { ...task, account_ids_json: JSON.stringify(config.accountIds), platforms_json: JSON.stringify(config.platforms),
      question_ids_json: JSON.stringify(config.questionIds) };
  }
  if (task.account_ids_json === '[]') throw new Error('请为本次运行选择至少一个账号');
  const unfinished = row("SELECT id,status FROM runs WHERE task_id=? AND status IN ('running','needs_attention') ORDER BY id DESC LIMIT 1", taskId);
  if (unfinished) throw new Error(unfinished.status === 'needs_attention'
    ? '此任务有待人工处理的运行 #' + unfinished.id + '，请先继续该运行' : '此任务正在运行');
  const count = JSON.parse(task.question_ids_json).length * accountsForTask(task).length;
  const brand = row('SELECT * FROM brands WHERE id=?', task.brand_id);
  const info = db.prepare("INSERT INTO runs(task_id,status,total,started_at,brand_snapshot_json,task_snapshot_json) VALUES(?,'running',?,?,?,?)")
    .run(taskId, count, now(), JSON.stringify(brand), JSON.stringify(task));
  const runId = Number(info.lastInsertRowid);
  void executeRun(runId, task);
  return row('SELECT * FROM runs WHERE id=?', runId);
}
function resumeRun(runId) {
  const run = row('SELECT * FROM runs WHERE id=?', runId);
  if (!run) throw new Error('运行记录不存在');
  if (!['needs_attention', 'interrupted'].includes(run.status)) throw new Error('只有待人工处理或中断的运行可以继续');
  const running = row("SELECT id FROM runs WHERE task_id=? AND status='running'", run.task_id);
  if (running) throw new Error('此任务已有运行正在执行');
  const task = run.task_snapshot_json ? JSON.parse(run.task_snapshot_json)
    : row('SELECT * FROM tasks WHERE id=?', run.task_id);
  db.prepare("UPDATE runs SET status='running',finished_at=NULL,error=NULL WHERE id=?").run(runId);
  void executeRun(runId, task);
  return row('SELECT * FROM runs WHERE id=?', runId);
}
function retryFailedRun(runId) {
  const run = row('SELECT * FROM runs WHERE id=?', runId);
  if (!run) throw new Error('运行记录不存在');
  if (!['failed', 'partial'].includes(run.status)) throw new Error('此运行没有可重试的失败项');
  if (!row("SELECT id FROM results WHERE run_id=? AND status='failed' LIMIT 1", runId)) {
    throw new Error('没有可重试的失败项');
  }
  const running = row("SELECT id FROM runs WHERE task_id=? AND status='running'", run.task_id);
  if (running) throw new Error('此任务已有运行正在执行');
  const task = run.task_snapshot_json ? JSON.parse(run.task_snapshot_json)
    : row('SELECT * FROM tasks WHERE id=?', run.task_id);
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE results SET status='retry_pending' WHERE run_id=? AND status='failed'").run(runId);
    db.prepare("UPDATE runs SET status='running',done=(SELECT count(*) FROM results WHERE run_id=? AND status='succeeded'),finished_at=NULL,error=NULL WHERE id=?")
      .run(runId, runId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  void executeRun(runId, task);
  return row('SELECT * FROM runs WHERE id=?', runId);
}
function runDetails(runId) {
  const run = row('SELECT runs.*,tasks.name AS task_name,tasks.brand_id,brands.name AS brand_name FROM runs JOIN tasks ON tasks.id=runs.task_id JOIN brands ON brands.id=tasks.brand_id WHERE runs.id=?', runId);
  if (!run) throw new Error('运行记录不存在');
  if (run.task_snapshot_json) run.task_name = JSON.parse(run.task_snapshot_json).name;
  const results = rows('SELECT results.*,questions.text AS question,questions.kind FROM results JOIN questions ON questions.id=results.question_id WHERE run_id=? ORDER BY results.id', runId);
  const attempts = rows('SELECT a.*,q.text AS question FROM result_attempts a JOIN questions q ON q.id=a.question_id WHERE a.run_id=? ORDER BY a.id', runId);
  return { run, results, attempts };
}

async function api(req, res, pathname) {
  const method = req.method;
  if (pathname === '/api/bootstrap' && method === 'GET') {
    return json(res, 200, { needsSetup: !row('SELECT id FROM users LIMIT 1') });
  }
  if (pathname === '/api/setup' && method === 'POST') {
    if (row('SELECT id FROM users LIMIT 1')) return error(res, 409, '管理员已创建');
    const input = await body(req);
    // The request body is asynchronous: another setup request may have won meanwhile.
    if (row('SELECT id FROM users LIMIT 1')) return error(res, 409, '管理员已创建');
    const username = text(input.username, '用户名', 100);
    const password = validatePassword(input.password);
    const salt = randomBytes(16).toString('hex');
    const info = db.prepare("INSERT INTO users(username,password_hash,salt,role,created_at) VALUES(?,?,?,'admin',?)")
      .run(username, passwordHash(password, salt), salt, now());
    return json(res, 201, { user: { id: Number(info.lastInsertRowid), username, role: 'admin' } },
      setSession(res, Number(info.lastInsertRowid)));
  }
  if (pathname === '/api/login' && method === 'POST') {
    const input = await body(req);
    const user = row('SELECT * FROM users WHERE username=?', String(input.username || ''));
    if (!user) return error(res, 401, '用户名或密码错误');
    const attempted = Buffer.from(passwordHash(String(input.password || ''), user.salt), 'hex');
    const actual = Buffer.from(user.password_hash, 'hex');
    if (!timingSafeEqual(attempted, actual)) return error(res, 401, '用户名或密码错误');
    return json(res, 200, { user: safeUser(user) }, setSession(res, user.id));
  }
  if (pathname === '/api/logout' && method === 'POST') {
    const token = cookieToken(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'geo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  const user = requireUser(req, res);
  if (!user) return;
  if (pathname === '/api/me' && method === 'GET') return json(res, 200, { user: safeUser(user) });
  if (pathname === '/api/users' && method === 'GET') {
    if (!requireUser(req, res, true)) return;
    return json(res, 200, { users: rows('SELECT id,username,role,created_at FROM users ORDER BY id') });
  }
  if (pathname === '/api/users' && method === 'POST') {
    if (!requireUser(req, res, true)) return;
    const input = await body(req);
    const username = text(input.username, '用户名', 100);
    const password = validatePassword(input.password);
    const role = input.role === 'admin' ? 'admin' : 'member';
    const salt = randomBytes(16).toString('hex');
    db.prepare('INSERT INTO users(username,password_hash,salt,role,created_at) VALUES(?,?,?,?,?)')
      .run(username, passwordHash(password, salt), salt, role, now());
    return json(res, 201, { ok: true });
  }
  if (pathname === '/api/platforms' && method === 'GET') {
    return json(res, 200, { platforms: Object.entries(PLATFORMS).map(([id, p]) => ({ id, label: p.label, url: p.url })) });
  }
  if (pathname === '/api/platform-accounts' && method === 'GET') {
    return json(res, 200, { accounts: rows("SELECT id,platform,label,notes,created_at,last_status,last_error,last_checked_at,profile_key=('legacy-' || platform) AS is_default FROM platform_accounts ORDER BY platform,id") });
  }
  if (pathname === '/api/platform-accounts' && method === 'POST') {
    if (!requireUser(req, res, true)) return;
    const input = await body(req);
    if (!PLATFORMS[input.platform]) throw new Error('无效平台');
    const label = text(input.label, '账号名称', 100);
    if (row('SELECT id FROM platform_accounts WHERE platform=? AND label=?', input.platform, label)) return error(res, 409, '该平台已有同名账号，请换一个名称');
    const profileKey = randomBytes(12).toString('hex');
    const info = db.prepare('INSERT INTO platform_accounts(platform,label,profile_key,created_at) VALUES(?,?,?,?)')
      .run(input.platform, label, profileKey, now());
    return json(res, 201, { account: row('SELECT id,platform,label,created_at FROM platform_accounts WHERE id=?', Number(info.lastInsertRowid)) });
  }
  const accountEdit = /^\/api\/platform-accounts\/(\d+)$/.exec(pathname);
  if (accountEdit && method === 'PUT') {
    if (!requireUser(req, res, true)) return;
    const id = parseId(accountEdit[1]);
    const account = row('SELECT * FROM platform_accounts WHERE id=?', id);
    if (!account) return error(res, 404, '平台账号不存在');
    const input = await body(req);
    const label = text(input.label, '账号名称', 100);
    const notes = optional(input.notes, 1000);
    if (row('SELECT id FROM platform_accounts WHERE platform=? AND label=? AND id<>?', account.platform, label, id)) {
      return error(res, 409, '该平台已有同名账号，请换一个名称');
    }
    db.prepare('UPDATE platform_accounts SET label=?,notes=? WHERE id=?').run(label, notes, id);
    return json(res, 200, { account: row('SELECT id,platform,label,notes,created_at FROM platform_accounts WHERE id=?', id) });
  }
  const accountLogin = /^\/api\/platform-accounts\/(\d+)\/login$/.exec(pathname);
  if (accountLogin && method === 'POST') {
    const account = row('SELECT * FROM platform_accounts WHERE id=?', parseId(accountLogin[1]));
    if (!account) return error(res, 404, '平台账号不存在');
    return json(res, 200, await openPlatformForLogin(account));
  }
  const platformLogin = /^\/api\/platforms\/([a-z]+)\/login$/.exec(pathname);
  if (platformLogin && method === 'POST') {
    const account = defaultAccount(platformLogin[1]);
    if (!account) return error(res, 404, '平台不存在');
    return json(res, 200, await openPlatformForLogin(account));
  }

  if (pathname === '/api/brands' && method === 'GET') return json(res, 200, { brands: rows('SELECT * FROM brands ORDER BY id DESC') });
  if (pathname === '/api/brands' && method === 'POST') {
    const brand = publicBrand(await body(req));
    const time = now();
    const info = db.prepare('INSERT INTO brands(name,aliases,category,description,audience,strengths,website,competitors,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(brand.name, brand.aliases, brand.category, brand.description, brand.audience, brand.strengths, brand.website, brand.competitors, time, time);
    return json(res, 201, { brand: row('SELECT * FROM brands WHERE id=?', Number(info.lastInsertRowid)) });
  }
  const brandRoute = /^\/api\/brands\/(\d+)$/.exec(pathname);
  if (brandRoute && method === 'PUT') {
    const id = parseId(brandRoute[1]);
    if (!row('SELECT id FROM brands WHERE id=?', id)) return error(res, 404, '品牌不存在');
    const brand = publicBrand(await body(req));
    db.prepare('UPDATE brands SET name=?,aliases=?,category=?,description=?,audience=?,strengths=?,website=?,competitors=?,updated_at=? WHERE id=?')
      .run(brand.name, brand.aliases, brand.category, brand.description, brand.audience, brand.strengths, brand.website, brand.competitors, now(), id);
    return json(res, 200, { brand: row('SELECT * FROM brands WHERE id=?', id) });
  }
  const questionRoute = /^\/api\/brands\/(\d+)\/questions$/.exec(pathname);
  if (questionRoute && method === 'GET') {
    return json(res, 200, { questions: rows('SELECT * FROM questions WHERE brand_id=? ORDER BY id DESC', parseId(questionRoute[1])) });
  }
  if (questionRoute && method === 'POST') {
    const brandId = parseId(questionRoute[1]);
    if (!row('SELECT id FROM brands WHERE id=?', brandId)) return error(res, 404, '品牌不存在');
    const input = await body(req);
    const items = Array.isArray(input.questions) ? input.questions : [];
    if (!items.length || items.length > 200) throw new Error('请提交 1～200 个问题');
    const insert = db.prepare('INSERT OR IGNORE INTO questions(brand_id,text,kind,source,created_at) VALUES(?,?,?,?,?)');
    const validated = items.map(item => {
      if (!item || !['brand', 'discovery'].includes(item.kind)) throw new Error('无效问题类型');
      return [brandId, text(item.text, '问题', 500), item.kind,
        item.source === 'generated' ? 'generated' : 'manual', now()];
    });
    let added = 0;
    db.exec('BEGIN');
    try {
      for (const item of validated) added += Number(insert.run(...item).changes);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return json(res, 201, { added });
  }
  const generateRoute = /^\/api\/brands\/(\d+)\/questions\/generate$/.exec(pathname);
  if (generateRoute && method === 'GET') {
    const brand = row('SELECT * FROM brands WHERE id=?', parseId(generateRoute[1]));
    if (!brand) return error(res, 404, '品牌不存在');
    return json(res, 200, { questions: generateQuestions(brand) });
  }
  if (pathname === '/api/tasks' && method === 'GET') {
    return json(res, 200, { tasks: rows('SELECT tasks.*,brands.name AS brand_name FROM tasks JOIN brands ON brands.id=tasks.brand_id ORDER BY tasks.id DESC') });
  }
  if (pathname === '/api/tasks' && method === 'POST') {
    const task = taskInput(await body(req));
    const info = db.prepare('INSERT INTO tasks(brand_id,name,platforms_json,question_ids_json,schedule_type,weekdays_json,time_hhmm,enabled,next_run_at,created_at,account_ids_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(task.brandId, task.name, JSON.stringify(task.platforms), JSON.stringify(task.questionIds), task.type,
        JSON.stringify(task.weekdays), task.timeHHMM, task.enabled ? 1 : 0, task.next, now(), JSON.stringify(task.accountIds));
    return json(res, 201, { task: row('SELECT * FROM tasks WHERE id=?', Number(info.lastInsertRowid)) });
  }
  const taskRoute = /^\/api\/tasks\/(\d+)$/.exec(pathname);
  if (taskRoute && method === 'PUT') {
    const input = await body(req);
    const id = parseId(taskRoute[1]);
    const existing = row('SELECT * FROM tasks WHERE id=?', id);
    if (!existing) return error(res, 404, '任务不存在');
    if (row("SELECT id FROM runs WHERE task_id=? AND status='running' LIMIT 1", id)) {
      throw new Error('任务正在运行，请等本次运行结束后再编辑');
    }
    const task = taskInput({ ...input, brandId: existing.brand_id });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE runs SET task_snapshot_json=? WHERE task_id=? AND task_snapshot_json IS NULL')
        .run(JSON.stringify(existing), id);
      db.prepare('UPDATE tasks SET name=?,platforms_json=?,question_ids_json=?,schedule_type=?,weekdays_json=?,time_hhmm=?,enabled=?,next_run_at=?,account_ids_json=? WHERE id=?')
        .run(task.name, JSON.stringify(task.platforms), JSON.stringify(task.questionIds), task.type,
          JSON.stringify(task.weekdays), task.timeHHMM, task.enabled ? 1 : 0, task.next,
          JSON.stringify(task.accountIds), id);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return json(res, 200, { task: row('SELECT * FROM tasks WHERE id=?', id) });
  }
  const toggle = /^\/api\/tasks\/(\d+)\/toggle$/.exec(pathname);
  if (toggle && method === 'POST') {
    const id = parseId(toggle[1]);
    const task = row('SELECT * FROM tasks WHERE id=?', id);
    if (!task) return error(res, 404, '任务不存在');
    if (task.schedule_type === 'manual') throw new Error('手动任务没有定时开关');
    const enabled = !task.enabled;
    const next = enabled ? nextRunAt(task.schedule_type, task.time_hhmm, JSON.parse(task.weekdays_json)) : null;
    db.prepare('UPDATE tasks SET enabled=?,next_run_at=? WHERE id=?').run(enabled ? 1 : 0, next, id);
    return json(res, 200, { task: row('SELECT * FROM tasks WHERE id=?', id) });
  }
  const runRoute = /^\/api\/tasks\/(\d+)\/run$/.exec(pathname);
  if (runRoute && method === 'POST') return json(res, 201, { run: startRun(parseId(runRoute[1]), await body(req)) });
  const resumeRoute = /^\/api\/runs\/(\d+)\/resume$/.exec(pathname);
  if (resumeRoute && method === 'POST') return json(res, 200, { run: resumeRun(parseId(resumeRoute[1])) });
  const retryRoute = /^\/api\/runs\/(\d+)\/retry-failed$/.exec(pathname);
  if (retryRoute && method === 'POST') return json(res, 200, { run: retryFailedRun(parseId(retryRoute[1])) });
  if (pathname === '/api/runs' && method === 'GET') {
    const runs = rows('SELECT runs.*,tasks.name AS task_name,brands.name AS brand_name FROM runs JOIN tasks ON tasks.id=runs.task_id JOIN brands ON brands.id=tasks.brand_id ORDER BY runs.id DESC LIMIT 100');
    for (const run of runs) if (run.task_snapshot_json) run.task_name = JSON.parse(run.task_snapshot_json).name;
    return json(res, 200, { runs });
  }
  const detailsRoute = /^\/api\/runs\/(\d+)$/.exec(pathname);
  if (detailsRoute && method === 'GET') return json(res, 200, runDetails(parseId(detailsRoute[1])));
  const reportRoute = /^\/api\/runs\/(\d+)\/report$/.exec(pathname);
  if (reportRoute && method === 'GET') {
    const details = runDetails(parseId(reportRoute[1]));
    const brand = details.run.brand_snapshot_json ? JSON.parse(details.run.brand_snapshot_json)
      : row('SELECT * FROM brands WHERE id=?', details.run.brand_id);
    const questions = rows('SELECT * FROM questions WHERE brand_id=?', details.run.brand_id);
    return json(res, 200, { run: details.run, report: summarizeRun({ brand, questions, results: details.results,
      totalExpected: details.run.total }) });
  }
  return error(res, 404, '接口不存在');
}

async function serveScreenshot(req, res, pathname) {
  if (!requireUser(req, res)) return;
  const match = /^\/screenshots\/(\d+)\/([a-zA-Z0-9-]+\.png)$/.exec(pathname);
  if (!match) return error(res, 404, '图片不存在');
  const file = resolve(process.env.GEO_RESULTS_ROOT || 'results', 'screenshots', match[1], match[2]);
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { error(res, 404, '图片不存在'); }
}

async function serveStatic(res, pathname) {
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  const entry = files[pathname];
  if (!entry) return error(res, 404, '页面不存在');
  const content = await readFile(resolve(publicRoot, entry[0]));
  res.writeHead(200, { 'Content-Type': entry[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + host + ':' + port && origin !== 'http://localhost:' + port) {
        return error(res, 403, '请求来源不受信任');
      }
    }
    if (pathname.startsWith('/api/')) await api(req, res, pathname);
    else if (pathname.startsWith('/screenshots/')) await serveScreenshot(req, res, pathname);
    else if (req.method === 'GET') await serveStatic(res, pathname);
    else error(res, 405, '不支持此方法');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/.test(message)) error(res, 409, '记录已存在');
    else error(res, 400, message);
  }
});
server.listen(port, host, () => process.stdout.write('GEO 监测系统：http://' + host + ':' + port + '\n'));

const timer = setInterval(() => {
  const due = rows("SELECT id,schedule_type,time_hhmm,weekdays_json FROM tasks WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?", now());
  for (const task of due) {
    try {
      if (row("SELECT id FROM runs WHERE task_id=? AND status IN ('running','needs_attention')", task.id)) continue;
      const next = nextRunAt(task.schedule_type, task.time_hhmm, JSON.parse(task.weekdays_json));
      startRun(task.id);
      db.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(next, task.id);
    } catch (err) { process.stderr.write('定时任务失败：' + err.message + '\n'); }
  }
}, 30000);
timer.unref();

async function shutdown() {
  server.close();
  await closeBrowsers();
  db.close();
}
process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
