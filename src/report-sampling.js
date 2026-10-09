export function reportSampling(records) {
  const good=records.filter(e=>e.status==='succeeded');
  const complete=e=>typeof e.monitorConditions?.search?.value==='boolean'&&
    typeof e.monitorConditions?.thinking?.value==='boolean'&&
    typeof e.monitorConditions?.model?.value==='string'&&Boolean(e.monitorConditions.model.value.trim());
  const describe=list=>{
    const days=[...new Set(list.map(e=>e.day).filter(Boolean))].sort();
    return {samples:list.length,share:good.length?list.length/good.length:null,
      runs:new Set(list.map(e=>e.run_id)).size,days:days.length,firstDay:days[0]||null,lastDay:days.at(-1)||null,
      platforms:new Set(list.map(e=>e.platform)).size,
      accounts:new Set(list.filter(e=>e.account_id).map(e=>JSON.stringify([e.platform,e.account_id]))).size,
      unknownAccountSamples:list.filter(e=>!e.account_id).length,
      settingsComplete:list.filter(complete).length,evidenceIds:list.map(e=>e.key)};
  };
  const group=key=>{
    const map=new Map();for(const e of good){const k=key(e);if(!map.has(k))map.set(k,[]);map.get(k).push(e);}
    return [...map].map(([key,list])=>{
      const latest=[...list].sort((a,b)=>a.run_id-b.run_id).at(-1);
      return {key,...describe(list),question:latest.question,questionCount:new Set(list.map(e=>e.question_id)).size,
        platform:latest.platform,account:latest.account_label||'未保存标签',accountKnown:Boolean(latest.account_id)};
    }).sort((a,b)=>b.samples-a.samples||a.key.localeCompare(b.key));
  };
  return {...describe(good),questionCount:new Set(good.map(e=>e.question_id)).size,
    accountsDistribution:group(e=>JSON.stringify([e.platform,e.account_id||null,e.account_id?null:e.run_id])),
    questionsDistribution:group(e=>String(e.question_id))};
}
