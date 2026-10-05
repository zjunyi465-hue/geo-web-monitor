export function runStatus(results) {
  if (results.some(result => result.status === 'needs_attention')) return 'needs_attention';
  const succeeded = results.filter(result => result.status === 'succeeded').length;
  return succeeded === results.length && results.length ? 'completed' : succeeded ? 'partial' : 'failed';
}

// Each account is a serial queue. A verification or login challenge stops only
// that account; other accounts can finish their own questions.
export async function runAccountJobs(jobs, ask, { concurrency = 2, onResult = () => {} } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency 必须是正整数');
  const groups = new Map();
  for (const job of jobs) {
    if (!job.account_id) throw new Error('账号任务缺少 account_id');
    if (!groups.has(job.account_id)) groups.set(job.account_id, []);
    groups.get(job.account_id).push(job);
  }
  const queues = [...groups.values()];
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < queues.length) {
      const queue = queues[cursor++];
      for (const job of queue) {
        const startedAt = new Date().toISOString();
        let result;
        try {
          const answer = await ask(job);
          if (!answer || typeof answer.text !== 'string' || !answer.text.trim()) throw new Error('未取得回答正文');
          result = { ...job, status: 'succeeded', startedAt: answer.attemptStartedAt || startedAt, finishedAt: new Date().toISOString(),
            answer: answer.text, citations: answer.citations ?? [], searchedSites: answer.searchedSites ?? [],
            reportedSearchCount: answer.reportedSearchCount ?? null, screenshot: answer.screenshot ?? null,
            reportedCitationCount: answer.reportedCitationCount ?? null,
            diagnostics: answer.diagnostics ?? {},
            captureMethod: answer.captureMethod ?? null };
        } catch (error) {
          const code = error instanceof Error ? error.code : null;
          result = { ...job, status: ['HUMAN_VERIFICATION_REQUIRED', 'LOGIN_REQUIRED'].includes(code)
            ? 'needs_attention' : 'failed', startedAt: error?.attemptStartedAt || startedAt, finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error), errorCode: code ?? null,
          diagnostics: error instanceof Error ? error.diagnostics ?? {} : {},
          screenshot: error instanceof Error ? error.screenshot ?? null : null };
        }
        await onResult(result);
        results.push(result);
        if (result.status === 'needs_attention') break;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queues.length) }, () => worker()));
  return results;
}

export function createJobs(questions, platforms, repeats = 1) {
  if (!Array.isArray(questions) || !Array.isArray(platforms) || !questions.length || !platforms.length) {
    throw new Error('至少需要一个问题和一个平台');
  }
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('repeats 必须是正整数');

  const jobs = [];
  for (const question of questions) {
    if (typeof question !== 'string' || !question.trim()) throw new Error('问题不能为空');
    for (const platform of platforms) {
      if (typeof platform !== 'string' || !platform.trim()) throw new Error('平台名不能为空');
      for (let round = 1; round <= repeats; round++) {
        jobs.push({
          id: `${jobs.length + 1}`,
          question: question.trim(),
          platform: platform.trim(),
          round,
        });
      }
    }
  }
  return jobs;
}

export async function runJobs(jobs, ask, { concurrency = 1, onResult = () => {} } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency 必须是正整数');
  const results = new Array(jobs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      const startedAt = new Date().toISOString();
      try {
        const answer = await ask(job);
        if (!answer || typeof answer.text !== 'string' || !answer.text.trim()) {
          throw new Error('未取得回答正文');
        }
        results[index] = {
          ...job, status: 'succeeded', startedAt,
          finishedAt: new Date().toISOString(),
          answer: answer.text,
          citations: answer.citations ?? [],
          searchedSites: answer.searchedSites ?? [],
          reportedSearchCount: answer.reportedSearchCount ?? null,
          screenshot: answer.screenshot ?? null,
          captureMethod: answer.captureMethod ?? null,
        };
      } catch (error) {
        results[index] = {
          ...job, status: 'failed', startedAt,
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          screenshot: error instanceof Error ? error.screenshot ?? null : null,
        };
      }
      await onResult(results[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}
