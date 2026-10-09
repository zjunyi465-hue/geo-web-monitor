import {citationHost} from './analysis.js';
export const SOURCE_CATEGORIES=['unclassified','owned','third_party','competitor','verify'];
const array=value=>{try {const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'});
const validDate=value=>typeof value==='string'&&value.trim()&&Number.isFinite(Date.parse(value))?new Date(value):null;
export function sourceAssets(records,annotations=[],filters={}) {
  const slots=new Map(),assets=new Map(),meta=new Map(annotations.map(a=>[a.url,a]));
  for(const r of records) if(r.account_id) {const key=JSON.stringify([r.run_id,r.question_id,r.platform,r.account_id]);slots.set(key,(slots.get(key)||0)+1);}
  for(const r of records) {
    if(r.status!=='succeeded'||!String(r.answer||'').trim())continue;
    if(r.account_id&&slots.get(JSON.stringify([r.run_id,r.question_id,r.platform,r.account_id]))>1)continue;
    if(Array.isArray(filters.questionIds)&&!filters.questionIds.includes(Number(r.question_id)))continue;
    const runDate=validDate(r.run_started_at||r.started_at),day=runDate?dayFormat.format(runDate):null;
    if((filters.from||filters.to)&&!day)continue;
    const observedDate=validDate(r.finished_at)||validDate(r.started_at),observedAt=observedDate?.toISOString()||null;
    if(filters.platform&&r.platform!==filters.platform||filters.taskId&&String(r.task_id)!==String(filters.taskId)||filters.questionId&&String(r.question_id)!==String(filters.questionId)||filters.from&&day<filters.from||filters.to&&day>filters.to)continue;
    for(const [kind,items] of [['citation',array(r.citations_json)],['search',array(r.searched_sites_json)]]) {
      if(filters.kind&&kind!==filters.kind)continue;
      for(const item of items) {
        const url=item?.url;let host;
        if(typeof url!=='string'||url!==url.trim()||!/^https?:\/\//i.test(url))continue;
        try {const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)continue;host=citationHost(url);}catch{continue;}
        if(!host)continue;
        if(!assets.has(url))assets.set(url,{url,host,title:item.title||url,titles:new Set(),category:meta.get(url)?.category||'unclassified',favorite:!!meta.get(url)?.favorite,notes:meta.get(url)?.notes||'',evidence:new Map()});
        const asset=assets.get(url);if(item.title){asset.title=String(item.title);asset.titles.add(String(item.title));}
        if(!asset.evidence.has(r.id))asset.evidence.set(r.id,{resultId:r.id,runId:r.run_id,questionId:r.question_id,question:r.question,platform:r.platform,account:r.account_label||'历史账号',observedAt,types:[]});
        const evidence=asset.evidence.get(r.id);if(!evidence.types.includes(kind))evidence.types.push(kind);
      }
    }
  }
  const search=String(filters.q||'').toLocaleLowerCase();
  return [...assets.values()].map(a=>{
    const evidence=[...a.evidence.values()].sort((a,b)=>String(b.observedAt).localeCompare(String(a.observedAt))),dates=evidence.map(e=>e.observedAt).filter(Boolean).sort();
    return {...a,titles:[...a.titles],evidence,answers:evidence.length,citationAnswers:evidence.filter(e=>e.types.includes('citation')).length,searchAnswers:evidence.filter(e=>e.types.includes('search')).length,
      platforms:[...new Set(evidence.map(e=>e.platform))],questions:new Set(evidence.map(e=>e.questionId)).size,firstSeen:dates[0],lastSeen:dates.at(-1)};
  }).filter(a=>(!filters.category||a.category===filters.category)&&(!filters.favorite||a.favorite)&&(!search||[...a.titles,a.url,a.host,a.notes].some(v=>String(v).toLocaleLowerCase().includes(search))))
    .sort((a,b)=>b.citationAnswers-a.citationAnswers||b.answers-a.answers||String(b.lastSeen||'').localeCompare(String(a.lastSeen||''))||a.url.localeCompare(b.url));
}
export function sourceLibrary(records,annotations,filters={}) {
  const all=sourceAssets(records,annotations,filters),groups=new Map();
  for(const a of all) {
    if(!groups.has(a.host))groups.set(a.host,{host:a.host,pages:0,favorites:0,citation:new Set(),search:new Set()});
    const g=groups.get(a.host);g.pages++;g.favorites+=Number(a.favorite);
    for(const e of a.evidence){if(e.types.includes('citation'))g.citation.add(e.resultId);if(e.types.includes('search'))g.search.add(e.resultId);}
  }
  const domains=[...groups.values()].map(g=>({host:g.host,pages:g.pages,favorites:g.favorites,citationAnswers:g.citation.size,searchAnswers:g.search.size})).sort((a,b)=>b.citationAnswers-a.citationAnswers||b.pages-a.pages||a.host.localeCompare(b.host));
  const selected=all.filter(a=>!filters.host||a.host===filters.host),pageCount=Math.max(1,Math.ceil(selected.length/20)),page=Math.min(Math.max(1,Number(filters.page)||1),pageCount);
  return {domains,domainCount:domains.length,totalPages:selected.length,page,pageCount,items:selected.slice((page-1)*20,page*20).map(({evidence,...a})=>a)};
}
