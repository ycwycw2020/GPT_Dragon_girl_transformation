import {readFile,writeFile,rename,mkdir,lstat,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
export function mergeHooks(existing,incoming) {
  if(!existing||typeof existing!=='object'||Array.isArray(existing))throw new Error('Existing hooks.json is not an object');
  if(existing.hooks!==undefined&&(!existing.hooks||typeof existing.hooks!=='object'||Array.isArray(existing.hooks)))throw new Error('Existing hooks table is invalid');
  const next=structuredClone(existing);next.hooks??={};let added=0;
  for(const [event,groups] of Object.entries(incoming.hooks)) {
    const current=next.hooks[event]??=[];
    if(!Array.isArray(current))throw new Error('Existing hook event is invalid: '+event);
    for(const group of groups) {
      const same=current.some(item=>JSON.stringify(item)===JSON.stringify(group));
      if(!same){current.push(structuredClone(group));added++;}
    }
  }
  if(!next.description)next.description=incoming.description;
  return {next,added};
}
async function bytesOrNull(file) {
  try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function installHooks({home,incoming,apply=false}) {
  if(!path.isAbsolute(home)||path.parse(home).root===path.resolve(home))throw new Error('Use an explicit Codex home directory');
  if((await lstat(home)).isSymbolicLink())throw new Error('Codex home must not be a symbolic link or junction');
  home=await realpath(home);
  const target=path.join(home,'hooks.json');
  const stat=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw new Error('hooks.json must be an ordinary file');
  const previous=await bytesOrNull(target);
  const old=previous?JSON.parse(previous.toString('utf8').replace(/^\uFEFF/,'')):{};
  const {next,added}=mergeHooks(old,incoming);
  const nextBytes=Buffer.from(JSON.stringify(next,null,2)+'\n');
  const plan={status:apply?'installed_needs_codex_trust':'read_only_plan',target,addedGroups:added,
    events:Object.keys(incoming.hooks),sha256:digest(nextBytes),trustChanged:false,
    note:'Codex requires review of these exact hook definitions before they can execute.'};
  if(!apply)return plan;
  if(!added)return {...plan,status:'already_installed_trust_unchanged'};
  const current=await bytesOrNull(target);
  if((previous?digest(previous):null)!==(current?digest(current):null))throw new Error('hooks.json changed during preparation; rerun safely');
  const backupDirectory=path.join(home,'gpt-niang-hook-backups');let backup=null;
  if(previous) {
    const info=await lstat(backupDirectory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(info?.isSymbolicLink())throw new Error('Backup directory must not be a link');
    await mkdir(backupDirectory,{recursive:true});
    backup=path.join(backupDirectory,Date.now()+'-'+randomUUID()+'.json');
    await writeFile(backup,previous,{flag:'wx'});
  }
  const temporary=path.join(home,'hooks.gpt-niang-'+randomUUID()+'.tmp');
  await writeFile(temporary,nextBytes,{flag:'wx'});
  await rename(temporary,target);
  if(digest(await readFile(target))!==digest(nextBytes))throw new Error('Post-install hook hash mismatch');
  return {...plan,backup};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--codex-home');
  const home=index>=0?process.argv[index+1]:process.env.CODEX_HOME||path.join(homedir(),'.codex');
  const incoming=JSON.parse(await readFile(path.join(HERE,'hooks.ready.json'),'utf8'));
  const result=await installHooks({home,incoming,apply:process.argv.includes('--apply')});
  if(process.argv.includes('--apply'))await writeFile(path.join(HERE,'hook-installation-receipt.json'),JSON.stringify({...result,installedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify(result,null,2));
}
