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
const emptyAnswerSearchFilters=()=>({q:'',scope:'all',taskId:'',platform:'',accountId:'',questionId:'',topicId:'',from:'',to:'',page:1});
let answerSearchFilters=emptyAnswerSearchFilters(),answerSearchData=null,answerSearchBrand=null,answerSearchProof=null;
let answerSearchDraft=null,answerSearchDraftMeta=null,answerSearchFilterOpen=false;
function captureAnswerSearchDraft(){const form=root.querySelector('#answerSearchForm');if(form&&!busy)answerSearchDraft=Object.fromEntries(new FormData(form));}
async function loadAnswerSearch(){
  if(answerSearchBrand!==state.brandId){answerSearchDraft=null;answerSearchDraftMeta=null;answerSearchFilterOpen=false;}
  const next=answerSearchBrand===state.brandId?{...answerSearchFilters}:emptyAnswerSearchFilters();
  const unavailable=next.topicId&&!topics.some(t=>String(t.id)===String(next.topicId));
  const data=unavailable?{unavailable:'所选专题已删除或不属于当前品牌。请重新选择专题或明确清空筛选后搜索，范围不会自动扩大。'}:state.brandId?(await request('/api/answer-search?'+new URLSearchParams({brandId:state.brandId,...next}))).search:null;
  answerSearchFilters=next;answerSearchData=data;answerSearchBrand=state.brandId;answerSearchProof=null;
}
let answerReviewEditor=null,answerReviewSelection=null;
const answerReviewLabels={pending:"待复核",accurate:"准确",inaccurate:"有误",outdated:"信息过时",uncertain:"无法确认"};
let changeFeed=null,changeBrandId=null;
const emptyChangeFilters=()=>({taskId:'',platform:'',accountId:'',topicId:'',from:'',to:'',type:'',status:'',comparison:'all',page:1});
let changeFilters=emptyChangeFilters();
const changeTypes={own_gained:'我方出现',own_lost:'我方未再出现',peer_gained:'对标出现',peer_lost:'对标未再出现',peer_only:'从双方变为仅对标',source_changed:'来源集合变化'};
const changeStates={new:'未查看',seen:'已查看',watch:'持续关注'};
async function loadChanges(){
  await loadTopics();const filters=changeBrandId===state.brandId?{...changeFilters}:emptyChangeFilters();if(filters.topicId&&!topics.some(t=>String(t.id)===filters.topicId))filters.topicId='';
  const next=state.brandId?(await request('/api/change-feed?'+new URLSearchParams({brandId:state.brandId,...filters}))).feed:null;changeFeed=next;changeFilters=filters;changeBrandId=state.brandId;
}
let analytics = null;
let reportFilters = { taskId:'', cohort:'', platform: '', accountId: '', topicId:'', kind: '', from: '', to: '' };
let reportEvidence = 'eligible';
let evidenceOpen = false;
const historyPanels = new Set();
let topics=[],topicEditId=null,questionTopicFilter='',topicBrandId=null,editingTaskTopics=[];
async function loadTopics(brandId=state.brandId){const next=brandId?(await request('/api/brands/'+brandId+'/topics')).topics:[];if(topicBrandId!==brandId){topicEditId=null;questionTopicFilter='';}topics=next;topicBrandId=brandId;if(questionTopicFilter&&!topics.some(t=>String(t.id)===String(questionTopicFilter)))questionTopicFilter='';}
function topicOptions(selected='',blank='全部专题'){return '<option value="">'+blank+'</option>'+topics.map(t=>'<option value="'+t.id+'"'+(String(t.id)===String(selected)?' selected':'')+'>'+esc(t.name)+'（'+t.questionIds.length+'）</option>').join('');}
function taskTopicPicker(selected=[],list=topics){return '<div class="task-topics"><strong>按专题选题（可多选）</strong><p class="muted">点击载入后勾选专题的全部问题，再按需要调整。任务保存固定清单，后续不会自动跟着专题改变。</p>'+list.map(t=>'<label class="checkbox"><input type="checkbox" name="topic" value="'+t.id+'"'+(selected.includes(t.id)?' checked':'')+'> '+esc(t.name)+'（'+t.questionIds.length+'）</label>').join('')+'<button type="button" class="secondary" data-action="applyTaskTopics">载入所选专题问题</button></div>';}
let library=null,sourceEditor=null,sourceEvidence=null,sourceDomainPage=1;
let sourceBrandId=null,reportBrandId=null;
const emptySourceFilters=()=>({q:'',platform:'',taskId:'',questionId:'',topicId:'',kind:'',category:'',favorite:'',from:'',to:'',host:'',page:1});
let sourceFilters=emptySourceFilters();
const sourceCategories={unclassified:'待分类',owned:'自有内容',third_party:'第三方',competitor:'竞品相关',verify:'待核实'};
async function loadSources(){
  await loadTopics();
  if(sourceFilters.topicId&&!topics.some(t=>String(t.id)===String(sourceFilters.topicId)))sourceFilters={...sourceFilters,topicId:'',page:1};
  if(sourceBrandId!==state.brandId){sourceBrandId=state.brandId;sourceFilters=emptySourceFilters();sourceEditor=null;sourceEvidence=null;sourceDomainPage=1;library=null;}
  library=state.brandId?(await request('/api/source-library?'+new URLSearchParams({brandId:state.brandId,...sourceFilters}))).library:null;
  sourceEvidence=null;
}
async function loadSourceEvidence(url,page=1){sourceEvidence=await request('/api/source-library/evidence?'+new URLSearchParams({brandId:state.brandId,...sourceFilters,url,evidencePage:page}));}
async function applySourceNavigation(nextFilters){
  const nextLibrary=(await request('/api/source-library?'+new URLSearchParams({brandId:state.brandId,...nextFilters}))).library;
  sourceFilters=nextFilters;library=nextLibrary;sourceEditor=null;sourceEvidence=null;
}
async function loadAnalytics() {
  await loadTopics();
  if(reportFilters.topicId&&!topics.some(t=>String(t.id)===String(reportFilters.topicId)))reportFilters={...reportFilters,topicId:''};
  if(reportBrandId!==state.brandId){reportBrandId=state.brandId;reportFilters={taskId:'',cohort:'',platform:'',accountId:'',topicId:'',kind:'',from:'',to:''};reportEvidence='eligible';evidenceOpen=false;analytics=null;}
  if (!state.brandId) { analytics = null; return; }
  analytics = (await request('/api/analytics?' + new URLSearchParams({ brandId: state.brandId, ...reportFilters }))).report;
}

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
let busyDisabledStates=new WeakMap();
function setBusy(value) {
  busy = value;
  root.querySelectorAll('button, input, select, textarea').forEach(control => {
    if(value){if(!busyDisabledStates.has(control))busyDisabledStates.set(control,control.disabled);control.disabled=true;}
    else control.disabled=(busyDisabledStates.get(control)??control.disabled)||control.dataset.unavailable==='true';
  });
  if(!value)busyDisabledStates=new WeakMap();
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
  if (state.brandId) {state.questions = (await request('/api/brands/' + state.brandId + '/questions')).questions;await loadTopics();}
  if (state.user?.role === 'admin') state.users = (await request('/api/users')).users;
  if (state.runId && state.tab !== 'search') {
    state.detail = await request('/api/runs/' + state.runId);
    state.report = await request('/api/runs/' + state.runId + '/report');
  }
  if (state.tab === 'analytics') await loadAnalytics();
  if (state.tab === 'sources') await loadSources();
  if (state.tab === 'institutions') await loadInstitutions();
  if (state.tab === 'changes') await loadChanges();
  if (state.tab === 'search') await loadAnswerSearch();
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
    interrupted: '已中断', needs_attention: '等待人工处理', retry_pending: '等待重试',unusable:'样本不可用' })[status] || status;
  return '<span class="pill ' + esc(status) + '">' + esc(label) + '</span>';
}
function accountHealth(account) {
  const labels = { unknown: '尚未采集', recent_success: '最近采集成功', login_required: '需要登录',
    verification_required: '需要人工验证', error: '最近采集失败' };
  return labels[account.last_status] || '尚未采集';
}
function loginCheckView(account) {
  const check = account.loginCheck;
  const labels = { valid: '最近检查：登录有效', login_required: '需要登录', verification_required: '需要人工验证', unconfirmed: '暂时无法确认' };
  return '<span class="login-health ' + esc(check?.status || 'unknown') + '">' + esc(labels[check?.status] || '尚未检查登录') + '</span>' +
    (account.inUse ? '<small class="muted">正在监测或等待处理，暂不可检查</small>' : '') +
    (check ? '<small class="muted">检查时间：' + dateText(check.checkedAt) + '</small><small class="login-evidence">' + esc(check.reason) + '</small>' +
      (check.screenshot ? '<a href="' + esc(check.screenshot) + '" target="_blank" rel="noopener">查看检查截图</a>' : '') : '');
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
  for(const panel of root.querySelectorAll('[data-history-panel]')) {
    if(panel.open) historyPanels.add(panel.dataset.historyPanel);
    else historyPanels.delete(panel.dataset.historyPanel);
  }
  if (!state.user) return;
  const main = ({
    overview: overviewView,
    brands: brandsView,
    questions: questionsView,
    accounts: accountsView,
    monitor: monitorView,
    results: resultsView,
    analytics: analyticsView,
    changes: changesView,
    search: answerSearchView,
    sources: sourcesView,
    institutions: institutionsView,
    admin: adminView,
  })[state.tab]();
  root.innerHTML = '<div class="layout"><aside class="sidebar"><div class="brandmark"><span class="brand-icon">◎</span><span>GEO <em>Monitor</em></span></div><div class="nav-caption">工作空间</div><nav class="nav">' +
    navButton('overview', '工作台') + navButton('brands', '品牌资料') +
    navButton('questions', '问题池') + navButton('accounts', '平台账号池') + navButton('monitor', '监测任务') +
    navButton('results', '采集结果') + navButton('search','历史回答检索') + navButton('analytics', '分析报告') + navButton('changes','变化动态') + navButton('sources','信源资产库') + navButton('institutions','机构发现与对照') +
    (state.user.role === 'admin' ? navButton('admin', '团队管理') : '') +
    '</nav><div class="sidefoot"><span class="avatar">' + esc(state.user.username.slice(0, 1).toUpperCase()) + '</span><span>' + esc(state.user.username) + '<small>' + (state.user.role === 'admin' ? '管理员' : '成员') + '</small></span>' +
    '<br><button class="ghost" data-action="logout">退出登录</button></div></aside><main>' +
    '<div class="topline"><span class="eyebrow">GEO / 网页监测工作台</span><span class="local-badge">● 本地运行</span></div>' +
    (message ? '<div data-notice class="message ' + (messageError ? 'error' : '') + '">' + esc(message) + '</div>' : '') +
    main + '</main></div>';
  if(answerReviewEditor&&root.querySelector('#answerReviewOriginal')){
    root.querySelector('#answerReviewOriginal').textContent=answerReviewEditor.answer;
    root.querySelector('#answerReviewForm [name="notes"]').value=answerReviewEditor.notes;
  }
  if (busy) setBusy(true);
  document.body.style.overflow = state.tab === 'analytics' && evidenceOpen ? 'hidden' : '';
}
function sourcesView() {
  const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
  const safeLink=(url,title)=>/^https?:\/\//i.test(url||'')?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(title||url)+'</a>':esc(title);
  const button=(action,id,label)=>'<button type="button" class="secondary" data-action="'+action+'" data-id="'+esc(id)+'">'+label+'</button>';
  const heading='<div class="page-heading"><div><span class="eyebrow">SOURCE LIBRARY</span><h1>信源资产库</h1><p class="lead">把已采集的来源按网站整理，收藏、分类并追溯回答。</p></div></div>';
  if(!state.brands.length)return heading+'<div class="card">先添加品牌并完成监测，再查看来源。</div>';
  const filters='<p class="muted">专题筛选按当前问题成员查看历史记录，不代表当时的专题归属。</p><form id="sourceFilterForm" class="card report-filters"><label>品牌<select name="brandId">'+state.brands.map(b=>option(b.id,b.name,state.brandId)).join('')+'</select></label><label>搜索标题 / 链接 / 备注<input name="q" value="'+esc(sourceFilters.q)+'"></label><label>平台<select name="platform">'+option('','全部平台',sourceFilters.platform)+state.platforms.map(p=>option(p.id,p.label,sourceFilters.platform)).join('')+'</select></label><label>任务<select name="taskId">'+option('','全部任务',sourceFilters.taskId)+state.tasks.filter(t=>t.brand_id===state.brandId).map(t=>option(t.id,t.name,sourceFilters.taskId)).join('')+'</select></label><label>问题<select name="questionId">'+option('','全部问题',sourceFilters.questionId)+state.questions.map(q=>option(q.id,q.text,sourceFilters.questionId)).join('')+'</select></label><label title="按当前成员筛选历史回答，不代表回答发生时属于此专题">专题（当前成员）<select name="topicId">'+topicOptions(sourceFilters.topicId)+'</select></label><label>来源类型<select name="kind">'+[['','正文引用与搜索结果'],['citation','仅正文引用'],['search','仅搜索结果']].map(([v,l])=>option(v,l,sourceFilters.kind)).join('')+'</select></label><label>分类<select name="category">'+option('','全部分类',sourceFilters.category)+Object.entries(sourceCategories).map(([v,l])=>option(v,l,sourceFilters.category)).join('')+'</select></label><label>收藏<select name="favorite">'+option('','全部',sourceFilters.favorite)+option('1','仅收藏',sourceFilters.favorite)+'</select></label><label>开始日期<input type="date" name="from" value="'+esc(sourceFilters.from)+'"></label><label>结束日期<input type="date" name="to" value="'+esc(sourceFilters.to)+'"></label><button>应用筛选</button>'+button('sourceReset','','重置筛选')+'</form>';
  if(!library)return heading+filters+'<div class="card">暂无来源。</div>';
  const domainPages=Math.max(1,Math.ceil(library.domains.length/12));sourceDomainPage=Math.min(sourceDomainPage,domainPages);
  const sites='<div class="card"><div class="row between"><h2>按网站查看 · '+library.domainCount+' 个</h2>'+button('sourceHost','','全部网站')+'</div><p class="muted">按当前筛选汇总；覆盖回答按网站去重，不把同一回答的多个页面重复累加。域名汇总不代表网站归属或权威性。</p><div class="source-sites">'+library.domains.slice((sourceDomainPage-1)*12,sourceDomainPage*12).map(d=>'<button class="source-site '+(sourceFilters.host===d.host?'selected':'')+'" data-action="sourceHost" data-id="'+esc(d.host)+'"><strong>'+esc(d.host)+'</strong><span>'+d.pages+' 个页面 · 收藏 '+d.favorites+'</span><small>正文引用覆盖 '+d.citationAnswers+' 条回答 · 搜索结果覆盖 '+d.searchAnswers+' 条</small></button>').join('')+'</div><div class="row">'+(sourceDomainPage>1?button('sourceDomainPage',sourceDomainPage-1,'上一页网站'):'')+'<span>网站第 '+sourceDomainPage+'/'+domainPages+' 页</span>'+(sourceDomainPage<domainPages?button('sourceDomainPage',sourceDomainPage+1,'下一页网站'):'')+'</div></div>';
  const editor=sourceEditor?'<div class="card source-editor"><h2>编辑来源资料</h2><p>'+safeLink(sourceEditor.url,sourceEditor.title)+'</p><form id="sourceEditForm"><label>分类<select name="category">'+Object.entries(sourceCategories).map(([v,l])=>option(v,l,sourceEditor.category)).join('')+'</select></label><label class="row"><input type="checkbox" name="favorite"'+(sourceEditor.favorite?' checked':'')+'>收藏此页面</label><label>备注<textarea name="notes" maxlength="2000">'+esc(sourceEditor.notes)+'</textarea></label><div class="row"><button>保存资料</button>'+button('sourceCancel','','取消')+'</div></form></div>':'';
  const pages='<div class="card"><h2>来源页面'+(sourceFilters.host?' · '+esc(sourceFilters.host):'')+' · '+library.totalPages+' 个</h2><p class="muted">相同完整 URL 合并；查询参数不同的链接保留。计数只使用有效成功回答，引用次数与搜索出现次数可重叠，不能相加。没有取得链接不代表没有引用。</p><div class="table-scroll"><table><thead><tr><th>页面 / 分类</th><th>覆盖回答</th><th>采集时间</th><th>操作</th></tr></thead><tbody>'+library.items.map(a=>'<tr><td>'+safeLink(a.url,a.title)+'<small>'+esc(a.host)+' · '+sourceCategories[a.category]+(a.favorite?' · ★ 收藏':'')+'</small>'+(a.notes?'<small>'+esc(a.notes)+'</small>':'')+'</td><td>正文引用 '+a.citationAnswers+' · 搜索结果 '+a.searchAnswers+'<small>'+a.questions+' 个问题 · '+esc(a.platforms.join('、'))+'</small></td><td>首次 '+dateText(a.firstSeen)+'<small>最近 '+dateText(a.lastSeen)+'</small></td><td><div class="row">'+button('sourceEdit',a.url,'编辑')+button('sourceEvidence',a.url,'查看回答')+'</div></td></tr>').join('')+'</tbody></table></div>'+(!library.items.length?'<p>当前筛选没有来源，请调整筛选或完成新的监测。</p>':'')+'<div class="row">'+(library.page>1?button('sourcePage',library.page-1,'上一页链接'):'')+'<span>链接第 '+library.page+'/'+library.pageCount+' 页 · 每页20条</span>'+(library.page<library.pageCount?button('sourcePage',library.page+1,'下一页链接'):'')+'</div></div>';
  const evidence=sourceEvidence?'<div class="card source-evidence" id="sourceEvidence"><div class="row between"><h2>来源对应的回答 · '+sourceEvidence.total+' 条</h2>'+button('sourceCloseEvidence','','关闭来源证据')+'</div><p>'+safeLink(sourceEvidence.asset.url,sourceEvidence.asset.title)+'</p><p class="muted">按当前筛选，每页10条。正文引用与搜索结果分别标注；来源出现不证明页面内容正确，分类为团队手动标记。</p>'+sourceEvidence.evidence.map(e=>'<details><summary>运行 #'+e.runId+' · '+esc(e.platform+' / '+e.account)+' · '+e.types.map(t=>t==='citation'?'正文引用':'搜索结果').join('、')+'</summary><p><strong>'+esc(e.question)+'</strong></p><p class="muted">取得时间 '+dateText(e.observedAt)+'</p><p class="answer">'+esc(e.answer).replace(/\n/g,'<br>')+'</p>'+button('viewRun',e.runId,'查看完整执行记录')+'</details>').join('')+'<div class="row">'+(sourceEvidence.page>1?button('sourceEvidencePage',sourceEvidence.page-1,'上一页回答'):'')+'<span>回答第 '+sourceEvidence.page+'/'+sourceEvidence.pageCount+' 页</span>'+(sourceEvidence.page<sourceEvidence.pageCount?button('sourceEvidencePage',sourceEvidence.page+1,'下一页回答'):'')+'</div></div>':'';
  return heading+filters+sites+editor+pages+evidence;
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
      '<p class="muted">登录检查不发送问题，只代表检查时页面状态。输入框可见或保存过 Cookie 不等于登录有效。</p>' +
      '<table class="accounts-table"><thead><tr><th>账号</th><th>平台</th><th>登录检查 / 最近采集</th><th>创建时间</th><th>操作</th></tr></thead><tbody>' +
      filtered.map(a => '<tr data-account-id="' + a.id + '"><td><strong>' + esc(a.label) + '</strong><small class="muted">#' + a.id +
        (a.is_default ? ' · 默认会话' : '') + '</small>' + (a.notes ? '<p class="account-notes">' + esc(a.notes) + '</p>' : '') + '</td><td>' +
        esc(state.platforms.find(p => p.id === a.platform)?.label || a.platform) + '</td><td>' + loginCheckView(a) + '<small class="muted">' + esc(accountHealth(a)) + '</small>' +
        '<small class="muted">' + dateText(a.last_checked_at) + '</small>' + (a.last_error ? '<small class="account-error" title="' + esc(a.last_error) + '">' + esc(a.last_error.slice(0, 100)) + '</small>' : '') +
        '</td><td>' + dateText(a.created_at) + '</td><td><div class="account-actions"><button class="secondary" data-action="checkAccount" data-unavailable="' + Boolean(a.inUse) + '"' + (a.inUse ? ' disabled' : '') + ' data-id="' + a.id + '">检查登录状态</button><button class="secondary" data-action="loginAccount" data-id="' + a.id + '">打开登录窗口</button>' +
        (state.user.role === 'admin' ? '<button class="secondary" data-action="editAccount" data-id="' + a.id + '">编辑账号</button>' : '') + '</div></td></tr>').join('') +
      (filtered.length ? '' : '<tr><td colspan="5" class="muted">没有匹配的账号，请调整筛选条件。</td></tr>') + '</tbody></table></div>' +
    (state.user.role === 'admin' ? '<div class="card"><div class="section-head"><h2>添加平台账号</h2><p class="muted">起一个便于识别的名称；系统不会保存平台密码。</p></div><form id="accountForm" class="account-form"><label>选择平台<select name="platform">' + state.platforms.map(p => '<option value="' + p.id + '">' + esc(p.label) + '</option>').join('') + '</select></label><label>账号名称<input name="label" required maxlength="100" placeholder="例如：门店账号 2"></label><button type="submit">添加账号</button></form></div>' : '') +
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
    '<div class="toolbar">' + brandSelect() + '</div>' + topicManagerView() +
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
    '<label>按专题查看<select id="questionTopicFilter">'+topicOptions(questionTopicFilter)+'</select></label>'+
    (state.questions.length ? '<form id="topicMembershipForm"><div class="row"><select name="topicId" required>'+topicOptions('','选择要操作的专题')+'</select><select name="operation"><option value="add">加入专题</option><option value="remove">移出专题</option></select><button>处理勾选问题</button></div><table><thead><tr><th>选择 / 类型</th><th>问题原文</th><th>来源 / 专题</th></tr></thead><tbody>' +
      state.questions.filter(q=>!questionTopicFilter||topics.find(t=>String(t.id)===String(questionTopicFilter))?.questionIds.includes(q.id)).map(q => '<tr><td><input type="checkbox" name="question" value="'+q.id+'"> ' + (q.kind === 'brand' ? '品牌认知' : '产品推荐') + '</td><td>' +
      esc(q.text) + '</td><td>' + (q.source === 'generated' ? '模板生成' : '人工添加') +'<small>'+esc(topics.filter(t=>t.questionIds.includes(q.id)).map(t=>t.name).join('、')||'未分专题')+ '</small></td></tr>').join('') +
      '</tbody></table></form>' : '<p class="muted">暂无问题。</p>') + '</div>';
}
function topicManagerView(){const edit=topics.find(t=>t.id===topicEditId);return '<div class="card topic-manager"><h2>问题专题</h2><p class="muted">专题是问题的标签，不复制问题。删除专题只取消分组，不删除问题或历史回答。</p><form id="topicForm"><label>'+(edit?'重命名专题':'新建专题')+'<input name="name" maxlength="100" required value="'+esc(edit?.name||'')+'" placeholder="例如：选择比较"></label><div class="row"><button>'+(edit?'保存专题名称':'创建专题')+'</button>'+(edit?'<button type="button" class="secondary" data-action="cancelTopicEdit">取消重命名</button>':'')+'</div></form><div class="topic-list">'+topics.map(t=>'<div class="row"><strong>'+esc(t.name)+' · '+t.questionIds.length+' 个问题</strong><button type="button" class="secondary" data-action="editTopic" data-id="'+t.id+'">改名</button><button type="button" class="ghost" data-action="deleteTopic" data-id="'+t.id+'">删除专题</button></div>').join('')+'</div></div>';}
function monitorView() {
  if (!state.brands.length) return '<h1>监测任务</h1><div class="card">请先添加品牌和问题。</div>';
  return '<div class="page-heading"><div><span class="eyebrow">MONITORING TASKS</span><h1>监测任务</h1><p class="lead">选问题、选账号，系统会为每个组合分别采集回答与来源。</p></div><span class="count-chip">' + state.tasks.length + ' 个任务</span></div>' +
    '<div class="grid monitor-grid"><div class="card guide-card"><h2>运行前检查</h2><p>① 在账号池为每个账号完成登录</p><p>② 选择本次使用的账号与问题</p><p>③ 先单题测试，再扩大批次</p><p class="muted">运行窗口在后台打开，不主动切换当前画面。不想看采集窗口时请最小化，不要关闭窗口或问答标签页，否则当前采集会中断。关闭本系统网页不等于关闭采集浏览器。遇到登录或验证，请从任务栏打开对应账号窗口，处理后继续。</p><button class="secondary" data-action="tab" data-id="accounts">前往账号池 →</button></div>' +
    '<div class="card"><h2>创建监测任务</h2><form id="taskForm">' +
    '<label>任务名称<input name="name" required placeholder="例如：品牌推荐问题每周监测"></label>' +
    '<label>品牌' + brandSelect() + '</label>' +
    '<div data-scheduled-accounts hidden><strong>定期监测账号</strong><p class="muted">自动执行使用这些账号；手动运行时可以另选。</p><div class="account-options">' +
    state.accounts.map(account => '<label class="account-option"><input type="checkbox" name="account" value="' + account.id + '"><span><strong>' + esc(account.label) + '</strong><small>' + esc(state.platforms.find(p => p.id === account.platform)?.label || account.platform) + '</small></span></label>').join('') +
    '</div></div>'+taskTopicPicker()+'<div><strong>问题</strong><div class="question-list">' +
    (state.questions.length ? state.questions.map(q => '<label class="checkbox"><input type="checkbox" name="question" value="' + q.id + '">' +
      '<span class="pill">' + (q.kind === 'brand' ? '认知' : '推荐') + '</span> ' + esc(q.text) + '</label>').join('') : '请先在问题池添加问题') +
    '</div></div><label>执行方式<select name="scheduleType" id="scheduleType"><option value="manual">手动</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>' +
    '<label>执行时间（本机时间）<input name="timeHHMM" type="time" value="09:00"></label>' +
    '<div><strong>每周运行日</strong><div class="row">' +
    ['日','一','二','三','四','五','六'].map((day, i) => '<label class="checkbox"><input type="checkbox" name="weekday" value="' + i + '">周' + day + '</label>').join('') +
    '</div></div><button type="submit">创建任务</button></form></div></div>' +
    runTaskView() + '<div class="card"><h2>已有任务</h2><p class="muted">手动运行时选择本次问题和账号，不需要编辑任务。定期任务使用预设账号自动执行。</p>' +
    (state.tasks.length ? '<table><thead><tr><th>任务</th><th>品牌</th><th>自动执行账号</th><th>周期</th><th>下次执行</th><th>操作</th></tr></thead><tbody>' +
      state.tasks.map(t => '<tr><td><span>' + esc(t.name) + '</span><small>'+esc((t.topicNames||[]).join('、'))+'</small>'+(t.topicsChanged?'<small>专题成员已变化，任务仍用原清单</small>':'')+(t.topicsChanged&&!t.topicsMissing?'<button type="button" class="secondary" data-action="syncTaskTopics" data-id="'+t.id+'">更新为专题最新问题</button>':'')+'</td><td>' + esc(t.brand_name) + '</td><td>' +
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
    '</div><strong>2. 选择本次账号</strong><p class="muted">可同时选择豆包、DeepSeek 或同平台多个账号。每个问题会在每个所选账号中分别提问。</p><div class="account-options">' +
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
    (task.topicsMissing?'<p class="message warning">此任务关联的部分专题已删除，原问题清单仍保留。保存编辑后会解除已删除专题的关联。</p>':'')+taskTopicPicker(JSON.parse(task.topic_ids_json||'[]'),editingTaskTopics)+'<div><strong>问题</strong><div class="question-list">' +
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
      (['failed', 'partial'].includes(detail.run.status) ? '<div class="message warning">“仅重试失败项”会用原账号和原问题新建对话重新提问，不再恢复失败项的旧对话。平台历史可能留下重复问题；旧尝试记录保留，已成功项不会重新执行。</div>' : '') +
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
          ' / ' + esc(a.account_label || '默认账号') + (d.retryMode === 'fresh' ? ' · 新会话重试' : '') + (d.automaticRetry ? ' · 随后自动重试' : '') + '</summary>' +
          '<p>' + esc(a.question) + '</p><p class="muted">结束：' + dateText(a.finished_at) +
          (d.stage ? ' · 阶段：' + esc(d.stage) : '') + '</p>' +
          (a.error ? '<p class="message error">' + esc(a.error) + (a.error_code ? '（' + esc(a.error_code) + '）' : '') + '</p>' : '') +
          (d.editor ? '<p>输入框：' + (d.editor.inViewport ? '在窗口可见范围内' : '超出窗口可见范围') +
            '；原问题' + (d.editor.questionRetained ? '仍在输入框' : '已不在输入框') + '</p>' : '') +
          networkRequestsView(d.networkFailures, a.status) +
          (a.screenshot ? '<p><a href="/screenshots/' + detail.run.id + '/' + esc(a.screenshot.replaceAll('\\', '/').split('/').pop()) +
            '" target="_blank" rel="noopener noreferrer">查看本次截图</a></p>' : '') + '</details>';
      }).join('') + '</details>' +
      answerReviewSummaryView(detail.manualReviewSummary)+answerReviewEditorView(detail.run.id)+'<h3>逐条回答</h3>' +
      (detail.results.length ? detail.results.map(r => '<details data-result-id="'+r.id+'"><summary>' + pill(r.status) + ' ' +
        esc(r.platform) + ' / ' + esc(r.account_label || '默认账号') + ' · ' + esc(r.question) +answerReviewBadge(r.review)+ '</summary>' +answerReviewDisplay(r.review)+(r.review?.reviewable?'<p><button class="secondary" data-action="answerReviewEdit" data-id="'+r.id+'">人工复核</button></p>':'')+
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
function monitorConditionsView(e) {
  const c=e.monitorConditions;
  const value=k=>c?.[k]?.value;
  const flag=k=>value(k)===true?'开启':value(k)===false?'关闭':'未知';
  const reasons=['search','thinking','model'].map(k=>c?.[k]?.reason).filter(Boolean);
  return '<p class="muted">发送前条件：搜索 '+flag('search')+' · 思考 '+flag('thinking')+' · 页面模型/模式 '+esc(value('model')||'未知')+(c?.capturedAt?' · '+dateText(c.capturedAt):' · 旧记录未保存')+(e.conditionsChanged?' · 采集前后发现条件变化':'')+'</p><small class="muted">'+esc(reasons.join('；'))+'</small>';
}
function nameEvidenceView(e,includeTitles=true,entityLabel='品牌') {
  const n=e.nameEvidence;if(!n)return '';
  const excerpt=x=>'<p class="brand-excerpt">'+(x.leading?'…':'')+x.parts.map(p=>p.highlight?'<mark>'+esc(p.text)+'</mark>':esc(p.text)).join('')+(x.trailing?'…':'')+'</p>';
  const names=x=>x.names.map(m=>(m.type==='brand_name'?entityLabel+'全名：':'别名：')+m.name).join('；');
  const titles=(items,label)=>'<h4>'+label+'命中 · '+items.length+' 个条目</h4>'+items.slice(0,4).map(c=>'<small>'+esc(names(c))+'</small>'+c.excerpts.map(excerpt).join('')).join('')+(items.length>4?'<small>此处展示前4个，完整标题见下方来源列表。</small>':'');
  return '<section class="brand-evidence"><h4>正文名称命中证据</h4>'+(n.body.matched?'<small>'+esc(names(n.body))+' · '+n.body.occurrences+' 处文字命中</small>'+n.body.excerpts.map(excerpt).join('')+(n.body.excerptCount>n.body.excerpts.length?'<small>展示前 '+n.body.excerpts.length+' 个片段，共 '+n.body.excerptCount+' 个；完整内容见回答原文。</small>':''):'<p class="muted">正文未匹配配置的'+esc(entityLabel)+'名或别名。</p>')+(includeTitles?'<details><summary>引用标题 / 搜索结果标题命中：'+n.citations.length+' / '+n.search.length+'</summary><p class="muted">标题命中不计入正文提及率；这里只匹配已保存的标题文字，不判断链接页面全文。</p>'+titles(n.citations,'引用标题')+titles(n.search,'搜索结果标题')+'</details>':'')+'<small class="muted">这是文字匹配，不代表推荐、认可或身份核实；含义较宽的别名请结合上下文核对。</small></section>';
}
function analyticsView() {
  const option = (value, label, selected) => '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
  const heading = '<div class="page-heading"><div><span class="eyebrow">BRAND INSIGHTS</span><h1>分析报告</h1><p class="lead">从品牌表现到每一条回答，让统计有依据。</p></div><button class="secondary" data-action="refresh">刷新报告</button></div>';
  if (!state.brands.length) return heading + '<div class="card">请先添加品牌并运行监测任务。</div>';
  const filters = '<div class="card"><p class="muted">专题筛选按当前问题成员查看历史记录，不代表当时的专题归属。</p><form id="reportFilterForm" class="report-filters"><label>品牌<select name="brandId">' + state.brands.map(b => option(b.id,b.name,state.brandId)).join('') + '</select></label>' +
    '<label>任务<select name="taskId">' + option('','全部任务',reportFilters.taskId) + state.tasks.filter(t => t.brand_id===state.brandId).map(t => option(t.id,t.name,reportFilters.taskId)).join('') + '</select></label>' +
    '<label>专题（当前成员）<select name="topicId">'+topicOptions(reportFilters.topicId)+'</select></label>'+
    '<label>记录条件组<select name="cohort">' + option('','全部记录条件',reportFilters.cohort) + (analytics?.cohorts || []).map((c,i) => option(c.key,c.label + ' · 条件组 ' + (i+1) + ' · ' + c.firstDay + ' 至 ' + c.lastDay,reportFilters.cohort)).join('') + '</select></label>' +
    '<label>平台<select name="platform">' + option('','全部平台',reportFilters.platform) + state.platforms.map(p => option(p.id,p.label,reportFilters.platform)).join('') + '</select></label>' +
    '<label>账号<select name="accountId">' + option('','全部账号',reportFilters.accountId) + state.accounts.map(a => option(a.id,a.label + ' · ' + a.platform,reportFilters.accountId)).join('') + '</select></label>' +
    '<label>问题类型<select name="kind">' + option('','全部类型',reportFilters.kind) + option('discovery','产品推荐',reportFilters.kind) + option('brand','品牌认知',reportFilters.kind) + '</select></label>' +
    '<label>开始日期<input type="date" name="from" value="' + esc(reportFilters.from) + '"></label><label>结束日期<input type="date" name="to" value="' + esc(reportFilters.to) + '"></label><button>应用筛选</button></form></div>';
  if (!analytics) return heading + filters + '<div class="card">暂无报告。</div>';
  const r = analytics, s = r.summary;
  const drill = (key, label) => '<button class="report-drill" data-action="reportEvidence" data-id="' + esc(key) + '">' + label + '</button>';
  const metric = (name,value,note,key) => '<div class="card report-metric"><div class="muted">' + name + '</div>' + drill(key,'<strong class="stat">' + value + '</strong>') + '<small>' + note + '</small></div>';
  let selected = r.records;
  if (reportEvidence === 'eligible') selected = selected.filter(e => e.eligible && e.status === 'succeeded');
  else if (reportEvidence === 'mentions') selected = selected.filter(e => e.eligible && e.mentioned);
  else if (reportEvidence === 'successful') selected = selected.filter(e => e.status === 'succeeded');
  else if (reportEvidence === 'cited') selected = selected.filter(e => e.status === 'succeeded' && e.citations.length);
  else if (reportEvidence === 'ownSource') selected = selected.filter(e => e.status==='succeeded' && e.mentioned && e.ownCitation!==null);
  else if(reportEvidence.startsWith('review|')){const status=reportEvidence.slice(7);selected=selected.filter(e=>e.status==='succeeded'&&(status==='stale'?e.review?.stale:(e.review?.effectiveStatus||'pending')===status));}
  else if (reportEvidence !== 'all') {
    const [type, ...parts] = reportEvidence.split('|'); const key = parts.join('|');
    const facts=r.questionFacts || [];
    const changes=r.runChanges || [];
    const buckets=changes.flatMap(c=>['gained','lost','kept','absent','excluded','matched'].map(state=>({key:JSON.stringify([c.key,state]),evidenceIds:
      (state==='excluded'?c.excluded:state==='matched'?c.pairs:c.pairs.filter(p=>p.state===state)).flatMap(p=>p.evidenceIds)})));
    const fact=facts.find(q=>q.key===key);
    const split=type==='split' ? facts.flatMap(q=>q.sourceSplit).find(s=>s.key===key) : null;
    const group = split || ({ day: r.trend, account: r.accounts, question: r.questions, cell: r.matrix, source: r.sources, page:r.pages, fact:facts, transition:buckets, history:r.history, historyDay:r.history.flatMap(h=>h.daily), historySource:r.history.flatMap(h=>h.sources), historyChange:r.history.flatMap(h=>h.points.map(p=>p.change).filter(Boolean)), samplingAccount:r.sampling?.accountsDistribution, samplingQuestion:r.sampling?.questionsDistribution })[type]?.find(g => (type==='page' ? g.url : g.key || g.host) === key);
    const pair = type==='compare' ? r.comparisons.find(c=>c.key===key) : null;
    const runPair=type==='runPair'?changes.flatMap(c=>c.pairs).find(p=>p.key===key):null;
    const ids=({ factNamed:fact?.namedIds, factAbsent:fact?.absentIds, factOwn:fact?.ownPresentIds, factNoOwn:fact?.ownAbsentIds })[type];
    selected = type==='record'?selected.filter(e=>e.key===key):ids ? selected.filter(e=>ids.includes(e.key)) : runPair ? selected.filter(e=>runPair.evidenceIds.includes(e.key)):pair ? selected.filter(e=>[pair.beforeId,pair.afterId].includes(e.key)) : group ? selected.filter(e => group.evidenceIds.includes(e.key)) : [];
  }
  const safeLink = (url, title) => /^https?:\/\//i.test(url || '') ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(title || url) + '</a>' : esc(title || '无可用链接');
  const evidence = '<div class="evidence-backdrop" data-action="closeEvidence"></div><section class="card evidence-drawer" id="reportEvidence" role="dialog" aria-modal="true" aria-label="回答证据" tabindex="-1"><div class="row between"><h2>统计对应的回答 · ' + selected.length + ' 条</h2><button class="secondary" data-action="closeEvidence">关闭证据</button></div>' + comparisonView(r,safeLink) + drill('all','查看全部') + '<p class="muted">最多显示最近 40 条；完整记录可在采集结果按运行查看。关闭面板后筛选保持不变。</p>' +
    selected.slice(-40).reverse().map(e => '<details><summary>' + pill(e.status) + ' ' + esc(e.question) + ' <span class="muted">' + esc(e.platform + ' / ' + e.account_label) + '</span>'+answerReviewBadge(e.review)+'</summary>' +
      '<p class="muted">' + dateText(e.started_at) + ' · 运行 #' + e.run_id + ' · ' + esc(e.task_name) + ' · ' + (e.brandBasis==='current_fallback'?'历史品牌快照缺失，按当前资料补算“':'按当时品牌“') + esc(e.brand.name) + '”' +
      (e.status === 'succeeded' ? ' · ' + (e.mentioned ? '提到品牌' : '未提到品牌') : '') + '</p>' +
      answerReviewDisplay(e.review)+monitorConditionsView(e)+(e.status === 'succeeded' ? nameEvidenceView(e)+'<h4>完整回答原文</h4><p class="answer">' + esc(e.answer).replace(/\n/g,'<br>') + '</p>' : '<p>' + esc(e.error || '尚未取得最终结果') + '</p>') +
      '<h4>正文引用 · ' + e.citations.length + ' 条</h4>' + (e.citationCompleteness!=='complete' ? '<p class="message warning">'+ (e.citationGap?'引用数量有缺口或与页面标注不一致。':'页面引用总数未知，不能确认链接已完整采集。') +'以下只展示已取得的有效链接。</p>' : '') +
      '<ul>' + e.citations.map(c => '<li>' + safeLink(c.url,c.title) + '</li>').join('') + '</ul>' +
      (e.searchedSites.length ? '<details><summary>搜索结果 · ' + e.searchedSites.length + ' 条（不计入正文引用统计）</summary><ul>' + e.searchedSites.map(c => '<li>' + safeLink(c.url,c.title) + '</li>').join('') + '</ul></details>' : '') +
      (e.screenshot ? '<p><a href="' + esc(e.screenshot) + '" target="_blank" rel="noopener noreferrer">查看采集截图</a></p>' : '') +
      '<button class="secondary" data-action="viewRun" data-id="' + e.run_id + '">查看完整执行记录</button></details>').join('') + (selected.length ? '' : '<p class="muted">当前筛选没有对应回答。</p>') + '</section>';
  return heading + filters + '<p class="muted">覆盖 ' + r.runCount + ' 次运行 · 日期按北京时间归属 · 重试只计最终结果，不重复累计尝试。</p>' +
    '<div class="report-metrics">' + metric('有效回答', s.successful, '统计样本 ' + s.total + ' 条；失败 ' + s.failed + '，待处理/未定位 ' + s.pending + '，样本不可用 ' + (s.invalid||0), 'successful') +
    metric('品牌主动提及率', pct(s.mentionRate), s.mentions + ' / ' + s.eligible + ' 条无品牌名推荐类有效回答', 'mentions') +
    metric('采集成功率', pct(s.captureRate), s.successful + ' / ' + s.total + ' 条统计样本（包括已知缺失）', 'all') +
    metric('官网引用（可判定样本）', pct(s.ownSourceRate), s.ownSourceAnswers + ' / ' + s.ownSourceEligible + ' 条可判定回答；另有 ' + (s.ownSourceUnknown||0) + ' 条提及品牌的回答无法判断', 'ownSource') + '</div>' + reportAuditView(r) +answerReviewSummaryView(r.manualReviews,drill)+
    '<div class="message report-scope">提及依据为品牌名或别名匹配，不代表推荐或认可。少于 3 条有效推荐回答时，不宜根据比例下结论。不同日期的问题、账号、联网模式可能不同，以下趋势是采样记录，不是严格同条件的效果比较。</div>' +
    runChangesView(r,drill) + historyView(r,drill,safeLink) + reportInsightsView(r,drill,safeLink) +
    '<div class="grid"><div class="card"><h2>每日主动提及趋势</h2><p class="muted">每行显示提及次数 / 有效推荐回答数；无有效样本时不记为 0%。</p><div class="report-trend">' + r.trend.map(d =>
      '<div class="trend-row">' + drill('day|' + d.key,esc(d.key)) + '<div class="trend-track"><span style="width:' + (d.mentionRate === null ? 0 : d.mentionRate * 100) + '%"></span></div><span>' + pct(d.mentionRate) + ' <small>(' + d.mentions + '/' + d.eligible + ')</small><small>有效回答 '+d.successful+' · 失败 '+d.failed+' · 不可用 '+d.invalid+' · 待处理/缺失 '+d.pending+(d.unlocatedExpected?' · 未定位 '+d.unlocatedExpected:'')+'</small></span></div>').join('') + (r.trend.length ? '' : '<p>暂无采样记录。</p>') + '</div></div>' +
    '<div class="card"><h2>账号表现</h2><p class="muted">问题集合或次数不同，账号之间不能直接按百分比排名。</p><table><thead><tr><th>平台 / 账号</th><th>成功 / 失败 / 待处理</th><th>主动提及</th></tr></thead><tbody>' + r.accounts.map(a => '<tr><td>' + drill('account|' + a.key,esc(a.first.platform + ' / ' + a.first.account_label)) + '</td><td>' + a.successful + ' / ' + a.failed + ' / ' + a.pending + '</td><td>' + pct(a.mentionRate) + ' (' + a.mentions + '/' + a.eligible + ')</td></tr>').join('') + '</tbody></table></div></div>' +
    '<div class="card"><h2>问题 × 平台表现</h2><p class="muted">推荐类显示品牌主动提及次数 / 有效回答数；品牌认知类查看采集数量，不混入主动提及率。单元格可以展开原文。</p><table class="report-matrix"><thead><tr><th>问题</th>' + r.platforms.map(p => '<th>' + esc(p) + '</th>').join('') + '</tr></thead><tbody>' +
    r.questions.map(q => '<tr><td>' + drill('question|' + q.key,esc(q.first.question)) + '<small>' + (q.first.eligible ? '无品牌名推荐类' : '品牌认知 / 含品牌名') + '</small></td>' + r.platforms.map(p => {
      const cell = r.matrix.find(c => c.key === q.key + ':' + p);
      return '<td>' + (cell ? drill('cell|' + cell.key, (q.first.eligible ? pct(cell.mentionRate) + ' (' + cell.mentions + '/' + cell.eligible + ')' : cell.successful + ' 条有效回答') + '<small>失败 ' + cell.failed + ' · 待处理 ' + cell.pending + '</small>') : '—') + '</td>';
    }).join('') + '</tr>').join('') + '</tbody></table></div>' +
    '<div class="card"><h2>正文引用来源</h2><p class="muted">“覆盖回答”每条回答对同一域名只计一次；“链接次数”按采集到的引用条目累计。官网依据当次品牌资料的网站域名识别，未配置时无法识别；不代表验证过来源真实性或可访问性。</p><table><thead><tr><th>域名</th><th>覆盖回答</th><th>链接次数</th><th>匹配品牌官网的回答</th><th>来源示例</th></tr></thead><tbody>' + r.sources.map(s => '<tr><td>' + drill('source|' + s.host,esc(s.host)) + '</td><td>' + s.answers + '</td><td>' + s.count + '</td><td>' + s.ownAnswers + '</td><td>' + s.links.slice(0,2).map(c => safeLink(c.url,c.title || c.url)).join('<br>') + '</td></tr>').join('') + '</tbody></table>' + (r.sources.length ? '' : '<p class="muted">暂无正文引用链接。</p>') + sourcePagesView(r,drill,safeLink) + '</div><div class="card"><h2>原始证据</h2><p class="muted">点击指标或矩阵，从侧边查看回答与来源。</p>' + drill('all','查看全部回答') + (!r.records.length ? '<p>当前筛选没有对应回答。</p>' : '') + '</div>' + reportSamplingView(r,drill) + (evidenceOpen ? evidence : '');
}
function reportAuditView(r) {
  const a=r.audit||{}, lines=[];
  if(a.fallbackBrandRecords) lines.push(a.fallbackBrandRecords+' 条历史记录没有品牌快照，名称统计按当前资料补算，不能当作当时品牌口径。');
  if(a.unlocatedExpected) lines.push(a.unlocatedExpected+' 条已知预期样本无法定位到问题/账号。'+(a.unlocatedIncluded?'已计入总体分母和未定位数量，不补造回答。':'当前按平台/账号/类型筛选，无法确认这些样本属于哪一组，未分配进筛选分母。'));
  if(a.expectedMismatchRuns) lines.push(a.expectedMismatchRuns+' 次运行的记录数量超过保存的预期数量，总体采集成功率暂不计算。');
  if(a.invalidAnswers) lines.push(a.invalidAnswers+' 条记录因正文为空或归属不唯一，已排除有效回答统计。');
  if(a.citationUnknown) lines.push(a.citationUnknown+' 条有效回答的引用总数未知；没有取得官网链接不直接判断为没有官网引用。');
  if(a.citationPartial) lines.push(a.citationPartial+' 条有效回答的引用数量有缺口或不一致；来源分布仅展示已取得的链接。');
  if(a.discardedCitationLinks) lines.push(a.discardedCitationLinks+' 条非有效网页URL未计入引用统计。');
  return lines.length?'<div class="message warning report-audit"><strong>本次报告的数据边界</strong><ul>'+lines.map(l=>'<li>'+esc(l)+'</li>').join('')+'</ul></div>':'';
}
function runChangesView(r,drill) {
  const groups=r.runChanges || [];
  const delta=value=>value===null?'暂无可比数据':(value>0?'+':'')+(value*100).toFixed(1)+' 个百分点';
  const names={gained:'新增出现',lost:'未再出现',kept:'持续出现',absent:'持续未出现'};
  return '<div class="card"><h2>最近两次运行对比</h2><p class="muted">每个记录条件组取最近两次已结束运行；只比较两次都成功的同一问题、同一账号。失败、缺失、口径变化单列，不作为下降。筛选范围决定选中的运行。</p>'+
    (groups.length?groups.map(c=>'<article class="question-fact"><h3>'+esc(c.task)+'</h3><p class="muted">上次 #'+c.beforeRun+' · '+dateText(c.beforeDate)+' → 本次 #'+c.afterRun+' · '+dateText(c.afterDate)+'</p><div class="fact-counts">'+drill('transition|'+JSON.stringify([c.key,'matched']),'可比回答对 '+c.matched)+drill('transition|'+JSON.stringify([c.key,'excluded']),'未纳入对比 '+c.excluded.length)+'</div><div class="change-stats">'+Object.entries(names).map(([state,label])=>'<div>'+drill('transition|'+JSON.stringify([c.key,state]),'<strong>'+c.transitions[state]+'</strong><span>'+label+'</span>')+'</div>').join('')+'</div>'+
      ((c.unlocatedBefore||c.unlocatedAfter)?'<p class="muted">未能定位的问题/账号样本：上次 '+c.unlocatedBefore+'，本次 '+c.unlocatedAfter+'。这些样本无法配对，不包含在下方已定位的未纳入项目数中；不会跳过这次运行改用更早批次。</p>':'')+
      '<p class="muted">页面设置确认一致 '+c.conditionsKnownMatched+' 对；条件未完整记录 '+(c.matched-c.conditionsKnownMatched)+' 对，未知样本不能宣称同条件。</p>'+(c.matched<3?'<p class="muted">当前只有 '+c.matched+' 对可比回答，比例容易波动，不据此判定持续趋势。</p>':'')+'<p>名称出现率：'+pct(c.beforeRate)+'（'+c.beforeMentions+'/'+c.matched+'） → '+pct(c.afterRate)+'（'+c.afterMentions+'/'+c.matched+'），变化 '+delta(c.difference)+'。</p>'+
      '<p>主动提及率：'+pct(c.beforeActiveRate)+'（'+c.beforeActive+'/'+c.activeMatched+'） → '+pct(c.afterActiveRate)+'（'+c.afterActive+'/'+c.activeMatched+'），变化 '+delta(c.activeDifference)+'。</p><p class="muted">主动提及仅用双方均成功的无品牌名推荐样本；两次使用同一配对分母，不与上方全部样本的累计比例混用。</p>'+
      '<p>官网引用：'+c.beforeOwn+'/'+c.ownMatched+' → '+c.afterOwn+'/'+c.ownMatched+' 个回答对。<small class="muted">仅比较两次都提及品牌、官网引用有足够依据可判定的回答对；分母为 0 时无法判断。</small></p>'+
      '<details><summary>展开配对结果与已取得的引用变化</summary><table><thead><tr><th>问题 / 账号</th><th>名称变化</th><th>引用变化</th><th>证据</th></tr></thead><tbody>'+c.pairs.map(p=>'<tr><td>'+esc(p.question)+'<small>'+esc(p.platform+' / '+p.account)+'</small></td><td>'+names[p.state]+'<small>'+(p.conditionsMatch==='same'?'已记录页面条件一致':'页面条件未完整记录')+'</small></td><td>新增 '+p.added.length+' · 本次未取得 '+p.removed.length+(p.citationIncomplete?' · 引用完整性未确认':'')+'</td><td>'+drill('runPair|'+p.key,'对照配对回答')+'</td></tr>').join('')+'</tbody></table></details>'+
      '<details><summary>未纳入对比 · '+c.excluded.length+' 项</summary><table><thead><tr><th>问题 / 账号</th><th>上次 / 本次</th><th>未纳入原因</th></tr></thead><tbody>'+c.excluded.map(e=>'<tr><td>'+esc(e.question)+'<small>'+esc(e.platform+' / '+e.account)+'</small></td><td>'+esc(e.beforeStatus+' / '+e.afterStatus)+'</td><td>'+esc(e.reason)+'</td></tr>').join('')+'</tbody></table></details></article>').join(''):
      '<p>当前范围内没有同一记录条件组的两次已结束运行。旧记录缺少快照，或运行仍在进行时，不会强行生成对比。</p>')+'<p class="muted">记录条件相同不代表模型、联网模式、地区或个性化完全相同；这里报告样本变化，不判断变化原因。</p></div>';
}
function historyView(r,drill,safeLink) {
  const histories=r.history || [];
  return '<div class="card report-history"><h2>逐问题历史轨迹</h2><p class="muted">同一问题、平台和账号的采样记录。节点展示最近 12 次，展开后查看每日分母与相邻记录的引用变化。失败不算未提及，不跨过失败拼接变化；累计比例描述所选样本，不证明持续改善。</p>'+histories.map(h=>'<article class="question-fact"><div class="history-row"><div><strong>'+esc(h.question)+'</strong><small>'+esc(h.platform+' / '+h.account)+' · 共 '+h.points.length+' 次记录</small><p>名称出现 '+h.summary.nameMentions+'/'+h.summary.successful+' 条有效回答；主动提及 '+pct(h.summary.mentionRate)+'（'+h.summary.mentions+'/'+h.summary.eligible+'）。</p>'+drill('history|'+h.key,'查看历史证据')+'</div><div class="history-points">'+h.points.slice(-12).map(p=>{
    const label=p.status==='succeeded'?(p.mentioned?'名称出现':'名称未出现'):({failed:'采集失败',needs_attention:'待人工处理',pending:'未取得结果',unusable:'样本不可用',retry_pending:'等待重试'})[p.status]||'待处理';
    return '<button class="history-point '+(p.status==='succeeded'?(p.mentioned?'named':'absent'):'unknown')+'" data-action="reportEvidence" data-id="'+esc('record|'+p.key)+'" title="'+esc(dateText(p.date)+' · '+label)+'"><small>#'+p.run+'</small><span>'+label+'</span>'+ (p.conditionChanged?'<small>已记录条件变化</small>':p.conditionUnknown?'<small>条件未完整记录</small>':'')+'</button>';
  }).join('')+'</div></div><details data-history-panel="'+esc(JSON.stringify([state.brandId,h.key]))+'"'+(historyPanels.has(JSON.stringify([state.brandId,h.key]))?' open':'')+'><summary>展开日期统计与引用变化</summary><h3>按日期的采样分母</h3><p class="muted">同日不同任务条件组或问题口径分行，不混成同条件趋势。每行仅使用已定位记录；未定位预期样本见报告顶部，不虚构到某个问题。比例不含失败和待处理。显示最近 14 行，共 '+h.daily.length+' 行。</p><table><thead><tr><th>日期 / 问题</th><th>名称出现 / 有效回答</th><th>主动提及</th><th>证据</th></tr></thead><tbody>'+h.daily.slice(-14).map(d=>'<tr><td>'+esc(d.day||'日期未知')+'<small>'+esc(d.question)+(d.cohortKnown?'':' · 条件组未知')+'</small></td><td>'+d.nameMentions+'/'+d.successful+'<small>失败 '+d.failed+' · 不可用 '+d.invalid+' · 待处理 '+d.pending+'</small></td><td>'+pct(d.mentionRate)+'（'+d.mentions+'/'+d.eligible+'）</td><td>'+drill('historyDay|'+d.key,'查看当天样本')+'</td></tr>').join('')+'</tbody></table><h3>相邻两次记录</h3><p class="muted">新增与未取得只指保存的精确 URL 集合，不证明平台停止引用。设置未知会注明，引用缺漏时不能确认全部变化。显示最近 12 次中的相邻对照。</p>'+h.points.slice(-12).filter(p=>p.change).map(p=>{const c=p.change;return '<div class="question-fact"><strong>'+drill('historyChange|'+c.key,'运行 #'+c.beforeRun+' → #'+c.afterRun+' · 查看回答')+'</strong><p>'+ (c.reason?'不计算变化：'+esc(c.reason):'名称：'+(c.beforeMention?'出现':'未出现')+' → '+(c.afterMention?'出现':'未出现')+' · 两次均取得 '+c.keptSources.length+' 个引用页面 · 新增 '+c.addedSources.length+' · 本次未取得 '+c.removedSources.length)+'</p>'+(!c.reason?'<small class="muted">'+(c.conditionsMatch==='same'?'已记录页面设置一致':'页面设置未知，不能确认同条件')+(c.citationIncomplete?'；至少一侧引用完整性未确认':'')+'</small><details><summary>具体引用页面</summary>'+[['两次均取得',c.keptSources],['本次新增取得',c.addedSources],['上次取得、本次未取得',c.removedSources]].map(([label,urls])=>'<h4>'+label+' · '+urls.length+'</h4><ul>'+urls.map(url=>'<li>'+safeLink(url,url)+'</li>').join('')+'</ul>').join('')+'</details>':'')+'</div>';}).join('')+'<h3>历次已取得的引用页面</h3><p class="muted">每条有效回答对同一 URL 只计一次。覆盖比例的分母为全部 '+h.summary.successful+' 条有效回答；未取得不代表未引用，不同条件样本可能混合。显示前 20 个，共 '+h.sources.length+' 个。</p><table><thead><tr><th>页面</th><th>覆盖有效回答</th><th>出现于运行</th><th>证据</th></tr></thead><tbody>'+h.sources.slice(0,20).map(s=>'<tr><td>'+safeLink(s.url,s.title)+'</td><td>'+s.evidenceIds.length+'/'+h.summary.successful+'</td><td>'+esc(s.runs.map(id=>'#'+id).join('、'))+'</td><td>'+drill('historySource|'+s.key,'查看引用原文')+'</td></tr>').join('')+'</tbody></table>'+(!h.sources.length?'<p>未取得可展示的正文引用链接。</p>':'')+'</details></article>').join('')+(histories.length?'':'<p>暂无历史记录。</p>')+'</div>';
}
function reportInsightsView(r,drill,safeLink) {
  const facts=r.questionFacts || [];
  return '<div class="card report-facts"><h2>品牌表现与数据差异</h2><p class="lead">按问题展示名称出现、平台分布和引用页面，不生成内容优化建议。</p><p class="muted">名称出现通过当次品牌名称或别名匹配，不等于推荐。品牌认知或含品牌名的问题单独看名称出现；主动提及只统计无品牌名的推荐样本。所有分布仅包含成功回答。</p>' +
    (facts.length ? facts.map(q=>'<article class="question-fact"><h3>'+esc(q.first.question)+'</h3><div class="fact-counts">'+
      drill('fact|'+q.key,'有效回答 '+q.successful+' 条')+drill('factNamed|'+q.key,'名称出现 '+q.nameMentions+' 条')+drill('factAbsent|'+q.key,'名称未出现 '+(q.successful-q.nameMentions)+' 条')+'</div>'+
      '<div class="fact-bar" aria-label="名称出现分布"><span style="width:'+((q.nameMentionRate||0)*100)+'%"></span></div><p class="muted">名称出现率 '+pct(q.nameMentionRate)+'（'+q.nameMentions+'/'+q.successful+'）；主动提及率 '+pct(q.mentionRate)+'（'+q.mentions+'/'+q.eligible+' 条无品牌名推荐样本）。失败 '+q.failed+'，待处理 '+q.pending+'，均不计入这两个比例。</p>'+
      '<details class="question-name-evidence"><summary>品牌名称出现在哪里 · 查看原文片段</summary><p>正文命中 '+q.nameLocations.body+' 条回答；引用标题命中 '+q.nameLocations.citationTitles+' 条；搜索结果标题命中 '+q.nameLocations.searchTitles+' 条；其中仅标题命中、正文未命中 '+q.nameLocations.titleOnly+' 条。</p><p class="muted">这些数量可以重叠，不能相加；标题命中不进入正文提及率。按保存的品牌名与别名匹配，不判定推荐态度。展示最近12条有效回答，共 '+q.successful+' 条。</p>'+r.records.filter(e=>q.evidenceIds.includes(e.key)).slice(-12).reverse().map(e=>'<article class="question-fact"><strong>'+drill('record|'+e.key,'运行 #'+e.run_id+' · '+esc(e.platform+' / '+e.account_label)+' · 查看原文')+'</strong>'+nameEvidenceView(e)+'</article>').join('')+'</details>'+
      '<details><summary>平台数据分布</summary><table><thead><tr><th>平台</th><th>有效回答</th><th>名称出现 / 未出现</th><th>主动提及</th></tr></thead><tbody>'+q.platforms.map(p=>'<tr><td>'+drill('cell|'+p.key,esc(p.first.platform))+'</td><td>'+p.successful+'</td><td>'+p.nameMentions+' / '+(p.successful-p.nameMentions)+'</td><td>'+pct(p.mentionRate)+' ('+p.mentions+'/'+p.eligible+')</td></tr>').join('')+'</tbody></table><p class="muted">平台的账号、问题组版本和采样次数可能不同；这张表不作平台能力或优化效果排名。</p></details>'+
      '<details><summary>名称出现与未出现的回答，分别引用了哪些页面 · '+q.sourceSplit.length+' 个</summary><p class="muted">每个回答对同一URL只计一次。两组分母分别为 '+q.nameMentions+' 和 '+(q.successful-q.nameMentions)+' 条有效回答；共同引用不代表引用导致了品牌出现。搜索结果不混入正文引用。</p><table><thead><tr><th>引用页面</th><th>名称出现组</th><th>名称未出现组</th><th>证据</th></tr></thead><tbody>'+q.sourceSplit.map(p=>'<tr><td>'+safeLink(p.url,p.title)+'</td><td>'+p.mentioned+'/'+q.nameMentions+' · '+pct(q.nameMentions?p.mentioned/q.nameMentions:null)+'</td><td>'+p.absent+'/'+(q.successful-q.nameMentions)+' · '+pct(q.successful>q.nameMentions?p.absent/(q.successful-q.nameMentions):null)+'</td><td>'+drill('split|'+p.key,'查看对应回答')+'</td></tr>').join('')+'</tbody></table>'+
      (!q.sourceSplit.length?'<p>没有取得可统计的正文引用页面。</p>':'')+'<p class="muted">'+q.noCitations+' 条回答未取得正文引用；'+q.citationMissing+' 条标出了引用数量缺口。这里的分布只代表已取得的链接。</p></details>'+
      '<div class="fact-counts">'+drill('factOwn|'+q.key,'提及品牌且有官网引用 '+q.ownPresentIds.length+' 条')+drill('factNoOwn|'+q.key,'提及品牌但未见官网引用 '+q.ownAbsentIds.length+' 条')+'</div><small class="muted">官网引用有匹配链接即记已见；未见只统计可见引用总数已核对一致的样本；另有 '+q.ownUnknown+' 条提及品牌的回答暂不参与官网判断。</small></article>').join(''):
      '<p>当前筛选没有问题数据。</p>') + '</div>' +
    '<div class="card"><h2>前后回答变化</h2><p class="muted">按相同记录条件组，比较同一问题、同一账号最近两次成功回答；失败尝试不作为回答对照。</p>' + (r.comparisons.length ? '<table><thead><tr><th>问题 / 账号</th><th>变化</th><th>操作</th></tr></thead><tbody>' + r.comparisons.map(c=>{const e=r.records.find(x=>x.key===c.afterId);return '<tr><td>'+esc(e.question)+'<small>'+esc(e.platform+' / '+e.account_label)+'</small></td><td>'+esc(c.mentionChange)+'<small>引用新增 '+c.addedSources.length+' · 本次未取得 '+c.removedSources.length+(c.citationIncomplete?' · 引用完整性未确认':'')+'</small></td><td>'+drill('compare|'+c.key,'对照两次回答')+'</td></tr>';}).join('')+'</tbody></table>' : '<p>还没有可对照的两次成功回答。旧记录缺少条件快照或筛选范围过窄时，也不会强行比较。</p>') + '</div>';
}
function reportSamplingView(r,drill) {
  const s=r.sampling; if(!s) return '';
  const range=g=>g.firstDay?esc(g.firstDay+(g.lastDay!==g.firstDay?' 至 '+g.lastDay:'')):'日期未记录';
  return '<div class="card report-sampling"><h2>监测样本分布</h2><p class="muted">只统计当前筛选中的有效回答。样本占比说明累计结果主要来自哪里，不是平台排名或优化效果评分。</p>'+
    '<div class="fact-counts"><span>有效回答 '+s.samples+'</span><span>问题 '+s.questionCount+'</span><span>平台 '+s.platforms+'</span><span>已知账号 '+s.accounts+'</span><span>有有效回答的运行 '+s.runs+'</span></div>'+
    '<p class="muted">有效采样日期：'+range(s)+' · 共 '+s.days+' 天；搜索、思考和页面模型/模式三项均已记录 '+s.settingsComplete+'/'+s.samples+' 条。记录完整不证明条件相同或模型版本一致。</p>'+
    (s.unknownAccountSamples?'<p class="muted">另有 '+s.unknownAccountSamples+' 条回答缺少账号ID，按平台和运行单列，不把它们认作同一账号。</p>':'')+
    '<h3>各平台与账号贡献的样本</h3><table><thead><tr><th>平台 / 账号</th><th>有效回答 / 占比</th><th>覆盖问题</th><th>运行数</th><th>采样日期</th></tr></thead><tbody>'+s.accountsDistribution.map(g=>'<tr><td>'+drill('samplingAccount|'+g.key,esc(g.platform+' / '+(g.accountKnown?g.account:'账号ID未知 · 单次运行')))+'</td><td>'+g.samples+' · '+pct(g.share)+'</td><td>'+g.questionCount+'</td><td>'+g.runs+'</td><td>'+range(g)+'</td></tr>').join('')+'</tbody></table>'+
    '<h3>各问题的监测覆盖</h3><table><thead><tr><th>问题</th><th>有效回答 / 占比</th><th>运行数</th><th>平台 / 已知账号</th><th>条件记录完整</th></tr></thead><tbody>'+s.questionsDistribution.map(g=>'<tr><td>'+drill('samplingQuestion|'+g.key,esc(g.question))+'</td><td>'+g.samples+' · '+pct(g.share)+'</td><td>'+g.runs+'</td><td>'+g.platforms+' / '+g.accounts+'</td><td>'+g.settingsComplete+'/'+g.samples+'</td></tr>').join('')+'</tbody></table>'+
    (!s.samples?'<p>当前筛选没有有效回答，暂时无法展示样本分布。</p>':'')+
    '<p class="muted">重复监测次数不是独立用户人数，也不代表同条件复测。某个账号或问题采样更多，会在累计比例中占更大比重；时间变化请结合上方配对结果查看。</p></div>';
}
function sourcePagesView(r,drill,safeLink) {
  return '<details><summary>具体引用页面 · '+r.pages.length+' 个</summary><table><thead><tr><th>页面</th><th>覆盖回答</th><th>查看</th></tr></thead><tbody>'+r.pages.map(p=>'<tr><td>'+safeLink(p.url,p.title)+'</td><td>'+p.answers+'</td><td>'+drill('page|'+p.url,'查看引用它的回答')+'</td></tr>').join('')+'</tbody></table></details>';
}
function comparisonView(r,safeLink) {
  const raw=reportEvidence.startsWith('runPair|')?(r.runChanges||[]).flatMap(c=>c.pairs).find(p=>p.key===reportEvidence.slice(8)):null;
  const names={gained:'本次出现品牌',lost:'本次未再出现品牌',kept:'两次均出现品牌',absent:'两次均未出现品牌'};
  const pair = raw?{...raw,mentionChange:names[raw.state],addedSources:raw.added,removedSources:raw.removed}:reportEvidence.startsWith('compare|') ? r.comparisons.find(c=>c.key===reportEvidence.slice(8)) : null;
  if (!pair) return '';
  return '<div class="comparison"><h3>最近两次成功回答对照</h3><p class="muted">'+(pair.conditionsMatch==='same'?'已记录的页面设置一致。':'页面设置未完整记录，不能确认同条件。')+'</p><p>' + esc(pair.mentionChange) + ' · 新增引用 ' + pair.addedSources.length + ' 条 · 本次未取得 ' + pair.removedSources.length + ' 条</p><p class="muted">引用差异仅比较已取得的链接，不证明平台停止引用来源。'+(pair.citationIncomplete?'至少一侧引用完整性未确认，未取得可能来自采集缺口。':'')+'</p><p class="muted">问题、账号、任务问题组及品牌判断口径相同；模型、联网模式、地区和个性化未完整记录，不能据此认定变化原因。</p><div class="compare-columns">' + [pair.beforeId,pair.afterId].map((id,i)=>{
    const e=r.records.find(x=>x.key===id); return '<section><h4>'+(i?'本次':'上次')+' · 运行 #'+e.run_id+'</h4><small>'+dateText(e.started_at)+'</small>'+nameEvidenceView(e,false)+'<p class="answer">'+esc(e.answer).replace(/\n/g,'<br>')+'</p></section>';
  }).join('') + '</div><details><summary>引用变化明细</summary><h4>新增引用</h4><ul>' + pair.addedSources.map(url=>'<li>'+safeLink(url,url)+'</li>').join('')+'</ul><h4>本次未取得</h4><ul>'+pair.removedSources.map(url=>'<li>'+safeLink(url,url)+'</li>').join('')+'</ul></details></div>';
}
document.addEventListener('keydown', event => {
  const dialog=root.querySelector('#reportEvidence'); if(!dialog) return;
  if(event.key==='Escape') { evidenceOpen=false; render(); root.querySelector('[data-action="reportEvidence"]')?.focus({preventScroll:true}); }
  if(event.key==='Tab') {
    const controls=[...dialog.querySelectorAll('button,a[href],summary')].filter(e=>e.getClientRects().length && !e.disabled);
    const first=controls[0], last=controls.at(-1);
    if(event.shiftKey && (document.activeElement===first || document.activeElement===dialog)) { event.preventDefault(); last?.focus(); }
    else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
  }
});
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

root.addEventListener('input',event=>{
  if(sourceEditor&&event.target.closest('#sourceEditForm')&&event.target.name==='notes')sourceEditor.notes=event.target.value;
});
root.addEventListener('change', async event => {
  if(event.target.id==='questionTopicFilter'){questionTopicFilter=event.target.value;render();return;}
  if(sourceEditor&&event.target.closest('#sourceEditForm')){
    if(event.target.name==='category')sourceEditor.category=event.target.value;
    if(event.target.name==='favorite')sourceEditor.favorite=event.target.checked;
  }
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
      const nextTopics=(await request('/api/brands/'+selected+'/topics')).topics;
      state.brandId = selected;
      creatingBrand = false;
      state.questions = response.questions;
      topics=nextTopics;topicBrandId=selected;topicEditId=null;questionTopicFilter='';
      state.generated = [];
      render();
    } catch (error) { event.target.value = previous; notice(error.message, true); }
    finally { setBusy(false); }
  }
});
root.addEventListener('pointerdown',event=>{
  if(event.target.closest('[data-action="answerReviewExcerpt"]')){
    const selection=window.getSelection();answerReviewSelection=selection?.rangeCount&&!selection.isCollapsed?selection.getRangeAt(0).cloneRange():null;
  }
});
root.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (busy) return;
  const action = button.dataset.action;
  setBusy(true);
  try {
    if(action==='answerSearchPage'||action==='answerSearchReset'){
      const next=action==='answerSearchReset'?emptyAnswerSearchFilters():{...answerSearchFilters,page:Number(button.dataset.id)};
      const data=(await request('/api/answer-search?'+new URLSearchParams({brandId:state.brandId,...next}))).search;
      answerSearchFilters=next;answerSearchData=data;answerSearchProof=null;if(action==='answerSearchReset'){answerSearchDraft=null;answerSearchDraftMeta=null;answerSearchFilterOpen=false;}render();
    }
    else if(action==='answerSearchProof'){
      const evidence=(await request('/api/answer-search/evidence?'+new URLSearchParams({brandId:state.brandId,...answerSearchFilters,resultId:button.dataset.id}))).evidence;
      answerSearchProof=evidence;render();root.querySelector('#answerSearchProof')?.scrollIntoView({block:'start'});
    }
    else if(action==='answerSearchCloseProof'){answerSearchProof=null;render();}
    else if(action==='answerSearchRun'){
      const previous={tab:state.tab,runId:state.runId,detail:state.detail,report:state.report};state.tab='results';state.runId=Number(button.dataset.run);
      try{await refresh();}catch(error){Object.assign(state,previous);throw error;}
      const result=root.querySelector('details[data-result-id="'+Number(button.dataset.id)+'"]');if(result){result.open=true;result.scrollIntoView({block:'start'});}
    }
    else if(action==='changeReset'){
      const next=emptyChangeFilters(),feed=(await request('/api/change-feed?'+new URLSearchParams({brandId:state.brandId,...next}))).feed;changeFilters=next;changeFeed=feed;render();
    }
    else if(action==='changePage'){
      const next={...changeFilters,page:Number(button.dataset.id)},feed=(await request('/api/change-feed?'+new URLSearchParams({brandId:state.brandId,...next}))).feed;changeFilters=next;changeFeed=feed;render();
    }
    else if(action==='changeTrack'){
      const event=(changeFeed.items||changeFeed.events).find(e=>e.key===button.dataset.id);let saved;
      try{saved=await put('/api/change-feed/tracking',{brandId:state.brandId,key:event.key,status:button.dataset.status,expectedUpdatedAt:event.tracking.updatedAt});}catch(error){throw error;}
      event.tracking=saved.tracking;
      try{await loadChanges();render();notice('跟进状态已保存；原回答与报告统计不变。');}catch(error){changeFeed=null;render();notice('跟进已保存，但页面刷新失败，请稍后刷新：'+error.message,true);}
    }
    else if(action==='answerReviewEdit'){
      if(answerReviewEditor&&!confirm('重新打开复核会替换当前未保存草稿，是否继续？'))return;
      const data=await request('/api/results/'+button.dataset.id+'/review');if(!data.review.reviewable)throw new Error('该回答当前不可复核');
      answerReviewEditor={resultId:data.resultId,runId:data.runId,answer:data.answer,status:data.review.stale?'pending':data.review.status,notes:data.review.notes,excerpt:data.review.stale?null:data.review.excerpt,expectedRevision:data.review.revision,expectedUpdatedAt:data.review.updatedAt,stale:data.review.stale};render();root.querySelector('#answerReviewForm')?.scrollIntoView({block:'start'});
    }
    else if(action==='answerReviewCancel'){answerReviewEditor=null;render();}
    else if(action==='answerReviewClearExcerpt'){answerReviewEditor.excerpt=null;render();}
    else if(action==='answerReviewExcerpt'){
      const original=root.querySelector('#answerReviewOriginal'),selection=window.getSelection(),range=answerReviewSelection||(selection?.rangeCount&&!selection.isCollapsed?selection.getRangeAt(0).cloneRange():null);answerReviewSelection=null;if(!range||range.collapsed)throw new Error('请先在复核原文中选中片段');
      if(!original.contains(range.startContainer)||!original.contains(range.endContainer))throw new Error('只能引用当前复核原文中的片段');
      const prefix=document.createRange();prefix.selectNodeContents(original);prefix.setEnd(range.startContainer,range.startOffset);const start=prefix.toString().length,text=range.toString();if(text.length>4000)throw new Error('引用片段最多4000字，请缩小范围');
      if(answerReviewEditor.answer.slice(start,start+text.length)!==text)throw new Error('片段未与原文对应，请重新选择');answerReviewEditor.excerpt={start,end:start+text.length,text};render();
    }
    else if(action==='institutionDetail'||action==='institutionDetailPage'){
      const key=action==='institutionDetail'?button.dataset.id:institutionDetailData.key;
      const pages=action==='institutionDetail'?{questionPage:1,sourcePage:1}:{questionPage:institutionDetailData.questions.page,sourcePage:institutionDetailData.sources.page,[button.dataset.section]:Number(button.dataset.id)};
      const data=(await request('/api/institutions/detail?'+new URLSearchParams({brandId:state.brandId,...institutionFilters,key,...pages}))).detail;
      institutionDetailData=data;institutionProof=null;render();root.querySelector('#institutionDetail')?.scrollIntoView({block:'start'});
    }
    else if(action==='institutionCloseDetail'){institutionDetailData=null;institutionProof=null;render();}
    else if(action==='institutionEdit'){institutionEditor={...institutionData.reviews.find(r=>r.key===button.dataset.id)};render();root.querySelector('#institutionReviewForm')?.scrollIntoView({block:'start'});}
    else if(action==='institutionManual'){institutionEditor={name:'',category:'pending',mergeInto:'',notes:'',updatedAt:null};render();root.querySelector('#institutionReviewForm')?.scrollIntoView({block:'start'});}
    else if(action==='institutionCancel'){institutionEditor=null;render();}
    else if(action==='institutionCloseProof'){institutionProof=null;render();}
    else if(action==='institutionPage'){const next={...institutionFilters,page:Number(button.dataset.id)};const data=(await request('/api/institutions?'+new URLSearchParams({brandId:state.brandId,...next}))).report;institutionFilters=next;institutionData=data;institutionProof=null;render();}
    else if(action==='institutionEvidence'||action==='institutionEvidencePage'){const key=action==='institutionEvidence'?button.dataset.id:institutionProof.key,mode=action==='institutionEvidence'?button.dataset.mode:institutionProof.mode,page=action==='institutionEvidence'?1:Number(button.dataset.id),extra=action==='institutionEvidence'?JSON.parse(button.dataset.context||'{}'):institutionProof.extra||{};institutionProof={...(await request('/api/institutions/evidence?'+new URLSearchParams({brandId:state.brandId,...institutionFilters,...extra,key,mode,evidencePage:page}))),key,mode,extra};render();root.querySelector('#institutionProof')?.scrollIntoView({block:'start'});}
    else if(action==='editTopic'){topicEditId=Number(button.dataset.id);render();}
    else if(action==='cancelTopicEdit'){topicEditId=null;render();}
    else if(action==='deleteTopic'){const t=topics.find(t=>t.id===Number(button.dataset.id));if(confirm('删除专题 '+t.name+'？只取消分组，问题和历史回答不会删除。')){await request('/api/topics/'+t.id,{method:'DELETE'});topicEditId=null;await refresh();}}
    else if(action==='applyTaskTopics'){const form=button.closest('form'),list=form.id==='editTaskForm'?editingTaskTopics:topics;const selected=[...form.querySelectorAll('[name=topic]:checked')].map(e=>Number(e.value));const ids=new Set(list.filter(t=>selected.includes(t.id)).flatMap(t=>t.questionIds));for(const field of form.querySelectorAll('[name=question]'))field.checked=ids.has(Number(field.value));notice('已载入去重后的 '+ids.size+' 个问题，可继续调整后保存。');}
    else if(action==='syncTaskTopics'){const task=state.tasks.find(t=>t.id===Number(button.dataset.id));const current=(await request('/api/brands/'+task.brand_id+'/topics')).topics;const ids=JSON.parse(task.topic_ids_json||'[]');const latest=[...new Set(current.filter(t=>ids.includes(t.id)).flatMap(t=>t.questionIds))];if(confirm('任务当前 '+JSON.parse(task.question_ids_json).length+' 个问题，将替换为专题最新的 '+latest.length+' 个问题。历史不变，是否更新？')){await post('/api/tasks/'+task.id+'/sync-topics',{expectedTask:{questionIds:JSON.parse(task.question_ids_json),topicIds:ids},expectedTopics:ids.map(id=>{const t=current.find(t=>t.id===id);return t?{id:t.id,name:t.name,questionIds:t.questionIds}:null;})});await refresh();notice('任务已更新，历史问题清单保持不变。');}}
    else if (action === 'tab') { const previousTab=state.tab;state.tab = button.dataset.id;try {if (state.tab === 'analytics') await loadAnalytics(); if(state.tab==='sources')await loadSources();if(state.tab==='institutions')await loadInstitutions();if(state.tab==='changes')await loadChanges();if(state.tab==='search')await loadAnswerSearch();}catch(error){state.tab=previousTab;throw error;}message = '';render(); }
    else if(action==='sourceHost'||action==='sourcePage'){const next={...sourceFilters,...(action==='sourceHost'?{host:button.dataset.id,page:1}:{page:Number(button.dataset.id)})};await applySourceNavigation(next);render();}
    else if(action==='sourceDomainPage'){sourceDomainPage=Number(button.dataset.id);render();}
    else if(action==='sourceEdit'){sourceEditor={...library.items.find(a=>a.url===button.dataset.id)};render();root.querySelector('.source-editor')?.scrollIntoView({block:'start'});}
    else if(action==='sourceCancel'){sourceEditor=null;render();}
    else if(action==='sourceEvidence'||action==='sourceEvidencePage'){await loadSourceEvidence(action==='sourceEvidence'?button.dataset.id:sourceEvidence.asset.url,action==='sourceEvidence'?1:Number(button.dataset.id));render();root.querySelector('#sourceEvidence')?.scrollIntoView({block:'start'});}
    else if(action==='sourceCloseEvidence'){sourceEvidence=null;render();}
    else if(action==='sourceReset'){await applySourceNavigation(emptySourceFilters());sourceDomainPage=1;render();}
    else if (action === 'reportEvidence') { reportEvidence = button.dataset.id; evidenceOpen=true; render(); root.querySelector('#reportEvidence')?.focus(); }
    else if (action === 'closeEvidence') { evidenceOpen=false; render(); root.querySelector('[data-action="reportEvidence"]')?.focus({preventScroll:true}); }
    else if (action === 'resultsPage') { resultsPage = Number(button.dataset.page); render(); }
    else if (action === 'logout') { await post('/api/logout', {}); location.reload(); }
    else if (action === 'newBrand') { creatingBrand = true; render(); }
    else if (action === 'generate') {
      state.generated = (await request('/api/brands/' + selectedBrandId() + '/questions/generate')).questions;
      render();
      notice('已生成 ' + state.generated.length + ' 个候选问题。请审核并编辑后保存。');
    }
    else if (action === 'loginAccount') { const opened = await post('/api/platform-accounts/' + button.dataset.id + '/login', {}); notice(opened.message, opened.navigationWarning); }
    else if (action === 'checkAccount') {
      button.textContent = '正在检查…';
      notice('正在等待账号信息和输入框加载稳定，不会发送问题。慢网络下最多约80秒，请稍候。');
      try {
        const response = await post('/api/platform-accounts/' + button.dataset.id + '/check-login', {});
        await refresh();
        notice(response.check.reason, response.check.status !== 'valid');
      } finally { if (button.isConnected) button.textContent = '检查登录状态'; }
    }
    else if (action === 'editAccount') { editingAccountId = Number(button.dataset.id); render(); root.querySelector('#editAccountPanel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if (action === 'cancelEditAccount') { editingAccountId = null; message = ''; messageError = false; render(); }
    else if (action === 'editTask') {
      const task = state.tasks.find(item => item.id === Number(button.dataset.id));
      editingTaskQuestions = (await request('/api/brands/' + task.brand_id + '/questions')).questions;
      editingTaskTopics=(await request('/api/brands/'+task.brand_id+'/topics')).topics;
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
    else if (action === 'retryFailed') { const data = await post('/api/runs/' + button.dataset.id + '/retry-failed', {}); state.tab = 'results'; state.runId = data.run.id; await refresh(); notice('正在为失败项新建对话重新提问；旧记录保留，已成功项不动。采集浏览器可最小化，请不要关闭。'); }
    else if (action === 'toggleTask') { await post('/api/tasks/' + button.dataset.id + '/toggle', {}); await refresh(); notice('定时设置已更新。'); }
    else if (action === 'viewRun') { state.tab = 'results'; state.runId = Number(button.dataset.id); await refresh(); }
    else if (action === 'refresh') await refresh();
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
});
root.addEventListener('input',event=>{if(answerReviewEditor&&event.target.closest('#answerReviewForm')&&['notes','status'].includes(event.target.name))answerReviewEditor[event.target.name]=event.target.value;if(institutionEditor&&event.target.closest('#institutionReviewForm'))institutionEditor[event.target.name]=event.target.value;});
root.addEventListener('input',event=>{if(event.target.closest('#answerSearchForm'))captureAnswerSearchDraft();});
root.addEventListener('toggle',event=>{if(event.target.id==='answerSearchAdvanced'&&event.target.isConnected&&state.tab==='search')answerSearchFilterOpen=event.target.open;},true);
root.addEventListener('change',async event=>{
  if(!event.target.closest('#answerSearchForm')||busy)return;
  const previousBrand=answerSearchDraftMeta?.brandId||state.brandId;captureAnswerSearchDraft();
  if(event.target.name!=='brandId'||Number(event.target.value)===previousBrand)return;
  const brandId=Number(event.target.value),draft={...answerSearchDraft};setBusy(true);
  try{
    const [questions,groups]=await Promise.all([request('/api/brands/'+brandId+'/questions'),request('/api/brands/'+brandId+'/topics')]);
    answerSearchDraft={...draft,taskId:'',questionId:'',topicId:''};answerSearchDraftMeta={brandId,questions:questions.questions,topics:groups.topics};render();
  }catch(error){answerSearchDraft={...draft,brandId:String(previousBrand)};event.target.value=String(previousBrand);notice('品牌筛选加载失败：'+error.message,true);}
  finally{setBusy(false);}
});
root.addEventListener('change',event=>{if(answerReviewEditor&&event.target.closest('#answerReviewForm')&&['notes','status'].includes(event.target.name))answerReviewEditor[event.target.name]=event.target.value;if(institutionEditor&&event.target.closest('#institutionReviewForm'))institutionEditor[event.target.name]=event.target.value;});
root.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const input = new FormData(form);
  const data = Object.fromEntries(input);
  setBusy(true);
  try {
    if(form.id==='answerSearchForm'){
      const brandId=Number(data.brandId),same=brandId===state.brandId||answerSearchDraftMeta?.brandId===brandId,next={q:data.q.trim(),scope:data.scope,taskId:same?data.taskId:'',platform:data.platform,accountId:data.accountId,questionId:same?data.questionId:'',topicId:same?data.topicId:'',from:data.from,to:data.to,page:1};
      const result=(await request('/api/answer-search?'+new URLSearchParams({brandId,...next}))).search;
      const qs=(await request('/api/brands/'+brandId+'/questions')).questions,ts=(await request('/api/brands/'+brandId+'/topics')).topics;
      state.brandId=brandId;state.questions=qs;topics=ts;topicBrandId=brandId;topicEditId=null;questionTopicFilter='';answerSearchBrand=brandId;answerSearchFilters=next;answerSearchData=result;answerSearchProof=null;answerSearchDraft=null;answerSearchDraftMeta=null;render();return;
    }
    if(form.id==='answerReviewForm'){
      const draft=answerReviewEditor,saved=await put('/api/results/'+draft.resultId+'/review',{status:data.status,notes:data.notes,excerpt:draft.excerpt,expectedRevision:draft.expectedRevision,expectedUpdatedAt:draft.expectedUpdatedAt});
      answerReviewEditor=null;const cached=state.detail?.results.find(r=>r.id===draft.resultId);if(cached)cached.review=saved.review;
      try{await refresh();}catch(error){if(state.detail)state.detail.manualReviewSummary=null;render();notice('复核已保存，但页面刷新失败，请稍后刷新：'+error.message,true);return;}
      const row=root.querySelector('details[data-result-id="'+draft.resultId+'"]');if(row)row.open=true;notice('人工复核已保存，提及统计保持原口径。');return;
    }
    if(form.id==='institutionFilterForm'){
      const nextBrandId=Number(data.brandId),same=state.brandId===nextBrandId,next={taskId:same?data.taskId:'',platform:data.platform,accountId:data.accountId,topicId:same?data.topicId:'',from:data.from,to:data.to,q:data.q,category:data.category,page:1};
      const report=(await request('/api/institutions?'+new URLSearchParams({brandId:nextBrandId,...next}))).report;
      const qs=(await request('/api/brands/'+nextBrandId+'/questions')).questions,ts=(await request('/api/brands/'+nextBrandId+'/topics')).topics;
      state.brandId=nextBrandId;state.questions=qs;topics=ts;topicBrandId=nextBrandId;topicEditId=null;questionTopicFilter='';institutionScope=nextBrandId;institutionFilters=next;institutionData=report;institutionEditor=null;institutionProof=null;institutionScopeWarning='';institutionDetailData=null;render();return;
    }
    if(form.id==='changeFilterForm'){
      const brandId=Number(data.brandId),same=brandId===state.brandId,next={taskId:same?data.taskId:'',platform:data.platform,accountId:data.accountId,topicId:same?data.topicId:'',from:data.from,to:data.to,type:data.type,status:data.status,comparison:data.comparison||'all',page:1};
      const feed=(await request('/api/change-feed?'+new URLSearchParams({brandId,...next}))).feed,nextTopics=(await request('/api/brands/'+brandId+'/topics')).topics;
      state.brandId=brandId;changeBrandId=brandId;changeFilters=next;changeFeed=feed;topics=nextTopics;topicBrandId=brandId;render();return;
    }
    if(form.id==='institutionReviewForm'){
      const record=institutionData.reviews.find(r=>r.key===institutionNameKey(data.name));
      await put('/api/institutions/review',{brandId:state.brandId,name:data.name,category:data.category,mergeInto:data.mergeInto,notes:data.notes,expectedUpdatedAt:record?.updatedAt||null});await loadInstitutions();render();notice('机构核对已保存；原回答未修改。');return;
    }
    if(form.id==='topicForm'){if(topicEditId)await put('/api/topics/'+topicEditId,{name:data.name});else await post('/api/brands/'+state.brandId+'/topics',{name:data.name});topicEditId=null;await refresh();notice('专题已保存。');return;}
    if(form.id==='topicMembershipForm'){await post('/api/topics/'+data.topicId+'/questions',{operation:data.operation,questionIds:input.getAll('question').map(Number)});await refresh();notice('专题问题已更新，已有任务清单不变。');return;}
    if(form.id==='sourceFilterForm'){
      const nextBrandId=Number(data.brandId),same=state.brandId===nextBrandId;
      const nextFilters={q:data.q,platform:data.platform,taskId:same?data.taskId:'',questionId:same?data.questionId:'',topicId:same?data.topicId:'',kind:data.kind,category:data.category,favorite:data.favorite,from:data.from,to:data.to,host:'',page:1};
      const nextLibrary=(await request('/api/source-library?'+new URLSearchParams({brandId:nextBrandId,...nextFilters}))).library;
      const nextQuestions=(await request('/api/brands/'+nextBrandId+'/questions')).questions;
      const nextTopics=(await request('/api/brands/'+nextBrandId+'/topics')).topics;
      state.brandId=nextBrandId;sourceBrandId=nextBrandId;sourceFilters=nextFilters;library=nextLibrary;state.questions=nextQuestions;topics=nextTopics;topicBrandId=nextBrandId;topicEditId=null;questionTopicFilter='';
      sourceDomainPage=1;sourceEditor=null;sourceEvidence=null;render();return;
    }
    if(form.id==='sourceEditForm'){await put('/api/source-library/annotation',{brandId:state.brandId,url:sourceEditor.url,category:data.category,favorite:input.has('favorite'),notes:data.notes});sourceEditor=null;sourceEvidence=null;await loadSources();render();notice('来源分类、收藏和备注已保存。');return;}
    if (form.id === 'reportFilterForm') {
      const nextBrandId=Number(data.brandId),sameBrand=state.brandId===nextBrandId, sameTask=reportFilters.taskId===data.taskId;
      const nextFilters={taskId:sameBrand?data.taskId:'',cohort:sameBrand&&sameTask?data.cohort:'',topicId:sameBrand?data.topicId:'',platform:data.platform,accountId:data.accountId,kind:data.kind,from:data.from,to:data.to};
      const nextReport=(await request('/api/analytics?'+new URLSearchParams({brandId:nextBrandId,...nextFilters}))).report;
      const nextQuestions=(await request('/api/brands/'+nextBrandId+'/questions')).questions;
      const nextTopics=(await request('/api/brands/'+nextBrandId+'/topics')).topics;
      state.brandId=nextBrandId;reportBrandId=nextBrandId;reportFilters=nextFilters;analytics=nextReport;state.questions=nextQuestions;topics=nextTopics;topicBrandId=nextBrandId;topicEditId=null;questionTopicFilter='';
      reportEvidence = 'eligible'; evidenceOpen=false;render();return;
    }
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
        questionIds: input.getAll('question').map(Number),topicIds:input.getAll('topic').map(Number),
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
        questionIds: input.getAll('question').map(Number),topicIds:input.getAll('topic').map(Number),
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


setInterval(() => {
  if (!busy && !(answerReviewEditor && state.runId===answerReviewEditor.runId) && state.user && state.tab === 'results' && state.runs.some(r => r.status === 'running')) {
    setBusy(true);
    const openQuestions = [...root.querySelectorAll('details')].map(element => element.open);
    refresh().then(() => {
      root.querySelectorAll('details').forEach((element, index) => { element.open = !!openQuestions[index]; });
    }).catch(error => notice(error.message, true)).finally(() => setBusy(false));
  }
}, 5000);

const institutionCategories={pending:'待确认',peer:'关注对标',ignore:'不关注',wrong:'识别错误'};
let institutionData=null,institutionScope=null,institutionEditor=null,institutionProof=null,institutionScopeWarning='',institutionDetailData=null;
let institutionFilters={taskId:'',platform:'',accountId:'',topicId:'',from:'',to:'',q:'',category:'',page:1};
const institutionNameKey=name=>String(name).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
async function loadInstitutions(){
  const same=institutionScope===state.brandId,next=same?{...institutionFilters}:{taskId:'',platform:'',accountId:'',topicId:'',from:'',to:'',q:'',category:'',page:1};
  const nextTopics=state.brandId?(await request('/api/brands/'+state.brandId+'/topics')).topics:[];
  let warning='';if(next.topicId&&!nextTopics.some(t=>String(t.id)===String(next.topicId))){next.topicId='';next.page=1;warning='此前筛选的专题已删除，已恢复全部专题，请重新筛选。';}
  const data=state.brandId?(await request('/api/institutions?'+new URLSearchParams({brandId:state.brandId,...next}))).report:null;
  if(topicBrandId!==state.brandId||topicEditId&&!nextTopics.some(t=>t.id===topicEditId))topicEditId=null;
  if(topicBrandId!==state.brandId||questionTopicFilter&&!nextTopics.some(t=>String(t.id)===String(questionTopicFilter)))questionTopicFilter='';
  institutionFilters=next;institutionScope=state.brandId;institutionData=data;topics=nextTopics;topicBrandId=state.brandId;institutionEditor=null;institutionProof=null;institutionDetailData=null;institutionScopeWarning=warning;
}
function institutionsView(){
 const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
 const filter='<form id="institutionFilterForm" class="card report-filters"><label>品牌<select name="brandId">'+state.brands.map(b=>option(b.id,b.name,state.brandId)).join('')+'</select></label><label>任务<select name="taskId">'+option('','全部任务',institutionFilters.taskId)+state.tasks.filter(t=>t.brand_id===state.brandId).map(t=>option(t.id,t.name,institutionFilters.taskId)).join('')+'</select></label><label>平台<select name="platform">'+option('','全部平台',institutionFilters.platform)+state.platforms.map(p=>option(p.id,p.label,institutionFilters.platform)).join('')+'</select></label><label>账号<select name="accountId">'+option('','全部账号',institutionFilters.accountId)+state.accounts.map(a=>option(a.id,a.label,institutionFilters.accountId)).join('')+'</select></label><label>专题（当前成员）<select name="topicId">'+topicOptions(institutionFilters.topicId)+'</select></label><label>开始日期<input type="date" name="from" value="'+esc(institutionFilters.from)+'"></label><label>结束日期<input type="date" name="to" value="'+esc(institutionFilters.to)+'"></label><label>查找名称<input name="q" value="'+esc(institutionFilters.q)+'"></label><label>候选分类<select name="category">'+option('','全部（不含识别错误）',institutionFilters.category)+Object.entries(institutionCategories).map(([v,l])=>option(v,l,institutionFilters.category)).join('')+'</select></label><button>应用筛选</button></form>';
 const heading='<h1>回答中的机构</h1><p class="lead">从已保存的回答发现其他机构，再确认是否关注。提及不等于推荐，出现顺序不代表排名。</p>';
 if(!institutionData)return heading+filter+'<div class="card">请先添加品牌并完成监测。</div>';
 const d=institutionData,summary=d.summary,proofButton=(g,mode,label)=>'<button type="button" class="ghost" data-action="institutionEvidence" data-id="'+esc(g.key)+'" data-mode="'+mode+'">'+label+'</button>';
 const peers=d.comparisons.slice(0,8);
 const comparison='<div class="card"><h2>同一批有效回答中的对照</h2><p class="muted">按当前品牌资料及人工确认名单回看历史。比较分母为不点名我方或任何已确认对标名称的推荐类有效回答；失败、空正文、归属重复不纳入。名称或名单调整后历史视图会重算，不改原回答。</p><p>当前有效回答 '+summary.successful+' 条 · 公共比较样本 '+summary.eligible+' 条 · 点名或其他类型 '+summary.namedOrOther+' 条</p><p class="muted">名称搜索和候选分类只筛选下方名单，不改变比较分母。频繁采样账号会影响累计比例，样本不是独立用户。</p><div class="table-scroll"><table><thead><tr><th>对象</th><th>正文出现 / 公共样本</th><th>双方出现</th><th>对方出现而我方未出现</th><th>仅我方出现 / 双方未匹配</th></tr></thead><tbody><tr><td>我方 · '+esc(state.brands.find(b=>b.id===state.brandId)?.name)+'</td><td>'+summary.ownMentions+'/'+summary.eligible+' · '+pct(summary.ownRate)+'</td><td colspan="3">名称依据当前品牌名称及别名</td></tr>'+d.comparisons.map(g=>'<tr><td><button class="ghost" data-action="institutionDetail" data-id="'+esc(g.key)+'">'+esc(g.name)+' · 详情</button></td><td>'+proofButton(g,'eligible',g.eligibleMentions+'/'+summary.eligible)+' · '+pct(g.rate)+'</td><td>'+g.both+'</td><td>'+proofButton(g,'withoutOwn',g.withoutOwn+' · 查看回答')+'</td><td>'+g.ownOnly+' / '+g.neither+'</td></tr>').join('')+'</tbody></table></div>'+(!d.comparisons.length?'<p>还没有确认的对标对象。请先核对下方候选名称。</p>':'')+'</div>';
 const questions='<div class="card"><h2>问题对照</h2><p class="muted">各行按该问题的公共样本数计数；只显示前 30 个问题、前 8 家对标对象，完整机构计数见上表。零次只表示未匹配这些已确认名称。</p><div class="table-scroll"><table><thead><tr><th>问题</th><th>公共样本 / 我方出现</th>'+peers.map(g=>'<th>'+esc(g.name)+'</th>').join('')+'</tr></thead><tbody>'+d.questions.slice(0,30).map(q=>'<tr><td>'+esc(q.question)+'</td><td>'+q.eligible+' / '+q.own+'</td>'+peers.map(g=>'<td>'+(q.peers[g.key]||0)+'/'+q.eligible+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>';
 const candidates='<div class="card"><div class="row between"><h2>发现与确认 · '+d.total+' 个分组</h2><button type="button" class="secondary" data-action="institutionManual">补充漏识别名称</button></div><p class="muted">自动提取使用中文机构名称结构规则，会有误识别和遗漏。这里只显示候选，不自动认定为竞品；确认前先看原文。标题出现与正文分开计数。合并后采用目标机构的分类，可随时解除。</p><div class="table-scroll"><table><thead><tr><th>名称 / 别名</th><th>状态</th><th>正文回答</th><th>引用标题</th><th>搜索标题</th><th>操作</th></tr></thead><tbody>'+d.groups.map(g=>'<tr><td><button class="ghost" data-action="institutionDetail" data-id="'+esc(g.key)+'">'+esc(g.name)+' · 详情</button><small>'+esc(g.names.join('、'))+'</small><small>正文覆盖 '+g.questions+' 个问题 · '+esc(g.platforms.join(' / '))+' · 最近记录 '+dateText(g.lastSeen)+'</small></td><td>'+institutionCategories[g.category]+'</td><td>'+proofButton(g,'body',g.body+' · 原文')+'</td><td>'+proofButton(g,'citation',g.citationTitles+' · 证据')+'</td><td>'+proofButton(g,'search',g.searchTitles+' · 证据')+'</td><td>'+g.names.map(n=>'<button type="button" class="secondary" data-action="institutionEdit" data-id="'+esc(institutionNameKey(n))+'">核对 '+esc(n)+'</button>').join('')+'</td></tr>').join('')+'</tbody></table></div>'+(!d.groups.length?'<p>当前范围没有候选，可补充回答中实际存在的名称。</p>':'')+'<div class="row"><button data-action="institutionPage" data-id="'+(d.page-1)+'"'+(d.page<=1?' disabled':'')+'>上一页</button><span>第 '+d.page+' / '+d.pageCount+' 页 · 每页20组</span><button data-action="institutionPage" data-id="'+(d.page+1)+'"'+(d.page>=d.pageCount?' disabled':'')+'>下一页</button></div></div>';
 const editor=institutionEditor?'<div class="card"><h2>核对名称与归类</h2><form id="institutionReviewForm"><label>名称<input name="name" maxlength="100" required value="'+esc(institutionEditor.name)+'"></label><p class="muted">补充名称必须在该品牌的有效回答或来源标题中出现。不是新增市场资料。</p><label>分类<select name="category">'+Object.entries(institutionCategories).map(([v,l])=>option(v,l,institutionEditor.category)).join('')+'</select></label><label>合并为目标别名<select name="mergeInto">'+option('','保持独立 / 解除合并',institutionEditor.mergeInto)+d.reviews.filter(r=>r.key!==institutionNameKey(institutionEditor.name)).map(r=>option(r.key,r.name,institutionEditor.mergeInto)).join('')+'</select></label><label>核对备注<textarea name="notes" maxlength="2000">'+esc(institutionEditor.notes)+'</textarea></label><p class="muted">团队共享记录，保存前会检查是否被他人修改。将已合并名称设为独立即可撤销该名称的合并。</p><button>保存核对</button> <button type="button" class="secondary" data-action="institutionCancel">取消</button></form></div>':'';
 const proof=institutionProof?'<div class="card" id="institutionProof"><div class="row between"><h2>名称证据 · '+institutionProof.total+' 条</h2><button data-action="institutionCloseProof">关闭证据</button></div>'+(institutionProof.extra?.sourceUrl?'<p class="muted">来源证据范围：'+(institutionProof.extra.sourceKind==='search'?'搜索结果':'正文引用')+' · '+(institutionProof.extra.sourceRelation==='body'?'正文提及该机构的回答使用此来源':'该来源标题出现机构名称')+'<br>'+esc(institutionProof.extra.sourceUrl)+'</p>':'')+institutionProof.evidence.map(e=>'<article class="question-fact"><strong>'+esc(e.question)+'</strong><small>'+esc(e.platform)+' / '+esc(e.account)+' · 运行 #'+e.runId+' · '+(e.eligible?'公共比较样本':'点名或其他类型，未进入公共分母')+'</small>'+nameEvidenceView({nameEvidence:{body:e.nameEvidence,citations:[],search:[]}},false,'机构')+'<p>'+esc(e.answer).replace(/\n/g,'<br>')+'</p><details><summary>引用标题与搜索标题（分别保存）</summary>'+[['正文引用',e.citations],['搜索结果',e.search]].map(([label,list])=>'<h4>'+label+'</h4><ul>'+list.map(c=>'<li><a href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer">'+esc(c.title||c.url)+'</a></li>').join('')+'</ul>').join('')+'</details><button data-action="viewRun" data-id="'+e.runId+'">查看完整运行</button></article>').join('')+'<p>第 '+institutionProof.page+' / '+institutionProof.pageCount+' 页，每页10条</p><button data-action="institutionEvidencePage" data-id="'+(institutionProof.page-1)+'"'+(institutionProof.page<=1?' disabled':'')+'>上一页证据</button> <button data-action="institutionEvidencePage" data-id="'+(institutionProof.page+1)+'"'+(institutionProof.page>=institutionProof.pageCount?' disabled':'')+'>下一页证据</button></div>':'';
 return heading+(institutionScopeWarning?'<p class="message warning">'+esc(institutionScopeWarning)+'</p>':'')+filter+(institutionDetailData?institutionDetailView():comparison+questions+candidates)+editor+proof;
}


function institutionDetailView(){
 const d=institutionDetailData,b=d.summary;
 const proof=(mode,label,extra={})=>'<button class="ghost" data-action="institutionEvidence" data-id="'+esc(d.key)+'" data-mode="'+mode+'" data-context="'+esc(JSON.stringify(extra))+'">'+esc(label)+'</button>';
 const pager=(section,data)=>'<div class="row"><button data-action="institutionDetailPage" data-section="'+section+'" data-id="'+(data.page-1)+'"'+(data.page<=1?' disabled':'')+'>上一页</button><span>第 '+data.page+' / '+data.pageCount+' 页 · '+data.total+' 条 · 每页20条</span><button data-action="institutionDetailPage" data-section="'+section+'" data-id="'+(data.page+1)+'"'+(data.page>=data.pageCount?' disabled':'')+'>下一页</button></div>';
 const cells=(row,extra)=>'<td>'+row.valid+' / '+proof('body',row.body+' 条正文',extra)+'</td>'+(d.comparable?'<td>'+row.eligible+'</td><td>'+proof('eligible',row.peer+'/'+row.eligible,extra)+' · '+pct(row.eligible?row.peer/row.eligible:null)+'</td><td>'+row.own+'/'+row.eligible+'</td><td>'+row.both+'</td><td>'+proof('withoutOwn',row.withoutOwn+' · 回答',extra)+'</td><td>'+row.ownOnly+' / '+row.neither+'</td>':'');
 const columns='<th>有效回答 / 对方正文出现</th>'+(d.comparable?'<th>公共样本</th><th>对方出现</th><th>我方出现</th><th>双方出现</th><th>对方出现而我方未出现</th><th>仅我方 / 双方未匹配</th>':'');
 const platformLabel=id=>state.platforms.find(p=>p.id===id)?.label||id;
 const table=(title,rows,first,context)=>'<div class="card"><h2>'+title+'</h2><div class="table-scroll"><table><thead><tr><th>'+first+'</th>'+columns+'</tr></thead><tbody>'+rows.map(row=>'<tr><td>'+esc(context(row).label)+'</td>'+cells(row,context(row).extra)+'</tr>').join('')+'</tbody></table></div>'+(!rows.length?'<p>当前范围没有有效回答。</p>':'')+'</div>';
 const header='<div class="card" id="institutionDetail"><div class="row between"><h2>'+esc(d.name)+' · 机构详情</h2><button class="secondary" data-action="institutionCloseDetail">返回机构列表</button></div><p>当前分类：'+institutionCategories[d.category]+' · 名称与别名：'+esc(d.names.join('、'))+'</p><p class="muted">沿用上方任务、平台、账号、专题与日期范围。名称搜索、候选分类不筛选详情。当前名单回看历史会随确认和别名调整重算，正文出现不等于推荐、认可或市场份额。</p><p>有效回答 '+b.valid+' 条 · 对方正文出现 '+proof('body',b.body+' 条')+'</p>'+(d.comparable?'<p>公共样本 '+b.eligible+' 条 · 对方 '+proof('eligible',b.peer+'/'+b.eligible)+'（'+pct(b.eligible?b.peer/b.eligible:null)+'） · 我方 '+b.own+'/'+b.eligible+'</p><p>双方出现 '+b.both+' · '+proof('withoutOwn','对方出现而我方未出现 '+b.withoutOwn)+' · 仅我方 '+b.ownOnly+' · 双方未匹配 '+b.neither+'</p><p class="muted">公共样本仅含不点名我方及任何已确认对标名称的推荐类有效回答。每条回答只计一次。四类计数相加等于公共样本数；多账号和重复采样不是独立用户。</p>':'<p class="muted">当前未列为关注对标，仅展示出现证据，不计算双方比较比例。可返回列表核对分类。</p>')+'</div>';
 const questionTable=table('在哪些问题中出现',d.questions.items,'问题',r=>({label:r.question,extra:{questionId:r.id}}));
 const platformTable=table('平台分布',d.platforms,'平台',r=>({label:platformLabel(r.platform),extra:{detailPlatform:r.platform}}));
 const accountTable='<details class="card"><summary>展开账号分布 · '+d.accounts.length+' 组</summary>'+table('账号分别计数',d.accounts,'平台 / 账号',r=>({label:platformLabel(r.platform)+' / '+r.account+(r.accountId?' (#'+r.accountId+')':'（身份未知，合并计数）'),extra:{detailPlatform:r.platform,detailAccount:r.accountId||'unknown'}}))+'</details>';
 const sourceTable='<div class="card"><h2>相关来源 · '+d.sources.total+' 条</h2><p class="muted">按来源类型和原始URL去重，次数是不同有效回答数。“提到机构的回答使用了此来源”不证明来源属于机构；“标题出现名称”也不证明正文引用支持该机构。只显示已保存的链接，未取得的来源不补造；这里不检查网页是否可访问。</p><div class="table-scroll"><table><thead><tr><th>类型 / 来源</th><th>提到机构的回答使用了此来源</th><th>来源标题出现机构名称</th></tr></thead><tbody>'+d.sources.items.map(row=>'<tr><td>'+ (row.kind==='search'?'搜索结果':'正文引用')+'<br><a href="'+esc(row.url)+'" target="_blank" rel="noopener noreferrer">'+esc(row.titles[0]||row.url)+'</a><small>'+esc(row.url)+'</small>'+ (row.titles.length>1?'<details><summary>已保存的其他标题</summary>'+row.titles.slice(1).map(t=>'<p>'+esc(t)+'</p>').join('')+'</details>':'')+'</td><td>'+proof('body',row.body+' · 回答',{sourceUrl:row.url,sourceKind:row.kind,sourceRelation:'body'})+'</td><td>'+proof(row.kind==='search'?'search':'citation',row.named+' · 证据',{sourceUrl:row.url,sourceKind:row.kind,sourceRelation:'named'})+'</td></tr>').join('')+'</tbody></table></div>'+(!d.sources.total?'<p>没有取得与该机构相关的有效来源，不代表平台没有参考来源。</p>':'')+pager('sourcePage',d.sources)+'</div>';
 return header+questionTable+'<div class="card">'+pager('questionPage',d.questions)+'</div>'+platformTable+accountTable+sourceTable;
}


function answerReviewBadge(review){return review?.updatedAt?'<span class="muted"> · 人工：'+answerReviewLabels[review.effectiveStatus]+(review.stale?'（需更新）':'')+'</span>':'';}
function answerReviewDisplay(review){
 if(!review||!review.reviewable&&!review.updatedAt)return '';
 return '<section class="answer-review"><strong>人工复核：'+answerReviewLabels[review.effectiveStatus]+'</strong>'+(review.stale?'<p class="message warning">原回答或来源已变化，旧复核需要更新。之前标记：'+answerReviewLabels[review.status]+'</p>':'')+(review.updatedAt?'<small>'+esc(review.reviewer||'原成员')+' · '+dateText(review.updatedAt)+'</small>':'')+(review.notes?'<p>'+esc(review.notes).replace(/\n/g,'<br>')+'</p>':'')+(review.excerpt?'<blockquote>'+esc(review.excerpt.text)+'</blockquote>':'')+'</section>';
}
function answerReviewSummaryView(summary,drill=null){
 if(!summary)return '';
 const count=(status,n)=>drill?drill('review|'+status,String(n)):String(n);
 return '<div class="card manual-review-summary"><h2>人工复核 · 团队标记</h2><p class="muted">当前范围有效回答 '+summary.total+' 条，已复核 '+summary.reviewed+' 条。这是团队人工判断，不能作为AI自动事实验证或整体准确率；提及与来源统计仍按采集原文计算。</p><div class="table-scroll"><table><thead><tr>'+Object.values(answerReviewLabels).map(label=>'<th>'+label+'</th>').join('')+'</tr></thead><tbody><tr>'+Object.keys(answerReviewLabels).map(status=>'<td>'+count(status,summary[status])+'</td>').join('')+'</tr></tbody></table></div>'+(summary.stale?'<p>待复核中有 '+count('stale',summary.stale)+' 条原回答或来源已变化。</p>':'')+'</div>';
}
function answerReviewEditorView(runId){
 const d=answerReviewEditor;if(!d||d.runId!==runId)return '';
 const current=state.detail?.results.find(r=>r.id===d.resultId),changed=current?.review?.revision!==d.expectedRevision;
 return '<section class="card answer-review-editor"><h2>复核回答 #'+d.resultId+'</h2><p class="muted">标记针对这条完整回答；引用片段用于说明判断位置。编辑期间页面自动刷新暂停，后台监测继续运行。</p>'+(d.stale||changed?'<p class="message warning">原回答或来源已变化，请核对当前内容；旧结论不会自动沿用。</p>':'')+'<pre id="answerReviewOriginal" class="answer-review-original"></pre><button class="secondary" data-action="answerReviewExcerpt">引用选中的原文</button><form id="answerReviewForm"><label>复核状态<select name="status">'+Object.entries(answerReviewLabels).map(([value,label])=>'<option value="'+value+'"'+(d.status===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label><label>备注<textarea name="notes" maxlength="2000">'+esc(d.notes)+'</textarea></label>'+(d.excerpt?'<div><strong>引用片段</strong><blockquote>'+esc(d.excerpt.text)+'</blockquote><button type="button" class="ghost" data-action="answerReviewClearExcerpt">移除片段</button></div>':'')+'<p class="muted">团队共享复核。保存时会检查回答版本和他人更新；冲突时保留当前草稿。</p><button>保存复核</button> <button type="button" class="secondary" data-action="answerReviewCancel">关闭复核</button></form></section>';
}

function changesView(){
 const platformLabel=id=>state.platforms.find(p=>p.id===id)?.label||id;
 const f=changeFeed,comparisons={all:'全部变化记录',confirmed:'仅条件已确认',observed:'仅条件未完整记录'};
 const option=(v,l,selected)=>'<option value="'+esc(v)+'"'+(String(v)===String(selected)?' selected':'')+'>'+esc(l)+'</option>';
 const select=(name,label,items,blank=true)=>{
   const value=changeFilters[name];if(value&&!items.some(([v])=>String(v)===String(value)))items=[[value,'历史或已移除项 #'+value],...items];
   return '<label>'+label+'<select name="'+name+'">'+(blank?option('','全部',value):'')+items.map(([v,l])=>option(v,l,value)).join('')+'</select></label>';
 };
 const advanced=['taskId','platform','accountId','topicId','type','status','from','to'],active=advanced.filter(k=>changeFilters[k]).length;
 const form='<form id="changeFilterForm" class="card change-filter-simple"><div class="change-filter-primary"><label>品牌<select name="brandId">'+state.brands.map(b=>option(b.id,b.name,state.brandId)).join('')+'</select></label>'+select('comparison','显示记录',Object.entries(comparisons),false)+'<button>应用筛选</button></div><details class="change-advanced"'+(active?' open':'')+'><summary>更多筛选'+(active?' · '+active+' 项已应用':' · 任务、账号、日期')+'</summary><div class="change-filter-grid">'+select('taskId','任务',state.tasks.filter(t=>t.brand_id===state.brandId).map(t=>[t.id,t.name]))+select('platform','平台',state.platforms.map(p=>[p.id,p.label]))+select('accountId','账号',state.accounts.map(a=>[a.id,a.label+' · '+platformLabel(a.platform)]))+select('topicId','专题（当前成员）',topics.map(t=>[t.id,t.name]))+select('type','变化类型',Object.entries(changeTypes))+select('status','跟进状态（仅同条件）',Object.entries(changeStates))+'<label>本次运行开始日期<input type="date" name="from" value="'+esc(changeFilters.from)+'"></label><label>截止日期<input type="date" name="to" value="'+esc(changeFilters.to)+'"></label></div></details></form>';
 const title='<div class="row between"><div><p class="eyebrow">MONITOR CHANGES</p><h1>变化动态</h1></div><div class="row"><button class="secondary" data-action="changeReset">清空筛选</button><button class="secondary" data-action="refresh">刷新动态</button></div></div><p class="lead">先看哪道问题变了，再打开前后回答确认。</p>';
 if(!state.brands.length)return title+'<p>请先添加品牌并完成监测。</p>';if(!f)return title+form+'<p>暂未加载数据，请刷新动态。</p>';
 const links=list=>list.length?'<ul>'+list.map(c=>'<li><a href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer">'+esc(c.title||c.url)+'</a></li>').join('')+'</ul>':'<p class="muted">无已保存链接</p>';
 const side=(label,e)=>'<article class="change-answer"><h3>'+label+' · 运行 #'+e.runId+'</h3><small>'+dateText(e.time)+'</small><p class="answer">'+esc(e.answer).replace(/\r/g,'&#13;').replace(/\n/g,'<br>')+'</p><details><summary>已保存参考来源</summary><h4>正文引用</h4>'+links(e.citations)+'<h4>搜索结果</h4>'+links(e.search)+'</details><button class="secondary" data-action="viewRun" data-id="'+e.runId+'">查看完整运行</button></article>';
 const labels=e=>e.changes.filter(c=>c.type!=='source_changed').map(c=>c.type==='own_gained'?'前次没提到我方，本次提到了':c.type==='own_lost'?'前次提到我方，本次没提到':c.label).concat(e.sources.map(s=>(s.kind==='citation'?'保存的正文引用':'保存的搜索来源')+'：仅本次 '+s.added.length+' 条，仅前次 '+s.beforeOnly.length+' 条'));
 const items=f.items||[],cards=items.map(e=>{
   const confirmed=e.comparison==='confirmed';
   const tracking=confirmed?'<details class="change-follow"><summary>跟进状态 · '+changeStates[e.tracking.status]+'</summary><div class="row">'+Object.entries(changeStates).map(([status,label])=>'<button class="'+(status===e.tracking.status?'':'secondary')+'" data-action="changeTrack" data-id="'+e.key+'" data-status="'+status+'"'+(status===e.tracking.status?' disabled':'')+'>'+label+'</button>').join('')+'</div>'+(e.tracking.updatedAt?'<small>'+esc(e.tracking.reviewer||'原成员')+' · '+dateText(e.tracking.updatedAt)+'</small>':'')+'<p class="muted">我方截至本次连续'+(e.afterOwn?'出现':'未出现')+' '+e.streak.own+' 次有效回答；遇到缺失、失败或条件变化停止计数。</p></details>':'';
   return '<section class="card change-record '+(confirmed?'change-event':'change-observation')+'"><div class="row between"><h2>'+esc(e.question)+'</h2><span class="pill '+(confirmed?'':'change-unconfirmed')+'">'+(confirmed?'条件已确认一致':'条件未完整记录')+'</span></div><p class="muted">'+esc(e.task+' · '+platformLabel(e.platform)+' / '+e.account)+'</p><p class="change-time">'+dateText(e.before.time)+' → '+dateText(e.after.time)+'</p><ul class="change-findings">'+labels(e).map(label=>'<li>'+esc(label)+'</li>').join('')+'</ul>'+(!confirmed?'<small class="muted">可核对原文差异；不能据此判断同条件趋势或优化效果。</small>':'')+'<details class="change-evidence"><summary>查看前后回答</summary><div class="change-pair">'+side('前次',e.before)+side('本次',e.after)+'</div>'+e.sources.map(s=>'<details class="change-source"><summary>'+(s.kind==='citation'?'正文引用':'搜索来源')+'差异</summary><h4>仅本次保存</h4>'+links(s.added)+'<h4>仅前次保存</h4>'+links(s.beforeOnly)+'<p class="muted">'+(s.complete?'两次正文引用数量已核对；差异仅针对保存集合。':'完整性未确认，不能断言平台不再引用。')+'</p></details>').join('')+'</details>'+tracking+'</section>';
 }).join('');
 const overview='<div class="card change-overview"><h2>找到 '+f.itemTotal+' 条变化记录</h2><p>当前结果：'+esc(state.brands.find(b=>b.id===state.brandId)?.name||'历史品牌')+' · '+esc(comparisons[changeFilters.comparison||'all'])+(active?' · '+active+' 项额外筛选':'')+'</p><p class="muted">名称出现不等于推荐；来源变化只针对已保存链接。两类记录分开标注，不合算同条件趋势。</p>'+(changeFilters.status?'<p class="muted">当前按跟进状态筛选，条件未完整记录的对照不会显示。</p>':'')+'</div>';
 const empty=items.length?'':'<div class="card"><h2>当前没有符合筛选的变化</h2><p>'+(f.summary.matched+(f.summary.observationPairs||0)>0?(f.summary.events+(f.summary.observations||0)>0?'已有变化记录，但不符合当前类型、条件或跟进筛选。':'已配对回答中，我方、关注对标名称和保存来源没有出现所列变化；不表示两次全文完全相同。'):'当前范围没有满足配对要求的两次历史回答；不是品牌没有变化。')+'</p><p class="muted">可展开下方比较说明查看原因，或放宽任务、账号和日期筛选。</p></div>';
 const reasons=f.exclusionReasons||[],method='<details class="card change-method"><summary>比较规则与未纳入原因</summary><p>只比较同任务相邻两次已结束运行，同问题、平台和账号的唯一成功非空回答，品牌快照必须一致。失败、缺失和已知条件冲突不能当作品牌消失。未完整读取条件的记录只供原文对照。</p><p>'+f.summary.matched+' 组条件已确认的配对，'+f.summary.unchanged+' 组未出现所列变化；'+(f.summary.observationPairs||0)+' 组条件未确认的配对；'+f.summary.inProgress+' 次未结束运行暂不参与。</p><p>当前关注对标：'+esc(f.peerBasis.join('、')||'暂无')+'。名单同时用于两次原文，修改名单会重算，不沿用变化后的跟进标记。</p>'+(reasons.length?'<ul>'+reasons.map(r=>'<li>'+esc(r.reason)+'：'+r.count+' 组</li>').join('')+'</ul>':'<p>当前范围没有记录到排除项；每个任务仍需至少两次运行才能比较。</p>')+'<p class="muted">日期按本次运行开始日，前一次基线可在日期范围外。不同账号不是同一个人的连续变化；单次变化不证明优化效果。</p></details>';
 return title+form+overview+'<div class="change-timeline-scroll" role="region" aria-label="变化记录列表，可在此区域滚动" tabindex="0">'+cards+empty+'</div><div class="row change-pagination"><button data-action="changePage" data-id="'+(f.page-1)+'"'+(f.page<=1?' disabled':'')+'>上一页</button><span>第 '+f.page+' / '+f.pageCount+' 页 · 每页20条</span><button data-action="changePage" data-id="'+(f.page+1)+'"'+(f.page>=f.pageCount?' disabled':'')+'>下一页</button></div>'+method;
}

function searchMarkedText(text,ranges=[]){
  const escapeSearch=value=>esc(value).replace(/\r/g,'&#13;');
  let html='',cursor=0;for(const r of ranges){if(r.start<cursor||r.end>text.length||r.end<=r.start)continue;html+=escapeSearch(text.slice(cursor,r.start))+'<mark>'+escapeSearch(text.slice(r.start,r.end))+'</mark>';cursor=r.end;}return html+escapeSearch(text.slice(cursor));
}
function answerSearchView(){
  const title='<div class="search-page-heading"><div><p class="eyebrow">ANSWER ARCHIVE</p><h1>历史回答检索</h1><p class="lead">在保存过的回答里，找到你要的名称、词句和来源。</p></div><button class="secondary" data-action="refresh">刷新检索</button></div>';
  if(!state.brands.length)return title+'<div class="card search-empty"><span class="search-empty-symbol">⌕</span><h2>还没有可检索的资料</h2><p>添加品牌并完成监测后，回答会留在这里供你查找。</p></div>';
  const applied=answerSearchFilters,f=answerSearchDraft||{...applied,brandId:state.brandId},draftBrand=Number(f.brandId),meta=answerSearchDraftMeta?.brandId===draftBrand?answerSearchDraftMeta:null;
  const questions=meta?.questions||(draftBrand===state.brandId?state.questions:[]),groups=meta?.topics||(draftBrand===state.brandId?topics:[]);
  const scopes={all:'回答正文及保存来源',body:'仅回答正文',citation:'仅正文引用标题 / 链接',search:'仅搜索结果标题 / 链接'};
  const select=(name,label,items,blank='全部')=>{
    if(f[name]&&!items.some(([v])=>String(v)===String(f[name])))items=[[f[name],'历史或已移除项 #'+f[name]],...items];
    return '<label>'+label+'<select name="'+name+'">'+(blank===null?'':'<option value="">'+blank+'</option>')+items.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(v)===String(f[name])?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label>';
  };
  const advancedKeys=['taskId','accountId','questionId','topicId','from','to'],activeAdvanced=advancedKeys.filter(k=>applied[k]).length;
  const form='<form id="answerSearchForm" class="card search-form"><div class="search-input-row"><label class="search-input-label"><span>搜索名称、词句或网址</span><span class="search-input-box"><span aria-hidden="true">⌕</span><input name="q" maxlength="200" value="'+esc(f.q)+'" placeholder="例如：某个品牌、回答中的一句话、example.org"></span></label><button class="search-submit">搜索</button></div><div class="search-primary-filters">'+select('brandId','品牌',state.brands.map(b=>[b.id,b.name]),null)+select('scope','搜索范围',Object.entries(scopes),null)+select('platform','平台',state.platforms.map(p=>[p.id,p.label]))+'</div><details id="answerSearchAdvanced" class="search-advanced"'+(answerSearchFilterOpen?' open':'')+'><summary>更多筛选'+(activeAdvanced?' <span class="search-filter-count">'+activeAdvanced+' 项已应用</span>':' <small>任务、账号、问题和日期</small>')+'</summary><div class="search-advanced-grid">'+select('taskId','任务',state.tasks.filter(t=>t.brand_id===draftBrand).map(t=>[t.id,t.name]))+select('accountId','账号',state.accounts.map(a=>[a.id,a.label+' · '+a.platform]))+select('questionId','问题',questions.map(q=>[q.id,q.text]))+select('topicId','专题（当前成员）',groups.map(t=>[t.id,t.name]))+'<label>运行开始日期<input type="date" name="from" value="'+esc(f.from)+'"></label><label>截止日期<input type="date" name="to" value="'+esc(f.to)+'"></label></div></details><div class="search-form-footer"><span>按字面匹配 · 英文不区分大小写</span><button type="button" class="ghost" data-action="answerSearchReset">清空筛选</button></div></form>';
  const s=answerSearchData;
  if(s?.unavailable)return title+form+'<div class="card search-empty"><h2>当前检索范围需要重新选择</h2><p class="message warning">'+esc(s.unavailable)+'</p></div>';
  if(!s?.searched)return title+form+'<div class="card search-empty"><span class="search-empty-symbol">⌕</span><h2>想找什么？</h2><p>输入一个名称、一段文字或一个网址，查看它出现在哪些回答里。</p><div class="search-empty-features"><span>定位命中片段</span><span>查看原文和来源</span><span>按平台和时间筛选</span></div><small>只搜索成功保存的非空回答，不自动展开别名或做语义判断。</small></div>';
  const platformLabel=id=>state.platforms.find(p=>p.id===id)?.label||id;
  const sourceList=items=>items.length?'<ul class="answer-search-sources">'+items.map(c=>'<li><a href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer">'+searchMarkedText(c.title||c.url,c.title?c.titleMatch?.ranges:c.urlMatch?.ranges)+'</a><small>'+searchMarkedText(c.url,c.urlMatch?.ranges)+'</small></li>').join('')+'</ul>':'<p class="muted">没有已保存的可用网页链接</p>';
  const e=answerSearchProof;
  const proof=e?'<aside class="card answer-search-proof" id="answerSearchProof"><div class="search-proof-heading"><div><p class="eyebrow">SAVED EVIDENCE</p><h2>原文与来源 · 回答 #'+e.resultId+'</h2></div><button class="secondary" data-action="answerSearchCloseProof">关闭原文</button></div><h3>'+esc(e.question)+'</h3><p class="muted">'+esc(platformLabel(e.platform)+' / '+e.account)+'<br>'+esc(e.task)+' · '+dateText(e.time)+'</p><p class="answer-search-original">'+searchMarkedText(e.answer,e.bodyRanges)+'</p>'+(e.bodyCount>200?'<p class="muted">正文共 '+e.bodyCount+' 处命中，完整原文只高亮前200处。</p>':'')+'<details open><summary>已保存参考来源</summary><h3>正文引用 · '+e.citations.length+' 条</h3>'+sourceList(e.citations)+'<h3>搜索结果 · '+e.search.length+' 条</h3>'+sourceList(e.search)+'</details><p class="muted">来源仅按保存内容展示，未验证页面可访问性或事实准确性。</p><button class="secondary" data-action="answerSearchRun" data-id="'+e.resultId+'" data-run="'+e.runId+'">查看完整运行</button></aside>':'';
  const items=s.items.map(r=>{
    const snippets=r.bodySnippets.map(v=>'<p class="answer-search-snippet">'+(v.leading?'…':'')+searchMarkedText(v.text,v.ranges)+(v.trailing?'…':'')+'</p>');
    const tags=[r.bodyCount?'<span>正文 '+r.bodyCount+' 处</span>':'',r.citationCount?'<span>引用 '+r.citationCount+' 条</span>':'',r.searchCount?'<span>搜索来源 '+r.searchCount+' 条</span>':''].join('');
    const sources=(r.citationMatches.length||r.searchMatches.length)?'<details class="search-matching-sources"'+(!r.bodyCount?' open':'')+'><summary>命中的来源 · '+(r.citationCount+r.searchCount)+' 条保存条目</summary>'+(r.citationMatches.length?'<h3>正文引用</h3>'+sourceList(r.citationMatches):'')+(r.searchMatches.length?'<h3>搜索结果</h3>'+sourceList(r.searchMatches):'')+((r.citationCount>5||r.searchCount>5)?'<p class="muted">每类预览最多5条，展开原文可查看保存的来源。</p>':'')+'</details>':'';
    return '<article class="card answer-search-item'+(e?.resultId===r.resultId?' is-selected':'')+'" data-result-id="'+r.resultId+'"><div class="search-item-meta"><span class="search-platform">'+esc(platformLabel(r.platform))+'</span><span>'+esc(r.account)+'</span><time>'+dateText(r.time)+'</time></div><h2>'+esc(r.question)+'</h2><p class="search-task-meta">'+esc(r.task)+' · 运行 #'+r.runId+' · 回答 #'+r.resultId+'</p><div class="search-match-tags">'+tags+'</div>'+(snippets[0]||'')+(snippets.length>1?'<details class="search-extra-snippets"><summary>还有 '+(snippets.length-1)+' 段命中预览</summary>'+snippets.slice(1).join('')+'</details>':'')+sources+'<div class="search-item-actions"><button class="secondary" data-action="answerSearchProof" data-id="'+r.resultId+'">展开原文及来源</button><button class="ghost" data-action="answerSearchRun" data-id="'+r.resultId+'" data-run="'+r.runId+'">查看完整运行</button></div></article>';
  }).join('');
  const metrics='<section class="search-overview card"><div class="search-overview-heading"><div><h2>找到 '+s.total+' 条回答记录</h2><p data-search-applied>当前结果搜索：<strong>'+esc(applied.q)+'</strong> · '+esc(state.brands.find(b=>b.id===state.brandId)?.name||'历史品牌')+' · '+esc(scopes[applied.scope])+'</p></div><span class="search-saved-badge">已保存内容</span></div><div class="search-metrics">'+[['全部命中',s.total,'按回答记录计数'],['正文命中',s.bodyAnswers,'名称或文字出现在正文'],['正文引用命中',s.citationAnswers,'标题或网址匹配'],['搜索来源命中',s.searchAnswers,'保存的搜索结果匹配']].map(([label,n,note])=>'<div><span>'+label+'</span><strong>'+n+'</strong><small>'+note+'</small></div>').join('')+'</div><details class="search-method"><summary>计数与检索范围说明</summary><p>后三类命中可重叠，不能相加。记录数不等于独立用户或推荐率。日期按北京时间的运行开始日期筛选；专题按当前成员筛选。只覆盖已保存的成功非空回答及可用HTTP(S)来源，不自动核验来源，不支持正则或语义搜索。</p></details></section>';
  const empty=!s.total?'<div class="card search-empty"><span class="search-empty-symbol">⌕</span><h2>没有找到匹配内容</h2><p>可以缩短搜索词，或放宽你选择的筛选条件。</p><small>没有命中只表示保存内容未匹配，不代表AI没有提及。</small></div>':'';
  const pager='<div class="search-pager"><button class="secondary" data-action="answerSearchPage" data-id="'+(s.page-1)+'"'+(s.page<=1?' disabled':'')+'>上一页回答</button><span>第 <strong>'+s.page+'</strong> / '+s.pageCount+' 页 · 每页20条</span><button class="secondary" data-action="answerSearchPage" data-id="'+(s.page+1)+'"'+(s.page>=s.pageCount?' disabled':'')+'>下一页回答</button></div>';
  return title+form+metrics+'<div class="search-results-layout'+(e?' has-proof':'')+'"><div class="search-results-list"><div class="search-list-scroll" role="region" aria-label="检索回答列表，可在此区域滚动" tabindex="0">'+items+empty+'</div>'+pager+'</div>'+proof+'</div>';
}


bootstrap().catch(error=>notice(error.message,true));
