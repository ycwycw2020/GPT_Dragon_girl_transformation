/** Local, storage-agnostic companion life state. No I/O, timers, or renderer calls. */
export const LIFE_VERSION = 1;
export const LIFE_LIMITS = Object.freeze({
  xpPerInteraction: 2, affectionPerInteraction: 1, dailyXp: 30,
  rewardCooldownMs: 10_000, feedbackCooldownMs: 350,
  gamingDurationMs: 30 * 60_000, sleepDurationMs: 60 * 60_000,
  maximumModeDurationMs: 4 * 60 * 60_000,
});
const MAX_XP = 1_000_000_000;
const MODES = new Set(['gaming_mode', 'sleep_mode']);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, fallback, min, max) => Number.isSafeInteger(v) ? Math.min(max, Math.max(min, v)) : fallback;
const timestamp = v => Number.isSafeInteger(v) && v >= 0 && v <= 8_640_000_000_000_000 ? v : null;

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
  return { version: LIFE_VERSION, totalXp: 0, affection: 0,
    daily: { dayKey, xp: 0, interactions: 0 }, lastRewardAt: null,
    lastInteractionAt: null, greetingKeys: [], temporaryMode: null, updatedAt: now };
}

/** Copy/sanitize external data. Advancing days resets the budget; clock rollback does not. */
export function normalizeLifeState(input, options = {}) {
  const ctx = context(options), fresh = createLifeState({ ...options, now: ctx.now });
  if (!record(input) || input.version !== LIFE_VERSION) return fresh;
  const state = { ...fresh,
    totalXp: integer(input.totalXp, 0, 0, MAX_XP),
    affection: integer(input.affection, 0, 0, 100),
    lastRewardAt: timestamp(input.lastRewardAt), lastInteractionAt: timestamp(input.lastInteractionAt),
    updatedAt: timestamp(input.updatedAt) ?? ctx.now,
  };
  if (record(input.daily) && validDay(input.daily.dayKey) && input.daily.dayKey >= ctx.dayKey) {
    state.daily = { dayKey: input.daily.dayKey,
      xp: integer(input.daily.xp, 0, 0, LIFE_LIMITS.dailyXp),
      interactions: integer(input.daily.interactions, 0, 0, 1_000_000) };
  }
  state.greetingKeys = Array.isArray(input.greetingKeys) ? [...new Set(input.greetingKeys.filter(k =>
    typeof k === 'string' && /^\d{4}-\d{2}-\d{2}\/(morning|noon|evening)$/.test(k) && validDay(k.slice(0, 10))))].slice(-12) : [];
  const m = input.temporaryMode;
  if (record(m) && MODES.has(m.kind) && timestamp(m.startedAt) !== null && timestamp(m.expiresAt) !== null
      && m.startedAt <= ctx.now && m.expiresAt > ctx.now && m.expiresAt > m.startedAt
      && m.expiresAt - m.startedAt <= LIFE_LIMITS.maximumModeDurationMs) {
    state.temporaryMode = { kind: m.kind, startedAt: m.startedAt, expiresAt: m.expiresAt };
  }
  return state;
}

export function getProgression(input, options = {}) {
  const xp = normalizeLifeState(input, options).totalXp;
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const levelStartXp = 100 * (level - 1) ** 2, nextLevelXp = 100 * level ** 2;
  return { level, totalXp: xp, levelStartXp, nextLevelXp, xpToNextLevel: nextLevelXp - xp,
    progress: (xp - levelStartXp) / (nextLevelXp - levelStartXp) };
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
  if (state.lastRewardAt !== null && now - state.lastRewardAt < LIFE_LIMITS.rewardCooldownMs) {
    result.reason = 'reward_cooldown'; return { state, result };
  }
  const xp = Math.min(LIFE_LIMITS.xpPerInteraction, LIFE_LIMITS.dailyXp - state.daily.xp, MAX_XP - state.totalXp);
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

/** null explicitly leaves a temporary mode. Expired modes normalize to null. */
export function setTemporaryMode(input, mode, options = {}) {
  const { now } = context(options), state = normalizeLifeState(input, { ...options, now });
  if (mode !== null && !MODES.has(mode)) return { state, result: { kind: 'mode', accepted: false, reason: 'invalid_mode', mode: getEffectiveMode(state, { ...options, now }), expiresAt: state.temporaryMode?.expiresAt ?? null } };
  if (mode === null) state.temporaryMode = null;
  else {
    const fallback = mode === 'gaming_mode' ? LIFE_LIMITS.gamingDurationMs : LIFE_LIMITS.sleepDurationMs;
    const durationMs = integer(options.durationMs, fallback, 1_000, LIFE_LIMITS.maximumModeDurationMs);
    state.temporaryMode = { kind: mode, startedAt: now, expiresAt: now + durationMs };
  }
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
