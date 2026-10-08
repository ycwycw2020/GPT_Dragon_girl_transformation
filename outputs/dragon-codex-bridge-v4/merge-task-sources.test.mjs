import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTaskSources} from './merge-task-sources.mjs';
const now=100000,A='a'.repeat(64),B='b'.repeat(64),thread='00000000-0000-4000-8000-000000000001';
const running={id:A,threadId:thread,turn:'1'.repeat(64),turnStartedAt:1000,active:true,stale:false,updatedAt:now,expiresAt:now+900000,cwd:'C:/project',label:'调用工具'};
const finished={...running,active:false,terminalEvent:'Stop',name:'真实对话名称',statusKnown:true,activitySource:'codex-history',updatedAt:now-1000,cwd:'D:/other-project',label:'本轮已结束'};
test('global terminal state repairs a stale active hook and supplies exact name/directory',()=>{
 const value=mergeTaskSources({tasks:[running]},{available:true,tasks:[finished]},now);
 assert.equal(value.tasks.length,1);assert.equal(value.tasks[0].active,false);assert.equal(value.tasks[0].name,'真实对话名称');
 assert.equal(value.tasks[0].cwd,'D:/other-project');assert.equal(value.source,'codex-global');
});
test('an active outside-directory conversation is discovered without a hook',()=>{
 const outside={...running,id:B,threadId:'00000000-0000-4000-8000-000000000002',cwd:'D:/anywhere',name:'另一个会话'};
 const value=mergeTaskSources({tasks:[running]},{available:true,tasks:[outside]},now);
 assert.equal(value.tasks.length,2);assert.equal(value.activeSessionCount,2);
});
test('same directory conversations never merge',()=>{
 const other={...finished,id:B,threadId:'00000000-0000-4000-8000-000000000002',cwd:running.cwd};
 assert.equal(mergeTaskSources({tasks:[running]},{available:true,tasks:[other]},now).tasks.length,2);
});
test('a new prompt wins before the history database projects its new turn',()=>{
 const prompt={...running,turn:'2'.repeat(64),turnStartedAt:now+1,updatedAt:now+1};
 const value=mergeTaskSources({tasks:[prompt]},{available:true,tasks:[finished]},now);
 assert.equal(value.tasks[0].active,true);assert.equal(value.tasks[0].turn,prompt.turn);
});
test('fresh hook activity can extend an old in-progress history lease',()=>{
 const history={...finished,terminalEvent:null,stale:true,label:'状态待确认'};
 assert.equal(mergeTaskSources({tasks:[running]},{available:true,tasks:[history]},now).tasks[0].active,true);
});
test('unavailable global metadata preserves hooks and does not require migration',()=>{
 const value=mergeTaskSources({tasks:[running]},{available:false,tasks:[]},now);
 assert.equal(value.tasks[0].id,A);assert.equal(value.source,'codex-hooks');assert.equal(value.isWorking,true);
});

test('known archived conversations cannot reappear through delayed Hooks',()=>{
 const value=mergeTaskSources({tasks:[running]},{available:true,tasks:[],excludedThreadIds:[thread]},now);
 assert.equal(value.tasks.length,0);assert.equal(value.isWorking,false);
 const offline=mergeTaskSources({tasks:[running]},{available:false,tasks:[],excludedThreadIds:[thread]},now);
 assert.equal(offline.tasks.length,1);assert.equal(offline.isWorking,true);
});
test('questions remain attached to the exact current conversation; completion clears them',()=>{
 const notice={id:'question',expiresAt:now+1000};
 assert.equal(mergeTaskSources({tasks:[{...running,questionNotice:notice}]},{tasks:[finished]},now).tasks[0].questionNotice,null);
 const active={...finished,active:true,terminalEvent:null};
 assert.deepEqual(mergeTaskSources({tasks:[{...running,questionNotice:notice}]},{tasks:[active]},now).tasks[0].questionNotice,notice);
});

test('a confirmed later prompt cannot be hidden by an older turns delayed completion timestamp',()=>{
 const lateOldTerminal={...finished,turnStartedAt:1000,updatedAt:now+2};
 const newPrompt={...running,turn:'2'.repeat(64),turnStartedAt:now+1,updatedAt:now+3};
 const value=mergeTaskSources({tasks:[newPrompt]},{available:true,tasks:[lateOldTerminal]},now+4);
 assert.equal(value.tasks[0].active,true);assert.equal(value.tasks[0].turn,newPrompt.turn);
 assert.equal(value.tasks[0].activitySource,'codex-hooks');
});

test('a globally discovered later turn does not inherit a preceding turns question notice',()=>{
 const prior={...running,questionNotice:{id:'old-question',expiresAt:now+900000}};
 const next={...finished,active:true,terminalEvent:null,turn:'2'.repeat(64),turnStartedAt:now,updatedAt:now};
 const value=mergeTaskSources({tasks:[prior]},{available:true,tasks:[next]},now);
 assert.equal(value.tasks[0].turn,next.turn);assert.equal(value.tasks[0].questionNotice,null);
});

test('expired running leases normalize inactive before downstream task selection rebuilds activity',()=>{
 const expired={...running,expiresAt:now,active:true,stale:false};
 const value=mergeTaskSources({tasks:[expired]},{available:false,tasks:[]},now);
 assert.equal(value.isWorking,false);assert.equal(value.tasks[0].active,false);
 assert.equal(value.tasks[0].stale,true);assert.equal(value.activeSessionCount,0);
});
