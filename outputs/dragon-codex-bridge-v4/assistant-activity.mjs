// Read only complete, public assistant messages. Never persist message bodies,
// user text, tool output, reasoning, arbitrary paths, or generated summaries.
import {createHash} from 'node:crypto';
import {open,realpath,lstat,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const ASSISTANT_ACTIVITY_TTL=15*60*1000;
export const ASSISTANT_TAIL_BYTES=64*1024;
const topics=[
  ['测试进展',/测试|校验|验证|\btest(?:s|ing)?\b|\bvalidat/i],
  ['画面与动作',/图片|画面|原画|贴图|眨眼|动作|动画|live2d|cubism|渲染|气泡|镜像/i],
  ['安装与打包',/安装|打包|便携|发布|构建|\bbuild\b|\bpackag|\binstall/i],
  ['修复说明',/修复|修改|调整|更新|优化|fix|change|updat/i],
  ['下一步安排',/接下来|下一步|准备|计划|首先|next step|plan/i],
];
const labels=new Set(['有新的进度说明','有新的回复',...topics.flatMap(([label])=>[`进度 · ${label}`,`回复 · ${label}`])]);
const digest=value=>createHash('sha256').update(value).digest('hex');
function makeActivity(text,kind,updatedAt,source){
  if(typeof text!=='string'||!text.trim()||!Number.isFinite(updatedAt))return null;
  const bounded=text.slice(0,32000),topic=topics.find(([,pattern])=>pattern.test(bounded))?.[0];
  const label=topic?`${kind==='final'?'回复':'进度'} · ${topic}`:kind==='final'?'有新的回复':'有新的进度说明';
  return {id:digest(kind+'\0'+text),kind,label,updatedAt,expiresAt:updatedAt+ASSISTANT_ACTIVITY_TTL,source};
}
export function assistantActivityFromHook(payload,now=Date.now()){
  if(payload?.hook_event_name!=='Stop'||payload.agent_id!==undefined)return null;
  return makeActivity(payload.last_assistant_message,'final',now,'stop-hook');
}
export function readAssistantActivity(value,now=Date.now()){
  if(!value||!['commentary','final'].includes(value.kind)||!labels.has(value.label)
    ||!['stop-hook','transcript-tail'].includes(value.source)||!/^[a-f0-9]{64}$/.test(value.id??'')
    ||!Number.isFinite(value.updatedAt)||!Number.isFinite(value.expiresAt)||value.updatedAt>now+60000
    ||value.expiresAt<=now||value.expiresAt<=value.updatedAt||value.expiresAt>value.updatedAt+ASSISTANT_ACTIVITY_TTL)return null;
  return {id:value.id,kind:value.kind,label:value.label,updatedAt:value.updatedAt,expiresAt:value.expiresAt,source:value.source};
}
export function transcriptPathFromHook(payload,{codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}={}){
  if(payload?.agent_id!==undefined||typeof payload?.transcript_path!=='string'||payload.transcript_path.length>4096)return null;
  const file=payload.transcript_path;
  return path.isAbsolute(file)&&/^rollout-[^\\/]+\.jsonl$/i.test(path.basename(file))
    &&within(path.resolve(codexHome,'sessions'),path.resolve(file))?path.resolve(file):null;
}
function visibleMessage(record){
  const body=record?.payload;
  if(record?.type==='event_msg'&&body?.type==='item_completed'&&body.item?.type==='AgentMessage'){
    const item=body.item;if(item.channel==='analysis'||item.phase==='analysis')return null;
    return {text:item.text,kind:['final','final_answer'].includes(item.phase??item.channel)?'final':'commentary'};
  }
  if(record?.type==='event_msg'&&body?.type==='agent_message'){
    if(body.channel==='analysis'||body.phase==='analysis')return null;
    return {text:body.message,kind:['final','final_answer'].includes(body.phase??body.channel)?'final':'commentary'};
  }
  if(record?.type!=='response_item'||body?.type!=='message'||body.role!=='assistant')return null;
  if(body.channel==='analysis'||body.phase==='analysis')return null;
  const phase=body.phase??body.channel;
  if(phase!==undefined&&phase!==null&&!['commentary','final','final_answer'].includes(phase))return null;
  if(!Array.isArray(body.content))return null;
  const texts=body.content.filter(item=>['output_text','text'].includes(item?.type)&&typeof item.text==='string').map(item=>item.text);
  return {text:texts.join('\n'),kind:phase==='commentary'?'commentary':'final'};
}
export function assistantActivityFromTail(text,{now=Date.now(),since=0,partialFirstLine=false}={}){
  if(typeof text!=='string')return null;
  const lines=text.split('\n');if(partialFirstLine)lines.shift();let latest=null;
  for(const line of lines){
    if(!line.trim())continue;
    try{
      const record=JSON.parse(line),updatedAt=Date.parse(record.timestamp);
      if(!Number.isFinite(updatedAt)||updatedAt<since||updatedAt>now+60000||updatedAt+ASSISTANT_ACTIVITY_TTL<=now)continue;
      const message=visibleMessage(record);if(!message)continue;
      const activity=makeActivity(message.text,message.kind,updatedAt,'transcript-tail');
      if(activity&&(!latest||activity.updatedAt>=latest.updatedAt))latest=activity;
    }catch{/* Incomplete lines and future format changes fail closed. */}
  }
  return latest;
}
const within=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
export function createAssistantTranscriptReader({codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),maxBytes=ASSISTANT_TAIL_BYTES}={}){
  const root=path.resolve(codexHome,'sessions'),cache=new Map(),pending=new Map();
  const discoveries=new Map(),discovering=new Map();
  const limit=Math.max(1024,Math.min(ASSISTANT_TAIL_BYTES,Number.isFinite(maxBytes)?Math.floor(maxBytes):ASSISTANT_TAIL_BYTES));
  async function indexedFile(threadId){
    // Known local metadata index, read-only and queried for one already-known
    // UUID. Schema drift simply disables this fallback; no history is listed.
    const index=path.resolve(codexHome,'state_5.sqlite');
    try{
      const [actualHome,actualIndex,info]=await Promise.all([realpath(codexHome),realpath(index),lstat(index)]);
      if(info.isSymbolicLink()||!info.isFile()||path.dirname(actualIndex).toLowerCase()!==actualHome.toLowerCase())return null;
      const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(actualIndex,{readOnly:true});
      try{
        db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=50');
        const columns=db.prepare('PRAGMA table_info(threads)').all().map(column=>column.name);
        if(!columns.includes('id')||!columns.includes('rollout_path'))return null;
        const record=db.prepare('SELECT rollout_path FROM threads WHERE id=? LIMIT 1').get(threadId);
        return transcriptPathFromHook({transcript_path:record?.rollout_path},{codexHome});
      }finally{db.close();}
    }catch{return null;}
  }
  async function discover(threadId,now){
    if(typeof threadId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(threadId))return null;
    const key=threadId.toLowerCase(),saved=discoveries.get(key);
    if(saved&&now-saved.checkedAt<5000)return saved.file;
    if(discovering.has(key))return discovering.get(key);
    const work=(async()=>{
      let file=await indexedFile(key);
      try{
        if(file){discoveries.set(key,{checkedAt:now,file});if(discoveries.size>128)discoveries.delete(discoveries.keys().next().value);return file;}
        const realRoot=await realpath(root);
        // Some desktop hooks leave transcript_path null. Resolve only the
        // known UUID in today/yesterday UTC, never enumerate older history.
        for(const day of [now,now-86400000]){
          const date=new Date(day).toISOString().slice(0,10).split('-'),folder=path.join(root,...date);
          let actual;try{actual=await realpath(folder);}catch{continue;}
          if(!within(realRoot,actual))continue;
          const matches=(await readdir(actual,{withFileTypes:true})).filter(entry=>entry.isFile()
            &&entry.name.toLowerCase().startsWith('rollout-')&&entry.name.toLowerCase().endsWith('-'+key+'.jsonl'));
          if(matches.length){matches.sort((a,b)=>b.name.localeCompare(a.name));file=path.join(folder,matches[0].name);break;}
        }
      }catch{/* Optional fallback is unavailable; the Stop field still works. */}
      discoveries.set(key,{checkedAt:now,file});if(discoveries.size>128)discoveries.delete(discoveries.keys().next().value);
      return file;
    })();
    discovering.set(key,work);try{return await work;}finally{discovering.delete(key);}
  }
  async function inspect(file,now){
    if(typeof file!=='string'||!path.isAbsolute(file)||!/^rollout-[^\\/]+\.jsonl$/i.test(path.basename(file)))return null;
    const resolved=path.resolve(file);if(!within(root,resolved))return null;
    const previous=cache.get(resolved);if(previous&&now-previous.checkedAt<400)return previous.activity;
    try{
      const [realRoot,realFile,info]=await Promise.all([realpath(root),realpath(resolved),lstat(resolved)]);
      if(!within(realRoot,realFile)||info.isSymbolicLink()||!info.isFile())return null;
      const handle=await open(realFile,'r');
      try{
        const stat=await handle.stat();if(!stat.isFile())return null;
        if(previous&&previous.size===stat.size&&previous.mtimeMs===stat.mtimeMs){previous.checkedAt=now;return previous.activity;}
        // A long tool result can bury a just-written public message. Read a
        // bounded part of newly appended data plus the tail, still <=64 KiB.
        const spans=previous&&stat.size-previous.size>limit/2
          ?[[Math.max(0,previous.size-4096),Math.floor(limit/2)],[Math.max(0,stat.size-Math.floor(limit/2)),Math.floor(limit/2)]]
          :[[Math.max(0,stat.size-limit),Math.min(stat.size,limit)]];
        let activity=readAssistantActivity(previous?.activity,now);
        for(const [start,length] of spans){
          const buffer=Buffer.alloc(Math.min(length,stat.size-start)),{bytesRead}=await handle.read(buffer,0,buffer.length,start);
          const observed=assistantActivityFromTail(buffer.subarray(0,bytesRead).toString('utf8'),{now,partialFirstLine:start>0});
          if(observed&&(!activity||observed.updatedAt>=activity.updatedAt))activity=observed;
        }
        cache.set(resolved,{checkedAt:now,size:stat.size,mtimeMs:stat.mtimeMs,activity});
        if(cache.size>128)cache.delete(cache.keys().next().value);
        return activity;
      }finally{await handle.close();}
    }catch{return null;}
  }
  return async function read(file,{since=0,now=Date.now(),threadId=null}={}){
    if(typeof file!=='string')file=await discover(threadId,now);
    if(typeof file!=='string')return null;
    let work=pending.get(file);
    if(!work){work=inspect(file,now);pending.set(file,work);work.finally(()=>{if(pending.get(file)===work)pending.delete(file);});}
    const value=readAssistantActivity(await work,now);
    return value&&value.updatedAt>=since?value:null;
  };
}
export const readAssistantTranscript=createAssistantTranscriptReader();
