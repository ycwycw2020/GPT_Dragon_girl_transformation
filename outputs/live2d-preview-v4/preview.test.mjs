import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { inspectBindings, applySupportedParameters } from './bindings.mjs';
import { startServer } from './server.mjs';
import { inputForModel, selectModelId } from './model-catalog.mjs';
import { inspectParameterEffects } from './model-qa.mjs';

test('only actual Core IDs are classified as present and receive writes',()=>{
  const inspection=inspectBindings({ids:['ParamEyeLOpen','Other','ParamDragonMouseX'],
    minimumValues:[0,-1,-.5],maximumValues:[1,1,.5],defaultValues:[1,0,0]});
  assert.equal(inspection.filter(b=>b.exists).length,2);
  assert.equal(inspection.find(b=>b.id==='ParamDragonMouseX').rangeMatches,false);
  const calls=[];
  const model={setParameterValueByIndex(...args){calls.push(args);}};
  const written=applySupportedParameters(model,inspection,{ParamEyeLOpen:.5,ParamDragonMouseX:1,ParamDragonKeyIndex:1});
  assert.equal(written,2);assert.deepEqual(calls,[[0,.5,1],[2,.5,1]]);
  assert.equal(applySupportedParameters(model,inspection,{ParamEyeLOpen:NaN}),0);
});

test('local service reports missing manifest honestly and rejects mutation/traversal',async()=>{
  const temporary=await mkdtemp(path.join(tmpdir(),'dragon-preview-test-'));
  const server=await startServer({port:0,modelDirectory:temporary});
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    let status=await(await fetch(origin+'/api/status')).json();
    assert.equal(status.modelManifestAvailable,false);assert.equal(status.genuineRenderVerified,false);
    assert.equal((await fetch(origin+'/model/dragon.model3.json')).status,404);
    assert.equal((await fetch(origin+'/',{method:'POST'})).status,405);
    assert.equal((await fetch(origin+'/%2e%2e%5csecret.txt')).status,400);
    const wrongHost=await new Promise((resolve,reject)=>{const request=http.get(origin+'/api/status',{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
    assert.equal(wrongHost,403);
    assert.equal((await fetch(origin+'/vendor/Core/live2dcubismcore.min.js')).status,200);
    assert.equal((await fetch(origin+'/vendor/Shaders/WebGL/vertshadersrc.vert')).status,200);
    const html=await(await fetch(origin+'/')).text();assert.ok(html.includes('正在准备角色'));
    // A manifest alone MUST NOT claim genuine rendering.
    await writeFile(path.join(temporary,'dragon.model3.json'),'{}');
    status=await(await fetch(origin+'/api/status')).json();
    assert.equal(status.modelManifestAvailable,true);assert.equal(status.genuineRenderVerified,false);
    assert.equal(status.models.find(item=>item.id==='idle_high_energy').modelManifestAvailable,false);
    assert.equal(status.modelUrl,'/model/dragon.model3.json');
    await writeFile(path.join(temporary,'dragon-working.model3.json'),'{"id":"working"}');
    await writeFile(path.join(temporary,'dragon-high-energy.model3.json'),'{"id":"energetic"}');
    status=await(await fetch(origin+'/api/status')).json();
    assert.equal(status.modelUrl,'/model/dragon-working.model3.json');
    assert.equal(status.models.filter(item=>item.modelManifestAvailable).length,1);
    assert.ok(status.models.filter(item=>item.kind==='layered-runtime').every(item=>!item.modelManifestAvailable));
    assert.equal((await(await fetch(origin+'/model/dragon.model3.json')).json()).id,'working');
    assert.equal((await(await fetch(origin+'/model/dragon-high-energy.model3.json')).json()).id,'energetic');
  }finally{await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(temporary).startsWith(path.resolve(tmpdir())+path.sep+'dragon-preview-test-'));await rm(temporary,{recursive:true,force:true});}
});

test('all four states drive their intended controller input',()=>{
  assert.deepEqual(inputForModel('working_thinking'),{isWorking:true,remainingPercent:75});
  assert.deepEqual(inputForModel('idle_high_energy'),{isWorking:false,remainingPercent:75});
  assert.equal(selectModelId('idle_low_energy'),'idle_low_energy');
  assert.deepEqual(inputForModel('idle_mid_energy'),{isWorking:false,remainingPercent:35});
  assert.equal(selectModelId('invalid'),'working_thinking');
});

test('QA catches excessive source-pixel motion, unexpected mesh movement and inert bindings',()=>{
  const parameters={ids:['Move','Inert'],values:new Float32Array([.25,.25]),
    defaultValues:new Float32Array([0,0]),minimumValues:new Float32Array([0,0]),maximumValues:new Float32Array([1,1])};
  const core={parameters,canvasinfo:{PixelsPerUnit:1000,CanvasWidth:2426,CanvasHeight:2592},
    drawables:{ids:['hand','desk'],opacities:new Float32Array([1,1])}};
  let vertices=[];
  const model={getModel:()=>core,getPixelsPerUnit:()=>1000,
    update(){vertices=[[0,0,.008*parameters.values[0],0],[0,0,0,.003*parameters.values[0]]];},
    getDrawableVertices:index=>vertices[index],setParameterValueByIndex(index,value){parameters.values[index]=value;}};
  model.update();
  const result=inspectParameterEffects(model,{modelId:'fixture',expectations:{Move:{allowedDrawables:['hand'],maxDxPx:6},Inert:{},Missing:{}}});
  const moving=result.parameters[0];
  assert.equal(moving.status,'excessive_displacement');
  assert.equal(moving.tests.find(test=>test.value===1).maxDxPx,8);
  assert.deepEqual(moving.tests.find(test=>test.value===1).unexpectedDrawables,['desk']);
  assert.equal(result.parameters[1].status,'unbound');assert.equal(result.parameters[2].status,'missing');
  assert.equal(result.allRequiredVerified,false);
  assert.deepEqual(Array.from(parameters.values),[.25,.25]);
});
