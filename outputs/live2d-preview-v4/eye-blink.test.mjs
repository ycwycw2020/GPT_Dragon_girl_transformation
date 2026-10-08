import test from 'node:test';import assert from 'node:assert/strict';import {blinkClosure,clickBlinkClosure,interpolateCurve} from './eye-blink.mjs';
test('click blink closes fully and returns to rest without overriding a natural closure',()=>{
 assert.equal(clickBlinkClosure(-1),0);assert.equal(clickBlinkClosure(0),0);assert.equal(clickBlinkClosure(.14),1);assert.equal(clickBlinkClosure(.28),0);assert.equal(clickBlinkClosure(Infinity),0);
 for(let age=0;age<=.28;age+=.001){const q=clickBlinkClosure(age);assert(q>=0&&q<=1);assert(Math.abs(q-clickBlinkClosure(.28-age))<1e-12);assert(Math.max(blinkClosure(4.615),q)===1);}
});
test('paired blink has full closure, continuous transitions and open resting intervals',()=>{
 let previous=blinkClosure(0),closed=0,rest=0;
 for(let t=0;t<41;t+=.001){const q=blinkClosure(t);assert(q>=0&&q<=1);assert(Math.abs(q-previous)<.02);if(q===1)closed++;if(q===0)rest++;previous=q;}
 assert(closed>150);assert(rest>35000);assert.equal(blinkClosure(4.615),1);assert.equal(blinkClosure(0),0);assert.equal(blinkClosure(20.5),0);
});
test('aperture curve retains its endpoints and interpolates without extrapolation',()=>{
 const points=[[0,10],[10,30],[20,0]];assert.equal(interpolateCurve(points,-5),10);assert.equal(interpolateCurve(points,5),20);assert.equal(interpolateCurve(points,15),15);assert.equal(interpolateCurve(points,25),0);
});
