import {compareMonitorConditions} from './monitor-conditions.js';
import {summarizeRecords} from './report-policy.js';

export function buildHistory(key, input, manifest=[]) {
  const list=[...input].sort((a,b)=>a.run_id-b.run_id);
  const points=list.map((e,i)=>{
    const previous=list[i-1];
    const urls=new Set(e.citations.map(c=>c.url));
    let change=null;
    if(previous) {
      let reason=null;
      if(!e.account_id||!previous.account_id) reason='账号标识缺失';
      else if(previous.run_id===e.run_id) reason='同次运行归属不唯一';
      else if(!previous.cohort||!e.cohort) reason='历史条件组未记录';
      else if(previous.cohort!==e.cohort||previous.question!==e.question||previous.kind!==e.kind||previous.eligible!==e.eligible) reason='任务条件或问题口径变化';
      else if(manifest.some(m=>m.cohort===e.cohort&&m.id>previous.run_id&&m.id<e.run_id&&m.total>0)) reason='中间运行缺少该问题账号的记录';
      else if(!['completed','partial','failed'].includes(e.run_status)||!['completed','partial','failed'].includes(previous.run_status)) reason='运行尚未结束';
      else if(previous.status!=='succeeded'||e.status!=='succeeded') reason='相邻记录未全部成功';
      else if(previous.conditionsChanged||e.conditionsChanged||compareMonitorConditions(previous.monitorConditions,e.monitorConditions)==='different') reason='已知页面设置变化';
      const oldUrls=new Set(previous.citations.map(c=>c.url));
      change={key:e.key,beforeId:previous.key,afterId:e.key,beforeRun:previous.run_id,afterRun:e.run_id,evidenceIds:[previous.key,e.key],reason,
        conditionsMatch:compareMonitorConditions(previous.monitorConditions,e.monitorConditions),
        beforeMention:reason?null:previous.mentioned,afterMention:reason?null:e.mentioned,
        keptSources:reason?[]:[...urls].filter(url=>oldUrls.has(url)),
        addedSources:reason?[]:[...urls].filter(url=>!oldUrls.has(url)),
        removedSources:reason?[]:[...oldUrls].filter(url=>!urls.has(url)),
        citationIncomplete:previous.citationCompleteness!=='complete'||e.citationCompleteness!=='complete'};
    }
    return {key:e.key,run:e.run_id,date:e.run_started_at||e.started_at,question:e.question,
      status:e.status,mentioned:e.status==='succeeded'?e.mentioned:null,eligible:e.eligible,
      citationCount:e.status==='succeeded'?urls.size:null,citationCompleteness:e.citationCompleteness,
      conditionChanged:!!previous&&(Boolean(e.cohort&&previous.cohort&&e.cohort!==previous.cohort)||compareMonitorConditions(previous.monitorConditions,e.monitorConditions)==='different')||e.conditionsChanged,
      conditionUnknown:!e.cohort||compareMonitorConditions(e.monitorConditions,e.monitorConditions)==='unknown',change};
  });
  const days=new Map(),sources=new Map();
  for(const e of list) {
    // Keep changed question/task snapshots separate, even on the same day.
    const dayKey=JSON.stringify([key,e.day,e.cohort,e.question,e.kind]);
    if(!days.has(dayKey)) days.set(dayKey,[]);
    days.get(dayKey).push(e);
    if(e.status!=='succeeded') continue;
    for(const c of new Map(e.citations.map(c=>[c.url,c])).values()) {
      if(!sources.has(c.url)) sources.set(c.url,{key:JSON.stringify([key,c.url]),url:c.url,title:c.title||c.url,evidenceIds:[],runs:[]});
      const source=sources.get(c.url);source.evidenceIds.push(e.key);source.runs.push(e.run_id);
    }
  }
  const daily=[...days].map(([key,group])=>({key,day:group[0].day,question:group[0].question,cohortKnown:!!group[0].cohort,
    ...summarizeRecords(group),evidenceIds:group.map(e=>e.key)})).sort((a,b)=>String(a.day).localeCompare(String(b.day)));
  const summary=summarizeRecords(list);
  return {key,question:list.at(-1).question,platform:list.at(-1).platform,
    account:list.at(-1).account_label+(list.at(-1).account_id?'':'（账号标识缺失，单次记录）'),
    summary,daily,sources:[...sources.values()].sort((a,b)=>b.evidenceIds.length-a.evidenceIds.length),
    evidenceIds:list.map(e=>e.key),points};
}
