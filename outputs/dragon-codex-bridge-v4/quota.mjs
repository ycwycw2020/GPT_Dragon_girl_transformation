import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile,rename,readdir,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DATA} from './hook.mjs';

// Explorer-launched pets do not inherit the Codex app's injected PATH.
export async function resolveCodexExecutable(executable='codex',{
  platform=process.platform,searchPath=process.env.PATH??'',localAppData=process.env.LOCALAPPDATA,
}={}) {
  if(executable!=='codex'||platform!=='win32')return executable;
  const isFile=async file=>{try{return (await stat(file)).isFile();}catch{return false;}};
  for(const entry of searchPath.split(';')) {
    const directory=entry.trim().replace(/^"|"$/g,'');
    if(!path.isAbsolute(directory))continue;
    const candidate=path.join(directory,'codex.exe');
    if(await isFile(candidate))return candidate;
  }
  if(localAppData&&path.isAbsolute(localAppData)) {
    const bin=path.join(localAppData,'OpenAI','Codex','bin');
    const entries=await readdir(bin,{withFileTypes:true}).catch(()=>[]);
    const candidates=[];
    for(const entry of entries) {
      if(!entry.isDirectory()||!/^[-a-zA-Z0-9_.]+$/.test(entry.name))continue;
      const file=path.join(bin,entry.name,'codex.exe');
      try {const info=await stat(file);if(info.isFile())candidates.push({file,mtime:info.mtimeMs});}catch{}
    }
    candidates.sort((a,b)=>b.mtime-a.mtime||a.file.localeCompare(b.file));
    if(candidates.length)return candidates[0].file;
  }
  return executable;
}

/** Uses core Codex limits only. Missing is unknown, never zero or fully charged. */
export function normalizeQuota(result,now=Date.now()) {
  const bucket=result?.rateLimitsByLimitId
    ? result.rateLimitsByLimitId.codex : result?.rateLimits;
  if(!bucket||bucket.limitId&&bucket.limitId!=='codex')return null;
  const windows=['primary','secondary'].flatMap(name=>{
    const w=bucket[name];
    return w&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100
      &&Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>0
      &&(!Number.isFinite(w.resetsAt)||w.resetsAt*1000>now)
      ?[{name,remainingPercent:100-w.usedPercent,windowDurationMins:w.windowDurationMins,resetsAt:w.resetsAt??null}]:[];
  });
  if(!windows.length)return null;
  return {remainingPercent:Math.min(...windows.map(w=>w.remainingPercent)),windows,
    updatedAt:now,expiresAt:Math.min(now+180000,...windows.filter(w=>Number.isFinite(w.resetsAt)).map(w=>w.resetsAt*1000)),
    source:'codex-app-server',policy:'minimum-of-available-core-windows'};
}

/** Read-only protocol: never starts/resumes a task, changes login or consumes reset credits. */
export async function readAccountQuota({executable='codex',timeoutMs=20000,signal}={}) {
  if(signal?.aborted)throw new Error('Codex quota read cancelled.');
  executable=await resolveCodexExecutable(executable);
  if(signal?.aborted)throw new Error('Codex quota read cancelled.');
  const child=spawn(executable,['app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stderr.resume(); // Do not collect auth diagnostics or other private app-server output.
  const lines=createInterface({input:child.stdout});
  let nextId=0,closedError=null;const pending=new Map();
  const fail=error=>{closedError=error;for(const item of pending.values())item.reject(error);pending.clear();};
  const abort=()=>{fail(new Error('Codex quota read cancelled.'));child.kill();};
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',()=>fail(new Error('Cannot start the installed Codex CLI.')));
  child.on('exit',code=>fail(new Error(`Codex read-only process exited (${code}).`)));
  child.stdin.on('error',()=>fail(new Error('Codex read-only input pipe closed.')));
  lines.on('line',line=>{
    let data;try {data=JSON.parse(line);}catch{return;}
    if(Object.hasOwn(data,'id')&&pending.has(data.id)&&!data.method) {
      const p=pending.get(data.id);pending.delete(data.id);
      if(data.error)p.reject(new Error(`Codex read request failed (${data.error.code??'unknown'}).`));else p.resolve(data.result);
    } else if(data.method&&Object.hasOwn(data,'id')) {
      // This reader does not grant app-server requests or perform authentication.
      child.stdin.write(JSON.stringify({id:data.id,error:{code:-32601,message:'Read-only companion client'}})+'\n');
    }
  });
  const request=(method,params)=>new Promise((resolve,reject)=>{
    if(closedError){reject(closedError);return;}
    const id=++nextId;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  const timer=setTimeout(()=>fail(new Error('Codex quota read timed out.')),timeoutMs);
  try {
    await request('initialize',{clientInfo:{name:'dragon_companion',title:'Dragon companion quota reader',version:'4.0.0'},
      capabilities:{explicitGatewayOauth:true,experimentalApi:false}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const result=await request('account/rateLimits/read',{excludeResetCreditDetails:true});
    return normalizeQuota(result);
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);lines.close();child.stdin.end();child.kill();}
}

export async function saveQuota(value,file=path.join(DATA,'quota.json')) {
  const state=value??{remainingPercent:null,updatedAt:Date.now(),expiresAt:Date.now(),source:'unavailable'};
  await mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(state,null,2));await rename(temporary,file);return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  try {
    const quota=await readAccountQuota({executable:option('--codex-exe')||'codex'});
    await saveQuota(quota,option('--out'));
    console.log(JSON.stringify({status:quota?'fresh':'unknown',remainingPercent:quota?.remainingPercent??null,
      windows:quota?.windows??[],source:'read-only-app-server'}));
  } catch(error) {
    await saveQuota(null,option('--out'));
    console.log(JSON.stringify({status:'unavailable',remainingPercent:null,error:error.message}));process.exitCode=2;
  }
}
