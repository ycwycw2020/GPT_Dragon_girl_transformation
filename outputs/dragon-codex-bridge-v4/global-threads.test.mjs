import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,appendFile,symlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createGlobalThreadReader,createTaskTranscriptReader,indexedRolloutPath,globalThreadMetadata,isRootThread,historyTaskState,GLOBAL_THREAD_TAIL_BYTES} from './global-threads.mjs';

const base=path.resolve('work/global-threads-tests');await mkdir(base,{recursive:true});
const now=Date.parse('2026-10-08T06:00:00Z'),iso=value=>new Date(value).toISOString();
const uuid=index=>`01999999-9999-7999-8999-${String(index).padStart(12,'0')}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
const line=value=>JSON.stringify(value)+'\n';
async function fixture(){
  const home=await mkdtemp(path.join(base,'home-')),sessions=path.join(home,'sessions','2025','01','01');
  await mkdir(sessions,{recursive:true});
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,title TEXT,first_user_message TEXT,cwd TEXT,rollout_path TEXT,source TEXT,agent_path TEXT,archived INTEGER,updated_at_ms INTEGER,recency_at_ms INTEGER)');
  return {home,sessions,db,async add(index,{name='会话 '+index,cwd='D:/different-project-'+index,source='vscode',agent_path=null,archived=0,file=path.join(sessions,`rollout-ancient-${uuid(index)}.jsonl`),time=now-index}={}){
    await writeFile(file,line({timestamp:iso(time),type:'event_msg',payload:{type:'token_count'}}));
    db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(uuid(index),name,'PRIVATE_PROMPT','PRIVATE_FIRST_MESSAGE',cwd,file,source,agent_path,archived,time,time);
    return file;
  }};
}

test('root identity uses only sidebar name; prompts and subagent metadata cannot become menu names',()=>{
  const row={id:uuid(1),name:'我的\u202e项目\n名字',cwd:'D:/outside-project',updated_at_ms:null,updated_at:123};
  Object.defineProperty(row,'title',{get(){throw new Error('Legacy prompt title was accessed');}});
  Object.defineProperty(row,'first_user_message',{get(){throw new Error('User body was accessed');}});
  const metadata=globalThreadMetadata(row);
  assert.equal(metadata.id,hash(uuid(1)));assert.equal(metadata.name,'我的 项目 名字');assert.equal(metadata.updatedAt,123000);
  assert.equal(isRootThread({...row,source:JSON.stringify({subagent:{other:'guardian'}}),agent_path:null}),false);
  assert.equal(isRootThread({...row,source:'subagent:fork'}),false);
  assert.equal(isRootThread({...row,agent_path:'root/child'}),false);
  assert.equal(isRootThread({...row,archived:1}),false);
  assert.equal(isRootThread({...row,id:'not-a-thread'}),false);
});

test('read-only discovery spans arbitrary C and D projects, old rollout dates and multiple chats in one directory',async()=>{
  const f=await fixture();
  await f.add(1,{name:'当前工程',cwd:'C:/Users/test/Documents/Codex/2026-10-06/current'});
  await f.add(2,{name:'D盘工程',cwd:'D:/HuaweiMoveData/arbitrary'});
  await f.add(3,{name:'同目录另一聊天',cwd:'D:/HuaweiMoveData/arbitrary'});
  await f.add(4,{source:JSON.stringify({subagent:{other:'guardian'}})});
  await f.add(5,{agent_path:'root/child'});await f.add(6,{archived:1});
  f.db.close();
  const index=path.join(f.home,'state_5.sqlite'),before=await readFile(index);
  const read=createGlobalThreadReader({codexHome:f.home,readActivity:async(_file,{now})=>({active:true,statusKnown:true,turn:hash('turn'),turnActive:true,turnStartedAt:now-10,updatedAt:now,expiresAt:now+900000,label:'运行测试',stale:false})});
  const snapshot=await read(now);
  assert.equal(snapshot.available,true);assert.equal(snapshot.tasks.length,3);
  assert(snapshot.tasks.some(task=>task.cwd.startsWith('D:/HuaweiMoveData')));
  assert(snapshot.tasks.every(task=>task.active&&task.statusKnown&&task.source==='codex-local-index'));
  assert.equal(new Set(snapshot.tasks.map(task=>task.id)).size,3);
  assert.deepEqual(await readFile(index),before,'Discovery must leave the Codex database byte-identical');
  assert(!JSON.stringify(snapshot).includes('PRIVATE'));assert(!JSON.stringify(snapshot).includes('rollout-ancient'));
});

test('source filter precedes root limit so hundreds of guardian agents cannot hide the actual chats',async()=>{
  const f=await fixture();await f.add(1,{time:now-10000});
  const file=path.join(f.sessions,`rollout-${uuid(1)}.jsonl`),insert=f.db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(let i=2;i<252;i++)insert.run(uuid(i),'guardian','PRIVATE','PRIVATE','C:/same',file,JSON.stringify({subagent:{other:'guardian'}}),null,0,now,now);
  f.db.close();
  const snapshot=await createGlobalThreadReader({codexHome:f.home,maxThreads:2,readActivity:null})(now);
  assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.tasks[0].threadId,uuid(1));
  assert.equal(snapshot.tasks[0].status,'unknown');assert.equal(snapshot.tasks[0].terminalEvent,null);
});

test('older supported schema fails safely without reading legacy title or inventing status',async()=>{
  const home=await mkdtemp(path.join(base,'old-')),sessions=path.join(home,'sessions');await mkdir(sessions);
  const file=path.join(sessions,`rollout-${uuid(1)}.jsonl`);await writeFile(file,'');
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT,title TEXT,updated_at INTEGER)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?)').run(uuid(1),file,'PRIVATE BODY',123);db.close();
  const snapshot=await createGlobalThreadReader({codexHome:home,readActivity:null})(now);
  assert.equal(snapshot.available,true);assert.equal(snapshot.tasks.length,1);
  assert.equal(snapshot.tasks[0].name,'');assert.equal(snapshot.tasks[0].updatedAt,123000);
  assert.equal(snapshot.tasks[0].statusKnown,false);assert.equal(snapshot.tasks[0].active,false);
  assert.equal((await createGlobalThreadReader({codexHome:path.join(home,'missing')})(now)).available,false);
});

test('two-second cache coalesces concurrent reads and discovers newly indexed chats on the next refresh',async()=>{
  const f=await fixture();await f.add(1);let calls=0;
  const read=createGlobalThreadReader({codexHome:f.home,readActivity:async()=>{calls++;return null;}});
  const results=await Promise.all(Array.from({length:12},()=>read(now)));
  assert(results.every(value=>value.tasks.length===1));assert.equal(calls,1);
  results[0].tasks[0].name='MUTATED';assert.notEqual((await read(now+1)).tasks[0].name,'MUTATED');
  await f.add(2);assert.equal((await read(now+1999)).tasks.length,1);
  assert.equal((await read(now+2000)).tasks.length,2);assert.equal(calls,3);f.db.close();
});

test('only indexed rollout files inside the real sessions tree can be observed',async()=>{
  const home=await mkdtemp(path.join(base,'safe-')),sessions=path.join(home,'sessions'),outside=path.join(home,'outside');
  await mkdir(sessions);await mkdir(outside);
  const file=path.join(sessions,`rollout-old-${uuid(9)}-${uuid(1)}.jsonl`),escape=path.join(outside,'rollout-private.jsonl');
  await writeFile(file,'');await writeFile(escape,'');
  assert.equal(await indexedRolloutPath(file,{codexHome:home}),file);
  assert.equal(await indexedRolloutPath(escape,{codexHome:home}),null);
  const link=path.join(sessions,'escape');await symlink(outside,link,process.platform==='win32'?'junction':'dir');
  assert.equal(await indexedRolloutPath(path.join(link,'rollout-private.jsonl'),{codexHome:home}),null);
  if(process.platform==='win32')assert.equal(await indexedRolloutPath('\\\\?\\'+file,{codexHome:home}),file);
});

test('bounded metadata observations survive lifecycle events buried by a huge tool result without retaining bodies',async()=>{
  const home=await mkdtemp(path.join(base,'tail-')),sessions=path.join(home,'sessions');await mkdir(sessions);
  const file=path.join(sessions,`rollout-${uuid(1)}.jsonl`),turn=uuid(8);
  const reasoning=time=>({timestamp:iso(time),type:'event_msg',payload:{type:'item_completed',turn_id:turn,item:{type:'Reasoning',text:'PRIVATE_REASONING'}}});
  await writeFile(file,line({timestamp:iso(now),type:'event_msg',payload:{type:'task_started',turn_id:turn,started_at:iso(now)}})
    +line({timestamp:iso(now+1),type:'response_item',payload:{type:'custom_tool_call_output',output:'PRIVATE_TOOL'.repeat(GLOBAL_THREAD_TAIL_BYTES)}})+line(reasoning(now+2)));
  const read=createTaskTranscriptReader({codexHome:home}),first=await read(file,{now:now+10});
  assert.equal(first.active,true,'Fresh Reasoning completion metadata can confirm activity without reading its text');
  assert.equal(first.turnStartedAt,null,'Buried lifecycle boundaries must not be fabricated');
  await appendFile(file,line({timestamp:iso(now+1000),type:'event_msg',payload:{type:'task_complete',turn_id:turn,started_at:iso(now),completed_at:iso(now+1000)}})
    +line({timestamp:iso(now+1001),type:'response_item',payload:{type:'custom_tool_call_output',output:'PRIVATE_TOOL'.repeat(GLOBAL_THREAD_TAIL_BYTES)}}));
  const finished=await read(file,{now:now+1100});assert.equal(finished.active,false);assert.equal(finished.terminalEvent,'Stop');
  assert(!JSON.stringify(finished).includes('PRIVATE'));assert.equal(finished.turn,hash(turn));
  const before=await stat(file);await read(file,{now:now+1200});assert.equal((await stat(file)).size,before.size);
});

test('thread history establishes buried turn boundaries and completed turns beat delayed tool activity',async()=>{
  const f=await fixture(),file=await f.add(1);
  await writeFile(file,line({timestamp:iso(now-100),type:'event_msg',payload:{type:'item_completed',turn_id:uuid(8),item:{type:'Reasoning',text:'PRIVATE'}}}));
  f.db.close();
  const historyFile=path.join(f.home,'thread_history_1.sqlite'),db=new DatabaseSync(historyFile);
  db.exec('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER,PRIMARY KEY(thread_id,turn_id))');
  const insert=db.prepare('INSERT INTO thread_turns VALUES(?,?,?,?,?,?)');
  insert.run(uuid(1),uuid(8),2,'inProgress',(now-3600000)/1000,null);
  // A timestamp can be newer while its rollout ordinal is older. Latest turn
  // selection must use the explicit projection order, not wall-clock time.
  insert.run(uuid(1),uuid(7),1,'completed',(now-1000)/1000,now/1000);db.close();
  const before=await readFile(historyFile),snapshot=await createGlobalThreadReader({codexHome:f.home})(now);
  assert.equal(snapshot.historyAvailable,true);assert.equal(snapshot.tasks[0].turn,hash(uuid(8)));
  assert.equal(snapshot.tasks[0].turnStartedAt,now-3600000);assert.equal(snapshot.tasks[0].active,true);
  assert.equal(snapshot.tasks[0].activitySource,'codex-history');assert.deepEqual(await readFile(historyFile),before);
  const update=new DatabaseSync(historyFile);update.prepare('UPDATE thread_turns SET status=?,completed_at=? WHERE turn_id=?').run('completed',now/1000,uuid(8));update.close();
  await appendFile(file,line({timestamp:iso(now+100),type:'event_msg',payload:{type:'item_completed',turn_id:uuid(8),item:{type:'Reasoning',text:'LATE_PRIVATE'}}}));
  const completed=(await createGlobalThreadReader({codexHome:f.home})(now+200)).tasks[0];
  assert.equal(completed.active,false);assert.equal(completed.terminalEvent,'Stop');assert.equal(completed.stale,false);
  assert.equal(completed.updatedAt,now);assert.equal(completed.statusKnown,true);assert.equal(completed.activitySource,'codex-history');
});

test('projection lag preserves genuinely newer turns, terminal rollout metadata and waits',()=>{
  const start=now-1000,record={turn_id:uuid(8),status:'inProgress',started_at:start/1000,completed_at:null};
  const finished={turn:hash(uuid(8)),active:false,statusKnown:true,terminalEvent:'Stop',updatedAt:now,taskObservedAt:now,stale:false};
  assert.equal(historyTaskState(record,finished,now).activitySource,'transcript');
  const newer={turn:hash(uuid(9)),turnStartedAt:now,active:true,statusKnown:true,updatedAt:now,taskObservedAt:now,expiresAt:now+900000,stale:false};
  assert.equal(historyTaskState({...record,status:'completed',completed_at:now/1000},newer,now).turn,newer.turn);
  const lateOldItem={...newer,turnStartedAt:start-1000};
  assert.equal(historyTaskState({...record,status:'completed',completed_at:now/1000},lateOldItem,now).turn,hash(uuid(8)));
  assert.equal(historyTaskState({...record,status:'completed',completed_at:now/1000},{...newer,turnStartedAt:null},now).turn,hash(uuid(8)));
  const waiting={...newer,turn:hash(uuid(8)),waitingForInput:true,label:'等待你的回答'};
  assert.equal(historyTaskState(record,waiting,now).waitingForInput,true);
  const stale=historyTaskState({...record,started_at:(now-3600000)/1000},null,now);
  assert.equal(stale.statusKnown,true);assert.equal(stale.stale,true);assert.equal(stale.active,false);
  assert.equal(historyTaskState({...record,completed_at:(start-1000)/1000},null,now),null);
});

test('archive suppression exports only archived root UUIDs and cannot exclude an active chat sharing its directory',async()=>{
  const f=await fixture();
  await f.add(1,{name:'仍在工作',cwd:'D:/shared-directory'});
  await f.add(2,{name:'ARCHIVED_PRIVATE_NAME',cwd:'D:/shared-directory',archived:1});
  await f.add(3,{archived:1,source:JSON.stringify({subagent:{other:'guardian'}})});
  await f.add(4,{archived:1,agent_path:'root/child'});
  f.db.close();
  const index=path.join(f.home,'state_5.sqlite'),before=await readFile(index);
  const read=createGlobalThreadReader({codexHome:f.home,readActivity:async()=>({active:true,statusKnown:true,turn:hash(uuid(8)),turnActive:true,turnStartedAt:now-100,updatedAt:now,expiresAt:now+900000,stale:false,label:'正在思考'})});
  const value=await read(now);
  assert.equal(value.available,true);assert.equal(value.tasks.length,1);assert.equal(value.tasks[0].active,true);
  assert.deepEqual(value.excludedThreadIds,[uuid(2)]);
  assert(!value.excludedThreadIds.includes(value.tasks[0].threadId));
  assert(!JSON.stringify(value).includes('ARCHIVED_PRIVATE_NAME'));
  assert.deepEqual(await readFile(index),before);
});

test('unavailable or archive-less metadata never invents exclusion identities',async()=>{
  const missing=await createGlobalThreadReader({codexHome:path.join(base,'missing-index')})(now);
  assert.equal(missing.available,false);assert.deepEqual(missing.excludedThreadIds,[]);
  const home=await mkdtemp(path.join(base,'no-archive-')),sessions=path.join(home,'sessions');await mkdir(sessions);
  const file=path.join(sessions,`rollout-${uuid(1)}.jsonl`);await writeFile(file,'');
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?)').run(uuid(1),file);db.close();
  const value=await createGlobalThreadReader({codexHome:home,readActivity:null})(now);
  assert.equal(value.available,true);assert.equal(value.tasks.length,1);assert.deepEqual(value.excludedThreadIds,[]);
});
