import test from 'node:test';import assert from 'node:assert/strict';
import {EXTRA_TOUCH_TARGETS,sampleExtraTouch,createExtraTouchController,extraObjectDisplacement,extraCharacterDisplacement,pickExtraTouch} from './extra-touch.mjs';
test('four object motions are bounded, distinct and have soft endpoints',()=>{
  const objects=EXTRA_TOUCH_TARGETS.filter(t=>t.kind==='object'),signatures=[];assert.equal(objects.length,4);
  for(const record of objects){const values=[];for(let n=0;n<=100;n++){const v=sampleExtraTouch(record.id,record.duration*n/100);values.push(v);assert(Number.isFinite(v));assert(Math.abs(v)<=(record.id==='plant'?.035:1));}
    assert.equal(values[0],0);assert.equal(values.at(-1),0);assert(values.some(v=>Math.abs(v)>0));signatures.push(JSON.stringify(values));
  }assert.equal(new Set(signatures).size,4);
  assert.equal(sampleExtraTouch('head',.2),0);assert.equal(sampleExtraTouch('cup',NaN),0);
});
test('object controller prevents stacking, expires and clears without touching life data',()=>{
  const c=createExtraTouchController();assert(!c.trigger('head',0));assert(c.trigger('mascot',0));assert(!c.trigger('mascot',.1));
  assert(c.sample(.5).playing.includes('mascot'));assert.deepEqual(c.sample(2).playing,[]);assert(c.trigger('mascot',2));c.clear();
  assert.deepEqual(c.sample(3),{values:{plant:0,mascot:0,keyboard:0,cup:0},playing:[],last:null});
});
test('object roots, cup, desk, horns and face are pinned',()=>{
  const touch={plant:.035,mascot:1,keyboard:1};
  for(const [x,y] of [[817,1500],[2150,1500],[1821,1638],[1400,1600],[1240,1510]])assert(extraObjectDisplacement(x,y,touch).every(v=>v===0));
  const reaction={hair:10,ahoge:15,ear:.025};
  for(const [x,y] of [[810,250],[1460,270],[1200,850],[1480,750],[1385,925],[1020,973],[1615,790],[1000,1430]])assert(extraCharacterDisplacement(x,y,reaction).every(v=>v===0),`unpinned ${x},${y}`);
});
test('local fields stay invertible at simultaneous motion extremes',()=>{
  let minDet=Infinity,maxLength=0;
  for(const sign of [-1,1])for(let y=0;y<=1740;y+=15)for(let x=0;x<=2420;x+=15){
    const field=(x,y)=>{const a=extraObjectDisplacement(x,y,{plant:.035*sign,mascot:sign,keyboard:1}),b=extraCharacterDisplacement(x,y,{hair:10*sign,ahoge:15*sign,ear:.025*sign});return [a[0]+b[0],a[1]+b[1]];};
    const q=field(x,y),dx=field(x+1,y),dy=field(x,y+1),det=(1+dx[0]-q[0])*(1+dy[1]-q[1])-(dx[1]-q[1])*(dy[0]-q[0]);
    minDet=Math.min(minDet,det);maxLength=Math.max(maxLength,Math.hypot(...q));
  }assert(minDet>.7,`min determinant ${minDet}`);assert(maxLength<18);
});
test('semantic regions preserve eye clicks and reject all transparent pixels',()=>{
  const points={head:[1150,400],horn:[830,260],cheek:[1290,935],hand:[1055,1370],cup:[817,1500],plant:[2140,1300],mascot:[1830,1540],keyboard:[1530,1420]};
  for(const state of ['working_thinking','idle_high_energy','idle_mid_energy','idle_low_energy'])for(const [id,p] of Object.entries(points)){
    assert.equal(pickExtraTouch(...p,{state,alphaAt:()=>255})?.id,id,`${state}:${id}`);
    assert.equal(pickExtraTouch(...p,{state,alphaAt:()=>0}),null);
  }
  for(const p of [[1200,840],[1480,740],[30,300],[1400,1800]])assert.equal(pickExtraTouch(...p,{alphaAt:()=>255}),null);
  assert.equal(pickExtraTouch(1150,400,{state:'sleep_mode',alphaAt:()=>255}),null);
  assert.equal(pickExtraTouch(1150,400,{alphaAt:()=>255,maskAt:()=>0}),null);
  assert.equal(pickExtraTouch(NaN,400,{alphaAt:()=>255}),null);
});
test('working and idle picking use the same inverse transforms as their renderers',()=>{
  assert.equal(pickExtraTouch(1170,407,{state:'idle_high_energy',alphaAt:()=>255,inversePoint:(x,y)=>[x-20,y-7]})?.id,'head');
  const ids=[];assert.equal(pickExtraTouch(1170,407,{alphaAt:()=>255,workingInverse:(id,x,y)=>{ids.push(id);return [x-20,y-7];}})?.id,'head');assert(ids.includes('ArtMesh35')||ids.includes('ArtMesh34')||ids.includes('ArtMesh33'));
});
