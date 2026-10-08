import test from 'node:test';
import assert from 'node:assert/strict';
import {TOUCH_TARGETS,sampleTouch,createTouchInteractions,viewTransform,pickTouch} from './touch-interactions.mjs';
import {deformPoint,motionSample} from './ambient-motion.mjs';
test('touch gestures are bounded, end cleanly, and cannot be stacked on the same part',()=>{
  const controller=createTouchInteractions();
  assert.equal(controller.trigger('unknown',0),false);
  for(const t of TOUCH_TARGETS){assert.equal(sampleTouch(t.id,0),0);assert.equal(sampleTouch(t.id,t.duration),0);
    assert(controller.trigger(t.id,10));assert(!controller.trigger(t.id,10.01));
    assert(Number.isFinite(sampleTouch(t.id,t.duration*.4)));}
  assert.equal(controller.sample(10.1).playing.length,4);assert.equal(controller.sample(14).playing.length,0);
});
test('hit coordinates remain aligned after resize and high-DPI canvas scaling',()=>{
  const info={CanvasOriginX:1213,CanvasOriginY:1296,PixelsPerUnit:2426};
  for(const size of [[180,200],[424,471],[810,900]]){
    const rect={left:30,top:45,width:size[0],height:size[1]},view=viewTransform([-.51,-.55,.53,.54],rect,info);
    for(const [x,y] of [[150,1100],[860,900],[1100,1400],[1200,1600]]){const p=view.project(x,y),q=view.unproject(p[0]+rect.left,p[1]+rect.top);assert(Math.hypot(q[0]-x,q[1]-y)<1e-8);}
  }
  assert.equal(pickTouch(id=>id==='ArtMesh29').id,'earring');assert.equal(pickTouch(()=>false),null);
});
test('touching keeps tail root, desk and book still; only mouse and hand press together',()=>{
  const s={...motionSample(1),touch:{tail:.06,earring:.06,mouse:4,book:.5}};
  assert.deepEqual(deformPoint('ArtMesh38',351,1217,s),[351,1217]);
  for(const id of ['ArtMesh17','ArtMesh3','ArtMesh11'])assert.deepEqual(deformPoint(id,1100,1400,s),[1100,1400]);
  for(const id of ['ArtMesh9','ArtMesh10'])assert.deepEqual(deformPoint(id,1100,1400,s),[1100,1404]);
  const normal=motionSample(1);assert.deepEqual(deformPoint('ArtMesh28',1250,850,s),deformPoint('ArtMesh28',1250,850,normal));
});
