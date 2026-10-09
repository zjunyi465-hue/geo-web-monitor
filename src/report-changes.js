const rate=(a,b)=>b?a/b:null;
import {compareMonitorConditions} from './monitor-conditions.js';
import {buildHistory} from './report-history.js';
const slot=e=>JSON.stringify([e.question_id,e.account_id,e.platform]);
const terminal=new Set(['completed','partial','failed']);
export function reportChanges(records, manifest = []) {
  const cohorts=new Map(), timelines=new Map();
  const metadata=new Map(manifest.map(m=>[m.id,m]));
  // Include ended runs with no located answers: never silently compare older runs.
  for(const m of manifest) {
    if(!m.cohort || !terminal.has(m.status)) continue;
    if(!cohorts.has(m.cohort)) cohorts.set(m.cohort,new Map());
    cohorts.get(m.cohort).set(m.id,[]);
  }
  for(const e of records) {
    const historyKey=e.account_id?slot(e):JSON.stringify([e.question_id,null,e.platform,e.run_id]);
    if(!timelines.has(historyKey)) timelines.set(historyKey,[]);
    timelines.get(historyKey).push(e);
    if(!e.cohort || !terminal.has(e.run_status)) continue;
    if(!cohorts.has(e.cohort)) cohorts.set(e.cohort,new Map());
    const runs=cohorts.get(e.cohort);
    if(!runs.has(e.run_id)) runs.set(e.run_id,[]);
    runs.get(e.run_id).push(e);
  }
  const runChanges=[];
  for(const [cohort,runs] of cohorts) {
    const ids=[...runs.keys()].sort((a,b)=>a-b);
    if(ids.length<2) continue;
    const before=runs.get(ids.at(-2)), after=runs.get(ids.at(-1));
    const beforeMeta=metadata.get(ids.at(-2)), afterMeta=metadata.get(ids.at(-1));
    const index=list=>{
      const map=new Map();
      for(const e of list) { const k=slot(e); if(!map.has(k)) map.set(k,[]); map.get(k).push(e); }
      return map;
    };
    const old=index(before), current=index(after), pairs=[], excluded=[];
    for(const k of new Set([...old.keys(),...current.keys()])) {
      const a=old.get(k)||[], b=current.get(k)||[], x=a[0], y=b[0];
      let reason=null;
      if(a.length!==1 || b.length!==1) reason=a.length>1||b.length>1?'样本归属不唯一':'一侧缺失';
      else if(!x.account_id || !y.account_id) reason='缺少账号标识';
      else if(x.question!==y.question || x.kind!==y.kind || x.eligible!==y.eligible) reason='问题或统计口径变化';
      else if(x.status!=='succeeded' || y.status!=='succeeded') reason='一侧或双方未成功';
      else if(x.conditionsChanged||y.conditionsChanged||compareMonitorConditions(x.monitorConditions,y.monitorConditions)==='different') reason='页面监测条件不同或采集中变化';
      if(reason) { excluded.push({key:k,question:(y||x).question,platform:(y||x).platform,account:(y||x).account_label,
        reason,beforeStatus:x?.status||'missing',afterStatus:y?.status||'missing',evidenceIds:[...a,...b].map(e=>e.key)}); continue; }
      const state=x.mentioned?(y.mentioned?'kept':'lost'):(y.mentioned?'gained':'absent');
      const oldUrls=new Set(x.citations.map(c=>c.url)), newUrls=new Set(y.citations.map(c=>c.url));
      pairs.push({key:y.key,beforeId:x.key,afterId:y.key,question:y.question,platform:y.platform,account:y.account_label,state,
        eligible:y.eligible,beforeMention:x.mentioned,afterMention:y.mentioned,
        conditionsMatch:compareMonitorConditions(x.monitorConditions,y.monitorConditions),
        ownKnown:x.mentioned&&y.mentioned&&x.ownCitation!==null&&y.ownCitation!==null,
        beforeOwn:x.ownCitation,afterOwn:y.ownCitation,
        added:[...newUrls].filter(url=>!oldUrls.has(url)),removed:[...oldUrls].filter(url=>!newUrls.has(url)),
        citationIncomplete:x.citationCompleteness!=='complete'||y.citationCompleteness!=='complete',evidenceIds:[x.key,y.key]});
    }
    const eligible=pairs.filter(p=>p.eligible), own=pairs.filter(p=>p.ownKnown);
    const beforeMentions=pairs.filter(p=>p.beforeMention).length,afterMentions=pairs.filter(p=>p.afterMention).length;
    const beforeActive=eligible.filter(p=>p.beforeMention).length,afterActive=eligible.filter(p=>p.afterMention).length;
    const beforeOwn=own.filter(p=>p.beforeOwn).length,afterOwn=own.filter(p=>p.afterOwn).length;
    runChanges.push({key:JSON.stringify([cohort,ids.at(-2),ids.at(-1)]),task:afterMeta?.task_name||after[0]?.task_name||before[0]?.task_name||'历史任务',
      beforeRun:ids.at(-2),afterRun:ids.at(-1),beforeDate:beforeMeta?.started_at||before[0]?.run_started_at||before[0]?.started_at,
      afterDate:afterMeta?.started_at||after[0]?.run_started_at||after[0]?.started_at,
      unlocatedBefore:beforeMeta?Math.max(0,beforeMeta.total-beforeMeta.located):0,
      unlocatedAfter:afterMeta?Math.max(0,afterMeta.total-afterMeta.located):0,
      matched:pairs.length,conditionsKnownMatched:pairs.filter(p=>p.conditionsMatch==='same').length,
      excluded,pairs:pairs.sort((a,b)=>Number(b.conditionsMatch==='same')-Number(a.conditionsMatch==='same')),evidenceIds:[...pairs,...excluded].flatMap(p=>p.evidenceIds),
      transitions:Object.fromEntries(['gained','lost','kept','absent'].map(s=>[s,pairs.filter(p=>p.state===s).length])),
      beforeMentions,afterMentions,beforeRate:rate(beforeMentions,pairs.length),afterRate:rate(afterMentions,pairs.length),
      difference:pairs.length?(afterMentions-beforeMentions)/pairs.length:null,
      activeMatched:eligible.length,beforeActive,afterActive,beforeActiveRate:rate(beforeActive,eligible.length),afterActiveRate:rate(afterActive,eligible.length),
      activeDifference:eligible.length?(afterActive-beforeActive)/eligible.length:null,
      ownMatched:own.length,beforeOwn,afterOwn,beforeOwnRate:rate(beforeOwn,own.length),afterOwnRate:rate(afterOwn,own.length)});
  }
  const history=[...timelines].map(([key,list])=>buildHistory(key,list,manifest));
  return {runChanges:runChanges.sort((a,b)=>b.afterRun-a.afterRun),history};
}
