import test from 'node:test';
import assert from 'node:assert/strict';
import {motionSample,deformPoint,createAmbientMotion} from './ambient-motion.mjs';

test('desk and hand contacts stay fixed throughout breathing and tail motion',()=>{
  for(let t=0;t<20;t+=.17){const s=motionSample(t);
    for(const id of ['ArtMesh5','ArtMesh6','ArtMesh7','ArtMesh8','ArtMesh9','ArtMesh10','ArtMesh11','ArtMesh12','ArtMesh17','ArtMesh18','ArtMesh39'])assert.deepEqual(deformPoint(id,1000,1350,s),[1000,1350]);
    assert.deepEqual(deformPoint('ArtMesh38',351,1217,s),[351,1217]);
    assert.deepEqual(deformPoint('ArtMesh15',1530,1350,s),[1530,1350]);
    assert.deepEqual(deformPoint('ArtMesh0',2100,1500,s),[2100,1500]);
  }
});
test('facial features and eye clipping mask share one rigid head transform',()=>{
  const sample=motionSample(1.974),ids=['ArtMesh21','ArtMesh22','ArtMesh24','ArtMesh28','ArtMesh46','ArtMesh48','ArtMesh50','ArtMesh52'];
  const point=deformPoint(ids[0],1200,850,sample);
  for(const id of ids)assert.deepEqual(deformPoint(id,1200,850,sample),point);
  const other=deformPoint('ArtMesh52',1250,875,sample);
  assert(Math.abs(Math.hypot(other[0]-point[0],other[1]-point[1])-Math.hypot(50,25))<1e-8);
});
test('breathing stays gentle and continuous across complete cycles',()=>{
  const s=motionSample(1.974);assert.equal(s.breath,1);assert(s.lift>0&&s.lift<=6);
  for(let t=0;t<30;t+=.03){const a=deformPoint('ArtMesh28',1300,600,motionSample(t)),b=deformPoint('ArtMesh28',1300,600,motionSample(t+.001));assert(Math.hypot(a[0]-b[0],a[1]-b[1])<.06);}
  assert(motionSample(2,{sleep:true}).lift<motionSample(1.974).lift);
});
test('peak inhalation preserves width and limits stretching around anchored shoulders',()=>{
 const breathOnly={...motionSample(1.974),angle:0,sin:0,cos:1,drift:0,hair:0,ahoge:0};
 for(const id of ['ArtMesh28','ArtMesh35','ArtMesh36','ArtMesh37','ArtMesh15','ArtMesh16']){
   for(let y=600;y<1560;y+=5){
     const a=deformPoint(id,1200,y,breathOnly),b=deformPoint(id,1200,y+5,breathOnly);
     assert.equal(a[0],1200,'breathing must not widen the body');
     assert(Math.abs((b[1]-a[1])/5-1)<.035,`${id}: excessive vertical strain at ${y}`);
   }
 }
});
function fixture(){
 const ids=['ArtMesh35','ArtMesh37','ArtMesh52','ArtMesh17'];
 const positions=ids.map(()=>new Float32Array([-.2,.2,.2,.2,-.2,-.2,.2,-.2]));
 const uv=new Float32Array([0,0,1,0,0,1,1,1]),indices=new Uint16Array([0,1,2,1,3,2]);
 return {getModel:()=>({canvasinfo:{CanvasWidth:2426,CanvasHeight:2592,PixelsPerUnit:2426,CanvasOriginX:1213,CanvasOriginY:1296},drawables:{ids}}),getDrawableVertices:i=>positions[i],getDrawableVertexUvs:()=>uv,getDrawableVertexIndices:()=>indices,getDrawableDynamicFlagVertexPositionsDidChange:()=>false};
}
test('renderer adapter preserves Core data and produces valid tessellation without drift',()=>{
 const core=fixture(),before=JSON.stringify(core.getDrawableVertices(0)),a=createAmbientMotion(core,'working_thinking'),render=a.model;
 const base=a.snapshot();a.update(1.974);const peak=a.snapshot();a.update(10);a.update(1.974);assert.deepEqual(a.snapshot(),peak);
 a.update(0,{disabled:true});assert.deepEqual(a.snapshot(),base);assert.equal(JSON.stringify(core.getDrawableVertices(0)),before);
 const count=render.getDrawableVertexCount(0),uv=render.getDrawableVertexUvs(0),ind=render.getDrawableVertexIndices(0);
 assert(count>4);assert.equal(uv.length,count*2);assert(ind.every(i=>i<count));assert(uv.every(v=>v>=0&&v<=1));
 assert.equal(render.getDrawableVertices(3),core.getDrawableVertices(3));
 let area=0;for(let i=0;i<ind.length;i+=3){const [a,b,c]=Array.from(ind.slice(i,i+3),n=>[uv[2*n],uv[2*n+1]]);area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}assert.equal(area,1);
});
test('unrelated models remain untouched',()=>{
 const m=fixture(),a=createAmbientMotion(m,'idle_high_energy');assert.equal(a.update(2).enabled,false);assert.equal(a.model.getDrawableVertices(0),m.getDrawableVertices(0));
});
test('live state and sleep switches retain breathing phase without snapping',()=>{
 const a=createAmbientMotion(fixture(),'working_thinking');
 a.update(1.974,{live:true,state:'working_thinking'});const before=a.snapshot();
 a.update(1.974,{live:true,state:'idle_low_energy',sleep:true});assert.deepEqual(a.snapshot(),before);
 a.update(1.990,{live:true,state:'idle_low_energy',sleep:true});const after=a.snapshot();
 for(let m=0;m<before.length;m++)for(let i=0;i<before[m].vertices.length;i++)assert(Math.abs(before[m].vertices[i]-after[m].vertices[i])*2426<1);
});
test('new touches deform local working meshes while their attachment points remain fixed',()=>{
  const s={...motionSample(1.4),touch:{plant:.035,mascot:1,keyboard:1},ear:.025};
  for(const [id,x,y] of [['ArtMesh0',2140,1250],['ArtMesh1',1830,1500],['ArtMesh11',1520,1414],['ArtMesh6',1690,1370]])assert.notDeepEqual(deformPoint(id,x,y,s),deformPoint(id,x,y,{...s,touch:{}}));
  for(const [id,x,y] of [['ArtMesh0',2150,1500],['ArtMesh1',1821,1638],['ArtMesh11',1240,1510],['ArtMesh6',1690,1300],['ArtMesh2',817,1500]])assert.deepEqual(deformPoint(id,x,y,s),[x,y]);
});
test('working inverse points follow bounded extra hair, ahoge, ear and object reactions',()=>{
  const a=createAmbientMotion(fixture(),'working_thinking');a.update(1.4,{reaction:{hair:100,ahoge:-100,ear:10},touch:{plant:.035,mascot:1,keyboard:1}});
  const e=a.evidence();assert.deepEqual(e.reactionChannels,{hair:10,ahoge:-15,ear:.025});
  const s=motionSample(1.4);s.hair+=10;s.ahoge-=15;s.ear=.025;s.touch={plant:.035,mascot:1,keyboard:1};
  for(const [id,x,y] of [['ArtMesh35',850,1120],['ArtMesh33',1180,120],['ArtMesh26',1670,760],['ArtMesh31',1470,240],['ArtMesh0',2150,1230],['ArtMesh1',1810,1500],['ArtMesh11',1540,1430]]){
    const p=deformPoint(id,x,y,s),q=a.inversePoint(id,...p);assert(Math.hypot(q[0]-x,q[1]-y)<.01,`${id}: inverse mismatch`);
  }
});
