import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifeState, normalizeLifeState, applyInteraction, getProgression,
  claimGreeting, getGreeting, setTemporaryMode, getEffectiveMode,
  parseLifeState, serializeLifeState, LIFE_LIMITS } from './index.mjs';

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
  assert.equal(claimGreeting(s,opts(at(11)+60_000)).result.greeting.id,'greeting_noon');
  assert.doesNotThrow(()=>getGreeting({now:START,timeZone:'Bad/Timezone'}));
});

test('temporary modes expire, can be replaced/cancelled, and do not grant sleep XP', () => {
  const state=createLifeState(opts(START));
  const game=setTemporaryMode(state,'gaming_mode',{...opts(START),durationMs:5000});
  assert.equal(getEffectiveMode(game.state,opts(START+4999)),'gaming_mode');
  assert.equal(getEffectiveMode(game.state,opts(START+5000)),null);
  const sleep=setTemporaryMode(game.state,'sleep_mode',opts(START+1000));
  const pet=applyInteraction(sleep.state,'pet',opts(START+2000));
  assert.equal(pet.result.feedback,'sleepy_reaction'); assert.equal(pet.state.totalXp,0);
  assert.equal(setTemporaryMode(sleep.state,null,opts(START+2000)).state.temporaryMode,null);
  assert.equal(setTemporaryMode(sleep.state,'unknown',opts(START+2000)).result.accepted,false);
  const bounded=setTemporaryMode(state,'gaming_mode',{...opts(START),durationMs:999999999});
  assert.equal(bounded.state.temporaryMode.expiresAt-START,LIFE_LIMITS.maximumModeDurationMs);
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
  const state={...createLifeState(opts(START)),totalXp:98};
  assert.equal(getProgression(state,opts(START)).level,1);
  const update=applyInteraction(state,'click',opts(START));
  assert.equal(update.result.levelBefore,1); assert.equal(update.result.levelAfter,2);
  assert.equal(getProgression(update.state,opts(START)).xpToNextLevel,300);
  assert.equal(getProgression({...state,totalXp:400},opts(START)).level,3);
});
