import test from 'node:test';import assert from 'node:assert/strict';
import {idleMotionSample,IDLE_STATES,IDLE_PROFILES} from './idle-rig.mjs';
test('each idle state keeps its approved motion limits for natural and touch motion',()=>{
  for(const state of IDLE_STATES){const p=IDLE_PROFILES[state];for(let t=0;t<100;t+=.013){const s=idleMotionSample(state,t,{touch:{tail:Math.sin(t),nod:Math.cos(t)}});assert(Math.abs(s.head[0])<=p.headX);assert(Math.abs(s.head[1])<=p.headY);assert(Math.abs(s.tail[0])<=p.tailX);assert(Math.abs(s.tail[1])<=p.tailY);}}
});
test('disabled pose is exact and unknown states cannot borrow another expression',()=>{
  for(const state of IDLE_STATES)assert.deepEqual(idleMotionSample(state,10,{disabled:true,touch:{tail:1,nod:1}}),{head:[0,0],tail:[0,0]});
  assert.throws(()=>idleMotionSample('working_thinking',0),/Unknown idle state/);
});
