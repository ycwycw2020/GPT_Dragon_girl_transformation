/** Local, storage-agnostic companion life state. No I/O, timers, or renderer calls. */
import {normalizeRestBaseline} from '../rest-wakeup.mjs';
export const LIFE_VERSION = 2;
export const LIFE_LIMITS = Object.freeze({
  xpPerInteraction: 2, affectionPerInteraction: 1, dailyXp: 30,
  rewardCooldownMs: 10_000, feedbackCooldownMs: 350,
  maxLevel: 100,
});
const MAX_XP = 1_000_000_000;
const MODES = new Set(['sleep_mode']);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, fallback, min, max) => Number.isSafeInteger(v) ? Math.min(max, Math.max(min, v)) : fallback;
const timestamp = v => Number.isSafeInteger(v) && v >= 0 && v <= 8_640_000_000_000_000 ? v : null;
export const LEVEL_COSTS = Object.freeze(Array.from({length:99},(_,i)=>i<10?6+i*2:24));
const LEVEL_STARTS=Object.freeze([0,...LEVEL_COSTS.reduce((all,cost)=>[...all,(all.at(-1)??0)+cost],[])]);
export function xpForLevel(level){return LEVEL_STARTS[integer(level,1,1,100)-1];}
export function tierFromLevel(level){const n=typeof level==='number'&&Number.isFinite(level)?Math.max(1,Math.min(100,level)):1;return n<4?'low':n<7?'mid':'high';}
function legacyAffectionLevel(value){return value<30?1+Math.floor(value/10):value<70?Math.min(6,4+Math.floor((value-30)/14)):Math.min(10,7+Math.floor((value-70)/10));}

function context(options = {}) {
  const now = timestamp(options.now) ?? Date.now();
  let timeZone = options.timeZone;
  if (typeof timeZone !== 'string') timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let formatter;
  const settings = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' };
  try { formatter = new Intl.DateTimeFormat('en-CA', settings); }
  catch { timeZone = 'UTC'; formatter = new Intl.DateTimeFormat('en-CA', { ...settings, timeZone }); }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { now, timeZone, dayKey: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createLifeState(options = {}) {
  const { now, dayKey } = context(options);
  return { version: LIFE_VERSION, totalXp: 0, affection: 0, migrationBonusXp:0,
    daily: { dayKey, xp: 0, interactions: 0 }, lastRewardAt: null,
    lastInteractionAt: null, greetingKeys: [], temporaryMode: null, updatedAt: now };
}

/** Copy/sanitize external data. Advancing days resets the budget; clock rollback does not. */
export function normalizeLifeState(input, options = {}) {
  const ctx = context(options), fresh = createLifeState({ ...options, now: ctx.now });
  if (!record(input) || (input.version !== LIFE_VERSION && input.version !== 1)) return fresh;
  const state = { ...fresh,
    totalXp: integer(input.totalXp, 0, 0, MAX_XP),
    affection: integer(input.affection, 0, 0, 100),
    migrationBonusXp:input.version===LIFE_VERSION?integer(input.migrationBonusXp,0,0,MAX_XP):0,
    lastRewardAt: timestamp(input.lastRewardAt), lastInteractionAt: timestamp(input.lastInteractionAt),
    updatedAt: timestamp(input.updatedAt) ?? ctx.now,
  };
  if(input.version===1){
    const oldLevel=Math.max(Math.floor(Math.sqrt(state.totalXp/100))+1,integer(input.level,1,1,100));
    const preservedLevel=Math.min(100,Math.max(oldLevel,legacyAffectionLevel(state.affection)));
    state.migrationBonusXp=Math.max(0,xpForLevel(preservedLevel)-state.totalXp);
  }
  if (record(input.daily) && validDay(input.daily.dayKey) && input.daily.dayKey >= ctx.dayKey) {
    state.daily = { dayKey: input.daily.dayKey,
      xp: integer(input.daily.xp, 0, 0, LIFE_LIMITS.dailyXp),
      interactions: integer(input.daily.interactions, 0, 0, 1_000_000) };
  }
  state.greetingKeys = Array.isArray(input.greetingKeys) ? [...new Set(input.greetingKeys.filter(k =>
    typeof k === 'string' && /^\d{4}-\d{2}-\d{2}\/(morning|noon|evening)$/.test(k) && validDay(k.slice(0, 10))))].slice(-12) : [];
  const m = input.temporaryMode;
  if (record(m) && MODES.has(m.kind) && timestamp(m.startedAt) !== null && m.startedAt <= ctx.now
      && (input.version===LIFE_VERSION || (timestamp(m.expiresAt)!==null&&m.expiresAt>ctx.now&&m.expiresAt>m.startedAt))) {
    // A still-active legacy sleep becomes indefinite; expired legacy sleep stays awake.
    state.temporaryMode = { kind: 'sleep_mode', startedAt: m.startedAt,restBaseline:normalizeRestBaseline(m.restBaseline) };
  }
  return state;
}

export function getProgression(input, options = {}) {
  const state=normalizeLifeState(input,options),xp=state.totalXp+state.migrationBonusXp;
  let level=1;while(level<100&&xp>=LEVEL_STARTS[level])level++;
  const isMax=level===100,levelStartXp=LEVEL_STARTS[level-1],levelXpCost=isMax?0:LEVEL_COSTS[level-1];
  const levelXp=isMax?0:xp-levelStartXp,progress=isMax?1:levelXp/levelXpCost;
  return {level,affectionLevel:level,tier:tierFromLevel(level),maxLevel:100,isMax,
    totalXp:state.totalXp,progressionXp:xp,migrationBonusXp:state.migrationBonusXp,
    levelStartXp,nextLevelXp:isMax?null:LEVEL_STARTS[level],xpToNextLevel:isMax?0:levelXpCost-levelXp,
    levelXp,levelXpCost,progress,reactionLevel:isMax?100:level+progress};
}

export function getEffectiveMode(input, options = {}) {
  return normalizeLifeState(input, options).temporaryMode?.kind ?? null;
}

export function applyInteraction(input, action = 'click', options = {}) {
  const { now } = context(options), state = normalizeLifeState(input, { ...options, now });
  const levelBefore = getProgression(state, { ...options, now }).level;
  const result = { kind: 'interaction', action, accepted: false, reason: null,
    feedback: null, xpGained: 0, affectionGained: 0, levelBefore, levelAfter: levelBefore };
  if (action !== 'click' && action !== 'pet') {
    result.action = null; result.reason = 'invalid_action'; return { state, result };
  }
  // A backwards clock cannot bypass the cooldown or claim another day's budget.
  if ((state.lastInteractionAt !== null && now < state.lastInteractionAt)
      || (state.lastRewardAt !== null && now < state.lastRewardAt)) {
    result.reason = 'clock_rollback'; return { state, result };
  }
  if (state.lastInteractionAt !== null && now - state.lastInteractionAt < LIFE_LIMITS.feedbackCooldownMs) {
    result.reason = 'throttled'; return { state, result };
  }
  state.lastInteractionAt = now; state.updatedAt = now;
  state.daily.interactions = Math.min(1_000_000, state.daily.interactions + 1);
  result.accepted = true;
  if (state.temporaryMode?.kind === 'sleep_mode') {
    result.feedback = 'sleepy_reaction'; result.reason = 'sleeping'; return { state, result };
  }
  result.feedback = 'petting_reaction';
  if(getProgression(state,{...options,now}).isMax){result.reason='max_level';return {state,result};}
  if (state.lastRewardAt !== null && now - state.lastRewardAt < LIFE_LIMITS.rewardCooldownMs) {
    result.reason = 'reward_cooldown'; return { state, result };
  }
  const xp = Math.min(LIFE_LIMITS.xpPerInteraction, LIFE_LIMITS.dailyXp - state.daily.xp, MAX_XP - state.totalXp,
    xpForLevel(100)-state.totalXp-state.migrationBonusXp);
  if (xp <= 0) { result.reason = 'daily_cap'; return { state, result }; }
  result.xpGained = xp;
  result.affectionGained = Math.min(LIFE_LIMITS.affectionPerInteraction, 100 - state.affection);
  state.totalXp += xp; state.daily.xp += xp; state.affection += result.affectionGained;
  state.lastRewardAt = now;
  result.levelAfter = getProgression(state, { ...options, now }).level;
  return { state, result };
}

export function getGreeting(options = {}) {
  const { dayKey, hour } = context(options);
  const period = hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 18 ? 'noon' : 'evening';
  const text = { morning: '早安，今天也一起认真做事吧。', noon: '午安，喝口水，再继续今天的小目标吧。', evening: '晚上好，辛苦啦。我们慢慢把手边的事情做好。' }[period];
  return { id: `greeting_${period}`, period, text, key: `${dayKey}/${period}` };
}

/** At most once per local date/period. Sleeping suppresses automatic greetings. */
export function claimGreeting(input, options = {}) {
  const { now } = context(options), state = normalizeLifeState(input, { ...options, now });
  const greeting = getGreeting({ ...options, now });
  if (state.temporaryMode?.kind === 'sleep_mode') return { state, result: { kind: 'greeting', greeting: null, reason: 'sleeping' } };
  if (state.greetingKeys.includes(greeting.key)) return { state, result: { kind: 'greeting', greeting: null, reason: 'already_greeted' } };
  state.greetingKeys = [...state.greetingKeys, greeting.key].slice(-12); state.updatedAt = now;
  return { state, result: { kind: 'greeting', greeting, reason: null } };
}

/** Sleep persists until explicitly cleared; durationMs is intentionally ignored. */
export function setTemporaryMode(input, mode, options = {}) {
  const { now } = context(options), state = normalizeLifeState(input, { ...options, now });
  if (mode !== null && !MODES.has(mode)) return { state, result: { kind: 'mode', accepted: false, reason: 'invalid_mode', mode: getEffectiveMode(state, { ...options, now }), expiresAt: state.temporaryMode?.expiresAt ?? null } };
  if (mode === null) state.temporaryMode = null;
  else state.temporaryMode = { kind: 'sleep_mode', startedAt: now,restBaseline:normalizeRestBaseline(options.restBaseline) };
  state.updatedAt = now;
  return { state, result: { kind: 'mode', accepted: true, reason: null, mode, expiresAt: state.temporaryMode?.expiresAt ?? null } };
}

export function parseLifeState(json, options = {}) {
  if (typeof json !== 'string') return normalizeLifeState(json, options);
  try { return normalizeLifeState(JSON.parse(json), options); } catch { return createLifeState(options); }
}

export function serializeLifeState(input, options = {}) {
  return JSON.stringify(normalizeLifeState(input, options));
}
