import test from 'node:test';
import assert from 'node:assert/strict';
import {pickBubbleTask,bubbleOperation} from './task-bubble-state.mjs';
const now=100000,activity={id:'a'.repeat(64),kind:'commentary',label:'进度 · 测试进展',updatedAt:now,expiresAt:now+900000};
test('recent assistant output briefly wins automatic selection; an explicit followed task always wins',()=>{
  const active={id:'work',active:true,label:'修改文件'},reply={id:'reply',active:false,label:'本轮已结束',assistantActivity:activity};
  assert.equal(pickBubbleTask({tasks:[active,reply]},now),reply);
  assert.equal(pickBubbleTask({tasks:[active,reply]},now+12001),active);
  assert.equal(pickBubbleTask({tasks:[active,reply],followSession:'work'},now),active);
  assert.equal(pickBubbleTask({tasks:[active,reply],followSession:'missing'},now),null);
  assert.equal(pickBubbleTask({tasks:[]},now),null);
});
test('short assistant labels expire back into actual operation text; malformed metadata is ignored',()=>{
  const task={id:'A',active:true,label:'修改文件',assistantActivity:activity};
  assert.equal(bubbleOperation(task,{},now),'进度 · 测试进展');
  assert.equal(bubbleOperation(task,{},now+12001),'修改文件');
  assert.equal(bubbleOperation({...task,active:false},{},now+12001),'进度 · 测试进展');
  assert.equal(bubbleOperation({...task,assistantActivity:{...activity,id:'bad'}},{},now),'修改文件');
  assert.equal(bubbleOperation(null,{taskKnown:false},now),'等待 Codex 任务');
});
