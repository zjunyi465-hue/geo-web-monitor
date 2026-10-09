import {brandMentioned} from './analysis.js';
import {searchAnswers,validateSearchFilters} from './answer-search.js';
import {buildChangeFeed,CHANGE_STATES} from './change-feed.js';
import {answerReviewView,answerRevision,validateAnswerReview,summarizeAnswerReviews} from './answer-reviews.js';
import {institutionReport,institutionEvidence,institutionDetail,institutionKey,validateInstitutionMerge,REVIEW_CATEGORIES} from './institutions.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { openDatabase } from './db.js';
import { generateQuestions } from './questions.js';
import { summarizeRun } from './analysis.js';
import { buildReport } from './reporting.js';
import {sourceLibrary,sourceAssets,SOURCE_CATEGORIES} from './source-library.js';
import {listTopics,topicSelection,topicTaskState,allocateTopicId} from './topics.js';
import { PLATFORMS, askBrowser, openPlatformForLogin, closeBrowsers, checkAccountLogin, accountBrowserBusy } from './browser.js';
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

function accountInRun(id) {
  return rows("SELECT tasks.*,runs.task_snapshot_json FROM runs JOIN tasks ON tasks.id=runs.task_id WHERE runs.status IN ('running','needs_attention')")
    .some(item => {
      const snapshot = item.task_snapshot_json ? JSON.parse(item.task_snapshot_json) : item;
      return accountsForTask(snapshot).some(account => account.id === id);
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
  const topics=topicSelection(db,brandId,data.topicIds||[]);
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
    brandId, platforms, accountIds, questionIds, topics, type, weekdays, timeHHMM, enabled,
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
      const prior = previous.find(r => r.question_id === job.question_id && r.account_id === job.account_id);
      const retryMode = prior && JSON.parse(prior.diagnostics_json || '{}').retryMode;
      return { ...job, resumeState, retryMode };
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
          if (['LOGIN_REQUIRED', 'HUMAN_VERIFICATION_REQUIRED'].includes(result.errorCode)) {
            db.prepare('UPDATE platform_accounts SET login_check_json=? WHERE id=?').run(JSON.stringify({
              status: result.errorCode === 'LOGIN_REQUIRED' ? 'login_required' : 'verification_required',
              reason: '监测过程中检测到' + (result.errorCode === 'LOGIN_REQUIRED' ? '需要登录。' : '需要人工验证。'),
              checkedAt: result.finishedAt, screenshot: null,
            }), result.account_id);
          }
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
    try {
      db.prepare("UPDATE runs SET status='interrupted', finished_at=?,error=? WHERE id=?")
        .run(now(), err instanceof Error ? err.message : String(err), runId);
    } catch (saveError) {
      process.stderr.write('运行 ' + runId + ' 中断状态暂未保存：' + saveError.message + '\n');
    }
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
    // Explicit retry is a new question; only resume/continue recovers an old
    // submission. Keep attempt history, but discard failed items' checkpoints.
    const failed = rows("SELECT question_id,account_id FROM results WHERE run_id=? AND status='failed'", runId);
    for (const job of failed) clearCheckpoint(db, runId, job);
    db.prepare("UPDATE results SET status='retry_pending',error=NULL,error_code=NULL,screenshot=NULL,diagnostics_json=? WHERE run_id=? AND status='failed'")
      .run(JSON.stringify({ retryMode: 'fresh' }), runId);
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
  for(const result of results)result.review=reviewForResult(result);
  return { run, results, attempts,manualReviewSummary:summarizeAnswerReviews(results) };
}
function savedAnswerReview(resultId){return row('SELECT answer_reviews.*,users.username AS reviewer FROM answer_reviews LEFT JOIN users ON users.id=answer_reviews.reviewed_by WHERE result_id=?',resultId);}
function reviewForResult(result){const review=answerReviewView(result,savedAnswerReview(result.id));if(result.account_id&&row('SELECT count(*) AS n FROM results WHERE run_id=? AND question_id=? AND platform=? AND account_id=?',result.run_id,result.question_id,result.platform,result.account_id).n>1)review.reviewable=false;return review;}
function changesForBrand(brand,filters={}) {
  const records=sourceRecords(brand.id),runs=rows('SELECT runs.*,tasks.name AS task_name FROM runs JOIN tasks ON tasks.id=runs.task_id WHERE tasks.brand_id=?',brand.id);
  const peers=institutionReport(records,brand,rows('SELECT * FROM institution_reviews WHERE brand_id=?',brand.id)).groups.filter(g=>g.category==='peer');
  const annotations=rows('SELECT change_annotations.*,users.username AS reviewer FROM change_annotations LEFT JOIN users ON users.id=change_annotations.reviewed_by WHERE brand_id=?',brand.id);
  return buildChangeFeed({runs,records,peers,annotations,filters});
}
function sourceRecords(brandId) {
  return rows('SELECT results.*,questions.text AS question,questions.kind AS question_kind,runs.started_at AS run_started_at,runs.task_id FROM results JOIN questions ON questions.id=results.question_id JOIN runs ON runs.id=results.run_id JOIN tasks ON tasks.id=runs.task_id WHERE tasks.brand_id=? ORDER BY results.id',brandId);
}
function sourceFilters(query,brandId) {
  const filters=Object.fromEntries(['platform','taskId','questionId','topicId','from','to','kind','category','q','favorite','host','page'].map(k=>[k,query.get(k)||'']));
  if(filters.topicId)filters.questionIds=topicSelection(db,brandId,[filters.topicId]).questionIds;
  for(const key of ['from','to'])if(filters[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filters[key])||!Number.isFinite(Date.parse(filters[key]))||new Date(filters[key]).toISOString().slice(0,10)!==filters[key]))throw new Error('日期格式无效');
  if(filters.from&&filters.to&&filters.from>filters.to)throw new Error('开始日期不能晚于结束日期');
  for(const key of ['taskId','questionId','page'])if(filters[key])parseId(filters[key]);
  if(filters.kind&&!['citation','search'].includes(filters.kind))throw new Error('来源类型无效');
  if(filters.category&&!SOURCE_CATEGORIES.includes(filters.category))throw new Error('分类无效');
  if(filters.favorite&&!['1','0'].includes(filters.favorite))throw new Error('收藏筛选无效');
  filters.favorite=filters.favorite==='1';
  return filters;
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
  if (pathname === '/api/answer-search' || pathname === '/api/answer-search/evidence') {
    if (method !== 'GET') return error(res,405,'请求方法不支持');
    const query=new URL(req.url,'http://localhost').searchParams,brandId=parseId(query.get('brandId'));
    if (!row('SELECT id FROM brands WHERE id=?',brandId)) return error(res,404,'品牌不存在');
    const filters=validateSearchFilters(query);
    if (filters.platform && !PLATFORMS[filters.platform]) return error(res,400,'平台无效');
    if (filters.topicId) filters.questionIds=topicSelection(db,brandId,[filters.topicId]).questionIds;
    if (!filters.q && pathname === '/api/answer-search') return json(res,200,{search:searchAnswers([],filters)});
    const records=rows('SELECT results.*,questions.text AS question,runs.started_at AS run_started_at,runs.task_id,runs.task_snapshot_json,tasks.name AS task_name FROM results JOIN questions ON questions.id=results.question_id JOIN runs ON runs.id=results.run_id JOIN tasks ON tasks.id=runs.task_id WHERE tasks.brand_id=? ORDER BY results.id',brandId);
    if (pathname === '/api/answer-search/evidence') {
      const evidence=searchAnswers(records,filters,parseId(query.get('resultId')));
      if (!evidence) return error(res,404,'回答不在当前检索结果中，请重新搜索');
      return json(res,200,{evidence});
    }
    return json(res,200,{search:searchAnswers(records,filters)});
  }
  if(pathname==='/api/change-feed'||pathname==='/api/change-feed/tracking'){
    const query=new URL(req.url,'http://localhost').searchParams;
    if(pathname==='/api/change-feed'&&method==='GET'){
      const brand=row('SELECT * FROM brands WHERE id=?',parseId(query.get('brandId')));if(!brand)return error(res,404,'品牌不存在');
      const filters=Object.fromEntries(['taskId','platform','accountId','topicId','from','to','type','status'].map(k=>[k,query.get(k)||'']));
      const comparison=query.get('comparison')||'all';
      if(!['all','confirmed','observed'].includes(comparison))return error(res,400,'记录范围无效');
      for(const key of ['taskId','accountId'])if(filters[key])parseId(filters[key]);
      for(const key of ['from','to'])if(filters[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filters[key])||!Number.isFinite(Date.parse(filters[key]))||new Date(filters[key]).toISOString().slice(0,10)!==filters[key]))return error(res,400,'日期格式无效');
      if(filters.from&&filters.to&&filters.from>filters.to)return error(res,400,'开始日期不能晚于结束日期');
      if(filters.status&&!CHANGE_STATES.includes(filters.status))return error(res,400,'跟进状态无效');
      if(filters.type&&!['own_gained','own_lost','peer_gained','peer_lost','peer_only','source_changed'].includes(filters.type))return error(res,400,'变化类型无效');
      if(filters.topicId)filters.questionIds=topicSelection(db,brand.id,[filters.topicId]).questionIds;
      const feed=changesForBrand(brand,filters),page=query.get('page')?parseId(query.get('page')):1;
      const items=[...(comparison==='observed'?[]:feed.events.map(e=>({...e,comparison:'confirmed'}))),...(comparison==='confirmed'?[]:feed.observations.map(e=>({...e,comparison:'observed'})))].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||b.after.resultId-a.after.resultId);
      // Existing clients keep their strict-event pagination. The redesigned view explicitly requests a combined timeline.
      const combined=query.has('comparison'),pageCount=Math.max(1,Math.ceil((combined?items.length:feed.events.length)/20)),selectedPage=Math.min(page,pageCount);
      return json(res,200,{feed:{...feed,items:items.slice((selectedPage-1)*20,selectedPage*20),itemTotal:items.length,comparison,events:feed.events.slice((selectedPage-1)*20,selectedPage*20),observations:feed.observations.slice(0,20),excluded:feed.excluded.slice(0,20),exclusionReasons:Object.entries(feed.excluded.reduce((counts,item)=>(counts[item.reason]=(counts[item.reason]||0)+1,counts),{})).map(([reason,count])=>({reason,count})),page:selectedPage,pageCount}});
    }
    if(pathname==='/api/change-feed/tracking'&&method==='PUT'){
      const input=await body(req);if(!input||typeof input!=='object'||!CHANGE_STATES.includes(input.status)||typeof input.key!=='string'||!/^([a-f0-9]{64})$/.test(input.key))return error(res,400,'跟进参数无效');
      db.exec('BEGIN IMMEDIATE');let response;
      try{
        const brand=row('SELECT * FROM brands WHERE id=?',parseId(input.brandId));if(!brand){db.exec('ROLLBACK');return error(res,404,'品牌不存在');}
        const event=changesForBrand(brand).events.find(e=>e.key===input.key);if(!event){db.exec('ROLLBACK');return error(res,409,'原文或竞品名单已变化，请刷新后重新核对');}
        if(input.expectedUpdatedAt!==event.tracking.updatedAt){db.exec('ROLLBACK');return error(res,409,'其他成员已更新跟进状态，请刷新后再操作');}
        const updatedAt=new Date(Math.max(Date.now(),Date.parse(event.tracking.updatedAt||'')+1||0)).toISOString();
        db.prepare('INSERT INTO change_annotations(brand_id,event_key,before_result_id,after_result_id,status,reviewed_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(brand_id,event_key) DO UPDATE SET status=excluded.status,reviewed_by=excluded.reviewed_by,updated_at=excluded.updated_at').run(brand.id,event.key,event.before.resultId,event.after.resultId,input.status,user.id,updatedAt);
        response={status:input.status,updatedAt,reviewer:user.username};db.exec('COMMIT');
      }catch(err){db.exec('ROLLBACK');throw err;}
      return json(res,200,{tracking:response});
    }
    return error(res,405,'请求方法不支持');
  }
  const answerReviewRoute=/^\/api\/results\/(\d+)\/review$/.exec(pathname);
  if(answerReviewRoute){
    const id=parseId(answerReviewRoute[1]);
    if(method==='GET'){const result=row('SELECT * FROM results WHERE id=?',id);if(!result)return error(res,404,'回答不存在');return json(res,200,{resultId:id,runId:result.run_id,answer:result.answer||'',review:reviewForResult(result)});}
    if(method!=='PUT')return error(res,405,'请求方法不支持');
    const input=await body(req);db.exec('BEGIN IMMEDIATE');
    try{
      const result=row('SELECT * FROM results WHERE id=?',id);if(!result){db.exec('ROLLBACK');return error(res,404,'回答不存在');}
      const saved=savedAnswerReview(id);
      if(input.expectedRevision!==answerRevision(result)||input.expectedUpdatedAt!==(saved?.updated_at||null)){db.exec('ROLLBACK');return error(res,409,'回答或复核已变化，请重新打开复核；当前草稿可保留复制');}
      if(result.account_id&&row('SELECT count(*) AS n FROM results WHERE run_id=? AND question_id=? AND platform=? AND account_id=?',result.run_id,result.question_id,result.platform,result.account_id).n>1)throw new Error('回答归属不唯一，请先核对采集记录');
      const checked=validateAnswerReview(result,input),updatedAt=new Date(Math.max(Date.now(),Date.parse(saved?.updated_at||'')+1||0)).toISOString();
      db.prepare('INSERT INTO answer_reviews(result_id,answer_revision,status,notes,excerpt_start,excerpt_end,excerpt_text,reviewed_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(result_id) DO UPDATE SET answer_revision=excluded.answer_revision,status=excluded.status,notes=excluded.notes,excerpt_start=excluded.excerpt_start,excerpt_end=excluded.excerpt_end,excerpt_text=excluded.excerpt_text,reviewed_by=excluded.reviewed_by,updated_at=excluded.updated_at').run(id,answerRevision(result),checked.status,checked.notes,checked.excerpt?.start??null,checked.excerpt?.end??null,checked.excerpt?.text??null,user.id,updatedAt);
      db.exec('COMMIT');return json(res,200,{review:answerReviewView(result,savedAnswerReview(id))});
    }catch(err){db.exec('ROLLBACK');throw err;}
  }
  if(['/api/institutions','/api/institutions/detail','/api/institutions/evidence','/api/institutions/review'].includes(pathname)){
    const query=new URL(req.url,'http://localhost').searchParams,input=method==='PUT'?await body(req):null;
    const brandId=parseId(input?.brandId??query.get('brandId')),brand=row('SELECT * FROM brands WHERE id=?',brandId);if(!brand)return error(res,404,'品牌不存在');
    const records=sourceRecords(brandId),annotations=rows('SELECT * FROM institution_reviews WHERE brand_id=?',brandId);
    const clean=new URLSearchParams(query);for(const key of ['category','kind','q','favorite','host'])clean.delete(key);
    const filters=sourceFilters(clean,brandId);if(query.get('accountId'))filters.accountId=parseId(query.get('accountId'));
    const report=institutionReport(records,brand,annotations,filters);
    if(method==='GET'&&pathname==='/api/institutions'){
      const q=(query.get('q')||'').toLocaleLowerCase(),category=query.get('category')||'';if(category&&!REVIEW_CATEGORIES.includes(category))throw new Error('机构分类无效');
      const groups=report.groups.filter(g=>(category?g.category===category:g.category!=='wrong')&&(!q||g.names.some(n=>n.toLocaleLowerCase().includes(q))||g.name.toLocaleLowerCase().includes(q)));
      const pageCount=Math.max(1,Math.ceil(groups.length/20)),page=Math.min(Number(filters.page)||1,pageCount);
      return json(res,200,{report:{summary:report.summary,comparisons:report.groups.filter(g=>g.category==='peer'),questions:report.questions,groups:groups.slice((page-1)*20,page*20),total:groups.length,page,pageCount,reviews:report.reviews}});
    }
    if(method==='GET'&&pathname==='/api/institutions/detail'){
      const detail=institutionDetail(report,query.get('key'));
      const paginate=(items,param)=>{const count=Math.max(1,Math.ceil(items.length/20)),page=Math.min(query.get(param)?parseId(query.get(param)):1,count);return {items:items.slice((page-1)*20,page*20),total:items.length,page,pageCount:count};};
      return json(res,200,{detail:{...detail,questions:paginate(detail.questions,'questionPage'),sources:paginate(detail.sources,'sourcePage')}});
    }
    if(method==='GET'&&pathname==='/api/institutions/evidence'){
      const mode=query.get('mode')||'body';if(!['body','eligible','withoutOwn','citation','search'].includes(mode))throw new Error('证据类型无效');
      const extra={};if(query.get('questionId'))extra.questionId=parseId(query.get('questionId'));
      if(query.get('detailPlatform')){if(!PLATFORMS[query.get('detailPlatform')])throw new Error('平台无效');extra.detailPlatform=query.get('detailPlatform');}
      if(query.get('detailAccount'))extra.detailAccount=query.get('detailAccount')==='unknown'?'unknown':parseId(query.get('detailAccount'));
      if(query.get('sourceUrl')){extra.sourceUrl=query.get('sourceUrl');extra.sourceKind=query.get('sourceKind');extra.sourceRelation=query.get('sourceRelation');if(!['citation','search'].includes(extra.sourceKind)||!['body','named'].includes(extra.sourceRelation)||mode!==(extra.sourceRelation==='body'?'body':extra.sourceKind==='search'?'search':'citation'))throw new Error('来源证据范围无效');}
      const items=institutionEvidence(report,query.get('key'),mode,extra),page=query.get('evidencePage')?parseId(query.get('evidencePage')):1,pageCount=Math.max(1,Math.ceil(items.length/10)),selectedPage=Math.min(page,pageCount);
      return json(res,200,{evidence:items.slice((selectedPage-1)*10,selectedPage*10),total:items.length,page:selectedPage,pageCount});
    }
    if(method==='PUT'&&pathname==='/api/institutions/review'){
      const name=text(input.name,'机构名称',100),key=institutionKey(name);
      if(!REVIEW_CATEGORIES.includes(input.category)||typeof input.notes!=='string'||input.notes.length>2000||typeof input.mergeInto!=='string')throw new Error('机构分类、备注或合并格式无效');
      if(brandMentioned(name,brand))throw new Error('我方名称不作为其他机构');
      const exists=report.reviews.some(a=>a.key===key)||[...report.evidence.values()].some(e=>brandMentioned(e.answer,{name})||[...e.citations,...e.search].some(c=>brandMentioned(c.title,{name})));
      if(!exists)return error(res,404,'名称未出现在该品牌的有效回答或来源标题中');
      const existing=annotations.find(a=>a.name_key===key);if(input.expectedUpdatedAt!==(existing?.updated_at||null))return error(res,409,'机构记录已被其他成员修改，请刷新后再保存');
      const target=input.mergeInto;
      if(input.category==='wrong'&&target)throw new Error('标为识别错误前请解除该名称的合并');
      if(target&&!report.groups.some(g=>g.category!=='wrong'&&g.names.some(n=>institutionKey(n)===target)))throw new Error('合并目标不存在、被标为识别错误或不在当前品牌');
      validateInstitutionMerge(key,target,annotations);
      db.prepare('INSERT INTO institution_reviews(brand_id,name_key,name,category,merge_into,notes,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(brand_id,name_key) DO UPDATE SET name=excluded.name,category=excluded.category,merge_into=excluded.merge_into,notes=excluded.notes,updated_at=excluded.updated_at').run(brandId,key,name,input.category,target||null,input.notes,new Date(Math.max(Date.now(),Date.parse(existing?.updated_at||'')+1||0)).toISOString());
      return json(res,200,{ok:true});
    }
    return error(res,405,'请求方法不支持');
  }

  if(['/api/source-library','/api/source-library/evidence','/api/source-library/annotation'].includes(pathname)) {
    const query=new URL(req.url,'http://localhost').searchParams;
    const input=method==='PUT'?await body(req):null;
    const brandId=parseId(input?.brandId??query.get('brandId'));
    if(!row('SELECT id FROM brands WHERE id=?',brandId))return error(res,404,'品牌不存在');
    const records=sourceRecords(brandId),annotations=rows('SELECT * FROM source_annotations WHERE brand_id=?',brandId);
    if(pathname==='/api/source-library'&&method==='GET')return json(res,200,{library:sourceLibrary(records,annotations,sourceFilters(query,brandId))});
    if(pathname==='/api/source-library/evidence'&&method==='GET') {
      const filters=sourceFilters(query,brandId);
      const asset=sourceAssets(records,annotations,filters).find(a=>a.url===query.get('url')&&(!filters.host||a.host===filters.host));
      if(!asset)return error(res,404,'当前筛选中没有该来源');
      const page=query.get('evidencePage')?parseId(query.get('evidencePage')):1;
      const pageCount=Math.max(1,Math.ceil(asset.evidence.length/10)),selectedPage=Math.min(page,pageCount);
      const evidence=asset.evidence.slice((selectedPage-1)*10,selectedPage*10).map(e=>({...e,answer:records.find(r=>r.id===e.resultId)?.answer||''}));
      return json(res,200,{asset:{...asset,evidence:undefined},evidence,total:asset.evidence.length,page:selectedPage,pageCount});
    }
    if(pathname==='/api/source-library/annotation'&&method==='PUT') {
      if(typeof input.url!=='string'||input.url.length>8192||!sourceAssets(records).some(a=>a.url===input.url))return error(res,404,'来源不存在');
      if(!SOURCE_CATEGORIES.includes(input.category)||typeof input.favorite!=='boolean'||typeof input.notes!=='string'||input.notes.length>2000)return error(res,400,'分类、收藏或备注格式无效，备注最多2000字');
      db.prepare('INSERT INTO source_annotations(brand_id,url,category,favorite,notes,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,url) DO UPDATE SET category=excluded.category,favorite=excluded.favorite,notes=excluded.notes,updated_at=excluded.updated_at').run(brandId,input.url,input.category,Number(input.favorite),input.notes,now());
      return json(res,200,{ok:true});
    }
    return error(res,405,'请求方法不支持');
  }
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
    return json(res, 200, { accounts: rows("SELECT id,platform,label,notes,created_at,last_status,last_error,last_checked_at,login_check_json,profile_key=('legacy-' || platform) AS is_default FROM platform_accounts ORDER BY platform,id")
      .map(account => ({ ...account, loginCheck: account.login_check_json ? JSON.parse(account.login_check_json) : null,
        inUse: accountInRun(account.id) || accountBrowserBusy(account) })) });
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
  const accountCheck = /^\/api\/platform-accounts\/(\d+)\/check-login$/.exec(pathname);
  if (accountCheck && method === 'POST') {
    const account = row('SELECT * FROM platform_accounts WHERE id=?', parseId(accountCheck[1]));
    if (!account) return error(res, 404, '平台账号不存在');
    if (accountInRun(account.id) || accountBrowserBusy(account)) return error(res, 409, '账号正在监测或等待人工处理，请先完成该任务，再检查登录。');
    const check = await checkAccountLogin(account);
    db.prepare('UPDATE platform_accounts SET login_check_json=? WHERE id=?').run(JSON.stringify(check), account.id);
    return json(res, 200, { check });
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
  const topicsRoute=/^\/api\/brands\/(\d+)\/topics$/.exec(pathname);
  if(topicsRoute){
    const brandId=parseId(topicsRoute[1]);if(!row('SELECT id FROM brands WHERE id=?',brandId))return error(res,404,'品牌不存在');
    if(method==='GET')return json(res,200,{topics:listTopics(db,brandId)});
    if(method==='POST'){const input=await body(req);const name=text(input.name,'专题名称',100);if(row('SELECT id FROM question_topics WHERE brand_id=? AND name=?',brandId,name))return error(res,409,'已有同名专题');db.exec('BEGIN');try{const id=allocateTopicId(db);db.prepare('INSERT INTO question_topics(id,brand_id,name,created_at) VALUES(?,?,?,?)').run(id,brandId,name,now());db.exec('COMMIT');}catch(err){db.exec('ROLLBACK');throw err;}return json(res,201,{topics:listTopics(db,brandId)});}
  }
  const topicRoute=/^\/api\/topics\/(\d+)$/.exec(pathname);
  if(topicRoute){
    const id=parseId(topicRoute[1]),existing=row('SELECT * FROM question_topics WHERE id=?',id);if(!existing)return error(res,404,'专题不存在');
    if(method==='PUT'){const input=await body(req),name=text(input.name,'专题名称',100);if(row('SELECT id FROM question_topics WHERE brand_id=? AND name=? AND id<>?',existing.brand_id,name,id))return error(res,409,'已有同名专题');db.prepare('UPDATE question_topics SET name=? WHERE id=?').run(name,id);return json(res,200,{ok:true});}
    if(method==='DELETE'){db.prepare('DELETE FROM question_topics WHERE id=?').run(id);return json(res,200,{ok:true});}
  }
  const membership=/^\/api\/topics\/(\d+)\/questions$/.exec(pathname);
  if(membership&&method==='POST'){
    const id=parseId(membership[1]),topic=row('SELECT * FROM question_topics WHERE id=?',id);if(!topic)return error(res,404,'专题不存在');
    const input=await body(req);if(!['add','remove'].includes(input.operation)||!Array.isArray(input.questionIds)||!input.questionIds.length||input.questionIds.length>200)throw new Error('请选择1～200个问题及有效操作');
    const ids=[...new Set(input.questionIds.map(parseId))];for(const q of ids)if(!row('SELECT id FROM questions WHERE id=? AND brand_id=?',q,topic.brand_id))throw new Error('问题不属于该专题品牌');
    db.exec('BEGIN');try{for(const q of ids)db.prepare(input.operation==='add'?'INSERT OR IGNORE INTO topic_questions(topic_id,question_id) VALUES(?,?)':'DELETE FROM topic_questions WHERE topic_id=? AND question_id=?').run(id,q);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return json(res,200,{ok:true});
  }
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
    return json(res, 200, { tasks: rows('SELECT tasks.*,brands.name AS brand_name FROM tasks JOIN brands ON brands.id=tasks.brand_id ORDER BY tasks.id DESC').map(t=>({...t,...topicTaskState(db,t)})) });
  }
  if (pathname === '/api/tasks' && method === 'POST') {
    const task = taskInput(await body(req));
    db.exec('BEGIN');let info;try {info = db.prepare('INSERT INTO tasks(brand_id,name,platforms_json,question_ids_json,schedule_type,weekdays_json,time_hhmm,enabled,next_run_at,created_at,account_ids_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(task.brandId, task.name, JSON.stringify(task.platforms), JSON.stringify(task.questionIds), task.type,
        JSON.stringify(task.weekdays), task.timeHHMM, task.enabled ? 1 : 0, task.next, now(), JSON.stringify(task.accountIds));
    db.prepare('UPDATE tasks SET topic_ids_json=?,topic_snapshot_json=? WHERE id=?').run(JSON.stringify(task.topics.ids),JSON.stringify(task.topics.snapshot),Number(info.lastInsertRowid));db.exec('COMMIT');}catch(err){db.exec('ROLLBACK');throw err;}
    return json(res, 201, { task: row('SELECT * FROM tasks WHERE id=?', Number(info.lastInsertRowid)) });
  }
  const taskRoute = /^\/api\/tasks\/(\d+)$/.exec(pathname);
  if (taskRoute && method === 'PUT') {
    const input = await body(req);
    const id = parseId(taskRoute[1]);
    const existing = row('SELECT * FROM tasks WHERE id=?', id);
    if (!existing) return error(res, 404, '任务不存在');
    if (row("SELECT id FROM runs WHERE task_id=? AND status IN ('running','needs_attention') LIMIT 1", id)) {
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
      db.prepare('UPDATE tasks SET topic_ids_json=?,topic_snapshot_json=? WHERE id=?').run(JSON.stringify(task.topics.ids),JSON.stringify(task.topics.snapshot),id);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return json(res, 200, { task: row('SELECT * FROM tasks WHERE id=?', id) });
  }
  const toggle = /^\/api\/tasks\/(\d+)\/toggle$/.exec(pathname);
  const topicSync=/^\/api\/tasks\/(\d+)\/sync-topics$/.exec(pathname);
  if(topicSync&&method==='POST'){
    const input=await body(req);
    const id=parseId(topicSync[1]),task=row('SELECT * FROM tasks WHERE id=?',id);if(!task)return error(res,404,'任务不存在');
    if(row("SELECT id FROM runs WHERE task_id=? AND status IN ('running','needs_attention')",id))throw new Error('任务运行或等待人工处理，请结束后更新');
    const selected=topicSelection(db,task.brand_id,JSON.parse(task.topic_ids_json||'[]'));if(!selected.questionIds.length)throw new Error('专题当前没有问题，请编辑任务选择问题');
    const expectedTask={questionIds:JSON.parse(task.question_ids_json),topicIds:JSON.parse(task.topic_ids_json||'[]')};
    if(JSON.stringify(input.expectedTask)!==JSON.stringify(expectedTask)||JSON.stringify(input.expectedTopics)!==JSON.stringify(selected.snapshot))return error(res,409,'任务或专题已变化，请刷新后重新确认更新');
    db.exec('BEGIN');try{db.prepare('UPDATE runs SET task_snapshot_json=? WHERE task_id=? AND task_snapshot_json IS NULL').run(JSON.stringify(task),id);db.prepare('UPDATE tasks SET question_ids_json=?,topic_snapshot_json=? WHERE id=?').run(JSON.stringify(selected.questionIds),JSON.stringify(selected.snapshot),id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return json(res,200,{ok:true});
  }
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
  if (pathname === '/api/analytics' && method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const brandId = parseId(query.get('brandId'));
    const currentBrand = row('SELECT * FROM brands WHERE id=?', brandId);
    if (!currentBrand) return error(res, 404, '品牌不存在');
    const filters = Object.fromEntries(['taskId', 'cohort', 'platform', 'accountId', 'topicId','kind', 'from', 'to'].map(k => [k, query.get(k) || '']));
    if(filters.topicId)filters.questionIds=topicSelection(db,brandId,[filters.topicId]).questionIds;
    for (const key of ['from', 'to']) if (filters[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(Date.parse(filters[key])) || new Date(filters[key]).toISOString().slice(0,10)!==filters[key])) return error(res, 400, '日期格式无效');
    if(filters.kind && !['brand','discovery'].includes(filters.kind)) return error(res,400,'问题类型无效');
    for(const key of ['taskId','accountId']) if(filters[key]) parseId(filters[key]);
    if (filters.from && filters.to && filters.from > filters.to) return error(res, 400, '开始日期不能晚于结束日期');
    const runs = rows('SELECT runs.*,tasks.name AS task_name FROM runs JOIN tasks ON tasks.id=runs.task_id WHERE tasks.brand_id=? ORDER BY runs.id', brandId);
    const entries = [];
    const manifest = [];
    for (const run of runs) {
      const task = run.task_snapshot_json ? JSON.parse(run.task_snapshot_json) : row('SELECT * FROM tasks WHERE id=?', run.task_id);
      const brand = run.brand_snapshot_json ? JSON.parse(run.brand_snapshot_json) : currentBrand;
      const frozenAccountIds=run.task_snapshot_json&&task.account_ids_json?JSON.parse(task.account_ids_json):[];
      const cohort = run.task_snapshot_json && run.brand_snapshot_json && frozenAccountIds.length ? JSON.stringify([run.task_id,
        JSON.parse(task.question_ids_json || '[]').sort((a,b)=>a-b), JSON.parse(task.account_ids_json || '[]').sort((a,b)=>a-b),
        brand.name, brand.aliases || '', brand.website || '']) : null;
      const actual = rows('SELECT results.*,questions.text AS question,questions.kind FROM results JOIN questions ON questions.id=results.question_id WHERE run_id=?', run.id);
      // A current default account cannot establish the identity of a historical job.
      const accountIds=frozenAccountIds;
      const accounts=accountIds.map(id=>row('SELECT * FROM platform_accounts WHERE id=?',id)).filter(Boolean);
      const questions = JSON.parse(task.question_ids_json || '[]').map(id => row('SELECT * FROM questions WHERE id=?', id)).filter(Boolean);
      const expected = [];
      for (const account of accounts) for (const q of questions) {
        if (actual.length + expected.length >= run.total) continue;
        if (!actual.some(r => r.question_id === q.id && r.account_id === account.id)) expected.push({ question_id: q.id, question: q.text, kind: q.kind, account_id: account.id, account_label: account.label, platform: account.platform, status: 'pending' });
      }
      const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(run.started_at));
      manifest.push({id:run.id,task_id:run.task_id,task_name:task.name,questionIds:JSON.parse(task.question_ids_json||'[]'),status:run.status,started_at:run.started_at,cohort,day,total:run.total,located:actual.length+expected.length});
      for (const r of [...actual, ...expected]) entries.push({
        key: run.id + ':' + r.platform + ':' + r.account_id + ':' + r.question_id, run_id: run.id, run_status:run.status, run_started_at:run.started_at, task_id:run.task_id, cohort, task_name: task.name,
        day,
        started_at: r.started_at || run.started_at, question_id: r.question_id, question: r.question, kind: r.kind,
        account_id: r.account_id, account_label: r.account_label || '默认账号', platform: r.platform,
        resultId:r.id||null,review:r.id?reviewForResult(r):null,
        status: r.status, answer: r.answer || '', error: r.error || '', brand,brandBasis:run.brand_snapshot_json?'snapshot':'current_fallback',
        citations: JSON.parse(r.citations_json || '[]'), searchedSites: JSON.parse(r.searched_sites_json || '[]'),
        screenshot: r.screenshot ? '/screenshots/' + run.id + '/' + r.screenshot.replaceAll('\\', '/').split('/').pop() : null,
        citationGap: Number.isInteger(r.reported_citation_count) && JSON.parse(r.citations_json || '[]').length < r.reported_citation_count,
        reportedCitationCount:r.reported_citation_count??null,
        monitorConditions:JSON.parse(r.diagnostics_json||'{}').monitorConditions||null,
        conditionsAfter:JSON.parse(r.diagnostics_json||'{}').conditionsAfter||null,
      });
    }
    const report=buildReport(entries,filters,manifest);report.manualReviews=summarizeAnswerReviews(report.records);
    return json(res, 200, { report, filters });
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
    else if (pathname.startsWith('/account-check-screenshots/')) {
      if (!requireUser(req, res)) return;
      const match = /^\/account-check-screenshots\/(account-\d+-\d+\.png)$/.exec(pathname);
      if (!match) return error(res, 404, '图片不存在');
      try { const content = await readFile(resolve(process.env.GEO_RESULTS_ROOT || 'results', 'account-checks', match[1]));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); res.end(content);
      } catch { error(res, 404, '图片不存在'); }
    }
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
