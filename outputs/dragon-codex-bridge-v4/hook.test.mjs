import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sanitizeEvent,readQuotaValue,applyEvent,aggregate,ACTIVITY_TTL} from './hook.mjs';
import {normalizeState} from '../dragon-companion-app-v4/state-bridge.mjs';
const base=path.resolve('work/codex-bridge-v4-tests');await mkdir(base,{recursive:true});
const fixture=()=>mkdtemp(path.join(base,'case-'));
const payload=(event,session='session-A',turn='turn-A',agent)=>({hook_event_name:event,session_id:session,turn_id:turn,
  ...(agent===undefined?{}:{agent_id:agent}),prompt:'DO NOT STORE',last_assistant_message:'PRIVATE'});
const moduleUrl=pathToFileURL(path.resolve('outputs/dragon-codex-bridge-v4/hook.mjs')).href;
function worker(source,args=[],{stdin='',suppressExperimentalWarning=true}={}) {
  const child=spawn(process.execPath,[...(suppressExperimentalWarning?['--disable-warning=ExperimentalWarning']:[]),'--input-type=module','-e',source,...args],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',value=>{stdout+=value;});child.stderr.on('data',value=>{stderr+=value;});
  child.stdin.end(stdin);
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(`Worker exit ${code}: ${stderr}`)));});
}
test('event stores only hashed identifiers and activity metadata',()=>{
  const value=sanitizeEvent(payload('UserPromptSubmit'),100);
  assert.equal(value.session.length,64);assert.equal(value.active,true);
  assert(!JSON.stringify(value).includes('DO NOT STORE'));assert(!JSON.stringify(value).includes('PRIVATE'));
  assert.equal(sanitizeEvent(payload('Unknown')),null);assert.equal(sanitizeEvent({}),null);
  assert.equal(sanitizeEvent(payload('SubagentStart')),null);
  const child=sanitizeEvent(payload('SubagentStart','session-A','turn-A','child-A'),100);
  assert.equal(child.active,true);assert.notEqual(child.agent,value.agent);
  assert(!JSON.stringify(child).includes('child-A'));
});
test('multiple sessions, delayed stop, interrupt, expiry',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  const act=(event,session,turn,now)=>applyEvent(payload(event,session,turn),{dataDir,stateFile,now});
  await act('UserPromptSubmit','A','A1',1000);await act('UserPromptSubmit','B','B1',1100);
  await act('Stop','A','A1',1200);assert.equal((await aggregate(dataDir,1300)).activeSessionCount,1);
  await act('UserPromptSubmit','B','B2',1400);
  assert.equal((await act('Stop','B','B1',1500)).accepted,true);
  assert.equal((await aggregate(dataDir,1600)).isWorking,true);
  await act('Interrupt','B','B2',1700);assert.equal((await aggregate(dataDir,1800)).isWorking,false);
  await act('UserPromptSubmit','A','A2',2000);assert.equal((await aggregate(dataDir,2000+ACTIVITY_TTL)).isWorking,false);
  const state=JSON.parse(await readFile(stateFile));assert.equal(state.source,'codex-hooks');assert.equal(state.remainingPercent,null);
});
test('quota unknown, stale, out of range and false zero handling',()=>{
  const good={remainingPercent:0,updatedAt:100,expiresAt:1000};
  assert.equal(readQuotaValue(good,500),0);assert.equal(readQuotaValue(good,1000),null);
  assert.equal(readQuotaValue({...good,remainingPercent:null},500),null);
  assert.equal(readQuotaValue({...good,remainingPercent:101},500),null);
  assert.equal(readQuotaValue(null,500),null);
});
test('actual bridge writes valid state and does not persist hook body',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  await writeFile(path.join(dataDir,'quota.json'),JSON.stringify({remainingPercent:63,updatedAt:1000,expiresAt:9000}));
  const out=await applyEvent(payload('PreToolUse'),{dataDir,stateFile,now:2000});
  const state=JSON.parse(await readFile(stateFile));
  assert.equal(out.accepted,true);assert.equal(state.isWorking,true);assert.equal(state.remainingPercent,63);
  const files=await readdir(path.join(dataDir,'activity'));
  assert(!String(await readFile(path.join(dataDir,'activity',files[0]))).includes('PRIVATE'));
});
test('subagent work survives parent stop, SessionEnd clears the whole session',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  const act=(event,agent,now)=>applyEvent(payload(event,'shared-session','shared-turn',agent),{dataDir,stateFile,now});
  await act('UserPromptSubmit',undefined,1000);
  // Neither child calls a tool; their SubagentStart events must be sufficient.
  await act('SubagentStart','child-A',1100);await act('SubagentStart','child-B',1150);
  assert.equal((await aggregate(dataDir,1160)).activeAgentCount,3);
  await act('Stop',undefined,1200);assert.equal((await aggregate(dataDir,1300)).activeAgentCount,2);
  await act('SubagentStop','child-A',1400);assert.equal((await aggregate(dataDir,1500)).activeAgentCount,1);
  await act('SubagentStop','child-B',1510);assert.equal((await aggregate(dataDir,1520)).isWorking,false);
  await act('SubagentStart','child-C',1600);await act('SessionEnd',undefined,1700);
  assert.equal((await aggregate(dataDir,1800)).isWorking,false);
});
test('snapshot retains actual activity expiry even when only 1ms remains',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  await applyEvent(payload('UserPromptSubmit','A','A1'),{dataDir,stateFile,now:1000});
  await applyEvent(payload('UserPromptSubmit','B','B1'),{dataDir,stateFile,now:1100});
  const realExpiry=1000+ACTIVITY_TTL;
  const result=await applyEvent(payload('Stop','B','B1'),{dataDir,stateFile,now:realExpiry-1});
  assert.equal(result.state.isWorking,true);assert.equal(result.state.expiresAt,realExpiry);
  assert.equal(result.state.expiresAt-result.state.updatedAt,1);
  assert.equal(normalizeState(result.state,realExpiry).connection,'expired');
  assert.equal((await aggregate(dataDir,realExpiry)).isWorking,false);
});
test('late event for the same agent/turn cannot reopen a newer terminal record',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  await applyEvent(payload('Stop'),{dataDir,stateFile,now:2000});
  const late=await applyEvent(payload('PreToolUse'),{dataDir,stateFile,now:1000});
  assert.equal(late.stored,false);assert.equal(late.state.isWorking,false);
});
test('same-process parallel calls queue before taking a synchronous SQLite lock',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  await Promise.all(Array.from({length:12},(_,index)=>applyEvent(payload('UserPromptSubmit',`S${index}`),{dataDir,stateFile,now:1000})));
  assert.equal((await aggregate(dataDir,1500)).activeSessionCount,12);
  await Promise.all(Array.from({length:12},(_,index)=>applyEvent(payload('Stop',`S${index}`),{dataDir,stateFile,now:2000})));
  assert.equal((await aggregate(dataDir,2500)).isWorking,false);
  assert.equal(JSON.parse(await readFile(stateFile)).isWorking,false);
});
test('real child processes serialize event, aggregation and shared snapshot writes',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  await Promise.all(Array.from({length:4},(_,index)=>applyEvent(payload('UserPromptSubmit',`old-${index}`),{dataDir,stateFile,now:1000})));
  const source=`const [url,dataDir,stateFile,event,now]=process.argv.slice(1);
    const {applyEvent}=await import(url);
    await applyEvent(JSON.parse(event),{dataDir,stateFile,now:Number(now)});`;
  await Promise.all(Array.from({length:8},(_,index)=>worker(source,[moduleUrl,dataDir,stateFile,
    JSON.stringify(payload(index<4?'Stop':'UserPromptSubmit',index<4?`old-${index}`:`new-${index}`)),String(2000)])));
  const actual=await aggregate(dataDir,3000),saved=JSON.parse(await readFile(stateFile));
  assert.equal(actual.activeSessionCount,4);assert.equal(saved.isWorking,actual.isWorking);
  assert.equal(saved.expiresAt,actual.expiresAt);
});
test('busy lock times out inside hook budget and a killed owner releases it without deleting a lock',async()=>{
  const dataDir=await fixture(),stateFile=path.join(dataDir,'state.json');
  const source=`const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');
    process.stdout.write('LOCKED');process.stdin.resume();`;
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',source,
    path.join(dataDir,'activity-lock.sqlite')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const exited=once(child,'exit');
  try {
    const [ready]=await once(child.stdout,'data');assert.equal(String(ready),'LOCKED');
    const started=performance.now();
    await assert.rejects(applyEvent(payload('UserPromptSubmit'),{dataDir,stateFile,now:1000}),/locked/);
    const elapsed=performance.now()-started;assert(elapsed>=900&&elapsed<2500,`lock waited ${elapsed}ms`);
    await assert.rejects(readFile(stateFile),{code:'ENOENT'});
    child.kill();await exited;
    const result=await applyEvent(payload('UserPromptSubmit'),{dataDir,stateFile,now:2000});
    assert.equal(result.state.isWorking,true);
  } finally {if(child.exitCode===null&&!child.killed)child.kill();}
});
test('importing aggregate and quota does not load SQLite or emit its experimental warning',async()=>{
  const result=await worker(`await import(process.argv[1]); await import(process.argv[2]);`,[moduleUrl,
    pathToFileURL(path.resolve('outputs/dragon-codex-bridge-v4/quota.mjs')).href],{suppressExperimentalWarning:false});
  assert.equal(result.stdout,'');assert.equal(result.stderr,'');
});
