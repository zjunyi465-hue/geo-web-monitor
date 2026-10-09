import {brandMentioned, citationHost} from './analysis.js';
import {compareMonitorConditions} from './monitor-conditions.js';
import {brandEvidence} from './brand-evidence.js';

export function webHost(url) {
  try { const parsed=new URL(url); return ['http:','https:'].includes(parsed.protocol)?citationHost(url):null; }
  catch { return null; }
}
export function brandWebHost(value) {
  const text=String(value||'').trim();
  if(!text||/\s|\\|@/.test(text)) return null;
  if(/^https?:\/\//i.test(text)) return webHost(text);
  // Accept a domain entered in the brand form, never repair collected URLs.
  if(text.includes('://')||text.startsWith('//')||/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return null;
  try {
    const parsed=new URL('https://'+text);
    if(parsed.username||parsed.password||!parsed.hostname.includes('.')||parsed.hostname.split('.').some(p=>!p||p.startsWith('-')||p.endsWith('-'))) return null;
    return webHost(parsed.href);
  } catch {return null;}
}
export function prepareReportRecord(e) {
  const originalStatus=e.status;
  const unusable=e.status==='succeeded'&&!String(e.answer||'').trim();
  const status=unusable?'unusable':e.status;
  const citations=Array.isArray(e.citations)?e.citations.filter(c=>c&&webHost(c.url)):[];
  const identities=new Set(citations.map(c=>c.number?String(c.number):c.url));
  const numberedUrls=new Map();
  let conflictingNumber=false;
  for(const c of citations) if(c.number) {
    const number=String(c.number);
    if(numberedUrls.has(number)&&numberedUrls.get(number)!==c.url) conflictingNumber=true;
    numberedUrls.set(number,c.url);
  }
  const discardedCitationCount=(Array.isArray(e.citations)?e.citations.length:0)-citations.length;
  const expected=e.reportedCitationCount;
  let citationCompleteness='unknown';
  if(discardedCitationCount||conflictingNumber) citationCompleteness='inconsistent';
  else if(e.citationGap) citationCompleteness='partial';
  else if(Number.isInteger(expected)&&expected>=0) {
    citationCompleteness=identities.size===expected?'complete':identities.size<expected?'partial':'inconsistent';
  }
  const own=brandWebHost(e.brand?.website);
  const found=own&&citations.some(c=>{const host=webHost(c.url);return host===own||host.endsWith('.'+own);});
  // A visible matching link proves presence, even if other links are missing.
  // Absence is only classified when the visible reference count reconciles.
  const ownCitation=own?(found?true:citationCompleteness==='complete'?false:null):null;
  return {...e,originalStatus,status,citations,unusable,nameEvidence:status==='succeeded'?brandEvidence({...e,citations}):null,
    conditionsChanged:compareMonitorConditions(e.monitorConditions,e.conditionsAfter)==='different',
    error:unusable?'记录标为成功，但回答正文为空；未纳入有效回答统计。':e.error,
    eligible:e.kind==='discovery'&&!brandMentioned(e.question,e.brand),
    mentioned:status==='succeeded'&&brandMentioned(e.answer,e.brand),
    citationCompleteness,citationGap:['partial','inconsistent'].includes(citationCompleteness),ownCitation,
    discardedCitationCount};
}
export function summarizeRecords(list) {
  const good=list.filter(e=>e.status==='succeeded');
  const eligible=good.filter(e=>e.eligible), mentions=eligible.filter(e=>e.mentioned);
  const own=good.filter(e=>e.mentioned&&e.ownCitation!==null);
  const count=key=>list.filter(e=>e.status===key).length;
  const ratio=(a,b)=>b?a/b:null;
  return {total:list.length,successful:good.length,failed:count('failed'),invalid:count('unusable'),
    pending:list.filter(e=>!['succeeded','failed','unusable'].includes(e.status)).length,
    eligible:eligible.length,mentions:mentions.length,mentionRate:ratio(mentions.length,eligible.length),
    nameMentions:good.filter(e=>e.mentioned).length,
    ownSourceEligible:own.length,ownSourceAnswers:own.filter(e=>e.ownCitation).length,
    ownSourceRate:ratio(own.filter(e=>e.ownCitation).length,own.length),ownSourceUnknown:good.filter(e=>e.mentioned&&e.ownCitation===null).length,
    captureRate:ratio(good.length,list.length),cited:good.filter(e=>e.citations.length).length,citedRate:ratio(good.filter(e=>e.citations.length).length,good.length)};
}
