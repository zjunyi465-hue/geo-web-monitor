import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {collectMessageSources} from '../src/message-sources.js';
import {expandDoubaoSources} from '../src/browser.js';

test('来源滚动补齐延迟加载、虚拟列表与重复URL编号，缺失仍有等待上限',{skip:process.env.GEO_UI_TEST!=='1'},async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<a href="https://outside.example/">侧栏</a><div id="message"><div id="list" style="height:160px;overflow-y:auto"></div></div>');
  await page.evaluate(()=>{
   const list=document.querySelector('#list');const append=(from,to)=>{for(let n=from;n<=to;n++)list.insertAdjacentHTML('beforeend',`<div style="height:40px"><a href="https://source.example/${n}">${n}.来源${n}</a></div>`);};
   append(1,18);let pending=false;list.onscroll=()=>{if(!pending&&list.scrollTop+list.clientHeight>=list.scrollHeight-3){pending=true;setTimeout(()=>append(19,23),700);}};
  });
  let result=await collectMessageSources(page,page.locator('#message'),23,{timeout:7000,poll:100});
  assert.equal(result.citations.length,23);assert.equal(result.sourceCollection.stopReason,'reported_count_reached');
  assert.ok(result.citations.every(c=>c.url.startsWith('https://source.example/')));
  await page.setContent('<div id="message"><div id="list" style="height:160px;overflow-y:auto"><div id="inner" style="height:736px;position:relative"></div></div></div>');
  await page.evaluate(()=>{
   const list=document.querySelector('#list'),inner=document.querySelector('#inner');
   const render=()=>{const start=Math.floor(list.scrollTop/32)+1;inner.innerHTML='';for(let n=start;n<=Math.min(23,start+5);n++)inner.insertAdjacentHTML('beforeend',`<a style="position:absolute;top:${(n-1)*32}px;height:32px" href="https://virtual.example/${n}">${n}.来源</a>`);};
   list.onscroll=render;list.scrollTop=576;render();
  });
  result=await collectMessageSources(page,page.locator('#message'),23,{timeout:7000,poll:100});
  assert.equal(new Set(result.citations.map(c=>c.number)).size,23);
  await page.setContent('<div id="message"><a href="https://same.example/a">1.来源一</a><a href="https://same.example/a">2.来源二</a><a href="javascript:void(0)">无效</a></div>');
  result=await collectMessageSources(page,page.locator('#message'),2,{timeout:1000,poll:100});
  assert.equal(result.citations.length,2);assert.deepEqual(result.citations.map(c=>c.number),[1,2]);
  await page.setContent('<div id="message"><a href="https://only.example/a">1.来源</a></div>');
  result=await collectMessageSources(page,page.locator('#message'),23,{timeout:800,poll:100});
  assert.equal(result.citations.length,1);assert.equal(result.sourceCollection.stopReason,'time_limit');
  assert.ok(result.sourceCollection.elapsedMs<2000);
  await page.locator('#message').evaluate(e=>e.remove());
  result=await collectMessageSources(page,page.locator('#message'),23,{timeout:800,poll:100});
  assert.equal(result.sourceCollection.stopReason,'message_unavailable');
  assert.ok(result.sourceCollection.elapsedMs<2000,'已关闭列表不能等待默认30秒');
  await page.setContent('<div id="message"><button aria-expanded="false" onclick="window.clicks=(window.clicks||0)+1;this.setAttribute(\'aria-expanded\',\'true\');document.querySelector(\'#refs\').hidden=false">搜索 1 个关键词，参考 1 篇资料</button><div id="refs" hidden><a href="https://ref.example/a">1.来源</a></div></div>');
  assert.equal(await expandDoubaoSources(page.locator('#message')),1);
  assert.equal(await expandDoubaoSources(page.locator('#message')),1);
  assert.equal(await page.evaluate(()=>window.clicks),1,'已展开列表不重复点击折叠');
  await page.locator('button').evaluate(e=>e.removeAttribute('aria-expanded'));
  await expandDoubaoSources(page.locator('#message'));
  assert.equal(await page.evaluate(()=>window.clicks),1,'缺少状态但编号链接已显示时仍不折叠');
 }finally{await browser.close();}
});
