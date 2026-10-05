import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs, runJobs, runStatus, runAccountJobs } from '../src/core.js';

test('批次状态区分全部成功、部分失败和全部失败', () => {
  assert.equal(runStatus([{ status: 'succeeded' }]), 'completed');
  assert.equal(runStatus([{ status: 'failed' }]), 'failed');
  assert.equal(runStatus([{ status: 'succeeded' }, { status: 'failed' }]), 'partial');
  assert.equal(runStatus([]), 'failed');
  assert.equal(runStatus([{ status: 'succeeded' }, { status: 'needs_attention' }]), 'needs_attention');
});

test('一个账号遇到人工验证只暂停自己，其他账号继续执行', async () => {
  const called = [];
  const jobs = [
    { account_id: 1, question: '甲1' }, { account_id: 2, question: '乙1' },
    { account_id: 1, question: '甲2' }, { account_id: 2, question: '乙2' },
  ];
  const results = await runAccountJobs(jobs, async job => {
    called.push(job.question);
    if (job.question === '甲1') {
      const error = new Error('需要验证'); error.code = 'HUMAN_VERIFICATION_REQUIRED'; throw error;
    }
    return { text: '回答' + job.question };
  });
  assert.deepEqual(new Set(called), new Set(['甲1', '乙1', '乙2']));
  assert.equal(results.find(item => item.question === '甲1').status, 'needs_attention');
  assert.equal(results.filter(item => item.status === 'succeeded').length, 2);
});

test('按问题、平台和轮次生成任务，并保留问题原文', () => {
  const jobs = createJobs(['品牌推荐什么？', '品牌是谁？'], ['平台A', '平台B'], 2);
  assert.equal(jobs.length, 8);
  assert.deepEqual(jobs[0], { id: '1', question: '品牌推荐什么？', platform: '平台A', round: 1 });
});

test('单条采集失败不会丢失其他问答结果', async () => {
  const jobs = createJobs(['好问题', '失败问题'], ['平台A']);
  const results = await runJobs(jobs, async job => {
    if (job.question === '失败问题') throw new Error('网页超时');
    return { text: '真实回答', citations: [] };
  }, { concurrency: 2 });
  assert.equal(results[0].status, 'succeeded');
  assert.equal(results[1].status, 'failed');
  assert.equal(results[1].error, '网页超时');
});
