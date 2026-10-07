// Counts and playback durations mirror the local Codex v2 pet player. Movement
// is a seated work pose: these slots do not claim the desk character can walk.
export const NATIVE_STATES=Object.freeze({
  idle:[1680,660,660,840,840,1920],
  'running-right':[120,120,120,120,120,120,120,220],
  'running-left':[120,120,120,120,120,120,120,220],
  waving:[140,140,140,280],jumping:[140,140,140,140,280],
  failed:[140,140,140,140,140,140,140,240],waiting:[150,150,150,150,150,260],
  running:[120,120,120,120,120,220],review:[150,150,150,150,150,280],
});
const TAU=Math.PI*2;
export function nativePose(state,phase) {
  const wave=Math.sin(phase*TAU),offset=Math.sin(phase*TAU+.65);
  const pose={ParamEyeLOpen:1,ParamEyeROpen:1,ParamBreath:.5+.5*wave,
    ParamDragonAhoge:.8*offset,ParamDragonTailBase:.8*Math.sin(phase*TAU+1.2),
    ParamDragonMouseX:0,ParamDragonKeyIndex:0,ParamDragonKeyMiddle:0};
  if(state==='running') {
    pose.ParamDragonKeyIndex=Math.max(0,Math.sin(phase*TAU*2));
    pose.ParamDragonKeyMiddle=Math.max(0,-Math.sin(phase*TAU*2));
  } else if(state==='running-right'||state==='running-left'||state==='review') {
    pose.ParamDragonMouseX=.7*wave*(state==='running-left'?-1:1);
  } else if(state==='waving')pose.ParamDragonAhoge=.8*wave;
  else if(state==='jumping')pose.ParamBreath=Math.sin(Math.PI*phase)**2;
  else if(state==='failed'){pose.ParamBreath=.4+.15*wave;pose.ParamDragonAhoge=-.3+.1*offset;pose.ParamDragonTailBase=-.25+.08*wave;}
  else if(state==='waiting'){pose.ParamBreath=.5+.3*wave;pose.ParamDragonTailBase=.12*offset;}
  return pose;
}
export function directionPose(index) {
  const angle=index/16*TAU;
  return {...nativePose('idle',0),ParamDragonAhoge:0,ParamDragonTailBase:0,
    ParamEyeBallX:Math.sin(angle),ParamEyeBallY:Math.cos(angle),
    ParamAngleX:8*Math.sin(angle),ParamAngleY:5*Math.cos(angle),ParamAngleZ:-2*Math.sin(angle)};
}
