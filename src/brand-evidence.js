const segmenter=new Intl.Segmenter('zh',{granularity:'grapheme'});
function normalizedMap(text,compact=false) {
  let value='';const starts=[],ends=[];
  for(const {segment,index} of segmenter.segment(text)) {
    let normalized=segment.normalize('NFKC');
    if(compact) normalized=normalized.toLocaleLowerCase().replace(/\s+/g,'');
    value+=normalized;
    for(let i=0;i<normalized.length;i++){starts.push(index);ends.push(index+segment.length);}
  }
  return {value,starts,ends};
}
export function brandMatches(text,brand={}) {
  text=String(text??'');const matches=[],seen=new Set();
  const aliases=Array.isArray(brand.aliases)?brand.aliases:String(brand.aliases??'').split(/[,，、\n]/);
  const names=[{name:brand.name,type:'brand_name'},...aliases.map(name=>({name,type:'alias'}))];
  let normal,compact;
  for(const item of names) {
    const name=String(item.name||'').normalize('NFKC').trim();if(!name||seen.has(name))continue;seen.add(name);
    const latin=/[a-z0-9]/i.test(name);
    const mapped=latin?(normal??=normalizedMap(text)):(compact??=normalizedMap(text,true));
    const needle=latin?name:name.toLocaleLowerCase().replace(/\s+/g,'');if(!needle)continue;
    const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp(latin?'(?<![a-z0-9_])'+escaped.replace(/\s+/g,'\\s+')+'(?![a-z0-9_])':escaped,latin?'gi':'g');
    for(const m of mapped.value.matchAll(re)) matches.push({start:mapped.starts[m.index],end:mapped.ends[m.index+m[0].length-1],name,type:item.type});
  }
  return matches.sort((a,b)=>a.start-b.start||b.end-a.end);
}
export function textEvidence(text,brand,maxExcerpts=5) {
  text=String(text??'');const matches=brandMatches(text,brand),ranges=[];
  for(const m of matches) {
    const last=ranges.at(-1);if(last&&m.start<last.end)last.end=Math.max(last.end,m.end);
    else ranges.push({start:m.start,end:m.end});
  }
  const windows=[];
  for(const r of ranges) {
    const start=Math.max(0,r.start-90),end=Math.min(text.length,r.end+90),last=windows.at(-1);
    if(last&&start<=last.end)last.end=Math.max(last.end,end);else windows.push({start,end});
  }
  const excerpts=windows.slice(0,maxExcerpts).map(w=>{
    const parts=[];let cursor=w.start;
    for(const r of ranges.filter(r=>r.end>w.start&&r.start<w.end)) {
      if(r.start>cursor)parts.push({text:text.slice(cursor,r.start),highlight:false});
      parts.push({text:text.slice(Math.max(cursor,r.start),Math.min(r.end,w.end)),highlight:true});cursor=Math.min(r.end,w.end);
    }
    if(cursor<w.end)parts.push({text:text.slice(cursor,w.end),highlight:false});
    return {start:w.start,end:w.end,leading:w.start>0,trailing:w.end<text.length,parts};
  });
  return {matched:!!matches.length,occurrences:ranges.length,names:[...new Map(matches.map(m=>[m.type+'|'+m.name,{name:m.name,type:m.type}])).values()],excerptCount:windows.length,excerpts};
}
export function brandEvidence(record) {
  const titles=list=>(Array.isArray(list)?list:[]).map((c,index)=>({index,url:c?.url,title:c?.title,...textEvidence(c?.title,record.brand,1)})).filter(c=>c.matched);
  return {body:textEvidence(record.answer,record.brand),citations:titles(record.citations),search:titles(record.searchedSites)};
}
