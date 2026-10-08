import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationWatcher,reflectClientX} from './view-presentation.mjs';

test('new move wins over slow initial IPC and stale HTTP poll',async()=>{
  let event,finish,unsubscribed=false;const values=[];
  const desktop={onView(fn){event=fn;return()=>{unsubscribed=true;};},view(){return new Promise(resolve=>{finish=resolve;});}};
  const watcher=createPresentationWatcher({desktop,onChange:value=>values.push(value.mirrored)});
  await Promise.resolve();watcher.fromBridge({mirrored:false});
  event({mirrored:true});finish({mirrored:false});
  await new Promise(resolve=>setImmediate(resolve));
  watcher.fromBridge({mirrored:false});assert.deepEqual(values,[false,true]);
  watcher.dispose();event({mirrored:false});assert.equal(unsubscribed,true);assert.deepEqual(values,[false,true]);
});
test('browser fallback accepts bridge moves, invalid values ignored',()=>{
  const values=[],watcher=createPresentationWatcher({desktop:null,onChange:value=>values.push(value)});
  watcher.fromBridge(undefined);watcher.fromBridge({mirrored:'false'});watcher.fromBridge({mirrored:false,displayId:1});watcher.fromBridge({mirrored:true,displayId:2});
  assert.deepEqual(values,[{mirrored:false,screenSide:'left',displayId:1},{mirrored:true,screenSide:'right',displayId:2}]);
});
test('mirrored hit point round-trips at non-zero window offsets',()=>{
  const rect={left:127,width:263};
  for(const x of [127,128,256,389,390]){
    assert.equal(reflectClientX(x,rect,false),x);
    assert.equal(reflectClientX(reflectClientX(x,rect,true),rect,true),x);
    assert.equal(reflectClientX(x,rect,true)+x,517);
  }
});
