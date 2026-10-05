function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function generateQuestions(brand) {
  const name = clean(brand.name);
  const category = clean(brand.category);
  const audience = clean(brand.audience);
  const competitors = clean(brand.competitors).split(/[,，、\n]/).map(clean).filter(Boolean);
  if (!name || !category) throw new Error('自动生成问题需要品牌名称和产品/服务类别');

  const candidates = [
    ['brand', name + '是什么？'],
    ['brand', name + '主要提供什么产品或服务？'],
    ['brand', name + '适合哪些客户？'],
    ['brand', name + '有哪些优势和不足？'],
    ['brand', name + '值得信赖吗？有什么依据？'],
    ['brand', '选择' + name + '之前应该了解什么？'],
    ['discovery', '有哪些值得考虑的' + category + '？'],
    ['discovery', category + '怎么选？主要看哪些因素？'],
    ['discovery', '推荐几个' + category + '，并说明各自适合谁。'],
    ['discovery', '目前常见的' + category + '有哪些？'],
    ['discovery', '如果要采购' + category + '，应该比较哪些服务商？'],
    ['discovery', category + '有哪些常见风险和避坑建议？'],
  ];
  if (audience) {
    candidates.push(['brand', name + '适合' + audience + '吗？']);
    candidates.push(['discovery', audience + '适合选择什么' + category + '？']);
    candidates.push(['discovery', '给' + audience + '推荐' + category + '，有什么选择？']);
  }
  for (const competitor of competitors.slice(0, 3)) {
    if (competitor.toLowerCase() === name.toLowerCase()) continue;
    candidates.push(['brand', name + '和' + competitor + '有什么区别？']);
    candidates.push(['discovery', '除了' + competitor + '，还有哪些' + category + '值得考虑？']);
  }
  const seen = new Set();
  return candidates.filter(([, text]) => {
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(([kind, text]) => ({ kind, text, source: 'generated' }));
}
