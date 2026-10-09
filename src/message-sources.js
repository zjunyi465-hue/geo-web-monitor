// Collect only links belonging to this assistant message. Scrolling may affect
// its conversation container, but must never widen the collection scope.
export async function collectMessageSources(page, message, reportedCount, {timeout=15000,poll=450}={}) {
  const deadline=Date.now()+timeout, started=Date.now(), collected=new Map();
  let unchanged=0,lastSize=0,stopReason='time_limit',scrolls=0,initialized=false;
  while(Date.now()<deadline) {
    let state;
    try {
      state=await message.evaluate((root,initialize)=>{
        const anchors=[...root.querySelectorAll('a[href]')].filter(a=>a.getClientRects().length>0&&/^https?:/.test(a.href));
        const links=anchors.map(a=>{
          const title=(a.textContent||'').trim();
          const number=Number(title.match(/^\s*(\d{1,4})[.．、]\s*/)?.[1])||null;
          return {title,url:a.href,...(number?{number}:{})};
        });
        const containers=new Set();
        for(const a of anchors) for(let p=a.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement) {
          if(p.clientHeight>0&&p.scrollHeight>p.clientHeight+2&&/auto|scroll/.test(getComputedStyle(p).overflowY)) containers.add(p);
        }
        let moved=false;
        for(const p of containers) {
          const old=p.scrollTop;
          // Start at this message, never at unrelated earlier conversations.
          const start=root.contains(p)?0:Math.max(0,p.scrollTop+root.getBoundingClientRect().top-p.getBoundingClientRect().top);
          p.scrollTop=initialize?start:Math.min(p.scrollHeight-p.clientHeight,old+Math.max(100,p.clientHeight*.7));
          if(Math.abs(p.scrollTop-old)>1) moved=true;
        }
        return {links,moved};
      },!initialized,{timeout:Math.max(1,Math.min(1500,deadline-Date.now()))});
    } catch { stopReason='message_unavailable';break; }
    for(const item of state.links) collected.set(JSON.stringify([item.number||null,item.url]),item);
    if(state.links.length) initialized=true;
    if(state.moved) scrolls++;
    const numbered=[...collected.values()].filter(c=>c.number);
    const numbers=new Set(numbered.filter(c=>c.number<=reportedCount).map(c=>c.number));
    if(Number.isInteger(reportedCount)&&reportedCount>0&&numbers.size>=reportedCount) {stopReason='reported_count_reached';break;}
    unchanged=collected.size===lastSize?unchanged+1:0;lastSize=collected.size;
    // Give lazy loading time at the bottom; movement is never a stability signal.
    const settle=Number.isInteger(reportedCount)&&collected.size<reportedCount?5000:1800;
    if(!state.moved&&unchanged>=4&&Date.now()-started>=settle) {stopReason='no_new_items';break;}
    await page.waitForTimeout(Math.min(poll,Math.max(0,deadline-Date.now())));
  }
  return {citations:[...collected.values()],sourceCollection:{stopReason,scrolls,elapsedMs:Date.now()-started,collected:collected.size,reportedCount}};
}
