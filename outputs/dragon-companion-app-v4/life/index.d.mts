export type TemporaryMode = 'sleep_mode';
export interface LifeOptions { now?: number; timeZone?: string; durationMs?: number; restBaseline?: Array<{id: string; turn: string | null}> }
export interface LifeState {
  version: 2;
  totalXp: number;
  affection: number;
  migrationBonusXp: number;
  daily: { dayKey: string; xp: number; interactions: number };
  lastRewardAt: number | null;
  lastInteractionAt: number | null;
  greetingKeys: string[];
  temporaryMode: { kind: TemporaryMode; startedAt: number; restBaseline: Array<{id: string; turn: string | null}> } | null;
  updatedAt: number;
}
export interface Progression {
  level: number; affectionLevel: number; tier: 'low' | 'mid' | 'high'; maxLevel: 100; isMax: boolean;
  totalXp: number; progressionXp: number; migrationBonusXp: number;
  levelStartXp: number; nextLevelXp: number | null; xpToNextLevel: number;
  levelXp: number; levelXpCost: number; progress: number; reactionLevel: number;
}
export interface Greeting {
  id: 'greeting_morning' | 'greeting_noon' | 'greeting_evening';
  period: 'morning' | 'noon' | 'evening'; text: string; key: string;
}
export interface InteractionResult {
  kind: 'interaction'; action: 'click' | 'pet' | null; accepted: boolean;
  reason: null | 'invalid_action' | 'clock_rollback' | 'throttled' | 'sleeping' | 'reward_cooldown' | 'daily_cap' | 'max_level';
  feedback: null | 'petting_reaction' | 'sleepy_reaction';
  xpGained: number; affectionGained: number; levelBefore: number; levelAfter: number;
}
export interface GreetingResult {
  kind: 'greeting'; greeting: Greeting | null;
  reason: null | 'sleeping' | 'already_greeted';
}
export interface ModeResult {
  kind: 'mode'; accepted: boolean; reason: null | 'invalid_mode';
  mode: TemporaryMode | null; expiresAt: number | null;
}
export interface LifeUpdate<T> { state: LifeState; result: T }
export const LIFE_VERSION: 2;
export const LIFE_LIMITS: Readonly<{
  xpPerInteraction: 2; affectionPerInteraction: 1; dailyXp: 30;
  rewardCooldownMs: 10000; feedbackCooldownMs: 350;
  maxLevel: 100;
}>;
export const LEVEL_COSTS: ReadonlyArray<number>;
export function xpForLevel(level: number): number;
export function tierFromLevel(level: number): 'low' | 'mid' | 'high';
export function createLifeState(options?: LifeOptions): LifeState;
export function normalizeLifeState(input: unknown, options?: LifeOptions): LifeState;
export function getProgression(input: unknown, options?: LifeOptions): Progression;
export function getEffectiveMode(input: unknown, options?: LifeOptions): TemporaryMode | null;
export function applyInteraction(input: unknown, action?: 'click' | 'pet', options?: LifeOptions): LifeUpdate<InteractionResult>;
export function getGreeting(options?: LifeOptions): Greeting;
export function claimGreeting(input: unknown, options?: LifeOptions): LifeUpdate<GreetingResult>;
export function setTemporaryMode(input: unknown, mode: TemporaryMode | null, options?: LifeOptions): LifeUpdate<ModeResult>;
export function parseLifeState(json: unknown, options?: LifeOptions): LifeState;
export function serializeLifeState(input: unknown, options?: LifeOptions): string;
