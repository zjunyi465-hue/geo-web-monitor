import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createJobs, runJobs } from './core.js';
import { askDemo } from './adapters/demo.js';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const platform = option('--platform', 'demo');
const questionsPath = option('--questions', 'examples/questions.txt');
const repeats = Number(option('--repeats', '1'));
const questions = (await readFile(resolve(questionsPath), 'utf8'))
  .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const jobs = createJobs(questions, [platform], repeats);

if (platform !== 'demo') {
  throw new Error(`平台 ${platform} 的网页适配器尚未接入；先用 --platform demo 验证任务流程`);
}

let done = 0;
const results = await runJobs(jobs, askDemo, {
  concurrency: 2,
  onResult: result => {
    done++;
    process.stdout.write(`${done}/${jobs.length} ${result.platform} ${result.status}: ${result.question}\n`);
  },
});
const dir = resolve('results');
await mkdir(dir, { recursive: true });
const out = join(dir, `run-${new Date().toISOString().replaceAll(':', '-')}.json`);
await writeFile(out, JSON.stringify(results, null, 2), 'utf8');
process.stdout.write(`结果：${out}\n`);
