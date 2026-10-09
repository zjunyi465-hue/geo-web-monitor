import {createHash} from 'node:crypto';
import {answerRevision} from './answer-reviews.js';
import {brandMentioned} from './analysis.js';
import {compareMonitorConditions} from './monitor-conditions.js';
import {prepareReportRecord} from './report-policy.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=(raw,fallback)=>{try{return JSON.parse(raw);}catch{return fallback;}};
const terminal=new Set(['completed','partial','failed']);
const identity=b=>({name:b.name,aliases:b.aliases||'',website:b.website||''});
const refs=raw=>{const a=parse(raw,[]);return Array.isArray(a)?a.filter(c=>{try{const u=new URL(c?.url);return typeof c.url==='string'&&c.url===c.url.trim()&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}):[];};
const day=time=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(time));
export const CHANGE_STATES=['new','seen','watch'];

// Compare adjacent ended runs of the same task. Missing/failed runs remain barriers.
// Peer identities are applied symmetrically to both saved answers, never to a historical count.
export function buildChangeFeed({runs,records,peers=[],annotations=[],filters={}}){
  const groups=new Map(),byRun=new Map(),events=[],excluded=[],observations=[];
  const peerBasis=peers.map(p=>({key:p.key,name:p.name,names:[...p.names].sort()})).sort((a,b)=>a.key.localeCompare(b.key));
  const config=hash(peerBasis),marks=new Map(annotations.map(a=>[a.event_key,a]));
  for(const r of records){if(!byRun.has(r.run_id))byRun.set(r.run_id,[]);byRun.get(r.run_id).push(r);}
  let inProgress=0,matched=0,unchanged=0,observationPairs=0;
  for(const run of runs){if(filters.taskId&&String(run.task_id)!==String(filters.taskId))continue;if(!terminal.has(run.status)){inProgress++;continue;}if(!groups.has(run.task_id))groups.set(run.task_id,[]);groups.get(run.task_id).push(run);}
  const inScope=(run,r)=> (!filters.platform||r.platform===filters.platform)&&(!filters.accountId||String(r.account_id)===String(filters.accountId))&&(!Array.isArray(filters.questionIds)||filters.questionIds.includes(r.question_id))&&(!filters.from||day(run.started_at)>=filters.from)&&(!filters.to||day(run.started_at)<=filters.to);
  const read=(run,r)=>{
    const task=parse(run.task_snapshot_json,null),brand=parse(run.brand_snapshot_json,null),diagnostics=parse(r?.diagnostics_json,{});
    if(!task||!brand||typeof brand.name!=='string'||!brand.name.trim())return {reason:'缺少历史任务或品牌快照'};
    const qs=parse(task.question_ids_json,[]),accounts=parse(task.account_ids_json,[]);
    if(!r?.account_id||!Array.isArray(qs)||!Array.isArray(accounts)||!qs.includes(r.question_id)||!accounts.includes(r.account_id))return {reason:'缺少账号标识或不在任务快照中'};
    if(r.status!=='succeeded'||typeof r.answer!=='string'||!r.answer.trim())return {reason:'回答未成功或正文为空'};
    const conditionState=compareMonitorConditions(diagnostics.monitorConditions,diagnostics.conditionsAfter);
    if(conditionState==='different')return {reason:'采集前后条件不同或未完整确认'};
    return {conditionState,brand:identity(brand),conditions:diagnostics.monitorConditions,own:brandMentioned(r.answer,brand),peer:peerBasis.filter(p=>brandMentioned(r.answer,{name:p.name,aliases:p.names})).map(p=>p.key),diagnostics};
  };
  const slot=r=>JSON.stringify([r.question_id,r.account_id,r.platform]);
  const index=run=>{const map=new Map();for(const r of byRun.get(run.id)||[]){const k=slot(r);if(!map.has(k))map.set(k,[]);map.get(k).push(r);}return map;};
  for(const timeline of groups.values()){
    // Invalid chronology cannot safely be silently skipped.
    if(timeline.some(r=>!Number.isFinite(Date.parse(r.started_at)))){excluded.push({reason:'任务运行时间无效，无法确认先后',taskId:timeline[0].task_id});continue;}
    timeline.sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at)||a.id-b.id);
    for(let i=1;i<timeline.length;i++){
      const beforeRun=timeline[i-1],afterRun=timeline[i],old=index(beforeRun),current=index(afterRun);
      for(const key of new Set([...old.keys(),...current.keys()])){
        const a=old.get(key)||[],b=current.get(key)||[],x=a[0],y=b[0],r=y||x;if(!inScope(afterRun,r))continue;
        let reason=a.length!==1||b.length!==1?(a.length>1||b.length>1?'回答归属不唯一':'相邻运行一侧缺少回答'):null;
        const left=x&&read(beforeRun,x),right=y&&read(afterRun,y);
        reason ||= left?.reason||right?.reason;
        if(!reason&&(x.question!==y.question||x.question_kind!==y.question_kind))reason='问题或类型不同';
        if(!reason&&hash(left.brand)!==hash(right.brand))reason='品牌资料快照不同';
        const states=!reason?[left.conditions,left.diagnostics.conditionsAfter,right.conditions,right.diagnostics.conditionsAfter]:[];
        const pairStates=states.flatMap((state,i)=>states.slice(i+1).map(other=>compareMonitorConditions(state,other)));
        const between=pairStates.includes('different')?'different':pairStates.includes('unknown')?'unknown':'same';
        if(!reason&&between==='different')reason='两次监测条件不同或未完整确认';
        if(reason){excluded.push({reason,beforeRun:beforeRun.id,afterRun:afterRun.id,question:r.question,platform:r.platform,account:r.account_label||'历史账号'});continue;}
        const observed=left.conditionState==='unknown'||right.conditionState==='unknown'||between==='unknown';
        if(observed){observationPairs++;excluded.push({reason:'监测条件未完整确认，仅供原文对照',beforeRun:beforeRun.id,afterRun:afterRun.id,question:r.question,platform:r.platform,account:r.account_label||'历史账号'});}else matched++;
        const changes=[];
        if(left.own!==right.own)changes.push({type:right.own?'own_gained':'own_lost',label:right.own?'我方本次出现':'我方本次未出现'});
        for(const peer of peerBasis){const was=left.peer.includes(peer.key),now=right.peer.includes(peer.key);if(was!==now)changes.push({type:now?'peer_gained':'peer_lost',label:peer.name+(now?'本次出现':'本次未出现'),peer:peer.key});if(left.own&&was&&!right.own&&now)changes.push({type:'peer_only',label:'从双方出现变为仅出现 '+peer.name,peer:peer.key});}
        const sources=[];
        for(const [kind,column] of [['citation','citations_json'],['search','searched_sites_json']]){
          const oldLinks=new Map(refs(x[column]).map(c=>[c.url,c])),newLinks=new Map(refs(y[column]).map(c=>[c.url,c]));
          const added=[...newLinks].filter(([url])=>!oldLinks.has(url)).map(([,c])=>c),beforeOnly=[...oldLinks].filter(([url])=>!newLinks.has(url)).map(([,c])=>c);
          const complete=kind==='citation'&&[x,y].every(e=>prepareReportRecord({status:e.status,answer:e.answer,brand:right.brand,kind:e.question_kind,question:e.question,citations:parse(e.citations_json,[]),reportedCitationCount:e.reported_citation_count}).citationCompleteness==='complete');
          if(added.length||beforeOnly.length)sources.push({kind,added,beforeOnly,complete});
        }
        if(sources.length)changes.push({type:'source_changed',label:'已保存的参考来源集合发生变化'});
        if(!changes.length){if(!observed)unchanged++;continue;}
        const evidence=e=>({resultId:e.id,runId:e.run_id,answer:e.answer,time:e.finished_at||e.started_at,citations:refs(e.citations_json),search:refs(e.searched_sites_json)});
        if(observed){observations.push({taskId:afterRun.task_id,task:parse(afterRun.task_snapshot_json,{}).name||afterRun.task_name,question:y.question,platform:y.platform,account:y.account_label||'历史账号',time:afterRun.started_at,changes,sources,beforeOwn:left.own,afterOwn:right.own,before:evidence(x),after:evidence(y)});continue;}
        const eventKey=hash([afterRun.task_id,x.id,y.id,answerRevision(x),answerRevision(y),right.brand,config]);
        const mark=marks.get(eventKey),streak={own:0,peers:Object.fromEntries(right.peer.map(k=>[k,0]))};
        // Count consecutive successful saved answers up to this event, stopping at any ambiguity.
        let ownOpen=true;const peerOpen=new Set(right.peer);
        for(let j=i;j>=0;j--){const items=index(timeline[j]).get(key)||[];if(items.length!==1)break;const v=read(timeline[j],items[0]);if(v.reason||v.conditionState!=='same'||hash(v.brand)!==hash(right.brand)||items[0].question!==y.question||items[0].question_kind!==y.question_kind||compareMonitorConditions(v.conditions,right.conditions)!=='same')break;if(ownOpen&&v.own===right.own)streak.own++;else ownOpen=false;for(const k of [...peerOpen])if(v.peer.includes(k))streak.peers[k]++;else peerOpen.delete(k);if(!ownOpen&&!peerOpen.size)break;}
        events.push({key:eventKey,taskId:afterRun.task_id,task:parse(afterRun.task_snapshot_json,{}).name||afterRun.task_name,question:y.question,questionId:y.question_id,platform:y.platform,accountId:y.account_id,account:y.account_label||'历史账号',time:afterRun.started_at,changes,sources,peerStreaks:right.peer.map(k=>({name:peerBasis.find(p=>p.key===k).name,count:streak.peers[k]})),beforeOwn:left.own,afterOwn:right.own,streak,before:evidence(x),after:evidence(y),tracking:{status:mark?.status||'new',updatedAt:mark?.updated_at||null,reviewer:mark?.reviewer||null}});
      }
    }
  }
  events.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||b.after.runId-a.after.runId||a.key.localeCompare(b.key));
  const selected=events.filter(e=>(!filters.type||e.changes.some(c=>c.type===filters.type))&&(!filters.status||e.tracking.status===filters.status));
  observations.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||b.after.resultId-a.after.resultId);
  const selectedObservations=observations.filter(e=>(!filters.type||e.changes.some(c=>c.type===filters.type))&&!filters.status);
  return {events:selected,observations:selectedObservations,summary:{events:events.length,selected:selected.length,matched,unchanged,excluded:excluded.length,inProgress,new:events.filter(e=>e.tracking.status==='new').length,watch:events.filter(e=>e.tracking.status==='watch').length,observationPairs,observations:observations.length,selectedObservations:selectedObservations.length},excluded,peerBasis:peerBasis.map(p=>p.name)};
}
