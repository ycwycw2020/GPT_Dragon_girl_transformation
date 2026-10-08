import test from 'node:test';
import assert from 'node:assert/strict';
import {legMotionSample,forwardLegPoint,inverseLegPoint,legHitTest,LEG_MAX_ANGLE} from './leg-motion.mjs';

const states=['working_thinking','idle_high_energy','idle_mid_energy','idle_low_energy'];

test('leg sway is optional, finite, bounded, and starts at the approved rest pose',()=>{
  assert.deepEqual(legMotionSample(0),{front:0,back:0});
  for(const state of states)assert.deepEqual(legMotionSample(1.4,{state,disabled:true,reactionLeg:.012}),{front:0,back:0});
  assert.deepEqual(legMotionSample(NaN),{front:0,back:0});
  for(let t=0;t<120;t+=.02){const s=legMotionSample(t);assert(Math.abs(s.front)<=.0175);assert(Math.abs(s.back)<=.0169);}
});

test('all four states use the same clock and phase, including after a state change',()=>{
  for(let t=0;t<30;t+=.033){
    const expected=legMotionSample(t);
    for(const state of states)assert.deepEqual(legMotionSample(t,{state}),expected);
  }
  for(const state of states){
    const moved=legMotionSample(1.45,{state});assert(moved.front>.01&&moved.back>.01);
    const left=legMotionSample(4.35,{state});assert(left.front<-.01&&left.back<-.01);
  }
  const awake=legMotionSample(1.45),sleep=legMotionSample(1.45,{sleep:true});
  assert.equal(sleep.front,awake.front*.25);assert.equal(sleep.back,awake.back*.25);
  assert.deepEqual(legMotionSample(1.45,{state:'sleep_mode'}),sleep);
});

test('reaction overlays are finite and limited without overpowering the leg warp',()=>{
  for(const state of states)for(const reactionLeg of [-100,-.012,0,.012,100,NaN,Infinity])for(let t=0;t<12;t+=.11){
    const sample=legMotionSample(t,{state,reactionLeg});
    assert(Number.isFinite(sample.front)&&Number.isFinite(sample.back));
    assert(Math.abs(sample.front)<=LEG_MAX_ANGLE&&Math.abs(sample.back)<=LEG_MAX_ANGLE);
  }
  assert.deepEqual(legMotionSample(0,{reactionLeg:.012}),{front:.012,back:.012});
  assert.deepEqual(legMotionSample(0,{reactionLeg:-.012}),{front:-.012,back:-.012});
});

test('thigh, chair, desk and outer correction boundary are exactly pinned',()=>{
  const anchors=[[1100,1810],[1240,1900],[1420,1900],[1110,2140],[1200,2300],[1780,2260],[1800,2470],[1530,2560],[980,1820],[1780,2420],[1570,2145],[1680,2185],[1740,2300],[1720,2320]];
  for(const reactionLeg of [-.012,0,.012])for(let t=0;t<15;t+=.13)for(const p of anchors)assert.deepEqual(forwardLegPoint(...p,legMotionSample(t,{reactionLeg})),p);
});

test('the lower legs rotate a few pixels without moving an entire image quad',()=>{
  let max=0,min=0;
  for(let t=0;t<18;t+=.03){const s=legMotionSample(t);for(const p of [[1450,2430],[1620,2400]]){
    const moved=forwardLegPoint(...p,s),d=moved[0]-p[0];max=Math.max(max,d);min=Math.min(min,d);
    assert(Math.hypot(moved[0]-p[0],moved[1]-p[1])<13);
  }}
  assert(max>8&&min< -8);
});

test('inverse sampling is single-valued and returns source positions without old-pose ghosts',()=>{
  let maxRoundTrip=0,minJacobian=Infinity;
  for(const reactionLeg of [-.012,0,.012])for(const time of [0,1.45,4.35,7.25,10.15]){
    const s=legMotionSample(time,{reactionLeg});
    for(let y=1940;y<2540;y+=9)for(let x=1150;x<1780;x+=9){
      const f=forwardLegPoint(x,y,s),p=inverseLegPoint(...f,s);
      maxRoundTrip=Math.max(maxRoundTrip,Math.hypot(p[0]-x,p[1]-y));
      const dx=forwardLegPoint(x+.1,y,s),dy=forwardLegPoint(x,y+.1,s);
      minJacobian=Math.min(minJacobian,((dx[0]-f[0])*(dy[1]-f[1])-(dx[1]-f[1])*(dy[0]-f[0]))/.01);
    }
  }
  assert(maxRoundTrip<.15,`maximum inverse residual ${maxRoundTrip}`);
  assert(minJacobian>.45,`no folds: smallest Jacobian ${minJacobian}`);
});

test('hit testing follows repaired legs and shoes rather than the obsolete mesh',()=>{
  const legPoints=[[1250,1900],[1350,2070],[1430,2320],[1465,2450],[1430,2040],[1510,2240],[1660,2420]];
  const otherPoints=[[1100,1810],[1120,2190],[1050,2310],[1280,2320],[1640,2170],[1740,2300],[1780,2460],[1920,2240],[1500,1700],[1210,2180],[1400,2540]];
  for(const reactionLeg of [-.012,0,.012])for(const time of [0,1.45,4.35]){
    const motion=legMotionSample(time,{reactionLeg});
    for(const point of legPoints){
      const moved=forwardLegPoint(...point,motion);
      assert(legHitTest(...moved,motion),`leg or shoe ${point}`);
      assert(!legHitTest(...moved,motion,()=>0),'transparent source pixel cannot be touched');
    }
    for(const point of otherPoints){
      const moved=forwardLegPoint(...point,motion);
      assert(!legHitTest(...moved,motion),`non-leg ${point}`);
    }
  }
  assert(!legHitTest(NaN,2300));assert(!legHitTest(1500,Infinity));
});
