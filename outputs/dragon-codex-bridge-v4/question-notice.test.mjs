import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {nextNotice,readNotice,NOTICE_TTL} from './question-notice.mjs';
import {applyEvent,aggregate} from './hook.mjs';
import noticeUI from '../dragon-companion-app-v4/question-notice.cjs';
const payload={session_id:'notice-session',turn_id:'turn',tool_use_id:'call',hook_event_name:'PreToolUse',tool_name:'functions.request_user_input_async',cwd:'D:/project',tool_input:{questions:[{title:'PRIVATE QUESTION',options:['PRIVATE OPTION']}]}};
test('notice stores only hashed metadata and expires; unsupported tools cannot trigger',()=>{
  const n=nextNotice(null,payload,1000);assert.equal(n.id.length,64);assert(!JSON.stringify(n).includes('PRIVATE'));
  assert.equal(readNotice(n,1000+NOTICE_TTL),null);assert.equal(nextNotice(null,{...payload,tool_name:'unrelated'},1000),null);
  assert.equal(readNotice({...n,expiresAt:n.expiresAt+1},1100),null);
});
test('async notification survives tool return, sync reply clears and new input clears',()=>{
  const n=nextNotice(null,payload,1000);
  assert(nextNotice(n,{...payload,hook_event_name:'PostToolUse'},1100));
  assert.equal(nextNotice(n,{...payload,hook_event_name:'UserPromptSubmit'},1100),null);
  const sync=nextNotice(null,{...payload,tool_name:'request_user_input'},1000);
  assert.equal(nextNotice(sync,{...payload,hook_event_name:'PostToolUse'},1100),null);
});
test('bridge exposes generic notices without question text or reply payload; invalid legacy session IDs have no thread address',async()=>{
  const root=path.resolve('work/notice-tests');await mkdir(root,{recursive:true});const dataDir=await mkdtemp(path.join(root,'case-')),stateFile=path.join(dataDir,'state.json');
  await applyEvent(payload,{dataDir,stateFile,now:1000});
  const task=(await aggregate(dataDir,1100)).tasks[0];assert(task.questionNotice);assert.equal(task.threadId,null);assert.equal(task.requests,undefined);
  const stored=await readFile(path.join(dataDir,'question-notices',createHash('sha256').update(payload.session_id).digest('hex')+'.json'),'utf8');assert(!stored.includes('PRIVATE'));assert(!stored.includes('notice-session'));
  await applyEvent({...payload,hook_event_name:'UserPromptSubmit'},{dataDir,stateFile,now:1200});assert.equal((await aggregate(dataDir,1300)).tasks[0].questionNotice,null);
});
test('bridge carries a valid conversation UUID beside hashed notice metadata, without storing question content',async()=>{
  const root=path.resolve('work/notice-tests');await mkdir(root,{recursive:true});const dataDir=await mkdtemp(path.join(root,'jump-')),stateFile=path.join(dataDir,'state.json');
  const thread='01999999-9999-7431-8fff-000000000001';
  await applyEvent({...payload,session_id:thread},{dataDir,stateFile,now:1000});
  const task=(await aggregate(dataDir,1100)).tasks[0];assert.equal(task.threadId,thread);assert.equal(task.id.length,64);
  const selected=noticeUI.chooseNotice([task],'',new Map(),1100);assert.equal(selected.threadId,thread);assert.equal(selected.sessionId,task.id);
  const stored=await readFile(path.join(dataDir,'question-notices',task.id+'.json'),'utf8');assert(!stored.includes('PRIVATE'));assert(!stored.includes(thread));
});
test('notice respects pinned session, dismissal and screen bounds',()=>{
  const n=nextNotice(null,payload,1000),tasks=[{id:'a',questionNotice:n}];
  assert(noticeUI.chooseNotice(tasks,'',new Map(),1100));assert.equal(noticeUI.chooseNotice(tasks,'b',new Map(),1100),null);
  assert.equal(noticeUI.chooseNotice(tasks,'',new Map([['a:'+n.id,n.expiresAt]]),1100),null);
  const pet={x:100,y:300,width:180,height:200},area={x:0,y:0,width:1440,height:900};const bounds=noticeUI.noticeBounds(pet,area);assert(bounds.y+bounds.height<pet.y);
  assert.equal(noticeUI.noticeBounds({...pet,y:0},area).y,0);
});
