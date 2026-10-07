import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeState, readState, writeState } from './state-bridge.mjs';
import { nativePose, directionPose, NATIVE_STATES } from '../live2d-preview-v4/frame-profiles.mjs';
import { applyPresentationPolicy } from '../live2d-preview-v4/bindings.mjs';

test('expired, malformed or unavailable input cannot invent a live Codex task or quota',()=>{
  assert.deepEqual(normalizeState({isWorking:true,remainingPercent:75,updatedAt:1000,expiresAt:2000},2000),
    {connection:'expired',isWorking:false,remainingPercent:null,updatedAt:1000,expiresAt:2000});
  assert.throws(()=>normalizeState({isWorking:'true',remainingPercent:50,updatedAt:1000,expiresAt:2000},1500));
  assert.throws(()=>normalizeState({isWorking:true,remainingPercent:500,updatedAt:1000,expiresAt:2000},1500));
});
test('local bridge round trips a bounded event and missing file remains an explicit demo',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'dragon-state-test-')),file=path.join(directory,'state.json');
  try {
    assert.equal((await readState(file)).connection,'standalone_preview');
    await writeState({isWorking:true,remainingPercent:null,ttlMs:2000},file,1000);
    assert.deepEqual(await readState(file,1500),{connection:'local_file',isWorking:true,remainingPercent:null,updatedAt:1000,expiresAt:3000,source:'manual-cli'});
    assert.equal((await readState(file,3000)).connection,'expired');
  } finally {assert.ok(directory.startsWith(path.resolve(tmpdir())+path.sep+'dragon-state-test-'));await rm(directory,{recursive:true,force:true});}
});
test('native pet profile has 57 base and 16 look slots with bounded genuine-model poses',()=>{
  assert.equal(Object.values(NATIVE_STATES).reduce((sum,durations)=>sum+durations.length,0),57);
  for(const state of Object.keys(NATIVE_STATES))for(let index=0;index<100;index++) {
    const pose=nativePose(state,index/100);
    assert.ok(pose.ParamBreath>=0&&pose.ParamBreath<=1);
    assert.ok(Math.abs(pose.ParamDragonMouseX)<=1);
    assert.ok(Math.abs(pose.ParamDragonTailBase)<=1);
    assert.equal(pose.ParamEyeLOpen,1);assert.equal(pose.ParamEyeROpen,1);
  }
  assert.equal(directionPose(0).ParamEyeBallY,1);
  assert.equal(directionPose(4).ParamEyeBallX,1);
  const fixed=applyPresentationPolicy({ParamEyeLOpen:0,ParamEyeROpen:0,ParamBreath:.4},'working_thinking');
  assert.equal(fixed.ParamEyeLOpen,1);assert.equal(fixed.ParamEyeROpen,1);
  assert.ok(Math.abs(fixed.ParamBreath-.1875)<1e-9);
  assert.ok(applyPresentationPolicy({ParamBreath:.34,ParamDragonAhoge:-.06,ParamDragonTailBase:-.05},'working_thinking').ParamBreath<1e-9);
  const maximum=applyPresentationPolicy({ParamBreath:.66,ParamDragonAhoge:.06,ParamDragonTailBase:.05},'working_thinking');
  assert.equal(maximum.ParamBreath,1);assert.equal(maximum.ParamDragonAhoge,.8);assert.equal(maximum.ParamDragonTailBase,.8);
});
