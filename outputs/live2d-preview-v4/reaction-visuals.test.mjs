import test from 'node:test';
import assert from 'node:assert/strict';
import {reactionOpacity,reactionHandPoint,REACTION_PATCH_BOUNDS} from './reaction-visuals.mjs';

test('reaction patches enter and leave continuously and disappear when idle',()=>{
  const sample=progress=>reactionOpacity({active:true,record:{pose:'angry'},progress});
  assert.equal(sample(0),0);assert.equal(sample(1),0);assert.equal(sample(.5),1);
  assert.equal(reactionOpacity({active:false,record:{pose:'angry'},progress:.5}),0);
  assert.equal(reactionOpacity({active:true,record:{pose:'unknown'},progress:.5}),0);
  assert.equal(reactionOpacity({active:true,record:{pose:'sleep'},progress:0}),1);
  assert.equal(reactionOpacity({active:true,record:{pose:'sleep'},progress:1}),1);
  let previous=sample(0);
  for(let p=0;p<=1;p+=.001){const q=sample(p);assert.ok(q>=0&&q<=1);assert.ok(Math.abs(q-previous)<.025);previous=q;}
});

test('fist motion fixes sleeve and desk contact while moving the centre',()=>{
  const extremes=[{handY:-30,handAngle:.08},{handY:12,handAngle:-.08},{handY:-30,handAngle:-.08},{handY:12,handAngle:.08}];
  for(const c of extremes){
    for(const [x,y] of [[940,1400],[970,1390],[1250,1400],[1100,1515],[995,1295]])assert.deepEqual(reactionHandPoint(x,y,c),[x,y]);
    const moved=reactionHandPoint(1100,1400,c);assert.ok(Math.hypot(moved[0]-1100,moved[1]-1400)>2);
    for(let y=1290;y<=1530;y+=8)for(let x=930;x<=1255;x+=8){
      const q=reactionHandPoint(x,y,c);assert.ok(q.every(Number.isFinite));assert.ok(Math.hypot(q[0]-x,q[1]-y)<48);
      const dx=reactionHandPoint(x+.25,y,c),dy=reactionHandPoint(x,y+.25,c);
      const det=((dx[0]-q[0])*(dy[1]-q[1])-(dx[1]-q[1])*(dy[0]-q[0]))/.0625;
      assert.ok(det>.1,'The hand surface must not fold over at an animation extreme.');
    }
  }
  assert.deepEqual(REACTION_PATCH_BOUNDS.face,[1050,570,1580,1025]);
});
