import {brandMentioned} from './analysis.js';
import {textEvidence} from './brand-evidence.js';

const references=items=>items.filter(c=>typeof c?.url==='string'&&c.url===c.url.trim()&&/^https?:\/\//i.test(c.url)).map(c=>{try{const u=new URL(c.url);return u.username||u.password?null:c;}catch{return null;}}).filter(Boolean);
export const REVIEW_CATEGORIES=['pending','peer','ignore','wrong'];
export const institutionKey=name=>String(name).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
const array=raw=>{try{const a=JSON.parse(raw||'[]');return Array.isArray(a)?a:[];}catch{return [];}};
const generic=/^(?:某某?|一家|这家|该|各|当地|本地|大型|正规|公立|私立|三甲|综合|专科|儿童|美容|医疗|治疗|科研|教育|培训)*(?:医院|诊所|中心|机构|公司|集团|大学|学院|学校|研究院|研究所|事务所)$/;
// Candidate discovery, not entity verification. Keep evidence and allow manual corrections.
export function discoverInstitutions(text) {
  const names=new Set();
  for(const match of String(text||'').replace(/(医院|诊所|公司|集团|大学|学院|研究院|研究所|中心|事务所)(和|与|及)/g,'$1、').matchAll(/[\p{Script=Han}A-Za-z0-9·]{2,70}(?:医院|诊所|研究院|研究所|公司|集团|大学|学院|学校|中心|事务所)/gu)) {
    let name=match[0];
    const prefixes=/(?:推荐|首选|优先选择|可以选择|包括|例如|比如|分别是|还有|以及|建议选择|建议去|主要是|重点关注|重点考虑|优先|考虑|直接去|选择|就诊于|位于|来自|前往|其次是|其次|联系)/g;
    let end=0;for(const p of name.matchAll(prefixes))end=p.index+p[0].length;
    if(end)name=name.slice(end);
    name=name.replace(/^(?:的|是|有|到|去|在|原)+/,'');
    if(/(?:作为|设有|不知道|这[家些类两]|哪|什么|是否|比较|最好|排名|顶尖|权威|靠谱|治疗|诊治|公立|私立|三甲|综合性|大型|可以|建议|首先|主要|之前|需要|通过|的)/.test(name)||(name.match(/医院/g)||[]).length>1)continue;
    if(name.length>=4&&name.length<=60&&!generic.test(name)&&!/^某/.test(name))names.add(name);
  }
  return [...names];
}
function rootOf(key,reviews) {
  const seen=new Set();while(reviews.get(key)?.merge_into){if(seen.has(key))throw new Error('机构合并关系有循环');seen.add(key);key=reviews.get(key).merge_into;}return key;
}
function validRecords(records,filters) {
  const counts=new Map();for(const r of records)if(r.account_id){const k=JSON.stringify([r.run_id,r.question_id,r.platform,r.account_id]);counts.set(k,(counts.get(k)||0)+1);}
  return records.filter(r=>{
    if(r.status!=='succeeded'||!String(r.answer||'').trim()||r.account_id&&counts.get(JSON.stringify([r.run_id,r.question_id,r.platform,r.account_id]))!==1)return false;
    if(filters.taskId&&String(r.task_id)!==String(filters.taskId)||filters.platform&&r.platform!==filters.platform||filters.accountId&&String(r.account_id)!==String(filters.accountId)||filters.questionId&&String(r.question_id)!==String(filters.questionId)||Array.isArray(filters.questionIds)&&!filters.questionIds.includes(Number(r.question_id)))return false;
    const time=r.run_started_at||r.started_at,day=Number.isFinite(Date.parse(time))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(time)):null;
    return !((filters.from||filters.to)&&!day||filters.from&&day<filters.from||filters.to&&day>filters.to);
  });
}
export function institutionReport(records,brand,annotations=[],filters={}) {
  const normalized=new Map(),needles=new Map();
  const matches=(text,identity)=>{text=String(text||'');if(!normalized.has(text))normalized.set(text,institutionKey(text));const k=JSON.stringify(identity);if(!needles.has(k))needles.set(k,[identity.name,...(Array.isArray(identity.aliases)?identity.aliases:String(identity.aliases||'').split(/[,，、\n]/))].filter(Boolean).map(institutionKey));return needles.get(k).some(n=>normalized.get(text).includes(n))&&brandMentioned(text,identity);};
  const reviews=new Map(annotations.map(a=>[a.name_key,a])),names=new Map();
  // Retain reviewed aliases even when the current filtered answers omit them.
  for(const a of annotations)if(!matches(a.name,brand))names.set(a.name_key,a.name);
  const all=validRecords(records,{});
  for(const r of all)for(const text of [r.answer,...references(array(r.citations_json)).map(c=>c?.title),...references(array(r.searched_sites_json)).map(c=>c?.title)])for(const name of discoverInstitutions(text))if(!matches(name,brand))names.set(institutionKey(name),reviews.get(institutionKey(name))?.name||name);
  const groups=new Map();for(const [key,name] of names){const root=rootOf(key,reviews);if(matches(reviews.get(root)?.name||names.get(root)||name,brand))continue;if(!groups.has(root))groups.set(root,{key:root,name:reviews.get(root)?.name||names.get(root)||name,category:reviews.get(root)?.category||'pending',names:[],bodyIds:[],citationIds:[],searchIds:[],eligibleIds:[],bothIds:[],withoutOwnIds:[],questions:new Set(),platforms:new Set(),lastSeen:null});groups.get(root).names.push(name);}
  const selected=validRecords(records,filters),peers=[...groups.values()].filter(g=>g.category==='peer'),own={name:brand.name,aliases:brand.aliases||''};
  const eligible=r=>r.question_kind==='discovery'&&!matches(r.question,own)&&!peers.some(g=>matches(r.question,{name:g.name,aliases:g.names}));
  let eligibleTotal=0,ownMentions=0;const ownIds=[],questionGroups=new Map(),evidence=new Map();
  for(const r of selected){
    const isEligible=eligible(r),ownBody=matches(r.answer,own);if(isEligible){eligibleTotal++;if(ownBody){ownMentions++;ownIds.push(r.id);}}
    const citations=references(array(r.citations_json)),search=references(array(r.searched_sites_json));
    evidence.set(r.id,{resultId:r.id,runId:r.run_id,questionId:r.question_id,question:r.question,platform:r.platform,accountId:r.account_id||null,account:r.account_label||'历史账号',answer:r.answer,eligible:isEligible,ownBody,citations,search});
    if(!questionGroups.has(r.question_id))questionGroups.set(r.question_id,{id:r.question_id,question:r.question,eligible:0,own:0,peers:{}});const q=questionGroups.get(r.question_id);if(isEligible){q.eligible++;q.own+=Number(ownBody);}
    for(const g of groups.values()){
      const identity={name:g.name,aliases:g.names};const body=matches(r.answer,identity),cited=citations.some(c=>matches(c.title,identity)),searched=search.some(c=>matches(c.title,identity));
      if(body||cited||searched){g.platforms.add(r.platform);const time=r.finished_at||r.started_at;if(Number.isFinite(Date.parse(time))&&(!g.lastSeen||Date.parse(time)>Date.parse(g.lastSeen)))g.lastSeen=new Date(time).toISOString();}
      if(body){g.bodyIds.push(r.id);g.questions.add(r.question_id);}if(cited)g.citationIds.push(r.id);if(searched)g.searchIds.push(r.id);
      if(body&&isEligible){g.eligibleIds.push(r.id);if(ownBody)g.bothIds.push(r.id);else g.withoutOwnIds.push(r.id);if(g.category==='peer')q.peers[g.key]=(q.peers[g.key]||0)+1;}
    }
  }
  const output=[...groups.values()].map(g=>({...g,questions:g.questions.size,platforms:[...g.platforms],body:g.bodyIds.length,citationTitles:g.citationIds.length,searchTitles:g.searchIds.length,eligibleMentions:g.eligibleIds.length,rate:eligibleTotal?g.eligibleIds.length/eligibleTotal:null,both:g.bothIds.length,withoutOwn:g.withoutOwnIds.length,ownOnly:ownMentions-g.bothIds.length,neither:eligibleTotal-ownMentions-g.eligibleIds.length+g.bothIds.length})).filter(g=>g.body||g.citationTitles||g.searchTitles||g.category==='peer').sort((a,b)=>b.body-a.body||a.name.localeCompare(b.name));
  return {summary:{successful:selected.length,eligible:eligibleTotal,namedOrOther:selected.length-eligibleTotal,ownMentions,ownRate:eligibleTotal?ownMentions/eligibleTotal:null,peerCount:peers.length,discovered:output.length},groups:output,questions:[...questionGroups.values()],reviews:[...names].map(([key,name])=>({key,name,category:reviews.get(key)?.category||'pending',mergeInto:reviews.get(key)?.merge_into||'',notes:reviews.get(key)?.notes||'',updatedAt:reviews.get(key)?.updated_at||null})),evidence,ownIds};
}
export function institutionEvidence(report,key,mode='body',filters={}) {
  const g=report.groups.find(g=>g.key===key);if(!g)throw new Error('当前范围没有该机构');
  const ids=mode==='withoutOwn'?g.withoutOwnIds:mode==='eligible'?g.eligibleIds:mode==='citation'?g.citationIds:mode==='search'?g.searchIds:g.bodyIds;
  const identity={name:g.name,aliases:g.names};
  return ids.map(id=>report.evidence.get(id)).filter(e=>(!filters.questionId||String(e.questionId)===String(filters.questionId))&&(!filters.detailPlatform||e.platform===filters.detailPlatform)&&(!filters.detailAccount||String(e.accountId||'unknown')===String(filters.detailAccount))&&(!filters.sourceUrl||(filters.sourceKind==='search'?e.search:e.citations).some(c=>c.url===filters.sourceUrl&&(filters.sourceRelation==='body'?g.bodyIds.includes(e.resultId):brandMentioned(c.title,identity))))).map(e=>({...e,nameEvidence:textEvidence(e.answer,identity)}));
}

// Derived only from the same valid saved samples as the overview. No website visits.
export function institutionDetail(report,key) {
  const g=report.groups.find(g=>g.key===key);if(!g)throw new Error('当前范围没有该机构');
  const body=new Set(g.bodyIds),identity={name:g.name,aliases:g.names},questions=new Map(),platforms=new Map(),accounts=new Map(),sources=new Map();
  const bucket=()=>({valid:0,eligible:0,body:0,own:0,peer:0,both:0,withoutOwn:0,ownOnly:0,neither:0});
  const add=(b,e)=>{b.valid++;b.body+=Number(body.has(e.resultId));if(!e.eligible)return;b.eligible++;b.own+=Number(e.ownBody);b.peer+=Number(body.has(e.resultId));b.both+=Number(body.has(e.resultId)&&e.ownBody);b.withoutOwn+=Number(body.has(e.resultId)&&!e.ownBody);b.ownOnly+=Number(!body.has(e.resultId)&&e.ownBody);b.neither+=Number(!body.has(e.resultId)&&!e.ownBody);};
  for(const e of report.evidence.values()){
    if(!questions.has(e.questionId))questions.set(e.questionId,{id:e.questionId,question:e.question,...bucket()});
    if(!platforms.has(e.platform))platforms.set(e.platform,{platform:e.platform,...bucket()});
    const ak=JSON.stringify([e.platform,e.accountId]);if(!accounts.has(ak))accounts.set(ak,{platform:e.platform,accountId:e.accountId,account:e.account,...bucket()});
    for(const b of [questions.get(e.questionId),platforms.get(e.platform),accounts.get(ak)])add(b,e);
    for(const [kind,list] of [['citation',e.citations],['search',e.search]])for(const c of list){
      const named=brandMentioned(c.title,identity),related=body.has(e.resultId);if(!named&&!related)continue;
      const sk=JSON.stringify([kind,c.url]);if(!sources.has(sk))sources.set(sk,{kind,url:c.url,titles:new Set(),bodyIds:new Set(),namedIds:new Set()});const s=sources.get(sk);
      if(c.title)s.titles.add(String(c.title));if(related)s.bodyIds.add(e.resultId);if(named)s.namedIds.add(e.resultId);
    }
  }
  const sort=(a,b)=>b.withoutOwn-a.withoutOwn||b.peer-a.peer||b.valid-a.valid;
  return {key:g.key,name:g.name,names:g.names,category:g.category,comparable:g.category==='peer',summary:{valid:report.summary.successful,eligible:report.summary.eligible,body:g.body,peer:g.eligibleMentions,own:report.summary.ownMentions,both:g.both,withoutOwn:g.withoutOwn,ownOnly:g.ownOnly,neither:g.neither},questions:[...questions.values()].sort(sort),platforms:[...platforms.values()].sort(sort),accounts:[...accounts.values()].sort(sort),sources:[...sources.values()].map(s=>({kind:s.kind,url:s.url,titles:[...s.titles],body:s.bodyIds.size,named:s.namedIds.size})).sort((a,b)=>b.body-a.body||b.named-a.named||a.url.localeCompare(b.url))};
}
export function validateInstitutionMerge(key,target,annotations) {
  if(!target)return;const map=new Map(annotations.map(a=>[a.name_key,a]));const seen=new Set([key]);while(target){if(seen.has(target))throw new Error('不能合并到自身或形成循环');seen.add(target);target=map.get(target)?.merge_into;}
}
