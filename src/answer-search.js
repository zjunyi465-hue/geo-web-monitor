const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
export const SEARCH_SCOPES = ['all', 'body', 'citation', 'search'];
const timestamp = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const literalPattern = q => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

export function validateSearchFilters(query) {
  const filters = Object.fromEntries(['q','scope','taskId','platform','accountId','questionId','topicId','from','to','page'].map(k => [k, query.get(k) || '']));
  filters.q = filters.q.trim();
  if (filters.q.length > 200) throw new Error('搜索词最多200个字符');
  filters.scope ||= 'all';
  if (!SEARCH_SCOPES.includes(filters.scope)) throw new Error('搜索范围无效');
  for (const key of ['taskId','accountId','questionId','topicId','page']) if (filters[key] && (!/^[1-9]\d*$/.test(filters[key]) || !Number.isSafeInteger(Number(filters[key])))) throw new Error('编号或页码无效');
  for (const key of ['from','to']) if (filters[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(Date.parse(filters[key])) || new Date(filters[key]).toISOString().slice(0,10) !== filters[key])) throw new Error('日期格式无效');
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('开始日期不能晚于结束日期');
  return filters;
}

function positions(text, q, limit = 200) {
  const ranges = []; let count = 0;
  for (const match of text.matchAll(literalPattern(q))) {
    if (ranges.length < limit) ranges.push({ start: match.index, end: match.index + match[0].length });
    count++;
  }
  return { count, ranges };
}
// Offsets always address the unchanged saved text. Do not normalize or rewrite evidence.
function snippets(text, ranges) {
  const windows = [];
  for (const range of ranges) {
    let start = Math.max(0, range.start - 80), end = Math.min(text.length, range.end + 140);
    if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start--;
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
    const last = windows.at(-1);
    if (last && range.end <= last.end) continue;
    if (last && start <= last.end && end - last.start <= 500) { last.end = Math.max(last.end, end); continue; }
    if (windows.length === 3) break;
    windows.push({start,end});
  }
  return windows.map(w => ({text:text.slice(w.start,w.end), start:w.start, leading:w.start>0, trailing:w.end<text.length,
    ranges:ranges.filter(r=>r.start>=w.start&&r.end<=w.end).map(r=>({start:r.start-w.start,end:r.end-w.start}))}));
}

export function savedSearchSources(raw) {
  let items; try { items = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const seen = new Set(), sources = [];
  for (const item of items) {
    if (typeof item?.url !== 'string' || item.url !== item.url.trim() || !/^https?:\/\//i.test(item.url) || /[\u0000-\u001f\u007f]/.test(item.url)) continue;
    try { const u=new URL(item.url); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) continue; } catch { continue; }
    const title = typeof item.title === 'string' ? item.title : '', key=JSON.stringify([item.url,title]);
    if (seen.has(key)) continue; seen.add(key); sources.push({url:item.url,title});
  }
  return sources;
}

export function searchAnswers(records, filters = {}, evidenceId = null) {
  const q=String(filters.q||'').trim(), scope=filters.scope||'all';
  const empty={searched:!!q,total:0,bodyAnswers:0,citationAnswers:0,searchAnswers:0,page:1,pageCount:1,items:[]};
  if (!q) return evidenceId===null ? empty : null;
  if (!SEARCH_SCOPES.includes(scope) || q.length>200) throw new Error('搜索参数无效');
  const matched=[],seen=new Set();
  for (const r of records) {
    if (seen.has(r.id) || r.status!=='succeeded' || typeof r.answer!=='string' || !r.answer.trim()) continue;
    seen.add(r.id);
    if (evidenceId!==null && r.id!==evidenceId) continue;
    if (filters.taskId&&String(r.task_id)!==String(filters.taskId) || filters.platform&&r.platform!==filters.platform || filters.accountId&&String(r.account_id)!==String(filters.accountId) || filters.questionId&&String(r.question_id)!==String(filters.questionId) || Array.isArray(filters.questionIds)&&!filters.questionIds.includes(r.question_id)) continue;
    const time=timestamp(r.run_started_at||r.started_at), day=time===null?null:dateFormat.format(new Date(time));
    if ((filters.from||filters.to)&&day===null || filters.from&&day<filters.from || filters.to&&day>filters.to) continue;
    const body=scope==='all'||scope==='body'?positions(r.answer,q):{count:0,ranges:[]};
    const citations=savedSearchSources(r.citations_json), search=savedSearchSources(r.searched_sites_json);
    const annotate=(s,kind)=>({...s,titleMatch:scope==='all'||scope===kind?positions(s.title,q):{count:0,ranges:[]},urlMatch:scope==='all'||scope===kind?positions(s.url,q):{count:0,ranges:[]}});
    const findSources=(sources,kind)=>sources.map(s=>annotate(s,kind)).filter(s=>s.titleMatch.count||s.urlMatch.count);
    const citationMatches=findSources(citations,'citation'),searchMatches=findSources(search,'search');
    if (!body.count&&!citationMatches.length&&!searchMatches.length) continue;
    const taskSnapshot=(()=>{try{return JSON.parse(r.task_snapshot_json||'null');}catch{return null;}})();
    const item={resultId:r.id,runId:r.run_id,taskId:r.task_id,task:taskSnapshot?.name||r.task_name||'历史任务',questionId:r.question_id,question:r.question,platform:r.platform,accountId:r.account_id||null,account:r.account_label||(r.account_id?'历史账号 #'+r.account_id:'账号标识未保存'),time:time===null?null:new Date(time).toISOString(),
      bodyCount:body.count,bodySnippets:snippets(r.answer,body.ranges),citationCount:citationMatches.length,searchCount:searchMatches.length,citationMatches:citationMatches.slice(0,5),searchMatches:searchMatches.slice(0,5)};
    if (evidenceId!==null) return {...item,answer:r.answer,bodyRanges:body.ranges,citations:citations.map(s=>annotate(s,'citation')),search:search.map(s=>annotate(s,'search'))};
    matched.push(item);
  }
  if (evidenceId!==null) return null;
  matched.sort((a,b)=>(timestamp(b.time)??-Infinity)-(timestamp(a.time)??-Infinity)||b.resultId-a.resultId);
  const pageCount=Math.max(1,Math.ceil(matched.length/20)),page=Math.min(Math.max(1,Number(filters.page)||1),pageCount);
  return {searched:true,total:matched.length,bodyAnswers:matched.filter(r=>r.bodyCount>0).length,citationAnswers:matched.filter(r=>r.citationCount>0).length,searchAnswers:matched.filter(r=>r.searchCount>0).length,page,pageCount,items:matched.slice((page-1)*20,page*20)};
}
