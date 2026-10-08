/**
 * The desktop app's running turns belong to its existing app-server process.
 * A new `codex app-server --listen stdio://` only sees stored records as
 * notLoaded; it must never be treated as global control of desktop tasks.
 *
 * Local verification, 2026-10-07: official `app-server proxy` cannot connect
 * to an existing control socket; the desktop process exposes no TCP listener.
 * Until an authenticated, verified owner transport is integrated, fail closed.
 * This module intentionally never kills, suspends, resumes, or spawns Codex.
 */
const unavailable=()=>({
  supported:false,
  status:'unavailable',
  scope:'pet-only',
  reason:'shared_control_not_connected',
  interrupted:0,
  verifiedStopped:0,
  allStopped:false,
  message:'当前只能让 GPT_Dragon_girl_transformation休息；无法停止 Codex 中正在运行的任务，请在 Codex 中手动停止。',
});

export function getCodexRestCapability(){return unavailable();}

/**
 * Call only from the explicit rest command. The caller manages the pet's sleep
 * state separately and must display this unavailable result, not "all stopped".
 * Arguments cannot enable an unverified endpoint or pretend interruption.
 */
export async function requestCodexRest(){return unavailable();}
