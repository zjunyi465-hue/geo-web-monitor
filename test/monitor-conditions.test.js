import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readMonitorConditions,compareMonitorConditions} from '../src/monitor-conditions.js';
import {buildReport} from '../src/reporting.js';
const conditions=(search=true)=>({search:{value:search},thinking:{value:false},model:{value:'演示模型'}});
test('条件未知不当关闭，已知差异与旧记录分别处理',()=>{
  assert.equal(compareMonitorConditions(null,conditions()),'unknown');
  assert.equal(compareMonitorConditions(conditions(),conditions()),'same');
  assert.equal(compareMonitorConditions(conditions(),conditions(false)),'different');
  const base={run_id:1,key:'1',run_status:'completed',task_id:1,cohort:'fixed',question_id:1,account_id:1,platform:'deepseek',question:'工具有哪些？',kind:'discovery',brand:{name:'星河'},answer:'星河',status:'succeeded',citations:[],day:'2026-10-06'};
  const a={...base,monitorConditions:conditions()},b={...base,run_id:2,key:'2',monitorConditions:conditions(false)};
  let r=buildReport([a,b]);assert.equal(r.runChanges[0].matched,0);assert.equal(r.comparisons.length,0);
  assert.match(r.runChanges[0].excluded[0].reason,/监测条件/);
  r=buildReport([a,{...b,monitorConditions:conditions()}]);assert.equal(r.runChanges[0].pairs[0].conditionsMatch,'same');
  r=buildReport([a,{...b,monitorConditions:null}]);assert.equal(r.runChanges[0].pairs[0].conditionsMatch,'unknown');
  r=buildReport([a,{...b,monitorConditions:conditions(),conditionsAfter:conditions(false)}]);assert.equal(r.runChanges[0].matched,0);
});
test('读取页面明确状态，忽略正文同名文字且不点击或发问',{skip:process.env.GEO_UI_TEST!=='1'},async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<div>正文：深度思考、智能搜索</div><div><textarea></textarea><button aria-pressed="true">智能搜索</button><button aria-pressed="false">深度思考</button><button data-testid="model-selector">演示模型</button></div>');
  let c=await readMonitorConditions(page,'deepseek');assert.equal(c.search.value,true);assert.equal(c.thinking.value,false);assert.equal(c.model.value,'演示模型');
  await page.locator('button').first().evaluate(e=>e.removeAttribute('aria-pressed'));
  c=await readMonitorConditions(page,'deepseek');assert.equal(c.search.value,null);
  await page.setContent('<div><div data-testid="chat_input_input"><div contenteditable="true"></div></div><button aria-checked="true">深度思考</button><button aria-pressed="false">联网搜索</button></div>');
  c=await readMonitorConditions(page,'doubao');assert.equal(c.search.value,false);assert.equal(c.thinking.value,true);assert.equal(c.model.value,null);
  assert.equal(await page.locator('[contenteditable]').textContent(),'');
  await page.setContent('<main><div data-testid="receive_message">豆包 深度思考</div><section><div><div data-testid="chat_input_input" contenteditable="true"></div><button>发送</button><button>附件</button></div><div><span>豆包 快速</span></div><div aria-pressed="true"><span>联网搜索</span></div><div>思考</div></section></main>');
  c=await readMonitorConditions(page,'doubao');assert.equal(c.model.value,'豆包 快速');assert.equal(c.model.kind,'page_mode');assert.equal(c.search.value,true);assert.equal(c.thinking.value,null);
  await page.locator('section').evaluate(e=>e.insertAdjacentHTML('beforeend','<span>豆包 思考</span>'));
  c=await readMonitorConditions(page,'doubao');assert.equal(c.model.value,null);
  await page.locator('section > span').evaluate(e=>e.remove());
  await page.locator('section > div').nth(1).evaluate(e=>e.textContent='豆包 · 快速');
  c=await readMonitorConditions(page,'doubao');assert.equal(c.model.value,'豆包 快速');assert.equal(c.model.evidence.label,'豆包 · 快速');
 } finally {await browser.close();}
});
