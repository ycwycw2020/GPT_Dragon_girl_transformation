import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeTaskTail,TRANSCRIPT_TASK_TTL} from './task-transcript.mjs';

const BASE=Date.parse('2026-10-08T00:00:00Z');
const TURN='01a11a0e-37fd-7433-af17-7088c8c9c790';
const NEXT='01a11a0d-3ed7-7f91-a323-c6c9ba7bf7ff';
const digest=value=>createHash('sha256').update(value).digest('hex');
const event=(type,fields={},offset=0)=>JSON.stringify({timestamp:new Date(BASE+offset).toISOString(),type:'event_msg',payload:{type,turn_id:TURN,...fields}});
const response=(type,fields={},offset=0)=>JSON.stringify({timestamp:new Date(BASE+offset).toISOString(),type:'response_item',payload:{type,...fields}});
const read=(text,fields={})=>summarizeTaskTail(text,{now:BASE+10000,...fields});

test('uses task lifecycle metadata and exactly the Hook turn hash namespace',()=>{
  const state=read(event('task_started',{started_at:new Date(BASE-100).toISOString()}));
  assert.equal(state.active,true);assert.equal(state.turn,digest(TURN));assert.equal(state.turnStartedAt,BASE-100);
  assert.equal(state.expiresAt,BASE+TRANSCRIPT_TASK_TTL);assert.equal(state.statusKnown,true);
});
test('normalizes lifecycle Unix seconds without changing item milliseconds',()=>{
  const state=read(event('task_started',{started_at:BASE/1000}));
  assert.equal(state.turnStartedAt,BASE);
  const completed=read(event('task_complete',{started_at:BASE/1000},100));
  assert.equal(completed.turnStartedAt,BASE);
});
test('complete and interrupted events end a turn without reading final text',()=>{
  for(const [type,terminal] of [['task_complete','Stop'],['turn_aborted','Interrupt']]){
    const state=read(event('task_started')+'\n'+event(type,{last_agent_message:'PRIVATE FINAL'},100));
    assert.equal(state.active,false);assert.equal(state.terminalEvent,terminal);assert.equal(state.waitingForInput,false);
    assert.equal(JSON.stringify(state).includes('PRIVATE'),false);
  }
});
test('an old task complete cannot terminate the newly started turn',()=>{
  const state=read(event('task_started')+'\n'+event('task_started',{turn_id:NEXT},10)+'\n'+event('task_complete',{},20));
  assert.equal(state.active,true);assert.equal(state.turn,digest(NEXT));
});
test('terminal wins over duplicate start and same-turn late tool/result',()=>{
  const state=read(event('task_started')+'\n'+event('task_complete',{},100)+'\n'+event('task_started',{},100)+'\n'+event('item_completed',{item:{type:'Reasoning',raw_content:['PRIVATE ANALYSIS']}},200)+'\n'+response('function_call_output',{output:'PRIVATE TOOL'},300));
  assert.equal(state.active,false);assert.equal(state.terminalEvent,'Stop');assert.equal(state.updatedAt,BASE+100);
});
test('a later complete proves its turn when that task start was buried',()=>{
  const previous=read(event('task_started'));
  const state=read(event('task_complete',{turn_id:NEXT,started_at:new Date(BASE+100).toISOString()},200),{previous});
  assert.equal(state.active,false);assert.equal(state.turn,digest(NEXT));assert.equal(state.turnStartedAt,BASE+100);assert.equal(state.terminalEvent,'Stop');
});
test('an older-turn item cannot resurrect a newer completed task',()=>{
  const previous=read(event('task_complete',{turn_id:NEXT,started_at:new Date(BASE+100).toISOString()},200));
  const state=read(event('item_completed',{started_at_ms:BASE,item:{type:'CommandExecution'}},300),{previous});
  assert.equal(state.turn,digest(NEXT));assert.equal(state.active,false);assert.equal(state.terminalEvent,'Stop');
});
test('new task begins after the preceding task completes',()=>{
  const state=read(event('task_complete')+'\n'+event('task_started',{turn_id:NEXT},100));
  assert.equal(state.active,true);assert.equal(state.turn,digest(NEXT));assert.equal(state.terminalEvent,null);
});
test('partial tails can identify recent activity without inventing its start',()=>{
  const state=read('{"truncated":\n'+event('item_completed',{item:{type:'Reasoning',summary_text:['PRIVATE ANALYSIS'],raw_content:['SECRET']}}),{partialFirstLine:true});
  assert.equal(state.active,true);assert.equal(state.turnStartedAt,null);assert.equal(state.label,'正在思考');
  assert.equal(/PRIVATE|SECRET/.test(JSON.stringify(state)),false);
});
test('previous metadata survives a huge/incomplete result burying task start',()=>{
  const previous=read(event('task_started'));
  const state=read('partial tool output\n'+event('token_count',{turn_id:undefined,info:{tokens:100}},500),{partialFirstLine:true,previous});
  assert.equal(state.turn,digest(TURN));assert.equal(state.turnStartedAt,BASE);assert.equal(state.active,true);assert.equal(state.updatedAt,BASE);
});
test('thread settings, context and token usage cannot start or renew tasks',()=>{
  const lines=[event('thread_settings_applied',{thread_settings:{model:'X'}},100),event('token_count',{},200),JSON.stringify({timestamp:new Date(BASE+300).toISOString(),type:'turn_context',payload:{turn_id:TURN}})].join('\n');
  assert.equal(read(lines),null);
  const previous=read(event('task_started'));
  const state=read(lines,{now:BASE+TRANSCRIPT_TASK_TTL,previous});
  assert.equal(state.active,false);assert.equal(state.stale,true);assert.equal(state.updatedAt,BASE);
});
test('activity refreshes a running lease but file observations do not',()=>{
  const previous=read(event('task_started'));
  const state=read(event('item_completed',{item:{type:'CommandExecution',command:'SECRET COMMAND',stdout:'SECRET OUTPUT'}},20000),{now:BASE+20001,previous});
  assert.equal(state.expiresAt,BASE+20000+TRANSCRIPT_TASK_TTL);assert.equal(state.label,'执行命令');
  assert.equal(read('',{now:BASE+20000+TRANSCRIPT_TASK_TTL,previous:state}).active,false);
});
test('public tool names determine labels without using arguments or output',()=>{
  for(const [name,label] of [['apply_patch','修改文件'],['functions.exec','执行命令'],['web.run','查阅资料'],['read_file','读取与检索'],['imagegen','生成图片'],['spawn_agent','子任务进行中']]){
    const state=read(response('function_call',{name,arguments:'PRIVATE PASSWORD / user body'}));
    assert.equal(state.label,label);assert.equal(state.turnStartedAt,null);assert.equal(state.active,true);
    assert.equal(JSON.stringify(state).includes('PRIVATE'),false);
  }
});
test('request_user_input waits until its own result, not another tool result',()=>{
  const previous=read(event('task_started')+'\n'+response('function_call',{name:'request_user_input',call_id:'question-1',arguments:'PRIVATE QUESTIONS'},100));
  assert.equal(previous.label,'等待你的回答');assert.equal(previous.waitingForInput,true);
  const other=read(response('function_call_output',{call_id:'other',output:'PRIVATE OUTPUT'},200),{previous});
  assert.equal(other.waitingForInput,true);assert.equal(other.label,'等待你的回答');
  const answered=read(response('function_call_output',{call_id:'question-1',output:'PRIVATE ANSWER'},300),{previous:other});
  assert.equal(answered.waitingForInput,false);assert.equal(answered.pendingInputCall,null);assert.equal(answered.label,'正在思考');
});
test('a new user item clears waiting metadata without using message content',()=>{
  const previous=read(event('task_started')+'\n'+response('function_call',{name:'functions.request_user_input',call_id:'Q'},100));
  const state=read(event('item_completed',{item:{type:'UserMessage',content:[{text:'SECRET ANSWER'}]}},200),{previous});
  assert.equal(state.waitingForInput,false);assert.equal(state.label,'正在处理新任务');
});
test('terminal facts remain inactive beyond the live activity lease',()=>{
  const previous=read(event('task_complete'));
  const state=read('',{now:BASE+86400000,previous});
  assert.equal(state.active,false);assert.equal(state.statusKnown,true);assert.equal(state.terminalEvent,'Stop');assert.equal(state.stale,false);
});
test('a different turn inferred from recent work resets the old start',()=>{
  const previous=read(event('task_complete'));
  const state=read(event('item_completed',{turn_id:NEXT,item:{type:'FileChange',changes:{'PRIVATE FILE':{}}}},100),{previous});
  assert.equal(state.active,true);assert.equal(state.turn,digest(NEXT));assert.equal(state.turnStartedAt,null);assert.equal(state.label,'修改文件');
});
test('malformed/future events and invalid turn identifiers fail closed',()=>{
  assert.equal(read('not json\n'+event('task_started',{turn_id:'SECRET'})),null);
  assert.equal(read(event('task_started',{},1000000)),null);
  assert.equal(read(event('item_completed',{turn_id:'SECRET',item:{type:'CommandExecution'}})),null);
});
test('sanitizes untrusted previous metadata to a finite safe schema',()=>{
  const good=read(event('task_started'));
  const state=read('',{previous:{...good,label:'PRIVATE PROMPT',command:'PRIVATE COMMAND',thread_id:'PRIVATE THREAD',pendingInputCall:'PRIVATE'}});
  assert.equal(state.label,'正在思考');assert.equal(state.pendingInputCall,null);
  assert.equal(/PRIVATE/.test(JSON.stringify(state)),false);
  assert.throws(()=>summarizeTaskTail('',{now:NaN}),TypeError);
});
