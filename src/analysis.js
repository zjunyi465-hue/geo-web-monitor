import { domainToASCII } from 'node:url';
import {brandMatches} from './brand-evidence.js';

function normalized(text) {
  return String(text ?? '').toLocaleLowerCase().replace(/\s+/g, '');
}

export function brandMentioned(answer, brand) {
  return brandMatches(answer,brand).length>0;
}

export function sentimentGuess(answer, brand) {
  if (!brandMentioned(answer, brand)) return 'not_applicable';
  const text = normalized(answer);
  const negative = ['不推荐', '不适合', '差评', '投诉', '风险', '缺点', '争议', '问题较多'];
  const positive = ['推荐', '适合', '优势', '值得', '可靠', '表现不错', '口碑较好'];
  const hasNegative = negative.some(word => text.includes(word));
  const withoutNegations = negative.reduce((value, word) => value.replaceAll(word, ''), text);
  const hasPositive = positive.some(word => withoutNegations.includes(word));
  if (hasNegative && hasPositive) return 'mixed';
  if (hasNegative) return 'negative';
  if (hasPositive) return 'positive';
  return 'neutral';
}

export function citationHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return domainToASCII(host) || host;
  } catch {
    return null;
  }
}

export function summarizeRun({ brand, questions, results, totalExpected = results.length }) {
  const byId = new Map(questions.map(q => [Number(q.id), q]));
  const slot=r=>JSON.stringify([r.question_id,r.platform,r.account_id]);
  const counts=new Map();
  for(const r of results) if(r.account_id) counts.set(slot(r),(counts.get(slot(r))||0)+1);
  const usable=r=>Boolean(String(r.answer||'').trim())&&(!r.account_id||counts.get(slot(r))===1);
  const invalid = results.filter(r => r.status === 'succeeded' && !usable(r)).length;
  const successful = results.filter(r => r.status === 'succeeded' && usable(r));
  const citationGaps = successful.filter(r => Number.isInteger(r.reported_citation_count) &&
    JSON.parse(r.citations_json || '[]').length < r.reported_citation_count).length;
  const searchGaps = successful.filter(r => Number.isInteger(r.reported_search_count) &&
    JSON.parse(r.searched_sites_json || '[]').length < r.reported_search_count).length;
  const failed = results.filter(r => r.status === 'failed').length;
  const pending = Math.max(0, totalExpected - successful.length - failed - invalid);
  const discovery = successful.filter(r => {
    const question = byId.get(Number(r.question_id));
    return question?.kind === 'discovery' && !brandMentioned(question.text, brand);
  });
  const mentions = discovery.filter(r => brandMentioned(r.answer, brand));
  const sentiment = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  const hosts = new Map();
  const accounts = new Map();
  for (const result of results) {
    const key = result.account_id ? String(result.account_id) : result.platform + ':default';
    if (!accounts.has(key)) accounts.set(key, {
      platform: result.platform, label: result.account_label || '默认账号',
      successful: 0, failed: 0, pending: 0, invalid: 0, discoveryTotal: 0, discoveryMentions: 0,
    });
    const group = accounts.get(key);
    if (result.status === 'succeeded' && !usable(result)) group.invalid++;
    else if (result.status === 'succeeded') {
      group.successful++;
      const question = byId.get(Number(result.question_id));
      if (question?.kind === 'discovery' && !brandMentioned(question.text, brand)) {
        group.discoveryTotal++;
        if (brandMentioned(result.answer, brand)) group.discoveryMentions++;
      }
    } else if (result.status === 'failed') group.failed++;
    else group.pending++;
  }
  for (const result of successful) {
    const guess = sentimentGuess(result.answer, brand);
    if (guess in sentiment) sentiment[guess]++;
    for (const citation of JSON.parse(result.citations_json || '[]')) {
      let host=null;
      try { if(['http:','https:'].includes(new URL(citation.url).protocol)) host=citationHost(citation.url); } catch {}
      if (host) hosts.set(host, (hosts.get(host) ?? 0) + 1);
    }
  }
  return {
    total: totalExpected,
    successful: successful.length,
    failed,
    invalid,
    pending,
    captureRate: totalExpected && results.length<=totalExpected ? successful.length / totalExpected : null,
    citationGaps,
    searchGaps,
    qualityWarnings: [
      ...(invalid ? ['有 ' + invalid + ' 条成功记录正文为空或归属重复，未纳入有效回答。'] : []),
      ...(results.length>totalExpected ? ['保存记录超过预期数量，暂不计算采集覆盖率。'] : []),
      ...(pending ? ['还有 ' + pending + ' 条待处理或未执行，当前报告不是完整批次。'] : []),
      ...(failed ? ['有 ' + failed + ' 条采集失败，提及率只统计成功回答，可能与完整批次不同。'] : []),
      ...(citationGaps ? ['有 ' + citationGaps + ' 条回答展示的参考资料数多于已取得链接，请核对网页截图。'] : []),
      ...(searchGaps ? ['有 ' + searchGaps + ' 条回答展示的搜索结果数多于已取得链接，请核对网页截图。'] : []),
      ...(discovery.length < 3 ? ['无品牌名推荐问题的有效回答少于 3 条，提及率仅供参考。'] : []),
    ],
    discoveryTotal: discovery.length,
    discoveryMentions: mentions.length,
    discoveryMentionRate: discovery.length ? mentions.length / discovery.length : null,
    byAccount: [...accounts.values()].map(account => ({ ...account,
      discoveryMentionRate: account.discoveryTotal ? account.discoveryMentions / account.discoveryTotal : null,
    })),
    sentimentGuess: sentiment,
    topCitationHosts: [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([host, count]) => ({ host, count })),
    caveats: [
      '主动提及率仅以成功采集的无品牌名推荐类问题为分母。',
      '情感倾向为关键词粗判，需对照回答原文人工复核。',
      '引用链接仅代表页面展示的来源，不自动证明回答中的说法正确。',
    ],
  };
}
