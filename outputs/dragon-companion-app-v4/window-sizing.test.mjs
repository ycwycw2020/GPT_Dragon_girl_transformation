import test from 'node:test';
import assert from 'node:assert/strict';
import sizing from './window-sizing.cjs';
const {DEFAULT_SCALE,normalizeScale,readScale,nextScale,scaledBounds}=sizing;
test('new or corrupt preferences default to exactly one-third of 540 × 600',()=>{
  const area={x:0,y:0,width:1440,height:900};
  for(const text of ['', '{broken', '{}', '{"scale":"2"}', '{"scale":null}']) {
    assert.equal(readScale(text),DEFAULT_SCALE);
    assert.deepEqual(scaledBounds(readScale(text),area),{x:1240,y:680,width:180,height:200});
  }
  assert.equal(readScale('{"scale":0.5}'),.5);
  assert.equal(normalizeScale(Infinity),DEFAULT_SCALE);
});
test('zoom retains the bottom centre and clamps to monitors with negative coordinates',()=>{
  const area={x:-1920,y:-100,width:1920,height:1080};
  const previous={x:-500,y:200,width:180,height:200};
  const bounds=scaledBounds(1,area,previous);
  assert.deepEqual(bounds,{x:-680,y:-100,width:540,height:600});
  const fitting=scaledBounds(1.5,{x:100,y:50,width:300,height:280},previous);
  assert.equal(fitting.height,280);assert.ok(fitting.width<=300);
  assert.ok(fitting.x>=100&&fitting.x+fitting.width<=400);
  assert.equal(fitting.y,50);
});
test('zoom steps, reset and saved values remain bounded',()=>{
  let value=DEFAULT_SCALE;
  for(let i=0;i<200;i++)value=nextScale(value,'in');
  assert.equal(value,1.5);
  for(let i=0;i<200;i++)value=nextScale(value,'out');
  assert.equal(value,.25);
  assert.equal(nextScale(value,'default'),DEFAULT_SCALE);
  assert.equal(readScale(JSON.stringify({scale:.75})),.75);
});
