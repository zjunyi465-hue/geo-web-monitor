export async function readMonitorConditions(page, platform) {
  const capturedAt=new Date().toISOString();
  try {
    const fields=await page.evaluate(platform=>{
      const visible=e=>Boolean(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
      const unknown=reason=>({value:null,reason});
      const input=document.querySelector(platform==='doubao'?'[data-testid="chat_input_input"]':'textarea');
      if(!input||!visible(input)) return {search:unknown('输入区未识别'),thinking:unknown('输入区未识别'),model:unknown('输入区未识别')};
      let root=input;
      for(let i=0;i<8&&root.parentElement;i++) {
        if(root.parentElement===document.body) break;
        if(root.parentElement.querySelector('[data-testid="receive_message"],.ds-markdown,[role="navigation"]')) break;
        root=root.parentElement;
      }
      const controls=[...root.querySelectorAll('button,div,span,[role="button"],[role="switch"]')].filter(visible);
      const label=e=>(e.getAttribute('aria-label')||e.textContent||'').replace(/\s+/g,' ').trim();
      const leafMatches=list=>list.filter(e=>!list.some(other=>other!==e&&e.contains(other)));
      const toggle=re=>{
        const candidates=controls.filter(e=>re.test(label(e)));
        const stateful=candidates.filter(e=>['aria-pressed','aria-checked','data-state'].some(a=>e.hasAttribute(a)));
        const matches=stateful.length?stateful:leafMatches(candidates);
        if(matches.length!==1) return unknown(matches.length?'找到多个同名控件':'未找到设置控件');
        const e=matches[0], evidence={label:label(e).slice(0,100)};
        const values=[];
        for(const attr of ['aria-pressed','aria-checked','data-state']) {
          const raw=e.getAttribute(attr);
          if(['true','checked','on'].includes(raw)) values.push(true);
          else if(['false','unchecked','off'].includes(raw)) values.push(false);
          if(raw!==null) evidence[attr]=raw;
        }
        if(!values.length||new Set(values).size!==1) return {value:null,reason:'控件没有明确或一致的选中状态',evidence};
        return {value:values[0],evidence};
      };
      const search=toggle(platform==='deepseek'?/^(智能搜索|联网搜索|Search)$/i:/^(联网搜索|搜索|智能搜索)$/i);
      const thinking=toggle(platform==='deepseek'?/^(深度思考(?:\s*\([^)]*\))?|DeepThink(?:\s*\([^)]*\))?)$/i:/^(深度思考|深度思考模式|思考)$/);
      const models=[...root.querySelectorAll('[data-testid="model-selector"],[data-testid="model_select"],[aria-label="选择模型"]'),
        ...leafMatches(controls.filter(e=>platform==='doubao'&&/^豆包\s*(?:[·・]\s*)?(快速|思考|深度思考)$/.test(label(e))))].filter(visible);
      const unique=leafMatches([...new Set(models)]);
      const modelText=unique.length===1?(unique[0].textContent||'').replace(/\s+/g,' ').trim():'';
      const mode=modelText.match(/^豆包\s*(?:[·・]\s*)?(快速|思考|深度思考)$/);
      const model=modelText&&!/^(选择模型|模型|Select model)$/i.test(modelText)?{value:mode?'豆包 '+mode[1]:modelText.slice(0,100),kind:mode?'page_mode':'model_label',evidence:{label:modelText.slice(0,100)}}:unknown('页面未明确展示唯一模型或模式标签');
      return {search,thinking,model};
    },platform);
    return {version:1,platform,capturedAt,...fields};
  } catch { return {version:1,platform,capturedAt,...Object.fromEntries(['search','thinking','model'].map(k=>[k,{value:null,reason:'页面条件读取失败'}]))}; }
}

export function compareMonitorConditions(a,b) {
  let unknown=false;
  for(const key of ['search','thinking','model']) {
    const x=a?.[key]?.value,y=b?.[key]?.value;
    if(x==null||y==null) unknown=true;
    else if(x!==y) return 'different';
  }
  return unknown?'unknown':'same';
}
