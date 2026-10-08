import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,appendFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {assistantActivityFromHook,assistantActivityFromTail,readAssistantActivity,transcriptPathFromHook,createAssistantTranscriptReader,ASSISTANT_ACTIVITY_TTL} from './assistant-activity.mjs';
import {applyEvent,aggregate} from './hook.mjs';
const now=Date.parse('2026-10-07T11:00:00Z'),iso=t=>new Date(t).toISOString();
const message=(text='测试结果已经整理好',phase='commentary',time=now)=>({timestamp:iso(time),type:'response_item',payload:{type:'message',role:'assistant',phase,content:[{type:'output_text',text}]}});
const line=value=>JSON.stringify(value)+'\n';
const base=path.resolve('work/assistant-activity-tests');await mkdir(base,{recursive:true});
test('official Stop field becomes fixed topic metadata without persisting message content',()=>{
  const text='PRIVATE_PASSWORD=secret-123，测试全部完成。';
  const value=assistantActivityFromHook({hook_event_name:'Stop',last_assistant_message:text},now);
  assert.equal(value.kind,'final');assert.equal(value.source,'stop-hook');assert.equal(value.label,'回复 · 测试进展');
  assert(!JSON.stringify(value).includes('PRIVATE'));assert(!JSON.stringify(value).includes('secret-123'));
  assert.equal(assistantActivityFromHook({hook_event_name:'PreToolUse',last_assistant_message:text},now),null);
  assert.equal(assistantActivityFromHook({hook_event_name:'Stop',agent_id:'child',last_assistant_message:text},now),null);
  assert.equal(readAssistantActivity({...value,label:text},now),null);
  assert.equal(readAssistantActivity(value,now+ASSISTANT_ACTIVITY_TTL),null);
});
test('only complete public assistant messages are read; reasoning, users and tool results never qualify',()=>{
  const visible=message(),privateRecords=[
    {...message('HIDDEN'),payload:{...message('HIDDEN').payload,channel:'analysis'}},
    {...message('USER'),payload:{...message('USER').payload,role:'user'}},
    {timestamp:iso(now),type:'response_item',payload:{type:'reasoning',summary:[{text:'HIDDEN'}]}},
    {timestamp:iso(now),type:'response_item',payload:{type:'function_call_output',output:'TOOL'}},
  ];
  for(const item of privateRecords)assert.equal(assistantActivityFromTail(line(item),{now}),null);
  const result=assistantActivityFromTail([line(visible),...privateRecords.map(line),'incomplete{'].join(''),{now});
  assert.equal(result.kind,'commentary');assert.equal(result.label,'进度 · 测试进展');
  assert.equal(assistantActivityFromTail(line(visible),{now,since:now+1}),null);
  assert.equal(assistantActivityFromTail(line(message('future','final_answer',now+61000)),{now}),null);
  assert.equal(assistantActivityFromTail(line({timestamp:iso(now),type:'event_msg',payload:{type:'agent_message',phase:'final_answer',message:'整理好了'}}),{now}).kind,'final');
  const desktop={timestamp:iso(now),type:'event_msg',payload:{type:'item_completed',item:{type:'AgentMessage',phase:'commentary',text:'正在调整画面'}}};
  assert.equal(assistantActivityFromTail(line(desktop),{now}).label,'进度 · 画面与动作');
  assert.equal(assistantActivityFromTail(line({...desktop,payload:{...desktop.payload,item:{type:'Reasoning',text:'PRIVATE'}}}),{now}),null);
  assert.equal(assistantActivityFromTail(line({timestamp:iso(now),type:'response_item',payload:{type:'agent_message',author:'child',recipient:'root',content:'PRIVATE'}}),{now}),null);
});
test('tail reader is bounded, rejects arbitrary paths and handles concurrent reads',async()=>{
  const home=await mkdtemp(path.join(base,'home-')),sessions=path.join(home,'sessions');await mkdir(sessions);
  const file=path.join(sessions,'rollout-test.jsonl'),outside=path.join(home,'rollout-private.jsonl');
  await writeFile(file,'x'.repeat(160000)+'\n'+line(message()));await writeFile(outside,line(message('outside')));
  const read=createAssistantTranscriptReader({codexHome:home,maxBytes:2048});
  const values=await Promise.all(Array.from({length:15},()=>read(file,{now})));
  assert(values.every(value=>value?.label==='进度 · 测试进展'));
  assert.equal(await read(outside,{now}),null);assert.equal(await read(file,{now,since:now+1}),null);
  assert.equal(transcriptPathFromHook({transcript_path:outside},{codexHome:home}),null);
  assert.equal(transcriptPathFromHook({transcript_path:file},{codexHome:home}),file);
  assert.equal(transcriptPathFromHook({transcript_path:file,agent_id:'child'},{codexHome:home}),null);
  await writeFile(file,line(message('新的图片进度','commentary',now+1000)));
  assert.equal((await read(file,{now:now+1000})).label,'进度 · 画面与动作');
  assert.equal(await read(file,{now:now+ASSISTANT_ACTIVITY_TTL+1000}),null);
});
test('a directory symlink escaping the sessions root is rejected by realpath',async()=>{
  const home=await mkdtemp(path.join(base,'link-')),sessions=path.join(home,'sessions'),outside=path.join(home,'outside');
  await mkdir(sessions);await mkdir(outside);await writeFile(path.join(outside,'rollout-private.jsonl'),line(message()));
  const link=path.join(sessions,'escape');await symlink(outside,link,process.platform==='win32'?'junction':'dir');
  assert.equal(await createAssistantTranscriptReader({codexHome:home})(path.join(link,'rollout-private.jsonl'),{now}),null);
});
test('public messages survive a large appended tool result without reading the full log',async()=>{
  const home=await mkdtemp(path.join(base,'delta-')),sessions=path.join(home,'sessions');await mkdir(sessions);
  const file=path.join(sessions,'rollout-delta.jsonl');await writeFile(file,line({timestamp:iso(now),type:'event_msg',payload:{type:'token_count'}}));
  const read=createAssistantTranscriptReader({codexHome:home});assert.equal(await read(file,{now}),null);
  await appendFile(file,line(message('正在修复动画','commentary',now+1000))+line({timestamp:iso(now+1001),type:'response_item',payload:{type:'function_call_output',output:'PRIVATE_TOOL'.repeat(50000)}}));
  const seen=await read(file,{now:now+1100});assert.equal(seen.label,'进度 · 画面与动作');
  await appendFile(file,line({timestamp:iso(now+2000),type:'event_msg',payload:{type:'token_count'}}));
  assert.equal((await read(file,{now:now+2100})).id,seen.id);
  assert.equal(await read(file,{now:now+2100,since:now+1500}),null);
});
test('a known UUID resolves an old session through the fixed read-only metadata index',async()=>{
  const home=await mkdtemp(path.join(base,'indexed-')),sessions=path.join(home,'sessions','2026','01','01');await mkdir(sessions,{recursive:true});
  const uuid='01999999-9999-7999-8999-999999999999',file=path.join(sessions,`rollout-old-${uuid}.jsonl`);await writeFile(file,line(message()));
  const {DatabaseSync}=await import('node:sqlite'),index=path.join(home,'state_5.sqlite'),db=new DatabaseSync(index);
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, title TEXT)');
  db.prepare('INSERT INTO threads VALUES (?,?,?)').run(uuid,file,'PRIVATE TITLE');db.close();
  const before=await readFile(index),read=createAssistantTranscriptReader({codexHome:home});
  assert.equal((await read(null,{threadId:uuid,now})).kind,'commentary');
  assert.deepEqual(await readFile(index),before,'metadata lookup must not write the SQLite database');
  assert.equal(await read(null,{threadId:'unsafe/not-uuid',now}),null);
});
test('UUID fallback lists only today/yesterday when the metadata index is absent',async()=>{
  const home=await mkdtemp(path.join(base,'recent-')),date=new Date(now-86400000).toISOString().slice(0,10).split('-');
  const directory=path.join(home,'sessions',...date);await mkdir(directory,{recursive:true});
  const uuid='01999999-9999-7999-8999-999999999999';await writeFile(path.join(directory,`rollout-recent-${uuid}.jsonl`),line(message()));
  assert.equal((await createAssistantTranscriptReader({codexHome:home})(null,{threadId:uuid,now})).label,'进度 · 测试进展');
});
test('Stop metadata and confirmed thread identity survive subsequent hook events without body retention',async()=>{
  const dataDir=await mkdtemp(path.join(base,'hook-')),stateFile=path.join(dataDir,'state.json');
  const uuid='01999999-9999-7999-8999-999999999999';
  await applyEvent({hook_event_name:'UserPromptSubmit',session_id:'opaque',thread_id:uuid,turn_id:'t1'},{dataDir,stateFile,now});
  await applyEvent({hook_event_name:'Stop',session_id:'opaque',turn_id:'t1',last_assistant_message:'PRIVATE_BODY 已完成测试'},{dataDir,stateFile,now:now+100});
  const result=(await aggregate(dataDir,now+200)).tasks[0];
  assert.equal(result.threadId,uuid);assert.equal(result.assistantActivity.label,'回复 · 测试进展');
  const records=await readdir(path.join(dataDir,'activity'));
  for(const file of records)assert(!String(await readFile(path.join(dataDir,'activity',file))).includes('PRIVATE_BODY'));
  await applyEvent({hook_event_name:'UserPromptSubmit',session_id:'opaque',thread_id:uuid,turn_id:'t2'},{dataDir,stateFile,now:now+300});
  assert.equal((await aggregate(dataDir,now+400)).tasks[0].assistantActivity,null);
});
test('root transcript observations are exposed only as normalized metadata after the current turn start',async()=>{
  const dataDir=await mkdtemp(path.join(base,'observe-')),stateFile=path.join(dataDir,'state.json');
  const transcript=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions','rollout-synthetic.jsonl');
  await applyEvent({hook_event_name:'UserPromptSubmit',session_id:'A',turn_id:'t',transcript_path:transcript},{dataDir,stateFile,now});
  const activity=assistantActivityFromTail(line(message()),{now});let calls=0;
  const result=await aggregate(dataDir,now+100,{assistantReader:async(file,options)=>{calls++;assert.equal(file,transcript);assert.equal(options.since,now);return activity;}});
  assert.equal(calls,1);assert.equal(result.tasks[0].assistantActivity.kind,'commentary');
  assert(!JSON.stringify(result).includes('rollout-synthetic'));assert(!JSON.stringify(result).includes('测试结果已经整理好'));
});
