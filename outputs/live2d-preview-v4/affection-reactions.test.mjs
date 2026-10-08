import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {REACTIONS,REACTION_CHANNEL_LIMITS,AFFECTION_TARGETS,AFFECTION_TARGET_METADATA,affectionTier,unlockedReactions,allUnlockedReactions,sampleReaction,createReactionController} from './affection-reactions.mjs';
import {createLifeState,getProgression,xpForLevel,LEVEL_COSTS} from '../dragon-companion-app-v4/life/index.mjs';

test('90 distinct performances cover six touch targets and five unlocks per affection tier',()=>{
  assert.equal(REACTIONS.length,90);assert.equal(new Set(REACTIONS.map(r=>r.id)).size,90);
  assert.deepEqual(AFFECTION_TARGETS,['leg','tail','head','horn','cheek','hand']);
  assert.deepEqual(AFFECTION_TARGET_METADATA.map(t=>t.id),AFFECTION_TARGETS);
  assert(AFFECTION_TARGET_METADATA.every(t=>Object.isFrozen(t)&&t.label&&t.description));
  for(const target of AFFECTION_TARGETS)for(const [tier,levels] of Object.entries({low:[1,1.5,2,2.5,3],mid:[4,4.5,5,5.5,6],high:[7,7.75,8.5,9.25,10]})){
    const pool=REACTIONS.filter(r=>r.target===target&&r.tier===tier);
    assert.deepEqual(pool.map(r=>r.unlock),levels);
    assert(pool.every(r=>r.duration>=2&&r.duration<=4&&r.label&&r.icon&&/[\u4e00-\u9fff]/u.test(r.text)));
  }
});

test('tier boundaries immediately switch to the correct behavior and unlocks are inclusive',()=>{
  for(const [n,tier] of [[-1,'low'],[1,'low'],[3.999,'low'],[4,'mid'],[6.999,'mid'],[7,'high'],[100,'high'],[10000,'high']])assert.equal(affectionTier(n),tier);
  for(const target of AFFECTION_TARGETS)for(const record of REACTIONS.filter(r=>r.target===target)){
    assert(unlockedReactions(record.unlock,target).some(r=>r.id===record.id));
    if(record.unlock>1)assert(!unlockedReactions(record.unlock-.001,target).some(r=>r.id===record.id));
    assert(unlockedReactions(record.unlock,target).every(r=>r.tier===record.tier));
  }
  assert.equal(allUnlockedReactions(10).length,90);
  assert.equal(allUnlockedReactions(100).length,90);
  assert.equal(allUnlockedReactions(7,'leg').length,11);
  assert.equal(unlockedReactions(4,'tail').length,1);
  assert.equal(unlockedReactions(7,'tail').length,1);
});

test('malformed affection safely falls back to the first tier without unlocking mature tiers',()=>{
  for(const n of [NaN,Infinity,-Infinity,undefined,null,'99',{},[]]){
    assert.equal(affectionTier(n),'low');
    assert.equal(unlockedReactions(n,'leg').length,1);
    assert.equal(allUnlockedReactions(n).length,6);
  }
  assert.deepEqual(unlockedReactions(100,'face'),[]);
});

test('all 90 performances have distinct motion geometry over time, not merely different decoration',()=>{
  const geometry=['headX','headY','headAngle','tail','leg','handY','handAngle','hair','ahoge','ear'];
  const fingerprints=REACTIONS.map(record=>Array.from({length:49},(_,i)=>{
    const s=sampleReaction(record,(i+1)*record.duration/50);
    return geometry.map(k=>s.channels[k].toFixed(5)).join(',');
  }).join(';'));
  assert.equal(new Set(fingerprints).size,90);
  for(let i=0;i<REACTIONS.length;i++){
    const record=REACTIONS[i],required={leg:['leg'],tail:['tail'],head:['headX','headY'],horn:['headAngle','ear'],cheek:['headX','headY'],hand:['handY','handAngle']}[record.target];
    assert(Array.from({length:49},(_,j)=>required.some(key=>Math.abs(sampleReaction(record,(j+1)*record.duration/50).channels[key])>.003)).some(Boolean),record.id);
  }
});

test('every channel is finite, bounded, and returns exactly to neutral at both ends',()=>{
  for(const record of REACTIONS){
    for(const age of [0,record.duration,record.duration+3])assert(Object.values(sampleReaction(record,age).channels).every(v=>v===0),record.id);
    for(let i=0;i<=400;i++){
      const {channels}=sampleReaction(record,record.duration*i/400);
      for(const [key,[lo,hi]] of Object.entries(REACTION_CHANNEL_LIMITS))assert(Number.isFinite(channels[key])&&channels[key]>=lo&&channels[key]<=hi,`${record.id}:${key}`);
    }
    for(const age of [1e-5,record.duration-1e-5])for(const [key,val] of Object.entries(sampleReaction(record,age).channels))assert(Math.abs(val)<.01,`${record.id} jumps at ${key}`);
  }
  assert.equal(sampleReaction('missing',1).active,false);
  for(const age of [NaN,Infinity,-1])assert.equal(sampleReaction(REACTIONS[0],age).active,false);
});

test('repeated clicks do not stack or restart an active reaction',()=>{
  const c=createReactionController({random:()=>0}),first=c.trigger('leg',100,10);
  assert.equal(first.accepted,true);
  const before=c.sample(10.4);
  assert.equal(c.trigger('tail',100,10.4).reason,'busy');
  assert.deepEqual(c.sample(10.4),before);
  assert.equal(c.sample(10+first.record.duration).active,false);
  assert.equal(c.trigger('tail',100,20).accepted,true);
  c.cancel();assert.equal(c.sample(20.1).active,false);
});

test('current-tier unlocked performances rotate without immediate repetition when alternatives exist',()=>{
  const c=createReactionController({random:()=>0});let t=0;
  for(const target of AFFECTION_TARGETS)for(const value of [3.999,6.999,100]){
    const ids=[];
    for(let i=0;i<10;i++){
      const out=c.trigger(target,value,t);assert(out.accepted);ids.push(out.record.id);
      assert.equal(out.record.tier,affectionTier(value));assert(out.record.unlock<=value);
      t+=out.record.duration+.1;
    }
    assert.equal(new Set(ids.slice(0,5)).size,5);
    assert.deepEqual(ids.slice(0,5),ids.slice(5));
    for(let i=1;i<ids.length;i++)assert.notEqual(ids[i],ids[i-1]);
  }
});

test('sampling uses caller time, supports paused clocks, and preview does not alter live selection',()=>{
  const c=createReactionController({random:()=>0});const first=c.trigger('tail',30,0);
  assert(first.accepted);assert.deepEqual(c.sample(1),c.sample(1));
  for(const record of REACTIONS)sampleReaction(record,record.duration/2);
  assert.equal(c.sample(1).record.id,first.record.id);
  assert.equal(c.trigger('leg',30,NaN).reason,'invalid_time');
  assert.equal(c.trigger('ear',30,1).reason,'invalid_target');
  assert.equal(c.sample(1).record.id,first.record.id);
});

test('invalid random providers cannot select out of range',()=>{
  for(const random of [()=>NaN,()=>Infinity,()=>-5,()=>5,()=>{throw Error('unavailable');}]){
    const c=createReactionController({random});assert(c.trigger('leg',100,0).accepted);
  }
});

test('real growth progress unlocks fractional-level actions without treating legacy affection as level',()=>{
  const now=Date.parse('2026-10-07T08:00:00+08:00'),options={now,timeZone:'Asia/Shanghai'};
  for(const record of REACTIONS){
    const level=Math.floor(record.unlock),progress=record.unlock-level;
    const threshold=xpForLevel(level)+Math.ceil(LEVEL_COSTS[level-1]*progress);
    const state={...createLifeState(options),totalXp:threshold,affection:100};
    const p=getProgression(state,options);
    assert(unlockedReactions(p.reactionLevel,record.target).some(r=>r.id===record.id),record.id);
    if(threshold>0){const prior=getProgression({...state,totalXp:threshold-1},options);assert(!unlockedReactions(prior.reactionLevel,record.target).some(r=>r.id===record.id),record.id);}
  }
  assert.equal(affectionTier(getProgression({...createLifeState(options),affection:100},options).reactionLevel),'low');
});

test('original thirty performance records and sampled channels remain byte-for-byte unchanged',()=>{
  const originals=REACTIONS.filter(record=>['leg','tail'].includes(record.target));
  const keys=['headX','headY','headAngle','tail','leg','handY','handAngle','bounce','blink','blush','hearts','anger','embarrassed','pulse','fist'];
  const snapshot=originals.map(record=>({record,samples:Array.from({length:49},(_,i)=>keys.map(k=>sampleReaction(record,(i+1)*record.duration/50).channels[k]))}));
  assert.equal(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),'dc382dcd087d4edd1a08d4a0432c6975927eff39798b1263527b0e98fcfac492');
});

test('new touch targets use existing modest expression assets and never force low-tier anger',()=>{
  const extras=REACTIONS.filter(record=>!['leg','tail'].includes(record.target));
  assert.equal(extras.length,60);
  assert.equal(new Set(extras.map(record=>record.text)).size,60);
  assert.equal(new Set(extras.map(record=>record.label)).size,60);
  for(const record of extras){
    assert.equal(record.pose,record.tier==='high'?'affectionate':'shy');
    assert.equal(sampleReaction(record,record.duration/2).channels.anger,0);
    assert.equal(sampleReaction(record,record.duration/2).channels.fist,0);
  }
});

test('all six targets are triggerable at level one and level one hundred; unknown empty pools are safe',()=>{
  const c=createReactionController({random:()=>.999});let clock=0;
  for(const target of AFFECTION_TARGETS)for(const level of [1,4,7,10,100]){
    const result=c.trigger(target,level,clock);
    assert(result.accepted);assert(result.record);assert.equal(result.record.target,target);
    assert.equal(result.record.tier,affectionTier(level));clock+=result.record.duration+.1;
  }
  for(const target of ['missing','',undefined,null,{},[]]){
    assert.deepEqual(unlockedReactions(100,target),[]);
    assert.deepEqual(c.trigger(target,100,clock),{accepted:false,record:null,reason:'invalid_target'});
  }
  assert.deepEqual(REACTION_CHANNEL_LIMITS.hair,[-10,10]);
  assert.deepEqual(REACTION_CHANNEL_LIMITS.ahoge,[-15,15]);
  assert.deepEqual(REACTION_CHANNEL_LIMITS.ear,[-.025,.025]);
});
