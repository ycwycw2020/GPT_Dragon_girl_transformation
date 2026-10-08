import test from 'node:test';
import assert from 'node:assert/strict';
import {getCodexRestCapability,requestCodexRest} from './codex-rest-control.mjs';

test('rest cannot report global success without a verified shared control transport',async()=>{
  const capability=getCodexRestCapability();
  assert.equal(capability.supported,false);
  assert.equal(capability.status,'unavailable');
  assert.equal(capability.scope,'pet-only');
  assert.equal(capability.allStopped,false);
  const result=await requestCodexRest({supported:true,scope:'all',interrupted:99,endpoint:'ws://127.0.0.1:12345'});
  assert.equal(result.supported,false);
  assert.equal(result.interrupted,0);
  assert.equal(result.verifiedStopped,0);
  assert.equal(result.allStopped,false);
  assert.match(result.message,/无法停止 Codex/);
});

test('a caller cannot mutate cached capability into a false stop confirmation',async()=>{
  const changed=getCodexRestCapability();changed.supported=true;changed.allStopped=true;
  const a=await requestCodexRest(),b=await requestCodexRest();
  assert.notEqual(a,b);assert.equal(a.supported,false);assert.equal(b.allStopped,false);
  assert.deepEqual(a,getCodexRestCapability());
});
