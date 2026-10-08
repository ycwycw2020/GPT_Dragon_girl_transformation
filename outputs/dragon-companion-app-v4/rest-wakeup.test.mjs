import test from 'node:test';
import assert from 'node:assert/strict';
import {createRestWakeTracker,normalizeRestBaseline} from './rest-wakeup.mjs';
const A='a'.repeat(64),B='b'.repeat(64),T='1'.repeat(64),U='2'.repeat(64);
const row=(extra={})=>({id:A,turn:T,active:true,turnActive:true,turnStartedAt:100,updatedAt:100,...extra});

test('clicking sleep during active work remains asleep across tool events and temporary idle gaps',()=>{
  const tracker=createRestWakeTracker({startedAt:200,baseline:[row()]});
  for(const updatedAt of [201,500,1000])assert.equal(tracker.observe([row({updatedAt})],{now:updatedAt}).wake,false);
  assert.equal(tracker.observe([row({active:false})],{now:1100}).wake,false);
  assert.equal(tracker.observe([row({active:true,updatedAt:1200})],{now:1200}).wake,false);
});

test('only a confirmed post-rest new active task or root turn wakes the pet',()=>{
  const tracker=createRestWakeTracker({startedAt:200,baseline:[row()]});
  assert.equal(tracker.observe([row({id:B,turnStartedAt:201})],{now:202}).reason,'new_task');
  assert.equal(tracker.observe([row({turn:U,turnStartedAt:201})],{now:202}).reason,'new_turn');
  for(const change of [{turn:U,turnStartedAt:199},{turn:U,turnStartedAt:200},{turn:U,turnStartedAt:null,updatedAt:500},
    {turn:U,turnStartedAt:201,active:false},{turn:U,turnStartedAt:201,turnActive:false},{turn:U,turnStartedAt:201,stale:true}])
    assert.equal(tracker.observe([row(change)],{now:500}).wake,false);
});

test('saved baseline survives process restart without mistaking an old turn for new work',()=>{
  const before=createRestWakeTracker({startedAt:200,baseline:[row()]});
  const restored=createRestWakeTracker({startedAt:200,baseline:JSON.parse(JSON.stringify(before.snapshot()))});
  assert.equal(restored.observe([row({updatedAt:5000})],{now:5000}).wake,false);
  assert.equal(restored.observe([row({turn:U,turnStartedAt:3000,updatedAt:5000})],{now:5000}).wake,true);
  const legacy=createRestWakeTracker({startedAt:200});
  assert.equal(legacy.observe([row({updatedAt:5000})],{now:5000}).wake,false);
  assert.equal(legacy.observe([row({turn:U,turnStartedAt:3000})],{now:5000}).wake,true);
});

test('snapshot contains only valid hashes, rejects content and unreasonable times, and cannot be mutated by caller',()=>{
  const tracker=createRestWakeTracker({startedAt:200,baseline:[row({prompt:'private',cwd:'private'}),{id:'plain text',turn:T}]});
  assert.deepEqual(tracker.snapshot(),[{id:A,turn:T}]);
  const copy=tracker.snapshot();copy[0].turn=U;assert.equal(tracker.snapshot()[0].turn,T);
  assert.equal(tracker.observe([row({turn:U,turnStartedAt:70000})],{now:500}).wake,false);
  assert.equal(createRestWakeTracker({startedAt:NaN}).observe([row()],{now:500}).wake,false);
  assert.deepEqual(normalizeRestBaseline(null),[]);
});
