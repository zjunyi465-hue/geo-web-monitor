import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRunAt } from '../src/schedule.js';

test('每天计划跨日、跨年以及恰好到点后均选择下一次执行', () => {
  const before = new Date(2026, 11, 31, 8, 0);
  assert.equal(nextRunAt('daily', '09:00', [], before), new Date(2026, 11, 31, 9).toISOString());
  assert.equal(nextRunAt('daily', '09:00', [], new Date(2026, 11, 31, 9)), new Date(2027, 0, 1, 9).toISOString());
});

test('每周计划跨周，拒绝无日期或无效时间', () => {
  const monday = new Date(2026, 8, 28, 10);
  assert.equal(nextRunAt('weekly', '09:00', [1], monday), new Date(2026, 9, 5, 9).toISOString());
  assert.throws(() => nextRunAt('weekly', '09:00', [], monday));
  assert.throws(() => nextRunAt('daily', '24:00', [], monday));
  assert.equal(nextRunAt('manual', '', [], monday), null);
});
