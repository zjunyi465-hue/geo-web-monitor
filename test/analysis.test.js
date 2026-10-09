import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuestions } from '../src/questions.js';
import { summarizeRun, sentimentGuess } from '../src/analysis.js';

test('单批报告排除空正文成功记录及非网页来源，预期数量冲突不算覆盖率',()=>{
  const input={brand:{name:'星河'},questions:[{id:1,text:'哪些工具好？',kind:'discovery'}],results:[
    {question_id:1,account_id:1,status:'succeeded',answer:' ',citations_json:'[]'},
    {question_id:1,account_id:2,status:'succeeded',answer:'星河',citations_json:'[{"url":"ftp://other.example.org/a"}]'}],totalExpected:2};
  const r=summarizeRun(input);
  assert.equal(r.successful,1);assert.equal(r.invalid,1);assert.equal(r.pending,0);
  assert.equal(r.discoveryTotal,1);assert.equal(r.captureRate,.5);
  assert.equal(r.byAccount[0].invalid,1);assert.equal(r.topCitationHosts.length,0);
  assert.equal(summarizeRun({...input,totalExpected:1}).captureRate,null);
  const duplicate=summarizeRun({...input,results:[input.results[1],{...input.results[1]}]});
  assert.equal(duplicate.successful,0);assert.equal(duplicate.invalid,2);
  assert.equal(duplicate.discoveryMentionRate,null);
});

test('自动生成品牌认知和无品牌名的推荐问题', () => {
  const items = generateQuestions({ name: '星河', category: '数据分析工具', audience: '小型企业' });
  assert.ok(items.some(x => x.kind === 'brand'));
  assert.ok(items.some(x => x.kind === 'discovery' && !x.text.includes('星河')));
  assert.equal(new Set(items.map(x => x.text)).size, items.length);
});

test('误标为推荐类但含品牌名或别名的问题不计入主动提及率', () => {
  const report = summarizeRun({
    brand: { name: '星河', aliases: 'StarRiver' },
    questions: [
      { id: 1, kind: 'discovery', text: '星河值得买吗？' },
      { id: 2, kind: 'discovery', text: 'StarRiver 如何？' },
      { id: 3, kind: 'discovery', text: '哪些工具适合小企业？' },
    ],
    results: [1, 2, 3].map(id => ({ question_id: id, status: 'succeeded', answer: '星河', citations_json: '[]' })),
  });
  assert.equal(report.discoveryTotal, 1);
  assert.equal(report.discoveryMentions, 1);
});

test('多账号报告分别计算主动提及率', () => {
  const report = summarizeRun({brand:{name:'星河',aliases:''},
    questions:[{id:1,text:'有哪些数据分析工具？',kind:'discovery'}],
    results:[
      {question_id:1,platform:'doubao',account_id:7,account_label:'甲',status:'succeeded',answer:'推荐星河',citations_json:'[]'},
      {question_id:1,platform:'doubao',account_id:8,account_label:'乙',status:'succeeded',answer:'推荐别的工具',citations_json:'[]'},
    ]});
  assert.equal(report.discoveryMentionRate, .5);
  assert.deepEqual(report.byAccount.map(account=>account.discoveryMentionRate),[1,0]);
});

test('否定短语不会因包含“推荐”而误判为混合情感', () => {
  assert.equal(sentimentGuess('星河不推荐用于这个场景。', { name: '星河' }), 'negative');
});

test('主动提及率只统计无品牌名问题的有效回答', () => {
  const brand = { name: '星河', aliases: '' };
  const questions = [{ id: 1, kind: 'brand' }, { id: 2, kind: 'discovery' }, { id: 3, kind: 'discovery' }];
  const results = [
    { question_id: 1, status: 'succeeded', answer: '星河是一家公司', citations_json: '[]' },
    { question_id: 2, status: 'succeeded', answer: '可以考虑星河', citations_json: '[]' },
    { question_id: 3, status: 'failed', answer: '', citations_json: '[]' },
  ];
  const report = summarizeRun({ brand, questions, results });
  assert.equal(report.discoveryTotal, 1);
  assert.equal(report.discoveryMentions, 1);
  assert.equal(report.discoveryMentionRate, 1);
});

test('报告标出未完成和失败样本，避免少量成功回答产生误导', () => {
  const report = summarizeRun({ brand: { name: '星河' },
    questions: [{ id: 1, kind: 'discovery', text: '推荐什么工具？' }],
    results: [
      { question_id: 1, status: 'succeeded', answer: '星河', citations_json: '[]' },
      { question_id: 1, status: 'failed' },
      { question_id: 1, status: 'needs_attention' },
    ], totalExpected: 5 });
  assert.equal(report.successful, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.pending, 3);
  assert.equal(report.captureRate, .2);
  assert.equal(report.qualityWarnings.length, 3);
  assert.equal(report.byAccount[0].failed, 1);
  assert.equal(report.byAccount[0].pending, 1);
});

test('页面标注来源多于采集链接时明确提示缺口', () => {
  const report = summarizeRun({ brand: { name: '星河' }, questions: [], results: [
    { status: 'succeeded', answer: '回答', citations_json: '[{"url":"https://example.org"}]',
      reported_citation_count: 3 },
  ] });
  assert.equal(report.citationGaps, 1);
  assert.ok(report.qualityWarnings.some(item => item.includes('参考资料数多于')));
});
