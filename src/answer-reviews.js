import {createHash} from 'node:crypto';

export const ANSWER_REVIEW_STATUSES=['pending','accurate','inaccurate','outdated','uncertain'];
export function answerRevision(result){
  return createHash('sha256').update(JSON.stringify([result.run_id,result.question_id,result.platform,result.account_id??null,result.status,result.answer||'',result.citations_json||'[]',result.searched_sites_json||'[]'])).digest('hex');
}
export const answerReviewable=result=>result.status==='succeeded'&&typeof result.answer==='string'&&!!result.answer.trim();
export function answerReviewView(result,saved=null){
  const revision=answerRevision(result),stale=!!saved&&saved.answer_revision!==revision;
  return {revision,status:saved?.status||'pending',effectiveStatus:stale?'pending':saved?.status||'pending',stale,
    notes:saved?.notes||'',excerpt:saved?.excerpt_start!=null?{start:saved.excerpt_start,end:saved.excerpt_end,text:saved.excerpt_text}:null,
    updatedAt:saved?.updated_at||null,reviewer:saved?.reviewer||null,reviewable:answerReviewable(result)};
}
export function validateAnswerReview(result,input){
  if(!answerReviewable(result))throw new Error('只能复核已经成功取得的非空回答');
  if(!ANSWER_REVIEW_STATUSES.includes(input.status)||typeof input.notes!=='string'||input.notes.length>2000)throw new Error('复核状态无效或备注超过2000字');
  const excerpt=input.excerpt;
  if(excerpt!==null&&(!excerpt||!Number.isSafeInteger(excerpt.start)||!Number.isSafeInteger(excerpt.end)||excerpt.start<0||excerpt.end<=excerpt.start||excerpt.end>result.answer.length||typeof excerpt.text!=='string'||excerpt.text.length>4000||result.answer.slice(excerpt.start,excerpt.end)!==excerpt.text))throw new Error('引用片段与回答原文不一致，请重新选取');
  if(excerpt){const splitSurrogate=offset=>offset>0&&offset<result.answer.length&&/[\uD800-\uDBFF]/.test(result.answer[offset-1])&&/[\uDC00-\uDFFF]/.test(result.answer[offset]);if(splitSurrogate(excerpt.start)||splitSurrogate(excerpt.end))throw new Error('引用片段不能截断字符');}
  return {status:input.status,notes:input.notes,excerpt};
}
export function summarizeAnswerReviews(records){
  const counts=new Map();for(const r of records)if(r.account_id){const k=JSON.stringify([r.run_id,r.question_id,r.platform,r.account_id]);counts.set(k,(counts.get(k)||0)+1);}
  const summary={total:0,reviewed:0,stale:0,...Object.fromEntries(ANSWER_REVIEW_STATUSES.map(s=>[s,0]))};
  for(const r of records){if(!answerReviewable(r)||r.account_id&&counts.get(JSON.stringify([r.run_id,r.question_id,r.platform,r.account_id]))>1)continue;summary.total++;const review=r.review;if(review?.stale)summary.stale++;const status=review?.stale?'pending':ANSWER_REVIEW_STATUSES.includes(review?.effectiveStatus)?review.effectiveStatus:'pending';summary[status]++;if(status!=='pending')summary.reviewed++;}
  return summary;
}
