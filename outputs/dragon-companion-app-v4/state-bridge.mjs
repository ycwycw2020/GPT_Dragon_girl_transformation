import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STATE_FILE=path.resolve(HERE,'../../work/desktop-app-v4/companion-state.json');
const MAX_STATE_BYTES=8192;

export function normalizeState(value,now=Date.now()) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('State must be an object');
  if(typeof value.isWorking!=='boolean')throw new Error('isWorking must be boolean');
  const quota=value.remainingPercent;
  if(quota!==null&&(!Number.isFinite(quota)||quota<0||quota>100))throw new Error('remainingPercent must be null or 0..100');
  if(!Number.isFinite(value.updatedAt)||!Number.isFinite(value.expiresAt)||value.expiresAt<=value.updatedAt)throw new Error('State timestamps are invalid');
  if(value.updatedAt>now+60000)throw new Error('State timestamp is in the future');
  if(value.expiresAt<=now)return {connection:'expired',isWorking:false,remainingPercent:null,updatedAt:value.updatedAt,expiresAt:value.expiresAt};
  return {connection:'local_file',isWorking:value.isWorking,remainingPercent:quota,
    updatedAt:value.updatedAt,expiresAt:value.expiresAt,
    source:typeof value.source==='string'?value.source.slice(0,100):'local'};
}

export async function readState(file=DEFAULT_STATE_FILE,now=Date.now()) {
  try {
    const info=await stat(file);if(!info.isFile()||info.size>MAX_STATE_BYTES)throw new Error('Invalid state file size');
    return normalizeState(JSON.parse(await readFile(file,'utf8')),now);
  } catch(error) {
    if(error.code==='ENOENT')return {connection:'standalone_preview',note:'No task event has been received; task activity is unknown.'};
    return {connection:'expired',isWorking:false,remainingPercent:null,error:error.message};
  }
}

export async function writeState({isWorking,remainingPercent=null,ttlMs=300000,source='manual-cli'},file=DEFAULT_STATE_FILE,now=Date.now()) {
  if(!Number.isFinite(ttlMs)||ttlMs<1000||ttlMs>86400000)throw new Error('ttlMs must be 1000..86400000');
  const state={isWorking,remainingPercent,updatedAt:now,expiresAt:now+ttlMs,source};
  normalizeState(state,now);await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(state,null,2));await rename(temporary,file);
  return state;
}
