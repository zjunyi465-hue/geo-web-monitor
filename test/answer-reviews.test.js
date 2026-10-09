import test from 'node:test';
import assert from 'node:assert/strict';
import {answerRevision,answerReviewView,validateAnswerReview,summarizeAnswerReviews} from '../src/answer-reviews.js';
const result={id:1,run_id:1,question_id:1,platform:'doubao',account_id:1,status:'succeeded',answer:'第一行\r\n😀 同一个词；同一个词。',citations_json:'[]',searched_sites_json:'[]'};
test('复核引用精确原文偏移，保留重复片段位置与换行，不接受伪造或截断字符',()=>{
 const start=result.answer.lastIndexOf('同一个词'),input={status:'inaccurate',notes:'人工判断',excerpt:{start,end:start+4,text:'同一个词'}};
 assert.deepEqual(validateAnswerReview(result,input),{status:input.status,notes:input.notes,excerpt:input.excerpt});
 for(const excerpt of [{start,end:start+4,text:'不存在'},{start:-1,end:1,text:'第'},{start:6,end:7,text:result.answer.slice(6,7)}])assert.throws(()=>validateAnswerReview(result,{...input,excerpt}));
 assert.throws(()=>validateAnswerReview(result,{...input,notes:'x'.repeat(2001)}));assert.throws(()=>validateAnswerReview({...result,status:'failed'},input));
});
test('回答或来源版本变化使旧复核回到待复核，原备注和引用仍可核对',()=>{
 const saved={answer_revision:answerRevision(result),status:'accurate',notes:'旧备注',excerpt_start:0,excerpt_end:3,excerpt_text:'第一行',updated_at:'2026-10-08T00:00:00Z'};
 assert.equal(answerReviewView(result,saved).effectiveStatus,'accurate');
 for(const changed of [{answer:'已替换'},{citations_json:'[{"url":"https://example.org/a"}]'},{status:'failed'},{run_id:2}]){const view=answerReviewView({...result,...changed},saved);assert.equal(view.stale,true);assert.equal(view.effectiveStatus,'pending');assert.equal(view.notes,'旧备注');assert.equal(view.excerpt.text,'第一行');}
 assert.equal(answerReviewView(result).effectiveStatus,'pending');
});
test('人工复核统计独立守恒，失效属于待复核，空正文失败及重复样本排除',()=>{
 const valid=[{...result,review:{effectiveStatus:'accurate'}},{...result,id:2,run_id:2,review:{effectiveStatus:'pending',stale:true}},{...result,id:3,run_id:3,review:{effectiveStatus:'inaccurate'}}],records=[...valid,{...result,id:4,run_id:4,answer:''},{...result,id:5,run_id:5,status:'failed'},{...result,id:6,run_id:6},{...result,id:7,run_id:6}];
 const before=JSON.stringify(records),summary=summarizeAnswerReviews(records);assert.equal(summary.total,3);assert.equal(summary.reviewed,2);assert.equal(summary.stale,1);assert.equal(summary.pending,1);assert.equal(summary.accurate,1);assert.equal(summary.inaccurate,1);assert.equal(summary.total,summary.pending+summary.accurate+summary.inaccurate+summary.outdated+summary.uncertain);assert.equal(JSON.stringify(records),before);
});
