import test from 'node:test';import assert from 'node:assert/strict';
import {MODEL_CATALOG,visualForState,inputForModel} from './model-catalog.mjs';
test('program driven variants are not mislabelled as independent Cubism exports',()=>{
 assert.equal(MODEL_CATALOG.length,4);
 for(const state of ['idle_high_energy','idle_mid_energy','idle_low_energy']){const item=MODEL_CATALOG.find(m=>m.id===state);assert.equal(item.kind,'layered-runtime');assert.deepEqual(item.files,[]);assert(item.assetManifest.includes(state));assert.equal(visualForState(state),state);}
});
test('working tasks take priority; unavailable quota does not invent a fatigue tier',()=>{
 assert.equal(visualForState('idle_low_energy',{isWorking:true,sleep:true}),'working_thinking');
 assert.equal(visualForState('idle_neutral'),'working_thinking');
 assert.equal(visualForState('idle_neutral',{sleep:true}),'idle_low_energy');
 assert.equal(inputForModel('idle_low_energy').remainingPercent,10);
 assert.equal(inputForModel('idle_mid_energy').remainingPercent,35);
});
