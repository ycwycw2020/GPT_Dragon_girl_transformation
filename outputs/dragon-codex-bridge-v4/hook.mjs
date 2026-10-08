import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STATE_FILE, normalizeState } from '../dragon-companion-app-v4/state-bridge.mjs';
import { taskDetails, readTaskDetails } from './task-details.mjs';
import {nextNotice,readNotice} from './question-notice.mjs';
import {assistantActivityFromHook,readAssistantActivity,transcriptPathFromHook,readAssistantTranscript} from './assistant-activity.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const DATA=path.resolve(HERE,'../../work/codex-bridge-v4');
const ACTIVE_EVENTS=new Set(['UserPromptSubmit','SubagentStart','PreToolUse','PostToolUse']);
const END_EVENTS=new Set(['Stop','SubagentStop','Interrupt','SessionEnd']);
export const ACTIVITY_TTL=15*60*1000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const processQueues=new Map();
let sqliteModule;
// SQLite owns this lock: process exit/termination releases it automatically.
// No PID guessing, lock-file deletion, or stale-owner reclamation is needed.
async function withDatabaseLock(dataDir,operation) {
  await mkdir(dataDir,{recursive:true});
  const {DatabaseSync}=await (sqliteModule??=import('node:sqlite'));
  const db=new DatabaseSync(path.join(dataDir,'activity-lock.sqlite'));
  let locked=false;
  try {
    db.exec('PRAGMA busy_timeout=1200; BEGIN IMMEDIATE');locked=true;
    return await operation();
  } finally {
    try {if(locked)db.exec('ROLLBACK');}finally{db.close();}
  }
}
function withActivityLock(dataDir,operation) {
  const key=path.resolve(dataDir),previous=processQueues.get(key)??Promise.resolve();
  // DatabaseSync must never block another async owner in this same event loop.
  const run=previous.then(()=>withDatabaseLock(key,operation));
  const tail=run.catch(()=>{});processQueues.set(key,tail);
  return run.finally(()=>{if(processQueues.get(key)===tail)processQueues.delete(key);});
}
async function atomic(file,value) {
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(value));await rename(temporary,file);
}
export function sanitizeEvent(payload,now=Date.now()) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const event=payload.hook_event_name;
  if(!ACTIVE_EVENTS.has(event)&&!END_EVENTS.has(event))return null;
  const session=payload.session_id,turn=payload.turn_id,agent=payload.agent_id;
  if(typeof session!=='string'||!session||session.length>512)return null;
  if(event!=='SessionEnd'&&(typeof turn!=='string'||!turn||turn.length>512))return null;
  if(agent!==undefined&&(typeof agent!=='string'||!agent||agent.length>512))return null;
  if((event==='SubagentStart'||event==='SubagentStop')&&agent===undefined)return null;
  if(event==='SessionEnd'&&agent!==undefined)return null;
  if(!Number.isFinite(now))return null;
  return {version:2,session:hash(session),agent:hash(agent===undefined?'root':'agent:'+agent),
    turn:turn?hash(turn):null,active:ACTIVE_EVENTS.has(event),
    updatedAt:now,expiresAt:now+ACTIVITY_TTL,event,display:taskDetails(payload),
    assistantActivity:assistantActivityFromHook(payload,now),transcriptPath:transcriptPathFromHook(payload)};
}
export function readQuotaValue(value,now=Date.now()) {
  if(!value||!Number.isFinite(value.remainingPercent)||value.remainingPercent<0||value.remainingPercent>100
    ||!Number.isFinite(value.updatedAt)||!Number.isFinite(value.expiresAt)
    ||value.updatedAt>now+60000||value.expiresAt<=now||value.expiresAt<=value.updatedAt)return null;
  return value.remainingPercent;
}
export async function aggregate(dataDir=DATA,now=Date.now(),{assistantReader=readAssistantTranscript}={}) {
  const records=[];
  const entries=await readdir(path.join(dataDir,'activity')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  for(const name of entries) {
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    try {
      const value=JSON.parse(await readFile(path.join(dataDir,'activity',name),'utf8'));
      if(value?.version===2&&/^[a-f0-9]{64}$/.test(value.session)&&/^[a-f0-9]{64}$/.test(value.agent)
        &&(ACTIVE_EVENTS.has(value.event)||END_EVENTS.has(value.event))
        &&Number.isFinite(value.updatedAt)&&Number.isFinite(value.expiresAt)
        &&value.updatedAt<=now+60000&&value.expiresAt>value.updatedAt
        &&value.expiresAt<=value.updatedAt+ACTIVITY_TTL)records.push(value);
    } catch { /* A damaged record cannot keep the pet working forever. */ }
  }
  const endedSessions=new Map();
  for(const value of records)if(value.event==='SessionEnd')endedSessions.set(value.session,Math.max(endedSessions.get(value.session)??0,value.updatedAt));
  const active=records.filter(value=>value.active===true&&value.expiresAt>now&&value.updatedAt<=now+60000
    &&value.updatedAt>(endedSessions.get(value.session)??0));
  let quota=null;
  try {quota=readQuotaValue(JSON.parse(await readFile(path.join(dataDir,'quota.json'),'utf8')),now);}catch{}
  const sessions=new Map();
  for(const value of records.filter(v=>v.updatedAt>now-86400000).sort((a,b)=>b.updatedAt-a.updatedAt)) {
    if(!sessions.has(value.session))sessions.set(value.session,value);
  }
  // A completed parent must not hide a still-running child in its session.
  for(const value of [...active].sort((a,b)=>a.updatedAt-b.updatedAt))sessions.set(value.session,value);
  const tasks=await Promise.all([...sessions.values()].map(async value=>{
    const running=active.some(a=>a.session===value.session),display=readTaskDetails(value.display);
    // A child starting or finishing must not appear to be a new user turn.
    // Prefer the newest confirmed root turn start over late events for old turns.
    const roots=records.filter(r=>r.session===value.session&&r.agent===hash('root')&&r.turn)
      .sort((a,b)=>(b.turnStartedAt??0)-(a.turnStartedAt??0)||b.updatedAt-a.updatedAt);
    const root=roots[0],turn=/^[a-f0-9]{64}$/.test(root?.turn??'')?root.turn:null;
    const turnStartedAt=Number.isSafeInteger(root?.turnStartedAt)&&root.turnStartedAt>=0?root.turnStartedAt:null;
    const turnActive=!!root&&active.some(a=>a.session===root.session&&a.agent===root.agent&&a.turn===root.turn);
    const stale=value.active&&!running;
    // Only a confirmed terminal root turn (or session end) proves completion.
    // A child stopping while an unconfirmed parent has expired does not.
    const endedAt=endedSessions.get(value.session)??0;
    const terminal=root&&['Stop','Interrupt'].includes(root.event)?root:null;
    const terminalEvent=!running&&!stale?(endedAt>=Math.max(root?.updatedAt??0,value.updatedAt)?'SessionEnd':
      terminal&&terminal.expiresAt>now?terminal.event:null):null;
    let assistantActivity=readAssistantActivity(root?.assistantActivity,now);
    if(root?.transcriptPath||root?.display?.threadId){
      const observed=await assistantReader(root.transcriptPath,{since:root.turnStartedAt??root.updatedAt,now,threadId:readTaskDetails(root.display).threadId}).catch(()=>null);
      const safe=readAssistantActivity(observed,now);
      if(safe&&(!assistantActivity||safe.updatedAt>assistantActivity.updatedAt))assistantActivity=safe;
    }
    let questionNotice=null;
    try {questionNotice=readNotice(JSON.parse(await readFile(path.join(dataDir,'question-notices',value.session+'.json'),'utf8')).notice,now);}catch{}
    return {id:value.session,turn,turnStartedAt,turnActive,terminalEvent,questionNotice,assistantActivity,...display,active:running,updatedAt:value.updatedAt,expiresAt:value.expiresAt,
      label:stale?'连接超时 · 等待新状态':display.label,stale};
  }));
  tasks.sort((a,b)=>Number(b.active)-Number(a.active)||b.updatedAt-a.updatedAt);
  return {isWorking:active.length>0,remainingPercent:quota,activeSessionCount:new Set(active.map(v=>v.session)).size,
    tasks,
    activeAgentCount:new Set(active.map(v=>v.session+'\0'+v.agent)).size,
    expiresAt:active.length?Math.max(...active.map(value=>value.expiresAt)):now+ACTIVITY_TTL};
}
export async function applyEvent(payload,{dataDir=DATA,stateFile=DEFAULT_STATE_FILE,now}={}) {
  const event=sanitizeEvent(payload,now??Date.now());if(!event)return {accepted:false};
  // Child hooks share a session ID, so agent and turn are separate namespaces.
  const key=hash(event.session+'\0'+(event.event==='SessionEnd'?'session-end':event.agent+'\0'+event.turn));
  const file=path.join(dataDir,'activity',key+'.json');
  return withActivityLock(dataDir,async()=>{
    let previous=null;
    try {previous=JSON.parse(await readFile(file,'utf8'));}catch{}
    // Keep the root prompt boundary across Pre/PostToolUse. A tool event alone
    // cannot prove when a legacy or previously unseen turn actually started.
    event.turnStartedAt=Number.isSafeInteger(previous?.turnStartedAt)?previous.turnStartedAt:
      event.event==='UserPromptSubmit'?event.updatedAt:null;
    if(!event.display.cwd&&previous?.display?.cwd)event.display.cwd=readTaskDetails(previous.display).cwd;
    if(!event.display.threadId&&previous?.display?.threadId)event.display.threadId=readTaskDetails(previous.display).threadId;
    if(!event.transcriptPath&&event.agent===hash('root'))event.transcriptPath=transcriptPathFromHook({transcript_path:previous?.transcriptPath});
    if(!event.assistantActivity)event.assistantActivity=readAssistantActivity(previous?.assistantActivity,event.updatedAt);
    // A delayed invocation must not overwrite a newer record for this exact turn.
    // At equal millisecond timestamps, a terminal record wins conservatively.
    const obsolete=previous?.updatedAt>event.updatedAt
      ||previous?.updatedAt===event.updatedAt&&previous.active===false&&event.active;
    if(!obsolete){
      await atomic(file,event);
      const noticeFile=path.join(dataDir,'question-notices',event.session+'.json');
      let saved={updatedAt:0,notice:null};
      try {saved=JSON.parse(await readFile(noticeFile,'utf8'));}catch{}
      if(event.updatedAt>=saved.updatedAt){
        const notice=nextNotice(saved.notice,payload,event.updatedAt);
        if(notice||saved.notice)await atomic(noticeFile,{updatedAt:event.updatedAt,notice});
      }
    }
    const observedAt=now??Date.now(),snapshot=await aggregate(dataDir,observedAt);
    // Preserve the latest real activity expiry, including a remainder below 1s.
    // writeState's manual-CLI 1000ms minimum must not extend an existing record.
    const state={isWorking:snapshot.isWorking,remainingPercent:snapshot.remainingPercent,
      updatedAt:observedAt,expiresAt:snapshot.expiresAt,source:'codex-hooks'};
    normalizeState(state,observedAt);await atomic(stateFile,state);
    return {accepted:true,stored:!obsolete,activeSessionCount:snapshot.activeSessionCount,
      activeAgentCount:snapshot.activeAgentCount,state};
  });
}

async function main() {
  let chunks=[],bytes=0;
  for await(const chunk of process.stdin) {
    bytes+=chunk.length;if(bytes>8*1024*1024)return;
    chunks.push(chunk);
  }
  let eventName;
  try {
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    eventName=payload?.hook_event_name;
    await applyEvent(payload);
  } catch { /* A companion must never block or change Codex task execution. */ }
  if(eventName==='Stop'||eventName==='SubagentStop')process.stdout.write('{}');
  // No context, approvals, continuation requests or user content is emitted.
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
