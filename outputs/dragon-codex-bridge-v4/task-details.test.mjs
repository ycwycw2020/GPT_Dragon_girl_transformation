import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {taskDetails} from './task-details.mjs';
import {applyEvent,aggregate,ACTIVITY_TTL} from './hook.mjs';
test('display includes directory and operation but excludes secret command contents',()=>{
  const detail=taskDetails({cwd:'D:\\work\\project',hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'node --test tests.mjs TOKEN=secret-value'},prompt:'private prompt'});
  assert.equal(detail.label,'运行测试');assert.equal(detail.cwd,'D:\\work\\project');
  assert(!JSON.stringify(detail).includes('secret-value'));assert(!JSON.stringify(detail).includes('private prompt'));
  assert.equal(taskDetails({tool_name:'apply_patch',hook_event_name:'PreToolUse'}).label,'修改文件');
  assert.equal(taskDetails({tool_name:'Bash',hook_event_name:'PreToolUse',tool_input:{command:'Get-Content hook.test.mjs'}}).label,'读取与检查文件');
  assert.equal(taskDetails({tool_name:'Bash',hook_event_name:'PreToolUse',tool_input:{command:'Get-AppxPackage Codex'}}).label,'执行命令');
});
test('task cards follow active session, retain cwd on stop, and expire honestly',async()=>{
  await mkdir('work/task-card-tests',{recursive:true});const dataDir=await mkdtemp(path.resolve('work/task-card-tests/case-')),stateFile=path.join(dataDir,'state.json');
  const apply=(event,session,now,cwd)=>applyEvent({hook_event_name:event,session_id:session,turn_id:'turn',cwd,tool_name:'Bash'},{dataDir,stateFile,now});
  await apply('PreToolUse','one',1000,'D:/one');await apply('PreToolUse','two',1100,'D:/two');await apply('Stop','two',1200);
  const current=await aggregate(dataDir,1300);assert.equal(current.tasks[0].cwd,'D:/one');assert(current.tasks[0].active);
  assert.equal(current.tasks[1].cwd,'D:/two');assert.equal(current.tasks[1].label,'本轮已结束');
  const expired=await aggregate(dataDir,1300+ACTIVITY_TTL);assert(!expired.isWorking);assert(expired.tasks.some(t=>t.stale));
});
