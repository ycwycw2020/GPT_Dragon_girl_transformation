import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifeState, normalizeLifeState, applyInteraction, getProgression,
  claimGreeting, getGreeting, setTemporaryMode, getEffectiveMode,
  parseLifeState, serializeLifeState, LIFE_LIMITS, LIFE_VERSION, LEVEL_COSTS, xpForLevel, tierFromLevel } from './index.mjs';

const START = Date.parse('2026-10-07T08:00:00+08:00');
const opts = now => ({ now, timeZone: 'Asia/Shanghai' });

test('rapid clicks cannot farm XP or affection; feedback and rewards use independent cooldowns', () => {
  let state = createLifeState(opts(START));
  let first = applyInteraction(state, 'click', opts(START));
  assert.equal(first.result.xpGained, 2);
  state = first.state;
  for (let i = 1; i < 1000; i++) state = applyInteraction(state, 'click', opts(START+i)).state;
  assert.equal(state.totalXp, 2); assert.equal(state.affection, 1);
  let mid = applyInteraction(state, 'pet', opts(START+2000));
  assert.equal(mid.result.accepted, true); assert.equal(mid.result.reason, 'reward_cooldown');
  let next = applyInteraction(mid.state, 'pet', opts(START+10_000));
  assert.equal(next.state.totalXp, 4); assert.equal(next.state.affection, 2);
});

test('daily cap also caps affection farming and resets on the next local calendar day', () => {
  let state = createLifeState(opts(START));
  for (let i=0; i<100; i++) state=applyInteraction(state,'click',opts(START+i*10_000)).state;
  assert.equal(state.daily.xp, LIFE_LIMITS.dailyXp);
  assert.equal(state.totalXp, 30); assert.equal(state.affection, 15);
  const next=applyInteraction(state,'click',opts(START+86_400_000));
  assert.equal(next.state.daily.xp,2); assert.equal(next.state.totalXp,32);
});

test('clock rollback does not reset a future daily budget or award another reward', () => {
  const awarded=applyInteraction(createLifeState(opts(START)),'click',opts(START)).state;
  const back=applyInteraction(awarded,'click',opts(START-86_400_000));
  assert.equal(back.result.reason,'clock_rollback');
  assert.equal(back.state.daily.dayKey,'2026-10-07');
  assert.equal(back.state.totalXp,2);
});

test('greetings honor supplied timezone and claim once per day/period without consuming sleeping greetings', () => {
  const at = hour => Date.parse(`2026-10-07T${String(hour).padStart(2,'0')}:00:00+08:00`);
  assert.equal(getGreeting(opts(at(5))).period,'morning');
  assert.equal(getGreeting(opts(at(11))).period,'noon');
  assert.equal(getGreeting(opts(at(18))).period,'evening');
  let a=claimGreeting(createLifeState(opts(at(8))),opts(at(8)));
  assert.equal(a.result.greeting.id,'greeting_morning');
  assert.equal(claimGreeting(a.state,opts(at(9))).result.reason,'already_greeted');
  let s=setTemporaryMode(a.state,'sleep_mode',{...opts(at(11)),durationMs:60_000}).state;
  assert.equal(claimGreeting(s,opts(at(11))).result.reason,'sleeping');
  assert.equal(claimGreeting(s,opts(at(11)+60_000)).result.reason,'sleeping');
  s=setTemporaryMode(s,null,opts(at(11)+60_000)).state;
  assert.equal(claimGreeting(s,opts(at(11)+60_000)).result.greeting.id,'greeting_noon');
  assert.doesNotThrow(()=>getGreeting({now:START,timeZone:'Bad/Timezone'}));
});

test('rest persists without an expiry, can be cancelled, rejects gaming, and grants no sleeping XP', () => {
  const state=createLifeState(opts(START));
  const game=setTemporaryMode(state,'gaming_mode',{...opts(START),durationMs:5000});
  assert.equal(game.result.accepted,false);
  assert.equal(getEffectiveMode(game.state,opts(START+4999)),null);
  const sleep=setTemporaryMode(game.state,'sleep_mode',opts(START+1000));
  const pet=applyInteraction(sleep.state,'pet',opts(START+2000));
  assert.equal(pet.result.feedback,'sleepy_reaction'); assert.equal(pet.state.totalXp,0);
  assert.equal(setTemporaryMode(sleep.state,null,opts(START+2000)).state.temporaryMode,null);
  assert.equal(setTemporaryMode(sleep.state,'unknown',opts(START+2000)).result.accepted,false);
  const persistent=setTemporaryMode(state,'sleep_mode',{...opts(START),durationMs:1000});
  assert.equal('expiresAt' in persistent.state.temporaryMode,false);
  assert.equal(getEffectiveMode(persistent.state,opts(START+86_400_000*365)),'sleep_mode');
});

test('malformed persistence falls back, unknown fields are dropped, inputs are not mutated', () => {
  assert.deepEqual(parseLifeState('{broken',opts(START)),createLifeState(opts(START)));
  assert.deepEqual(normalizeLifeState({version:99},opts(START)),createLifeState(opts(START)));
  const bad={version:1,totalXp:Infinity,affection:999,daily:{dayKey:'2026-99-45',xp:999},
    greetingKeys:[null,'bad','2026-13-01/morning'],temporaryMode:{kind:'gaming_mode',startedAt:START,expiresAt:START+999999999},extra:'drop'};
  const safe=normalizeLifeState(bad,opts(START));
  assert.equal(safe.totalXp,0); assert.equal(safe.affection,100); assert.equal(safe.daily.xp,0);
  assert.equal(safe.temporaryMode,null); assert.equal('extra' in safe,false); assert.deepEqual(safe.greetingKeys,[]);
  const original=createLifeState(opts(START)); const saved=structuredClone(original);
  applyInteraction(original,'pet',opts(START)); assert.deepEqual(original,saved);
  assert.deepEqual(parseLifeState(serializeLifeState(safe,opts(START)),opts(START)),safe);
});

test('level progression has exact boundaries and reports level-up in the interaction event', () => {
  const state={...createLifeState(opts(START)),totalXp:4};
  assert.equal(getProgression(state,opts(START)).level,1);
  const update=applyInteraction(state,'click',opts(START));
  assert.equal(update.result.levelBefore,1); assert.equal(update.result.levelAfter,2);
  assert.equal(getProgression(update.state,opts(START)).xpToNextLevel,8);
  assert.equal(getProgression({...state,totalXp:14},opts(START)).level,3);
});

test('100-level costs grow for ten levels then stay fixed, with exact tier and progress boundaries',()=>{
  assert.deepEqual(LEVEL_COSTS.slice(0,10),[6,8,10,12,14,16,18,20,22,24]);
  assert.equal(LEVEL_COSTS.length,99);assert(LEVEL_COSTS.slice(10).every(cost=>cost===24));
  assert.equal(xpForLevel(4),24);assert.equal(xpForLevel(7),66);assert.equal(xpForLevel(100),2286);
  for(let level=1;level<=100;level++){
    const p=getProgression({...createLifeState(opts(START)),totalXp:xpForLevel(level)},opts(START));
    assert.equal(p.level,level);assert.equal(p.affectionLevel,level);assert.equal(p.tier,tierFromLevel(level));
    assert.equal(p.progress,level===100?1:0);assert.equal(p.isMax,level===100);
    if(level<100){assert.equal(p.levelXpCost,LEVEL_COSTS[level-1]);assert.equal(p.xpToNextLevel,p.levelXpCost);}
    if(level>1)assert.equal(getProgression({...createLifeState(opts(START)),totalXp:xpForLevel(level)-1},opts(START)).level,level-1);
  }
  for(const [n,t] of [[1,'low'],[3.999,'low'],[4,'mid'],[6.999,'mid'],[7,'high'],[100,'high'],[NaN,'low'],[null,'low']])assert.equal(tierFromLevel(n),t);
  const halfway=getProgression({...createLifeState(opts(START)),totalXp:3},opts(START));
  assert.equal(halfway.progress,.5);assert.equal(halfway.reactionLevel,1.5);
});

test('legacy saves preserve cumulative XP, never lose level, and affection migration credit applies only once',()=>{
  for(const [totalXp,oldAffection,explicitLevel] of [[0,100,1],[30,15,1],[100,30,2],[10000,60,11],[1_000_000,100,100],[0,0,8]]){
    const old={...createLifeState(opts(START)),version:1,totalXp,affection:oldAffection,level:explicitLevel};
    const saved=structuredClone(old),up=normalizeLifeState(old,opts(START)),p=getProgression(up,opts(START));
    assert.equal(up.version,LIFE_VERSION);assert.equal(up.totalXp,totalXp);assert.equal(up.affection,oldAffection);
    assert(p.level>=Math.min(100,Math.max(explicitLevel,Math.floor(Math.sqrt(totalXp/100))+1)));
    assert.deepEqual(normalizeLifeState(up,opts(START)),up);assert.deepEqual(old,saved);
  }
  const low=normalizeLifeState({...createLifeState(opts(START)),version:1,totalXp:0,affection:20},opts(START));
  assert.equal(low.totalXp,0);assert.equal(getProgression(low,opts(START)).level,3);
  const high=normalizeLifeState({...createLifeState(opts(START)),version:1,totalXp:0,affection:100},opts(START));
  assert.equal(getProgression(high,opts(START)).level,10);assert.equal(high.migrationBonusXp,126);
});

test('MAX locks progress and rewards while preserving existing lifetime XP',()=>{
  const previous={...createLifeState(opts(START)),totalXp:xpForLevel(100)-1};
  const final=applyInteraction(previous,'pet',opts(START));
  assert.equal(final.result.xpGained,1);assert.equal(final.result.levelAfter,100);
  const p=getProgression(final.state,opts(START));
  assert.equal(p.progress,1);assert.equal(p.xpToNextLevel,0);assert.equal(p.nextLevelXp,null);assert.equal(p.levelXpCost,0);
  const locked=applyInteraction(final.state,'pet',opts(START+10_000));
  assert.equal(locked.result.reason,'max_level');assert.equal(locked.result.xpGained,0);assert.equal(locked.state.totalXp,2286);
  const oldHuge={...createLifeState(opts(START)),version:1,totalXp:1_000_000,affection:100};
  const huge=normalizeLifeState(oldHuge,opts(START));assert.equal(huge.totalXp,1_000_000);assert.equal(getProgression(huge,opts(START)).level,100);
});

test('legacy active sleep becomes indefinite, expired sleep stays awake, gaming is removed',()=>{
  const base={...createLifeState(opts(START)),version:1};
  const oldSleep={kind:'sleep_mode',startedAt:START-1000,expiresAt:START+1000};
  const up=normalizeLifeState({...base,temporaryMode:oldSleep},opts(START));
  assert.deepEqual(up.temporaryMode,{kind:'sleep_mode',startedAt:START-1000,restBaseline:[]});
  assert.equal(getEffectiveMode(up,opts(START+86_400_000*10)),'sleep_mode');
  assert.equal(normalizeLifeState({...base,temporaryMode:oldSleep},opts(START+1000)).temporaryMode,null);
  assert.equal(normalizeLifeState({...base,temporaryMode:{...oldSleep,kind:'gaming_mode'}},opts(START)).temporaryMode,null);
});

test('rest baseline persists only hashed identifiers and is retained across save/load',()=>{
  const id='a'.repeat(64),turn='b'.repeat(64),tasks=[{id,turn,prompt:'private',updatedAt:START}];
  const sleep=setTemporaryMode(createLifeState(opts(START)),'sleep_mode',{...opts(START),restBaseline:tasks}).state;
  assert.deepEqual(sleep.temporaryMode.restBaseline,[{id,turn}]);
  const json=serializeLifeState(sleep,opts(START));assert(!json.includes('private'));
  assert.deepEqual(parseLifeState(json,opts(START+86400000)).temporaryMode,sleep.temporaryMode);
});
