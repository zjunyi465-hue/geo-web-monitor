export async function askDemo(job) {
  return {
    text: `演示回答：${job.question}`,
    citations: [],
    screenshot: null,
    captureMethod: 'demo',
  };
}
