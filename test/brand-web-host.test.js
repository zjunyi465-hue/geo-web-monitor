import test from 'node:test';
import assert from 'node:assert/strict';
import {brandWebHost,webHost,prepareReportRecord} from '../src/report-policy.js';
test('品牌裸域名可识别，采集链接仍须原始HTTP(S)地址',()=>{
 for(const value of ['www.brand.example','brand.example/about','https://www.brand.example/about','brand.example:8443/about']) assert.equal(brandWebHost(value),'brand.example');
 for(const value of ['', 'ftp://brand.example','javascript:alert(1)','mailto:info@brand.example','https://user@brand.example','brand example','localhost','//brand.example','-brand.example']) assert.equal(brandWebHost(value),null);
 assert.equal(webHost('brand.example'),null);
 const base={status:'succeeded',answer:'星河',question:'有哪些工具？',kind:'discovery',brand:{name:'星河',website:'www.brand.example'},reportedCitationCount:1};
 assert.equal(prepareReportRecord({...base,citations:[{url:'https://docs.brand.example/a',number:'1'}]}).ownCitation,true);
 assert.equal(prepareReportRecord({...base,citations:[{url:'https://brand.example.other.example/a',number:'1'}]}).ownCitation,false);
 assert.equal(prepareReportRecord({...base,reportedCitationCount:2,citations:[{url:'https://other.example/a',number:'1'}]}).ownCitation,null);
 const invalid=prepareReportRecord({...base,citations:[{url:'brand.example/a',number:'1'}]});
 assert.equal(invalid.citations.length,0);assert.equal(invalid.ownCitation,null);
});
