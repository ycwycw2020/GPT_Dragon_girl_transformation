// Read the local Codex thread index without changing it. Project directories
// are display metadata, never a discovery boundary. Message bodies, prompts,
// credentials, and the legacy title/first_user_message fields are not queried.
import {createHash} from 'node:crypto';
import {lstat,realpath,open} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {summarizeTaskTail} from './task-transcript.mjs';

export const GLOBAL_THREAD_REFRESH_MS=2000;
export const GLOBAL_THREAD_LIMIT=200;
export const GLOBAL_THREAD_TAIL_BYTES=64*1024;
const ACTIVITY_TTL=15*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest=value=>createHash('sha256').update(value).digest('hex');
const clean=(value,max)=>typeof value==='string'?Array.from(value.replace(/[\x00-\x1f\x7f-\x9f\u2028-\u202e\u2066-\u2069]/g,' ').trim()).slice(0,max).join(''):'';
const within=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const integer=value=>value!==null&&value!==undefined&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;

function normalWindowsPath(value){
  // Desktop metadata may use the ordinary Win32 extended-path spelling.
  if(process.platform!=='win32'||typeof value!=='string')return value;
  if(/^\\\\\?\\UNC\\/i.test(value))return '\\\\'+value.slice(8);
  return /^\\\\\?\\/.test(value)?value.slice(4):value;
}

export function isRootThread(record){
  if(!record||typeof record!=='object'||!UUID.test(record.id??''))return false;
  if(record.archived===true||record.archived===1||record.archived==='1')return false;
  if(typeof record.agent_path==='string'&&record.agent_path.trim())return false;
  if(record.agent_path!==undefined&&record.agent_path!==null&&typeof record.agent_path!=='string')return false;
  const source=record.source;
  if(typeof source==='string'){
    if(/^subagent(?:$|[:/])/i.test(source.trim()))return false;
    try{const value=JSON.parse(source);if(value&&typeof value==='object'&&Object.hasOwn(value,'subagent'))return false;}catch{/* Ordinary sources include vscode, cli and exec. */}
  }else if(source&&typeof source==='object'&&Object.hasOwn(source,'subagent'))return false;
  return true;
}

export function globalThreadMetadata(record){
  if(!isRootThread(record))return null;
  const threadId=record.id.toLowerCase();
  // `name` is the user's Codex sidebar title. `title` is intentionally ignored:
  // on current Codex builds it contains the full first prompt, not that title.
  const name=clean(record.name,160),cwd=clean(normalWindowsPath(record.cwd),1024);
  const updatedAt=integer(record.updated_at_ms)??(integer(record.updated_at)===null?0:integer(record.updated_at)*1000);
  const recencyAt=integer(record.recency_at_ms)??updatedAt;
  return {id:digest(threadId),threadId,name,cwd,updatedAt,recencyAt};
}

export async function indexedRolloutPath(file,{codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}={}){
  if(typeof file!=='string'||file.length>4096)return null;
  const normalized=normalWindowsPath(file),home=normalWindowsPath(codexHome);
  if(!path.isAbsolute(normalized)||!/^rollout-[^\\/]+\.jsonl$/i.test(path.basename(normalized)))return null;
  const root=path.resolve(home,'sessions'),resolved=path.resolve(normalized);
  if(!within(root,resolved))return null;
  try{
    const [actualRoot,actualFile,info]=await Promise.all([realpath(root),realpath(resolved),lstat(resolved)]);
    if(info.isSymbolicLink()||!info.isFile()||!within(actualRoot,actualFile))return null;
    return actualFile;
  }catch{return null;}
}

export function createTaskTranscriptReader({codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),maxBytes=GLOBAL_THREAD_TAIL_BYTES}={}){
  const cache=new Map(),pending=new Map();
  const budget=Math.max(1024,Math.min(GLOBAL_THREAD_TAIL_BYTES,Number.isFinite(maxBytes)?Math.floor(maxBytes):GLOBAL_THREAD_TAIL_BYTES));
  async function inspect(file,now){
    const safeFile=await indexedRolloutPath(file,{codexHome});if(!safeFile)return null;
    const handle=await open(safeFile,'r');
    try{
      const stat=await handle.stat();if(!stat.isFile())return null;
      const saved=cache.get(safeFile),old=saved&&stat.size>=saved.size&&stat.ino===saved.ino
        &&(stat.size>saved.size||stat.mtimeMs===saved.mtimeMs)?saved:null;
      if(old&&stat.size===old.size&&stat.mtimeMs===old.mtimeMs){
        old.summary=summarizeTaskTail('',{now,previous:old.summary});return old.summary;
      }
      let previous=old?.summary??null;
      // A large tool result can bury recent lifecycle metadata. Observe the
      // beginning of the appended region and the newest tail in the same
      // 64 KiB budget; never read a full transcript or store tool/message text.
      const delta=old?stat.size-old.size:0,overlap=Math.min(4096,Math.floor(budget/4));
      const spans=old&&delta>0&&delta>budget-overlap
        ?[[Math.max(0,old.size-overlap),Math.floor(budget/2)],[Math.max(0,stat.size-Math.ceil(budget/2)),Math.ceil(budget/2)]]
        :[[old&&delta>0?Math.max(0,old.size-overlap):Math.max(0,stat.size-budget),budget]];
      for(const [start,length] of spans){
        const buffer=Buffer.alloc(Math.min(length,Math.max(0,stat.size-start)));
        const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
        previous=summarizeTaskTail(buffer.subarray(0,bytesRead).toString('utf8'),{now,partialFirstLine:start>0,previous});
      }
      cache.set(safeFile,{size:stat.size,mtimeMs:stat.mtimeMs,ino:stat.ino,summary:previous});
      if(cache.size>GLOBAL_THREAD_LIMIT*2)cache.delete(cache.keys().next().value);
      return previous;
    }finally{await handle.close();}
  }
  return async function read(file,{now=Date.now()}={}){
    if(typeof file!=='string'||!Number.isFinite(now))return null;
    let work=pending.get(file);
    if(!work){work=inspect(file,now).catch(()=>null);pending.set(file,work);work.finally(()=>{if(pending.get(file)===work)pending.delete(file);});}
    const value=await work;return value?structuredClone(value):null;
  };
}

async function readIndex(codexHome,maxThreads){
  const file=path.resolve(codexHome,'state_5.sqlite');
  try{
    const [actualHome,actualFile,info]=await Promise.all([realpath(codexHome),realpath(file),lstat(file)]);
    if(info.isSymbolicLink()||!info.isFile()||path.dirname(actualFile).toLowerCase()!==actualHome.toLowerCase())return {available:false,records:[],excludedThreadIds:[]};
    const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(actualFile,{readOnly:true});
    let transaction=false;
    try{
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=50; BEGIN');transaction=true;
      const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(column=>column.name));
      if(!columns.has('id')||!columns.has('rollout_path'))return {available:false,records:[],excludedThreadIds:[]};
      const fields=['id','name','cwd','rollout_path','source','agent_path','archived','updated_at_ms','recency_at_ms','updated_at'].filter(column=>columns.has(column));
      const filters=[];
      if(columns.has('archived'))filters.push('COALESCE(archived,0)=0');
      if(columns.has('agent_path'))filters.push("(agent_path IS NULL OR agent_path='')");
      // Filter known serialized subagent origins before the limit, including
      // guardian agents whose agent_path is null. Validate them again in JS.
      if(columns.has('source'))filters.push("instr(lower(COALESCE(source,'')),'\"subagent\"')=0 AND lower(COALESCE(source,'')) NOT LIKE 'subagent%'");
      const order=columns.has('recency_at_ms')?'recency_at_ms':columns.has('updated_at_ms')?'updated_at_ms':columns.has('updated_at')?'updated_at':'id';
      const query=`SELECT ${fields.join(',')} FROM threads${filters.length?' WHERE '+filters.join(' AND '):''} ORDER BY ${order} DESC,id LIMIT ?`;
      // An archived conversation can still have an unexpired historical Hook
      // record. Export only its canonical identity for internal suppression;
      // do not query its name, directory, legacy prompt title or message data.
      const excludedThreadIds=columns.has('archived')
        ?db.prepare(`SELECT id FROM threads WHERE ${['COALESCE(archived,0)=1',...filters.filter(filter=>!filter.startsWith('COALESCE(archived,'))].join(' AND ')}`)
          .all().filter(record=>UUID.test(record.id??'')).map(record=>record.id.toLowerCase())
        :[];
      return {available:true,records:db.prepare(query).all(maxThreads).filter(isRootThread),excludedThreadIds:[...new Set(excludedThreadIds)]};
    }finally{try{if(transaction)db.exec('ROLLBACK');}finally{db.close();}}
  }catch{return {available:false,records:[],excludedThreadIds:[]};}
}

async function readHistory(codexHome,threadIds){
  const file=path.resolve(codexHome,'thread_history_1.sqlite');
  try{
    const [actualHome,actualFile,info]=await Promise.all([realpath(codexHome),realpath(file),lstat(file)]);
    if(info.isSymbolicLink()||!info.isFile()||path.dirname(actualFile).toLowerCase()!==actualHome.toLowerCase())return {available:false,turns:new Map()};
    const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(actualFile,{readOnly:true});
    try{
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=50');
      const columns=new Set(db.prepare('PRAGMA table_info(thread_turns)').all().map(column=>column.name));
      if(!['thread_id','turn_id','rollout_ordinal','status','started_at','completed_at'].every(column=>columns.has(column)))return {available:false,turns:new Map()};
      const query=db.prepare('SELECT turn_id,status,started_at,completed_at FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1');
      const turns=new Map();for(const threadId of threadIds){const record=query.get(threadId);if(record)turns.set(threadId,record);}
      return {available:true,turns};
    }finally{db.close();}
  }catch{return {available:false,turns:new Map()};}
}

export function historyTaskState(record,observed,now=Date.now()){
  const fallback=()=>observed?{...observed,historyStatus:null,activitySource:observed.statusKnown===true?'transcript':'unknown'}:null;
  if(!record||!UUID.test(record.turn_id??'')||!['inProgress','completed','failed','interrupted'].includes(record.status))return fallback();
  const started=integer(record.started_at),completed=integer(record.completed_at);
  if(started===null||started*1000>now+60000||completed!==null&&(completed<started||completed*1000>now+60000))return fallback();
  const turn=digest(record.turn_id.toLowerCase()),turnStartedAt=started*1000;
  const historyAt=completed===null?turnStartedAt:completed*1000;
  const observedAt=integer(observed?.taskObservedAt)??integer(observed?.updatedAt)??0;
  const observedStart=integer(observed?.turnStartedAt);
  const newerTurn=observed?.turn&&observed.turn!==turn&&observedStart!==null&&observedStart>=turnStartedAt;
  // The history projection can briefly lag newly appended rollout metadata.
  // A later turn or the same turn's explicit terminal event may safely win.
  if(observed?.statusKnown===true&&observedAt>=turnStartedAt
    &&(newerTurn||record.status==='inProgress'&&observed.turn===turn&&observed.terminalEvent)){
    return {...observed,historyStatus:null,activitySource:'transcript'};
  }
  if(record.status!=='inProgress')return {turn,turnStartedAt,turnActive:false,active:false,statusKnown:true,
    terminalEvent:record.status==='completed'?'Stop':'Interrupt',label:record.status==='completed'?'本轮已结束':record.status==='failed'?'本轮未完成':'任务已中断',
    updatedAt:historyAt,taskObservedAt:historyAt,expiresAt:now+ACTIVITY_TTL,stale:false,waitingForInput:false,historyStatus:record.status,activitySource:'codex-history'};
  const sameTurn=observed?.turn===turn,fresh=sameTurn&&observed.active===true&&Number.isFinite(observed.expiresAt)&&observed.expiresAt>now;
  const startedFresh=turnStartedAt+ACTIVITY_TTL>now;
  const waiting=sameTurn&&observed.waitingForInput===true;
  const updatedAt=fresh?Math.max(turnStartedAt,integer(observed.updatedAt)??turnStartedAt):turnStartedAt;
  return {turn,turnStartedAt,turnActive:fresh||startedFresh,active:fresh||startedFresh,statusKnown:true,terminalEvent:null,
    label:waiting?'等待你的回答':fresh&&typeof observed.label==='string'?observed.label:'正在思考',
    updatedAt,taskObservedAt:updatedAt,expiresAt:updatedAt+ACTIVITY_TTL,stale:!fresh&&!startedFresh,waitingForInput:waiting,historyStatus:'inProgress',activitySource:'codex-history'};
}

/**
 * readActivity(file,{threadId,now,metadata}) is an optional bounded rollout
 * metadata reader. Unknown or inaccessible state stays unknown; simply being
 * present in the thread index does not prove a task is running or completed.
 */
export function createGlobalThreadReader({codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),
  readActivity=undefined,refreshMs=GLOBAL_THREAD_REFRESH_MS,maxThreads=GLOBAL_THREAD_LIMIT}={}){
  const home=path.resolve(normalWindowsPath(codexHome));
  const limit=Math.max(1,Math.min(GLOBAL_THREAD_LIMIT,Number.isSafeInteger(maxThreads)?maxThreads:GLOBAL_THREAD_LIMIT));
  const interval=Math.max(100,Math.min(60000,Number.isFinite(refreshMs)?refreshMs:GLOBAL_THREAD_REFRESH_MS));
  const activityReader=readActivity===undefined?createTaskTranscriptReader({codexHome:home}):readActivity;
  let cache=null,pending=null;
  async function scan(now){
    const index=await readIndex(home,limit);
    const history=await readHistory(home,index.records.map(record=>record.id.toLowerCase()));
    const tasks=await Promise.all(index.records.map(async record=>{
      const metadata=globalThreadMetadata(record);
      if(!metadata)return null;
      const file=await indexedRolloutPath(record.rollout_path,{codexHome:home});
      const unknown={...metadata,active:false,turn:null,turnStartedAt:null,turnActive:false,terminalEvent:null,
        label:'等待任务状态',status:'unknown',statusKnown:false,historyStatus:null,stale:true,waitingForInput:false,expiresAt:now,source:'codex-local-index',activitySource:'unknown'};
      let observed=null;
      if(file&&typeof activityReader==='function')try{observed=await activityReader(file,{threadId:metadata.threadId,now,metadata});}catch{/* Index and history still provide metadata if rollout is temporarily busy. */}
      observed=historyTaskState(history.turns.get(metadata.threadId),observed,now);
      if(!observed||typeof observed!=='object')return unknown;
      // Keep indexed identity and title authoritative, never copy arbitrary
      // fields or payloads supplied by a parser into the renderer response.
      const active=observed.active===true,updatedAt=integer(observed.updatedAt)??metadata.updatedAt;
      const turn=typeof observed.turn==='string'&&/^[a-f0-9]{64}$/.test(observed.turn)?observed.turn:null;
      const terminalEvent=['Stop','Interrupt','SessionEnd'].includes(observed.terminalEvent)?observed.terminalEvent:null;
      return {...unknown,active,turn,turnStartedAt:integer(observed.turnStartedAt),turnActive:observed.turnActive===true,
        terminalEvent,label:clean(observed.label,80)||unknown.label,
        status:active?'running':terminalEvent==='Stop'?'completed':terminalEvent?'stopped':'unknown',statusKnown:observed.statusKnown===true,
        updatedAt,taskObservedAt:integer(observed.taskObservedAt)??updatedAt,expiresAt:integer(observed.expiresAt)??now,stale:observed.stale!==false,
        waitingForInput:observed.waitingForInput===true,activitySource:observed.activitySource,
        historyStatus:['inProgress','completed','failed','interrupted'].includes(observed.historyStatus)?observed.historyStatus:null};
    }));
    return {available:index.available,historyAvailable:history.available,source:'codex-local-index',updatedAt:now,
      tasks:tasks.filter(Boolean),excludedThreadIds:index.excludedThreadIds};
  }
  return async function read(nowOrOptions=Date.now()){
    const now=typeof nowOrOptions==='object'?nowOrOptions?.now??Date.now():nowOrOptions;
    if(!Number.isFinite(now))throw new TypeError('A finite observation time is required');
    if(cache&&now>=cache.updatedAt&&now-cache.updatedAt<interval)return structuredClone(cache);
    if(!pending)pending=scan(now).then(value=>{cache=value;return value;}).finally(()=>{pending=null;});
    return structuredClone(await pending);
  };
}
