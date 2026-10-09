import { citationHost } from './analysis.js';
import { reportChanges } from './report-changes.js';
import {prepareReportRecord,summarizeRecords,brandWebHost} from './report-policy.js';
import {compareMonitorConditions} from './monitor-conditions.js';
import {reportSampling} from './report-sampling.js';

const rate = (a, b) => b ? a / b : null;
export function buildReport(entries, filters = {}, manifest = []) {
  // Integrity is a property of the stored job, not of the selected view.
  const prepared = entries.map(prepareReportRecord);
  const records = prepared.filter(e => (!filters.taskId || String(e.task_id) === String(filters.taskId)) && (!filters.cohort || e.cohort === filters.cohort) && (!filters.platform || e.platform === filters.platform) &&
    (!filters.accountId || String(e.account_id) === String(filters.accountId)) &&
    (!filters.kind || e.kind === filters.kind) && (!Array.isArray(filters.questionIds)||filters.questionIds.includes(Number(e.question_id))) && (!filters.from || e.day >= filters.from) && (!filters.to || e.day <= filters.to));
  const slotCounts=new Map();
  for(const e of prepared) if(e.account_id) {
    const key=JSON.stringify([e.run_id,e.question_id,e.platform,e.account_id]);
    slotCounts.set(key,(slotCounts.get(key)||0)+1);
  }
  let duplicateRecords=0;
  for(const e of records) if(e.account_id && slotCounts.get(JSON.stringify([e.run_id,e.question_id,e.platform,e.account_id]))>1) {
    duplicateRecords++;
    if(e.status==='succeeded') { e.status='unusable'; e.unusable=true; e.mentioned=false; e.error='同一运行、问题和账号有重复记录，归属不唯一；未纳入有效回答统计。'; }
  }
  const summarize=summarizeRecords;
  const group = key => {
    const groups = new Map();
    for (const e of records) { const k = key(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    return [...groups].map(([key, list]) => ({ key, ...summarize(list), evidenceIds: list.map(e => e.key), first: list[0] }));
  };
  const sources = new Map();
  const pages = new Map();
  for (const e of records.filter(e => e.status === 'succeeded')) {
    const seen = new Set();
    const seenPages = new Set();
    for (const c of e.citations) {
      const host = citationHost(c.url); if (!host) continue;
      // Keep exact URLs: distinct query parameters may identify different source pages.
      if (!pages.has(c.url)) pages.set(c.url, { url:c.url, title:c.title || c.url, host, answers:0, evidenceIds:[] });
      if (!seenPages.has(c.url)) { seenPages.add(c.url); const page=pages.get(c.url); page.answers++; page.evidenceIds.push(e.key); }
      if (!sources.has(host)) sources.set(host, { host, count: 0, answers: 0, ownAnswers: 0, evidenceIds: [], links: [] });
      const s = sources.get(host); s.count++;
      if (!s.links.some(x => x.url === c.url)) s.links.push(c);
      if (!seen.has(host)) {
        seen.add(host); s.answers++; s.evidenceIds.push(e.key);
        const own = brandWebHost(e.brand.website); if (own && (host === own || host.endsWith('.' + own))) s.ownAnswers++;
      }
    }
  }
  const comparisons = [];
  const pairGroups = new Map();
  for (const e of records.filter(e => e.status === 'succeeded' && e.cohort && e.account_id)) {
    const key = JSON.stringify([e.cohort,e.question_id,e.account_id,e.platform]);
    if (!pairGroups.has(key)) pairGroups.set(key,[]);
    pairGroups.get(key).push(e);
  }
  for (const list of pairGroups.values()) {
    list.sort((a,b) => a.run_id-b.run_id);
    if (list.length < 2) continue;
    const before=list.at(-2), after=list.at(-1);
    if (before.question !== after.question || before.kind!==after.kind || before.eligible!==after.eligible || before.run_id===after.run_id) continue;
    const conditionsMatch=compareMonitorConditions(before.monitorConditions,after.monitorConditions);
    if(conditionsMatch==='different'||before.conditionsChanged||after.conditionsChanged) continue;
    const urls = e => new Set(e.citations.map(c => c.url));
    const oldUrls=urls(before), newUrls=urls(after);
    comparisons.push({ key:after.key, beforeId:before.key, afterId:after.key,
      conditionsMatch,
      mentionChange: !after.eligible ? '不属于主动提及样本：查看原文' : before.mentioned === after.mentioned ? '提及状态未变' : after.mentioned ? '本次出现品牌' : '本次未再出现品牌',
      citationIncomplete:before.citationCompleteness!=='complete'||after.citationCompleteness!=='complete',
      addedSources:[...newUrls].filter(url => !oldUrls.has(url)), removedSources:[...oldUrls].filter(url => !newUrls.has(url)) });
  }
  const questions=group(e=>String(e.question_id));
  const matrix=group(e=>e.question_id+':'+e.platform);
  const questionFacts=questions.map(q=>{
    const good=records.filter(e=>String(e.question_id)===q.key&&e.status==='succeeded');
    const named=good.filter(e=>e.mentioned), absent=good.filter(e=>!e.mentioned);
    const knownOwn=good.filter(e=>e.mentioned&&e.ownCitation!==null);
    const urls=new Map();
    for(const e of good) for(const c of new Map(e.citations.filter(c=>citationHost(c.url)).map(c=>[c.url,c])).values()) {
      if(!urls.has(c.url)) urls.set(c.url,{key:JSON.stringify([q.key,c.url]),url:c.url,title:c.title||c.url,mentioned:0,absent:0,evidenceIds:[]});
      const item=urls.get(c.url); item[e.mentioned?'mentioned':'absent']++; item.evidenceIds.push(e.key);
    }
    return {...q, nameMentions:named.length, nameMentionRate:rate(named.length,good.length),
      namedIds:named.map(e=>e.key), absentIds:absent.map(e=>e.key), evidenceIds:good.map(e=>e.key),
      nameLocations:{body:named.length,citationTitles:good.filter(e=>e.nameEvidence.citations.length).length,searchTitles:good.filter(e=>e.nameEvidence.search.length).length,
        titleOnly:good.filter(e=>!e.mentioned&&(e.nameEvidence.citations.length||e.nameEvidence.search.length)).length},
      platforms:matrix.filter(c=>String(c.first.question_id)===q.key),
      citationMissing:good.filter(e=>e.citationGap).length,
      noCitations:good.filter(e=>!e.citations.length).length,
      ownPresentIds:knownOwn.filter(e=>e.ownCitation).map(e=>e.key), ownAbsentIds:knownOwn.filter(e=>!e.ownCitation).map(e=>e.key),
      ownUnknown:good.filter(e=>e.mentioned&&e.ownCitation===null).length,
      sourceSplit:[...urls.values()].sort((a,b)=>(b.mentioned+b.absent)-(a.mentioned+a.absent))};
  });
  const quality=questions.filter(q=>q.failed||q.pending||q.invalid||(q.eligible>0&&q.eligible<3)).map(q=>({...q,
    reasons:[...(q.failed?['采集失败 '+q.failed+' 条']:[]),...(q.pending?['待处理 '+q.pending+' 条']:[]),...(q.invalid?['样本不可用 '+q.invalid+' 条']:[]),...(q.eligible>0&&q.eligible<3?['有效推荐样本不足 3 条']:[])]}));
  const cohorts = new Map();
  for (const e of [...entries,...manifest].filter(e => e.cohort && (!filters.taskId || String(e.task_id)===String(filters.taskId)))) {
    if (!cohorts.has(e.cohort)) cohorts.set(e.cohort, { key:e.cohort, taskId:e.task_id, label:e.task_name, firstDay:e.day, lastDay:e.day });
    const c=cohorts.get(e.cohort); c.firstDay=c.firstDay<e.day?c.firstDay:e.day; c.lastDay=c.lastDay>e.day?c.lastDay:e.day;
  }
  const selectedRuns=manifest.filter(m=>(!filters.taskId||String(m.task_id)===String(filters.taskId))&&(!filters.cohort||m.cohort===filters.cohort)&&(!filters.from||m.day>=filters.from)&&(!filters.to||m.day<=filters.to)&&(!Array.isArray(filters.questionIds)||(m.questionIds||records.filter(e=>e.run_id===m.id).map(e=>e.question_id)).some(id=>filters.questionIds.includes(Number(id)))));
  const unlocated=selectedRuns.reduce((n,m)=>n+Math.max(0,m.total-m.located),0);
  const scoped=Boolean(filters.platform||filters.accountId||filters.kind||Array.isArray(filters.questionIds));
  const summary=summarize(records);
  if(!scoped) { summary.total+=unlocated; summary.pending+=unlocated; summary.captureRate=summary.total?summary.successful/summary.total:null; }
  const mismatchRuns=selectedRuns.filter(m=>m.located>m.total).length;
  if(mismatchRuns) summary.captureRate=null;
  const trend=group(e=>e.day);
  for(const m of selectedRuns) {
    let day=trend.find(d=>d.key===m.day);
    if(!day) {
      day={key:m.day,...summarize([]),evidenceIds:[],unlocatedExpected:0};
      trend.push(day);
    }
    const missing=Math.max(0,m.total-m.located);
    day.unlocatedExpected=(day.unlocatedExpected||0)+missing;
    if(!scoped) {day.total+=missing;day.pending+=missing;}
    if(m.located>m.total) day.expectedMismatch=true;
  }
  for(const day of trend) day.captureRate=day.expectedMismatch?null:rate(day.successful,day.total);
  const audit={policyVersion:'2026-10-06.1',duplicateRecords,unlocatedExpected:unlocated,unlocatedIncluded:!scoped,expectedMismatchRuns:mismatchRuns,
    fallbackBrandRecords:records.filter(e=>e.brandBasis==='current_fallback').length,
    citationUnknown:records.filter(e=>e.status==='succeeded'&&e.citationCompleteness==='unknown').length,
    citationPartial:records.filter(e=>e.status==='succeeded'&&e.citationGap).length,
    invalidAnswers:summary.invalid,discardedCitationLinks:records.reduce((n,e)=>n+e.discardedCitationCount,0)};
  return { ...reportChanges(records,selectedRuns), sampling:reportSampling(records),audit, summary, trend: trend.sort((a,b) => a.key.localeCompare(b.key)),
    accounts: group(e => e.platform + ':' + e.account_id), questions,
    platforms: [...new Set(records.map(e => e.platform))],
    matrix,
    sources: [...sources.values()].sort((a,b) => b.answers - a.answers), records,
    pages:[...pages.values()].sort((a,b) => b.answers-a.answers), comparisons:comparisons.sort((a,b) => Number(b.afterId.split(':')[0])-Number(a.afterId.split(':')[0])), questionFacts, quality, cohorts:[...cohorts.values()],
    runCount: new Set([...records.map(e => e.run_id),...selectedRuns.map(m=>m.id)]).size };
}
