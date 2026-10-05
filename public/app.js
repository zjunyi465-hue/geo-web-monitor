const root = document.getElementById('root');
const state = { user: null, brands: [], questions: [], tasks: [], runs: [], platforms: [], accounts: [], users: [], tab: 'overview', brandId: null, runId: null, detail: null, report: null, generated: [] };
let message = '';
let messageError = false;
let busy = false;
let creatingBrand = false;
let editingTaskId = null;
let editingTaskQuestions = [];
let editingAccountId = null;
let accountFilter = { platform: '', search: '' };
let runningTaskId = null;
let runningTaskQuestions = [];
let resultsPage = 1;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateText = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
const pct = value => value === null || value === undefined ? '暂无数据' : (value * 100).toFixed(1) + '%';
const citationHost = value => { try { return new URL(value).hostname; } catch { return ''; } };
function notice(text, isError = false) {
  message = text; messageError = isError;
  root.querySelector('[data-notice]')?.remove();
  const box = document.createElement('div');
  box.dataset.notice = '';
  box.className = 'message' + (isError ? ' error' : '');
  box.textContent = text;
  (root.querySelector('main') || root.querySelector('.login-card') || root).prepend(box);
}
function setBusy(value) {
  busy = value;
  root.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = value || control.dataset.unavailable === 'true'; });
}
async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
const post = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) });
const put = (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) });
async function refresh() {
  const calls = await Promise.all([
    request('/api/brands'), request('/api/tasks'), request('/api/runs'), request('/api/platforms'), request('/api/platform-accounts'),
  ]);
  state.brands = calls[0].brands;
  state.tasks = calls[1].tasks;
  state.runs = calls[2].runs;
  state.platforms = calls[3].platforms.sort((a, b) => (a.id === 'doubao' ? -1 : 1) - (b.id === 'doubao' ? -1 : 1));
  state.accounts = calls[4].accounts;
  if (!state.brandId && state.brands.length) state.brandId = state.brands[0].id;
  if (state.brandId) state.questions = (await request('/api/brands/' + state.brandId + '/questions')).questions;
  if (state.user?.role === 'admin') state.users = (await request('/api/users')).users;
  if (state.runId) {
    state.detail = await request('/api/runs/' + state.runId);
    state.report = await request('/api/runs/' + state.runId + '/report');
  }
  render();
}
async function bootstrap() {
  const setup = await request('/api/bootstrap');
  if (!setup.needsSetup) {
    try { state.user = (await request('/api/me')).user; } catch { /* login page */ }
  }
  if (state.user) await refresh();
  else renderAuth(setup.needsSetup);
}
function renderAuth(needsSetup) {
  root.innerHTML = '<div class="login-page"><div class="card login-card"><h1>GEO 网页监测</h1><p class="lead">' +
    (needsSetup ? '首次启动：请创建管理员账号。' : '请登录，查看团队监测项目。') +
    '</p><form id="' + (needsSetup ? 'setupForm' : 'loginForm') + '">' +
    '<label>用户名<input name="username" autocomplete="username" required></label>' +
    '<label>密码<input name="password" type="password" minlength="10" autocomplete="' + (needsSetup ? 'new-password' : 'current-password') + '" required></label>' +
    '<button type="submit">' + (needsSetup ? '创建管理员' : '登录') + '</button></form>' +
    (message ? '<p data-notice class="message error">' + esc(message) + '</p>' : '') + '</div></div>';
}
function navButton(id, label) {
  return '<button data-action="tab" data-id="' + id + '" class="' + (state.tab === id ? 'active' : '') + '">' + label + '</button>';
}
function brandSelect() {
  const showDraft = state.tab === 'brands' && creatingBrand;
  return '<select id="brandSelect">' + (showDraft ? '<option value="" selected disabled>正在新建品牌</option>' : '') +
    state.brands.map(b => '<option value="' + b.id + '"' +
    (!showDraft && b.id === state.brandId ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select>';
}
function selectedBrandId() {
  if (!state.brands.some(brand => brand.id === state.brandId)) throw new Error('请先保存品牌资料并选择品牌');
  return state.brandId;
}
function pill(status) {
  const label = ({ succeeded: '成功', failed: '失败', partial: '部分失败', running: '运行中', completed: '全部成功',
    interrupted: '已中断', needs_attention: '等待人工处理', retry_pending: '等待重试' })[status] || status;
  return '<span class="pill ' + esc(status) + '">' + esc(label) + '</span>';
}
function accountHealth(account) {
  const labels = { unknown: '尚未采集', recent_success: '最近采集成功', login_required: '需要登录',
    verification_required: '需要人工验证', error: '最近采集失败' };
  return labels[account.last_status] || '尚未采集';
}
function networkRequestsView(failures, status) {
  if (!failures?.length) return '';
  const groups = new Map();
  for (const item of failures) {
    const address = (item.host || '') + (item.path || '');
    const reason = item.error || 'HTTP ' + item.status;
    const key = address + ' ' + reason;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { address, reason, count: 1,
      explanation: item.host === 'cdn.deepseek.com' && (item.path || '').startsWith('/site-icons/')
        ? '来源网站的小图标加载失败，不代表来源网页无法打开。'
        : '网页请求失败，具体用途及对采集的影响未确认。' });
  }
  return '<details class="network-diagnostics"><summary>' +
    (status === 'succeeded' ? '采集成功，期间有部分网页请求失败（影响未确认）' : '网页请求诊断（不单独判定问答是否成功）') +
    '</summary><p class="muted">以下仅记录页面请求失败；系统没有逐个打开引用来源验证可访问性。' +
    (status === 'succeeded' ? '本次已取得回答正文，引用是否完整请结合来源数量和截图核对。' : '本次执行状态和失败原因请查看上方记录。') +
    '</p><ul>' + [...groups.values()].map(item => '<li><strong>' + esc(item.explanation) + '</strong><br><span class="muted">' +
      esc(item.address + ' · ' + item.reason) + (item.count > 1 ? '（重复 ' + item.count + ' 次）' : '') +
      '</span></li>').join('') + '</ul></details>';
}
function render() {
  if (!state.user) return;
  const main = ({
    overview: overviewView,
    brands: brandsView,
    questions: questionsView,
    accounts: accountsView,
    monitor: monitorView,
    results: resultsView,
    admin: adminView,
  })[state.tab]();
  root.innerHTML = '<div class="layout"><aside class="sidebar"><div class="brandmark"><span class="brand-icon">◎</span><span>GEO <em>Monitor</em></span></div><div class="nav-caption">工作空间</div><nav class="nav">' +
    navButton('overview', '工作台') + navButton('brands', '品牌资料') +
    navButton('questions', '问题池') + navButton('accounts', '平台账号池') + navButton('monitor', '监测任务') +
    navButton('results', '结果与报告') +
    (state.user.role === 'admin' ? navButton('admin', '团队管理') : '') +
    '</nav><div class="sidefoot"><span class="avatar">' + esc(state.user.username.slice(0, 1).toUpperCase()) + '</span><span>' + esc(state.user.username) + '<small>' + (state.user.role === 'admin' ? '管理员' : '成员') + '</small></span>' +
    '<br><button class="ghost" data-action="logout">退出登录</button></div></aside><main>' +
    '<div class="topline"><span class="eyebrow">GEO / 网页监测工作台</span><span class="local-badge">● 本地运行</span></div>' +
    (message ? '<div data-notice class="message ' + (messageError ? 'error' : '') + '">' + esc(message) + '</div>' : '') +
    main + '</main></div>';
  if (busy) setBusy(true);
}
function overviewView() {
  const done = state.runs.filter(x => x.status === 'completed').length;
  const running = state.runs.filter(x => x.status === 'running').length;
  return '<div class="hero"><div><span class="eyebrow">MONITORING WORKSPACE</span><h1>让每一次 AI 回答都有迹可循</h1><p>从真实网页采集回答、参考来源与截图，持续观察品牌在不同账号中的呈现。</p></div><div class="hero-orb">GEO</div></div>' +
    '<div class="grid three">' +
    '<div class="card"><div class="muted">品牌项目</div><div class="stat">' + state.brands.length + '</div></div>' +
    '<div class="card"><div class="muted">监测任务</div><div class="stat">' + state.tasks.length + '</div></div>' +
    '<div class="card"><div class="muted">已完成 / 运行中</div><div class="stat">' + done + ' / ' + running + '</div></div></div>' +
    '<div class="card"><h2>开始一次监测</h2><div class="steps"><span>01 · 品牌资料</span><span>02 · 问题池</span><span>03 · 平台账号</span><span>04 · 监测任务</span><span>05 · 结果报告</span></div>' +
    '<p class="muted">每个平台账号使用独立的本地浏览器资料。首次运行前请先在“平台账号池”中打开并登录。</p></div>' +
    '<div class="card"><h2>最近运行</h2>' + runsTable(state.runs.slice(0, 5)) + '</div>';
}
function accountsView() {
  const selected = state.accounts.find(a => a.id === editingAccountId);
  const filtered = state.accounts.filter(a => (!accountFilter.platform || a.platform === accountFilter.platform) &&
    (a.label + ' ' + (a.notes || '')).toLowerCase().includes(accountFilter.search.toLowerCase()));
  return '<div class="page-heading"><div><span class="eyebrow">PLATFORM ACCOUNTS</span><h1>平台账号池</h1><p class="lead">每个账号有独立的 Edge 登录状态。创建账号后，请在对应窗口手动登录。</p></div><span class="count-chip">' + state.accounts.length + ' 个账号</span></div>' +
    (selected && state.user.role === 'admin' ? '<div class="card" id="editAccountPanel"><h2>编辑账号</h2><p class="muted">' +
      esc(state.platforms.find(p => p.id === selected.platform)?.label) + ' · 账号 #' + selected.id +
      '。修改名称和备注会保留登录状态、任务关联及历史记录。</p><form id="editAccountForm" data-id="' + selected.id + '" class="form-grid">' +
      '<label>账号名称<input name="label" required maxlength="100" value="' + esc(selected.label) + '"></label>' +
      '<label class="full">备注（选填）<textarea name="notes" maxlength="1000" placeholder="例如：负责人、用途或门店">' + esc(selected.notes) + '</textarea></label>' +
      '<div class="row full"><button type="submit">保存账号修改</button><button type="button" class="secondary" data-action="cancelEditAccount">取消</button></div></form></div>' : '') +
    '<div class="card"><div class="row between"><h2>全部账号</h2><button class="secondary" data-action="refresh">刷新</button></div>' +
      '<form id="accountFilterForm" class="account-form"><label>平台<select name="platform"><option value="">全部平台</option>' +
      state.platforms.map(p => '<option value="' + p.id + '"' + (accountFilter.platform === p.id ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') +
      '</select></label><label>搜索名称 / 备注<input name="search" value="' + esc(accountFilter.search) + '" placeholder="输入账号名称或备注"></label><button type="submit">筛选账号</button></form>' +
      '<p class="muted">显示 ' + filtered.length + ' / ' + state.accounts.length + ' 个账号。默认会话表示系统最初创建的浏览器会话，不代表已登录。</p>' +
      '<table class="accounts-table"><thead><tr><th>账号</th><th>平台</th><th>最近采集状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>' +
      filtered.map(a => '<tr data-account-id="' + a.id + '"><td><strong>' + esc(a.label) + '</strong><small class="muted">#' + a.id +
        (a.is_default ? ' · 默认会话' : '') + '</small>' + (a.notes ? '<p class="account-notes">' + esc(a.notes) + '</p>' : '') + '</td><td>' +
        esc(state.platforms.find(p => p.id === a.platform)?.label || a.platform) + '</td><td>' + esc(accountHealth(a)) +
        '<small class="muted">' + dateText(a.last_checked_at) + '</small>' + (a.last_error ? '<small class="account-error" title="' + esc(a.last_error) + '">' + esc(a.last_error.slice(0, 100)) + '</small>' : '') +
        '</td><td>' + dateText(a.created_at) + '</td><td><div class="account-actions"><button class="secondary" data-action="loginAccount" data-id="' + a.id + '">打开登录窗口</button>' +
        (state.user.role === 'admin' ? '<button class="secondary" data-action="editAccount" data-id="' + a.id + '">编辑账号</button>' : '') + '</div></td></tr>').join('') +
      (filtered.length ? '' : '<tr><td colspan="5" class="muted">没有匹配的账号，请调整筛选条件。</td></tr>') + '</tbody></table></div>' +
    (state.user.role === 'admin' ? '<div class="card"><div class="section-head"><h2>添加平台账号</h2><p class="muted">起一个便于识别的名称；系统不会保存平台密码。</p></div><form id="accountForm" class="account-form"><label>选择平台<select name="platform">' + state.platforms.map(p => '<option value="' + p.id + '">' + esc(p.label) + '</option>').join('') + '</select></label><label>账号名称<input name="label" required maxlength="100" placeholder="例如：平台 A · 门店账号 2"></label><button type="submit">添加账号</button></form></div>' : '') +
    '<p class="muted">“打开登录窗口”不会新增账号；请先点击“添加账号”，再使用对应账号登录。更换网络后，可先在该窗口手动问一个问题，确认网页能回答，再到“结果与报告”重试失败项。</p>';
}
function brandsView() {
  const selected = creatingBrand ? null : state.brands.find(b => b.id === state.brandId);
  return '<h1>品牌资料</h1><p class="lead">品牌资料是自动出题和结果分析的依据。先填写真实、可核验的信息。</p>' +
    '<div class="toolbar">' + brandSelect() + '<button class="secondary" data-action="newBrand">新建品牌</button></div>' +
    '<div class="card"><h2>' + (selected ? '编辑品牌' : '新建品牌') + '</h2>' +
    '<form id="brandForm" class="form-grid">' +
    '<label>品牌名称<input name="name" required value="' + esc(selected?.name) + '"></label>' +
    '<label>产品 / 服务类别<input name="category" required value="' + esc(selected?.category) + '"></label>' +
    '<label>品牌别名（用逗号隔开）<input name="aliases" value="' + esc(selected?.aliases) + '"></label>' +
    '<label>目标客户<input name="audience" value="' + esc(selected?.audience) + '"></label>' +
    '<label>官网<input name="website" value="' + esc(selected?.website) + '"></label>' +
    '<label>竞品 / 对标机构（选填）<input name="competitors" placeholder="可留空；多个名称用逗号隔开" value="' + esc(selected?.competitors) + '"></label>' +
    '<label class="full">品牌与产品介绍<textarea name="description">' + esc(selected?.description) + '</textarea></label>' +
    '<label class="full">有证据支持的优势<textarea name="strengths">' + esc(selected?.strengths) + '</textarea></label>' +
    '<div class="full"><button type="submit">保存品牌资料</button></div></form></div>';
}
function questionsView() {
  if (!state.brands.length) return '<h1>问题池</h1><div class="card">请先在“品牌资料”添加品牌。</div>';
  return '<h1>问题池</h1><p class="lead">自动出题采用品牌资料和问题模板。团队可先审核、修改，再加入监测。</p>' +
    '<div class="toolbar">' + brandSelect() + '</div>' +
    '<div class="grid"><div class="card"><h2>自动生成</h2><p class="muted">覆盖品牌认知和无品牌名推荐两类问题；自动生成不会直接启动监测。</p>' +
    '<button data-action="generate">根据品牌资料出题</button>' +
    (state.generated.length ? '<p class="muted">每行格式：类型|问题；可以编辑或删除。</p><form id="generatedForm"><textarea name="lines" style="min-height:260px">' +
      esc(state.generated.map(q => q.kind + '|' + q.text).join('\n')) +
      '</textarea><button type="submit">审核后加入问题池</button></form>' : '') +
    '</div><div class="card"><h2>手动添加 / 批量导入</h2><form id="manualQuestionsForm">' +
    '<label>问题类型<select name="kind"><option value="discovery">产品推荐（问题不含品牌名）</option><option value="brand">品牌认知</option></select></label>' +
    '<label>每行一个问题<textarea name="lines" placeholder="这类产品有哪些值得推荐？&#10;如何选择适合自己的服务商？" required></textarea></label>' +
    '<button type="submit">加入问题池</button></form></div></div>' +
    '<div class="card"><h2>已保存问题（' + state.questions.length + '）</h2>' +
    (state.questions.length ? '<table><thead><tr><th>类型</th><th>问题原文</th><th>来源</th></tr></thead><tbody>' +
      state.questions.map(q => '<tr><td>' + (q.kind === 'brand' ? '品牌认知' : '产品推荐') + '</td><td>' +
      esc(q.text) + '</td><td>' + (q.source === 'generated' ? '模板生成' : '人工添加') + '</td></tr>').join('') +
      '</tbody></table>' : '<p class="muted">暂无问题。</p>') + '</div>';
}
function monitorView() {
  if (!state.brands.length) return '<h1>监测任务</h1><div class="card">请先添加品牌和问题。</div>';
  return '<div class="page-heading"><div><span class="eyebrow">MONITORING TASKS</span><h1>监测任务</h1><p class="lead">选问题、选账号，系统会为每个组合分别采集回答与来源。</p></div><span class="count-chip">' + state.tasks.length + ' 个任务</span></div>' +
    '<div class="grid monitor-grid"><div class="card guide-card"><h2>运行前检查</h2><p>① 在账号池为每个账号完成登录</p><p>② 选择本次使用的账号与问题</p><p>③ 先单题测试，再扩大批次</p><p class="muted">运行窗口在后台打开，不主动切换当前画面。遇到登录或验证，请从任务栏打开对应账号窗口，处理后继续。</p><button class="secondary" data-action="tab" data-id="accounts">前往账号池 →</button></div>' +
    '<div class="card"><h2>创建监测任务</h2><form id="taskForm">' +
    '<label>任务名称<input name="name" required placeholder="例如：品牌推荐问题每周监测"></label>' +
    '<label>品牌' + brandSelect() + '</label>' +
    '<div data-scheduled-accounts hidden><strong>定期监测账号</strong><p class="muted">自动执行使用这些账号；手动运行时可以另选。</p><div class="account-options">' +
    state.accounts.map(account => '<label class="account-option"><input type="checkbox" name="account" value="' + account.id + '"><span><strong>' + esc(account.label) + '</strong><small>' + esc(state.platforms.find(p => p.id === account.platform)?.label || account.platform) + '</small></span></label>').join('') +
    '</div></div><div><strong>问题</strong><div class="question-list">' +
    (state.questions.length ? state.questions.map(q => '<label class="checkbox"><input type="checkbox" name="question" value="' + q.id + '">' +
      '<span class="pill">' + (q.kind === 'brand' ? '认知' : '推荐') + '</span> ' + esc(q.text) + '</label>').join('') : '请先在问题池添加问题') +
    '</div></div><label>执行方式<select name="scheduleType" id="scheduleType"><option value="manual">手动</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>' +
    '<label>执行时间（本机时间）<input name="timeHHMM" type="time" value="09:00"></label>' +
    '<div><strong>每周运行日</strong><div class="row">' +
    ['日','一','二','三','四','五','六'].map((day, i) => '<label class="checkbox"><input type="checkbox" name="weekday" value="' + i + '">周' + day + '</label>').join('') +
    '</div></div><button type="submit">创建任务</button></form></div></div>' +
    runTaskView() + '<div class="card"><h2>已有任务</h2><p class="muted">手动运行时选择本次问题和账号，不需要编辑任务。定期任务使用预设账号自动执行。</p>' +
    (state.tasks.length ? '<table><thead><tr><th>任务</th><th>品牌</th><th>自动执行账号</th><th>周期</th><th>下次执行</th><th>操作</th></tr></thead><tbody>' +
      state.tasks.map(t => '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.brand_name) + '</td><td>' +
      (t.schedule_type === 'manual' ? '运行时选择' : esc(taskAccountIds(t)
        .map(id => { const account = state.accounts.find(a => a.id === id); return account ? account.platform + ' / ' + account.label : '历史账号'; }).join('、'))) + '</td><td>' +
      esc(({ manual: '手动', daily: '每天', weekly: '每周' })[t.schedule_type]) + (t.enabled ? ' · 已开启' : '') +
      '</td><td>' + dateText(t.next_run_at) + '</td><td><div class="row"><button data-action="runTask" data-id="' + t.id + '">选择账号运行</button>' +
      '<button class="secondary" data-action="editTask" data-id="' + t.id + '">编辑</button>' +
      (t.schedule_type !== 'manual' ? '<button class="secondary" data-action="toggleTask" data-id="' + t.id + '">' +
        (t.enabled ? '暂停定时' : '开启定时') + '</button>' : '') + '</div></td></tr>').join('') +
      '</tbody></table>' : '<p class="muted">暂无任务。</p>') + '</div>' + editTaskView();
}
function runTaskView() {
  const task = state.tasks.find(t => t.id === runningTaskId);
  if (!task) return '';
  const selectedQuestions = JSON.parse(task.question_ids_json);
  return '<div class="card" id="runTaskPanel"><h2>本次监测：' + esc(task.name) + '</h2><p class="muted">品牌：' + esc(task.brand_name) +
    '。本次选择不会修改任务，继续运行或重试会使用本次记录的账号和问题。</p><form id="runTaskForm" data-id="' + task.id + '">' +
    '<strong>1. 选择本次问题</strong><div class="question-list">' + runningTaskQuestions.map(q =>
      '<label class="checkbox"><input type="checkbox" name="question" value="' + q.id + '"' + (selectedQuestions.includes(q.id) ? ' checked' : '') + '> ' + esc(q.text) + '</label>').join('') +
    '</div><strong>2. 选择本次账号</strong><p class="muted">可同时选择平台 A、平台 B 或同平台多个账号。每个问题会在每个所选账号中分别提问。</p><div class="account-options">' +
    state.accounts.map(a => '<label class="account-option"><input type="checkbox" name="account" value="' + a.id + '"><span><strong>' + esc(a.label) + '</strong><small>' +
      esc(state.platforms.find(p => p.id === a.platform)?.label || a.platform) + ' · ' + esc(accountHealth(a)) + '</small></span></label>').join('') +
    '</div><div class="row"><button type="submit">开始本次监测</button><button type="button" class="secondary" data-action="cancelRunTask">取消</button></div></form></div>';
}
function taskAccountIds(task) {
  return task.account_ids_json ? JSON.parse(task.account_ids_json)
    : JSON.parse(task.platforms_json).map(platform => state.accounts.find(a => a.platform === platform && a.is_default)?.id);
}
function editTaskView() {
  const task = state.tasks.find(item => item.id === editingTaskId);
  if (!task) return '';
  const accountIds = taskAccountIds(task);
  const questionIds = JSON.parse(task.question_ids_json);
  const weekdays = JSON.parse(task.weekdays_json || '[]');
  return '<div class="card" id="editTaskPanel"><div class="row between"><div><h2>编辑任务：' + esc(task.name) + '</h2>' +
    '<p class="muted">品牌：' + esc(task.brand_name) + '。更改只影响之后新建的运行；已有批次按原配置继续或重试。</p></div>' +
    '<button class="ghost" data-action="cancelEditTask">取消</button></div><form id="editTaskForm" data-id="' + task.id + '">' +
    '<label>任务名称<input name="name" required value="' + esc(task.name) + '"></label>' +
    '<div data-scheduled-accounts' + (task.schedule_type === 'manual' ? ' hidden' : '') + '><strong>定期监测账号</strong><p class="muted">手动运行的账号在开始运行时选择；这里只设置定期自动执行账号。</p><div class="account-options">' +
    state.accounts.map(account => '<label class="account-option"><input type="checkbox" name="account" value="' + account.id + '"' +
      (accountIds.includes(account.id) ? ' checked' : '') + '><span><strong>' + esc(account.label) + '</strong><small>' +
      esc(state.platforms.find(p => p.id === account.platform)?.label || account.platform) + '</small></span></label>').join('') +
    '</div><button type="button" class="ghost" data-action="tab" data-id="accounts">前往账号池添加账号 →</button></div>' +
    '<div><strong>问题</strong><div class="question-list">' +
    editingTaskQuestions.map(q => '<label class="checkbox"><input type="checkbox" name="question" value="' + q.id + '"' +
      (questionIds.includes(q.id) ? ' checked' : '') + '><span class="pill">' + (q.kind === 'brand' ? '认知' : '推荐') + '</span> ' +
      esc(q.text) + '</label>').join('') + '</div></div>' +
    '<label>执行方式<select name="scheduleType">' +
    [['manual', '手动'], ['daily', '每天'], ['weekly', '每周']].map(([value, label]) =>
      '<option value="' + value + '"' + (task.schedule_type === value ? ' selected' : '') + '>' + label + '</option>').join('') +
    '</select></label><label>执行时间（本机时间）<input name="timeHHMM" type="time" value="' + esc(task.time_hhmm) + '"></label>' +
    '<div><strong>每周运行日</strong><div class="row">' + ['日','一','二','三','四','五','六'].map((day, i) =>
      '<label class="checkbox"><input type="checkbox" name="weekday" value="' + i + '"' + (weekdays.includes(i) ? ' checked' : '') + '>周' + day + '</label>').join('') +
    '</div></div><label class="checkbox"><input type="checkbox" name="enabled"' + (task.enabled ? ' checked' : '') + '>启用定时执行（手动任务无效）</label>' +
    '<button type="submit">保存修改</button></form></div>';
}
function runsTable(runs) {
  if (!runs.length) return '<p class="muted">暂无运行记录。</p>';
  return '<table><thead><tr><th>运行</th><th>品牌 / 任务</th><th>进度</th><th>状态</th><th>开始时间</th><th>操作</th></tr></thead><tbody>' +
    runs.map(r => '<tr><td>#' + r.id + '</td><td>' + esc(r.brand_name) + ' / ' + esc(r.task_name) +
      '</td><td>' + r.done + '/' + r.total + '</td><td>' + pill(r.status) + '</td><td>' +
      dateText(r.started_at) + '</td><td><div class="row"><button class="secondary" data-action="viewRun" data-id="' + r.id + '">查看结果</button>' +
      (['needs_attention', 'interrupted'].includes(r.status) ? '<button data-action="resumeRun" data-id="' + r.id + '">继续运行</button>' : '') +
      (['failed', 'partial'].includes(r.status) ? '<button data-action="retryFailed" data-id="' + r.id + '">重试失败项</button>' : '') +
      '</div></td></tr>').join('') +
    '</tbody></table>';
}
function resultsView() {
  const detail = state.detail;
  const report = state.report?.report;
  const pageCount = Math.max(1, Math.ceil(state.runs.length / 10));
  resultsPage = Math.min(Math.max(1, resultsPage), pageCount);
  const pageRuns = state.runs.slice((resultsPage - 1) * 10, resultsPage * 10);
  return '<h1>结果与报告</h1><p class="lead">展示网页采集的原始回答和来源；失败项不会计入成功回答的指标分母。</p>' +
    '<div class="card"><div class="row between"><h2>运行记录</h2><button class="secondary" data-action="refresh">刷新</button></div>' +
    runsTable(pageRuns) + '<div class="row between runs-pagination"><span class="muted">共 ' + state.runs.length +
    ' 条 · 每页 10 条 · 第 ' + resultsPage + ' / ' + pageCount + ' 页</span><div class="row">' +
    '<button class="secondary" data-action="resultsPage" data-page="' + (resultsPage - 1) + '" data-unavailable="' + (resultsPage === 1) + '"' +
    (resultsPage === 1 ? ' disabled' : '') + '>上一页</button><button class="secondary" data-action="resultsPage" data-page="' + (resultsPage + 1) +
    '" data-unavailable="' + (resultsPage === pageCount) + '"' + (resultsPage === pageCount ? ' disabled' : '') + '>下一页</button></div></div></div>' +
    (detail ? '<div class="card"><h2>运行 #' + detail.run.id + '：' + esc(detail.run.task_name) + '</h2><p>状态：' +
      pill(detail.run.status) + '　进度：' + detail.run.done + '/' + detail.run.total + '</p>' +
      (detail.run.error ? '<div class="message error">' + esc(detail.run.error) + '</div>' : '') +
      (['failed', 'partial'].includes(detail.run.status) ? '<div class="message warning">更换网络或重新登录后，点击下方“仅重试失败项”。先用单题核对回答、引用和截图，再扩大批量监测；已成功项不会重复提问。</div>' : '') +
      (detail.run.status === 'needs_attention' ? '<div class="message warning">任务已暂停，登录和人工验证没有倒计时。请从任务栏打开对应账号的 Edge 窗口，完成处理后点击“处理后继续运行”。暂停期间不要在原对话追加问题。</div>' : '') +
      (['needs_attention', 'interrupted'].includes(detail.run.status) ? '<p><button data-action="resumeRun" data-id="' + detail.run.id + '">处理后继续运行</button></p>' : '') +
      (['failed', 'partial'].includes(detail.run.status) ? '<p><button data-action="retryFailed" data-id="' + detail.run.id + '">仅重试失败项</button></p>' : '') +
      (report ? '<div class="grid three">' +
        '<div><div class="muted">无品牌名问题的 AI 提及率</div><div class="stat">' + pct(report.discoveryMentionRate) + '</div><div class="muted">' +
        report.discoveryMentions + ' / ' + report.discoveryTotal + ' 条有效回答</div></div>' +
        '<div><div class="muted">成功 / 失败 / 待处理</div><div class="stat">' + report.successful + ' / ' + report.failed + ' / ' + report.pending + '</div></div>' +
        '<div><div class="muted">情感粗判：正向 / 负向 / 混合</div><div class="stat">' +
        report.sentimentGuess.positive + ' / ' + report.sentimentGuess.negative + ' / ' + report.sentimentGuess.mixed +
        '</div></div></div>' +
        (report.qualityWarnings.length ? '<div class="message warning">' + report.qualityWarnings.map(esc).join('<br>') + '</div>' : '') +
        '<p class="muted">采集覆盖率：' + pct(report.captureRate) + '。' + report.caveats.map(esc).join(' ') + '</p>' +
        '<h3>按账号比较</h3>' + (report.byAccount.length ? '<table><thead><tr><th>平台</th><th>账号</th><th>成功 / 失败 / 待处理</th><th>主动提及率</th></tr></thead><tbody>' + report.byAccount.map(account =>
          '<tr><td>' + esc(account.platform) + '</td><td>' + esc(account.label) + '</td><td>' + account.successful + ' / ' + account.failed + ' / ' + account.pending + '</td><td>' + pct(account.discoveryMentionRate) + ' <span class="muted">(' + account.discoveryMentions + '/' + account.discoveryTotal + ')</span></td></tr>').join('') + '</tbody></table>' : '<p class="muted">暂无账号结果。</p>') +
        '<h3>引用来源域名</h3><p>' + (report.topCitationHosts.map(x => esc(x.host) + '（' + x.count + '）').join('、') || '暂无可见引用') + '</p>' : '') +
      '<details><summary>执行记录（' + (detail.attempts || []).length + ' 次，包含失败和重试）</summary>' +
      '<p class="muted">每次尝试分别保存；重试后的最终结果用于报告统计。</p>' +
      (detail.attempts || []).map(a => {
        const d = JSON.parse(a.diagnostics_json || '{}');
        return '<details><summary>' + pill(a.status) + ' ' + dateText(a.started_at) + ' · ' + esc(a.platform) +
          ' / ' + esc(a.account_label || '默认账号') + (d.automaticRetry ? ' · 随后自动重试' : '') + '</summary>' +
          '<p>' + esc(a.question) + '</p><p class="muted">结束：' + dateText(a.finished_at) +
          (d.stage ? ' · 阶段：' + esc(d.stage) : '') + '</p>' +
          (a.error ? '<p class="message error">' + esc(a.error) + (a.error_code ? '（' + esc(a.error_code) + '）' : '') + '</p>' : '') +
          (d.editor ? '<p>输入框：' + (d.editor.inViewport ? '在窗口可见范围内' : '超出窗口可见范围') +
            '；原问题' + (d.editor.questionRetained ? '仍在输入框' : '已不在输入框') + '</p>' : '') +
          networkRequestsView(d.networkFailures, a.status) +
          (a.screenshot ? '<p><a href="/screenshots/' + detail.run.id + '/' + esc(a.screenshot.replaceAll('\\', '/').split('/').pop()) +
            '" target="_blank" rel="noopener noreferrer">查看本次截图</a></p>' : '') + '</details>';
      }).join('') + '</details>' +
      '<h3>逐条回答</h3>' +
      (detail.results.length ? detail.results.map(r => '<details><summary>' + pill(r.status) + ' ' +
        esc(r.platform) + ' / ' + esc(r.account_label || '默认账号') + ' · ' + esc(r.question) + '</summary>' +
        (r.status === 'succeeded' ? '<p class="answer">' + esc(r.answer).replace(/\n/g, '<br>') + '</p>' +
          '<details><summary>正文引用（已采集 ' + JSON.parse(r.citations_json || '[]').length + ' 条' +
          (r.reported_citation_count === null ? '' : '；页面标注 ' + r.reported_citation_count + ' 篇') + '）</summary>' +
          (JSON.parse(r.citations_json || '[]').length ? '<ol>' + JSON.parse(r.citations_json || '[]').map(c =>
            '<li><a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' +
            esc((c.number ? '[' + c.number + '] ' : '') + (c.title || c.url).replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').slice(0, 180)) +
            '</a> <span class="muted">' + esc(citationHost(c.url)) + '</span></li>').join('') + '</ol>' : '<p>暂无可见来源链接。</p>') +
        '</details>' + (r.reported_search_count !== null || JSON.parse(r.searched_sites_json || '[]').length ?
          '<details><summary>网页搜索结果（已采集 ' + JSON.parse(r.searched_sites_json || '[]').length + ' 条' +
          (r.reported_search_count === null ? '' : '；页面显示 ' + r.reported_search_count + ' 条') + '）</summary>' +
          '<p class="muted">搜索结果与正文实际引用分开记录；仅正文引用计入引用来源统计。</p>' +
          (JSON.parse(r.searched_sites_json || '[]').length ? '<ol>' + JSON.parse(r.searched_sites_json || '[]').map(site =>
            '<li><a href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer">' +
            esc((site.number ? '[' + site.number + '] ' : '') + (site.title || site.url).slice(0, 180)) +
            '</a> <span class="muted">' + esc(citationHost(site.url)) + '</span></li>').join('') + '</ol>' : '<p>暂无可见搜索结果链接。</p>') +
          '</details>' : '') + (r.screenshot ? '<p><a href="/screenshots/' + detail.run.id + '/' +
          esc(r.screenshot.replaceAll('\\', '/').split('/').pop()) + '" target="_blank" rel="noopener noreferrer">查看网页截图</a></p>' : '') :
          '<p class="message error">' + esc(r.error) + '</p>' +
          (r.screenshot ? '<p><a href="/screenshots/' + detail.run.id + '/' +
            esc(r.screenshot.replaceAll('\\', '/').split('/').pop()) + '" target="_blank" rel="noopener noreferrer">查看失败截图</a></p>' : '')) +
        '</details>').join('') : '<p class="muted">等待第一条回答。</p>') +
      '</div>' : '');
}
function adminView() {
  if (state.user.role !== 'admin') return '<h1>无权限</h1>';
  return '<h1>团队管理</h1><p class="lead">管理员可以创建团队成员。第一版默认只在本机 127.0.0.1 上运行。</p>' +
    '<div class="grid"><div class="card"><h2>添加成员</h2><form id="userForm">' +
    '<label>用户名<input name="username" required></label><label>初始密码（至少 10 位）<input name="password" type="password" minlength="10" required></label>' +
    '<label>角色<select name="role"><option value="member">成员</option><option value="admin">管理员</option></select></label>' +
    '<button type="submit">创建用户</button></form></div>' +
    '<div class="card"><h2>已有用户</h2><table><thead><tr><th>用户名</th><th>角色</th><th>创建时间</th></tr></thead><tbody>' +
    state.users.map(u => '<tr><td>' + esc(u.username) + '</td><td>' + esc(u.role) + '</td><td>' + dateText(u.created_at) + '</td></tr>').join('') +
    '</tbody></table></div></div>';
}

root.addEventListener('change', async event => {
  if (event.target.name === 'scheduleType') {
    const accounts = event.target.closest('form')?.querySelector('[data-scheduled-accounts]');
    if (accounts) accounts.hidden = event.target.value === 'manual';
  }
  if (event.target.id === 'brandSelect') {
    if (busy) return;
    const previous = state.brandId;
    const selected = Number(event.target.value);
    setBusy(true);
    try {
      const response = await request('/api/brands/' + selected + '/questions');
      state.brandId = selected;
      creatingBrand = false;
      state.questions = response.questions;
      state.generated = [];
      render();
    } catch (error) { event.target.value = previous; notice(error.message, true); }
    finally { setBusy(false); }
  }
});
root.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (busy) return;
  const action = button.dataset.action;
  setBusy(true);
  try {
    if (action === 'tab') { state.tab = button.dataset.id; message = ''; render(); }
    else if (action === 'resultsPage') { resultsPage = Number(button.dataset.page); render(); }
    else if (action === 'logout') { await post('/api/logout', {}); location.reload(); }
    else if (action === 'newBrand') { creatingBrand = true; render(); }
    else if (action === 'generate') {
      state.generated = (await request('/api/brands/' + selectedBrandId() + '/questions/generate')).questions;
      render();
      notice('已生成 ' + state.generated.length + ' 个候选问题。请审核并编辑后保存。');
    }
    else if (action === 'loginAccount') { const opened = await post('/api/platform-accounts/' + button.dataset.id + '/login', {}); notice(opened.message, opened.navigationWarning); }
    else if (action === 'editAccount') { editingAccountId = Number(button.dataset.id); render(); root.querySelector('#editAccountPanel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if (action === 'cancelEditAccount') { editingAccountId = null; message = ''; messageError = false; render(); }
    else if (action === 'editTask') {
      const task = state.tasks.find(item => item.id === Number(button.dataset.id));
      editingTaskQuestions = (await request('/api/brands/' + task.brand_id + '/questions')).questions;
      editingTaskId = task.id;
      render();
      root.querySelector('#editTaskPanel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    else if (action === 'cancelEditTask') { editingTaskId = null; editingTaskQuestions = []; render(); }
    else if (action === 'runTask') {
      const task = state.tasks.find(t => t.id === Number(button.dataset.id));
      runningTaskQuestions = (await request('/api/brands/' + task.brand_id + '/questions')).questions;
      runningTaskId = task.id; render(); root.querySelector('#runTaskPanel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    else if (action === 'cancelRunTask') { runningTaskId = null; runningTaskQuestions = []; message = ''; render(); }
    else if (action === 'resumeRun') { const data = await post('/api/runs/' + button.dataset.id + '/resume', {}); state.tab = 'results'; state.runId = data.run.id; await refresh(); notice('已从未完成的问题继续运行，Edge 窗口在后台保留。'); }
    else if (action === 'retryFailed') { const data = await post('/api/runs/' + button.dataset.id + '/retry-failed', {}); state.tab = 'results'; state.runId = data.run.id; await refresh(); notice('正在重试失败项，Edge 窗口在后台保留；已成功的问答不会重复提问。'); }
    else if (action === 'toggleTask') { await post('/api/tasks/' + button.dataset.id + '/toggle', {}); await refresh(); notice('定时设置已更新。'); }
    else if (action === 'viewRun') { state.tab = 'results'; state.runId = Number(button.dataset.id); await refresh(); }
    else if (action === 'refresh') await refresh();
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});
root.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const input = new FormData(form);
  const data = Object.fromEntries(input);
  setBusy(true);
  try {
    if (form.id === 'setupForm' || form.id === 'loginForm') {
      state.user = (await post(form.id === 'setupForm' ? '/api/setup' : '/api/login', data)).user;
      await refresh();
      return;
    }
    if (form.id === 'brandForm') {
      const response = state.brandId && !creatingBrand ? await put('/api/brands/' + state.brandId, data) : await post('/api/brands', data);
      creatingBrand = false;
      state.generated = [];
      state.brandId = response.brand.id; await refresh(); notice('品牌资料已保存。'); return;
    }
    if (form.id === 'generatedForm') {
      const items = data.lines.split(/\r?\n/).map(line => {
        const split = line.indexOf('|');
        if (split < 0) return null;
        return { kind: line.slice(0, split).trim(), text: line.slice(split + 1).trim(), source: 'generated' };
      }).filter(item => item?.text);
      const response = await post('/api/brands/' + selectedBrandId() + '/questions', { questions: items });
      state.generated = []; await refresh(); notice('已加入 ' + response.added + ' 个新问题。'); return;
    }
    if (form.id === 'manualQuestionsForm') {
      const items = data.lines.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        .map(text => ({ text, kind: data.kind, source: 'manual' }));
      const response = await post('/api/brands/' + selectedBrandId() + '/questions', { questions: items });
      await refresh(); notice('已加入 ' + response.added + ' 个新问题。'); return;
    }
    if (form.id === 'taskForm') {
      const payload = {
        name: data.name, brandId: selectedBrandId(),
        accountIds: data.scheduleType === 'manual' ? [] : input.getAll('account').map(Number),
        questionIds: input.getAll('question').map(Number),
        scheduleType: data.scheduleType,
        timeHHMM: data.timeHHMM,
        weekdays: input.getAll('weekday').map(Number),
      };
      await post('/api/tasks', payload); await refresh(); notice('监测任务已创建。'); return;
    }
    if (form.id === 'editTaskForm') {
      const payload = {
        name: data.name,
        accountIds: data.scheduleType === 'manual' ? [] : input.getAll('account').map(Number),
        questionIds: input.getAll('question').map(Number),
        scheduleType: data.scheduleType,
        timeHHMM: data.timeHHMM,
        weekdays: input.getAll('weekday').map(Number),
        enabled: input.has('enabled'),
      };
      await put('/api/tasks/' + form.dataset.id, payload);
      editingTaskId = null; editingTaskQuestions = [];
      await refresh(); notice('任务已更新，之后的新运行会使用新配置。'); return;
    }
    if (form.id === 'runTaskForm') {
      const accountIds = input.getAll('account').map(Number);
      const questionIds = input.getAll('question').map(Number);
      if (!questionIds.length) throw new Error('请至少选择一个问题');
      if (!accountIds.length) throw new Error('请为本次运行选择至少一个账号');
      const data = await post('/api/tasks/' + form.dataset.id + '/run', { accountIds, questionIds });
      runningTaskId = null; runningTaskQuestions = []; state.tab = 'results'; state.runId = data.run.id;
      await refresh(); notice('监测已启动，使用本次选择的问题和账号。'); return;
    }
    if (form.id === 'accountFilterForm') { accountFilter = { platform: data.platform, search: data.search.trim() }; render(); return; }
    if (form.id === 'editAccountForm') { await put('/api/platform-accounts/' + form.dataset.id, data); editingAccountId = null; await refresh(); notice('账号名称和备注已保存，登录状态与任务关联保持不变。'); return; }
    if (form.id === 'accountForm') { await post('/api/platform-accounts', data); accountFilter = { platform: '', search: '' }; await refresh(); notice('账号已加入。请点击“打开登录窗口”完成平台登录。'); return; }
    if (form.id === 'userForm') { await post('/api/users', data); await refresh(); notice('团队用户已创建。'); }
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});

bootstrap().catch(error => { root.innerHTML = '<div class="login-page"><div class="card">' + esc(error.message) + '</div></div>'; });
setInterval(() => {
  if (!busy && state.user && state.tab === 'results' && state.runs.some(r => r.status === 'running')) {
    setBusy(true);
    const openQuestions = [...root.querySelectorAll('details')].map(element => element.open);
    refresh().then(() => {
      root.querySelectorAll('details').forEach((element, index) => { element.open = !!openQuestions[index]; });
    }).catch(error => notice(error.message, true)).finally(() => setBusy(false));
  }
}, 5000);
