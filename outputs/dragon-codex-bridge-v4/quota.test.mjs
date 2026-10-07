import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeQuota,readAccountQuota,resolveCodexExecutable} from './quota.mjs';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
const window=(usedPercent,windowDurationMins=300)=>({usedPercent,windowDurationMins,resetsAt:2000});
test('uses the constraining core window and handles 0% correctly',()=>{
  const value=normalizeQuota({rateLimitsByLimitId:{codex:{primary:window(25),secondary:window(70,10080)},other:{primary:window(100)}}},1000);
  assert.equal(value.remainingPercent,30);assert.equal(value.windows.length,2);
  assert.equal(normalizeQuota({rateLimits:{limitId:'codex',primary:window(100)}},1000).remainingPercent,0);
});
test('does not substitute other buckets or legacy value when mapping is present',()=>{
  assert.equal(normalizeQuota({rateLimitsByLimitId:{other:{primary:window(90)}},rateLimits:{primary:window(0)}},1000),null);
  assert.equal(normalizeQuota({rateLimits:{limitId:'other',primary:window(10)}},1000),null);
});
test('missing, expired and malformed windows stay unknown',()=>{
  for(const input of [null,{}, {rateLimits:{primary:window(null)}},{rateLimits:{primary:window(101)}},{rateLimits:{primary:{...window(20),resetsAt:0}}}])assert.equal(normalizeQuota(input,1000),null);
});
test('already cancelled reads never launch a child process',async()=>{
  const abort=new AbortController();abort.abort();
  await assert.rejects(readAccountQuota({executable:'must-not-launch',signal:abort.signal}),/cancelled/);
});
test('Windows double-click launch can find bundled Codex without PATH',async()=>{
  const root=path.resolve('work/quota-path-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'fixture-'));
  const installed=path.join(directory,'OpenAI','Codex','bin','123abc','codex.exe');
  await mkdir(path.dirname(installed),{recursive:true});await writeFile(installed,'test-only-not-executable');
  assert.equal(await resolveCodexExecutable('codex',{platform:'win32',searchPath:'',localAppData:directory}),installed);
  const explicit=path.join(directory,'explicit.exe');
  assert.equal(await resolveCodexExecutable(explicit,{platform:'win32'}),explicit);
});
test('Windows lookup prefers a real PATH executable and ignores relative PATH entries',async()=>{
  const root=path.resolve('work/quota-path-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'path-'));
  const executable=path.join(directory,'codex.exe');await writeFile(executable,'test-only-not-executable');
  assert.equal(await resolveCodexExecutable('codex',{platform:'win32',searchPath:`.;"${directory}"`,localAppData:directory}),executable);
  assert.equal(await resolveCodexExecutable('codex',{platform:'win32',searchPath:'.;relative',localAppData:directory}), 'codex');
});
