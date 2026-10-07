import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaService, combineStateAndQuota } from './quota-service.mjs';

test('one reader is shared across overlapping polls and stop cancels the active request',async()=>{
  let calls=0,finish,signal,cleared=0,timerCount=0;
  const service=createQuotaService({readQuota:options=>{calls++;signal=options.signal;return new Promise(resolve=>{finish=resolve;});},
    saveQuota:async()=>{},setTimer:()=>{timerCount++;return 5;},clearTimer:()=>cleared++,now:()=>1000});
  const first=service.start(),second=service.start(),third=service.poll();
  assert.equal(first,second);assert.equal(first,third);assert.equal(calls,1);assert.equal(timerCount,1);
  service.stop();assert.equal(signal.aborted,true);assert.equal(cleared,1);
  finish(null);await first;await service.poll();assert.equal(calls,1);
});
test('quota expiry and read failure produce unknown instead of retaining a stale percentage',async()=>{
  let clock=1000,failed=false;const writes=[];
  const service=createQuotaService({readQuota:async()=>{if(failed)throw new Error('read unavailable');return {remainingPercent:9,expiresAt:2000,source:'codex-app-server'};},
    saveQuota:async value=>writes.push(value),now:()=>clock,setTimer:()=>1,clearTimer:()=>{}});
  await service.start();assert.equal(service.current().remainingPercent,9);
  clock=2000;assert.equal(service.current().status,'unknown');assert.equal(service.current().remainingPercent,null);
  failed=true;await service.poll();assert.equal(writes.at(-1),null);service.stop();
});
test('readable quota does not pretend the Codex task hook is connected',()=>{
  const quota={status:'fresh',remainingPercent:9,expiresAt:2000,source:'codex-app-server'};
  const unknown=combineStateAndQuota({connection:'standalone_preview'},quota);
  assert.equal(unknown.connection,'task_unknown');assert.equal(unknown.taskKnown,false);assert.equal(unknown.isWorking,false);assert.equal(unknown.remainingPercent,9);
  const connected=combineStateAndQuota({connection:'local_file',isWorking:true,source:'codex-hooks'},quota);
  assert.equal(connected.taskKnown,true);assert.equal(connected.isWorking,true);assert.equal(connected.taskSource,'codex-hooks');
  assert.equal(combineStateAndQuota(connected,{status:'unknown'}).remainingPercent,null);
});
