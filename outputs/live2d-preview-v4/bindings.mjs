export const BINDINGS = Object.freeze([
  {id:'ParamEyeLOpen',label:'左眼开合',min:0,max:1},
  {id:'ParamEyeROpen',label:'右眼开合',min:0,max:1},
  {id:'ParamDragonMouseX',label:'握鼠手 + 鼠标',min:-1,max:1},
  {id:'ParamDragonKeyIndex',label:'食指敲键',min:0,max:1},
  {id:'ParamDragonKeyMiddle',label:'中指敲键',min:0,max:1},
  {id:'ParamDragonTailBase',label:'尾巴轻摆',min:-1,max:1},
  {id:'ParamAngleX',label:'头部左右',min:-30,max:30,optional:true},
  {id:'ParamAngleY',label:'头部上下',min:-30,max:30,optional:true},
  {id:'ParamAngleZ',label:'头部轻晃',min:-30,max:30,optional:true},
  {id:'ParamBodyAngleZ',label:'身体轻晃',min:-10,max:10,optional:true},
  {id:'ParamBreath',label:'呼吸',min:0,max:1,optional:true},
  {id:'ParamDragonAhoge',label:'呆毛轻摆',min:-1,max:1,optional:true},
  {id:'ParamDragonHairFront',label:'前发轻摆',min:-1,max:1,optional:true},
  {id:'ParamDragonHairBack',label:'后发轻摆',min:-1,max:1,optional:true},
  {id:'ParamDragonTassel',label:'流苏轻摆',min:-1,max:1,optional:true},
  {id:'ParamEyeBallX',label:'视线左右',min:-1,max:1,optional:true},
  {id:'ParamEyeBallY',label:'视线上下',min:-1,max:1,optional:true},
]);

export function applyPresentationPolicy(values,modelId,frame={}) {
  // Left-eye repair is deferred; hold both eyes open during automatic playback
  // rather than making the character wink continuously. Manual QA can override.
  if(modelId!=='working_thinking')return values;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const calibrated={...values,ParamEyeLOpen:1,ParamEyeROpen:1};
  // This particular rig's full parameter range is only a few source pixels.
  // Calibrate here, keeping the reusable controller's logical units unchanged.
  if(Number.isFinite(values.ParamBreath))calibrated.ParamBreath=clamp(.5+(values.ParamBreath-.5)/.32,0,1);
  if(Number.isFinite(values.ParamDragonAhoge))calibrated.ParamDragonAhoge=clamp(values.ParamDragonAhoge*(.8/.06),-.8,.8);
  if(Number.isFinite(values.ParamDragonTailBase)) {
    const logicalAmplitude={working_thinking:.05,idle_high_energy:.1375,idle_mid_energy:.03,idle_low_energy:.00625,idle_neutral:.035}[frame.state]||.05;
    const rigAmplitude={working_thinking:.8,idle_high_energy:.8,idle_mid_energy:.3,idle_low_energy:.08,idle_neutral:.4}[frame.state]||.8;
    calibrated.ParamDragonTailBase=clamp(values.ParamDragonTailBase*rigAmplitude/logicalAmplitude,-rigAmplitude,rigAmplitude);
  }
  return calibrated;
}

// Inspect real Core parameter IDs. Cubism getParameterIndex alone is unsuitable:
// it can synthesize a not-existing-parameter index instead of proving a binding.
export function inspectBindings(coreParameters) {
  return BINDINGS.map(binding=>{
    const index=Array.from(coreParameters.ids).indexOf(binding.id);
    const exists=index>=0;
    return {...binding,index,exists,
      modelMin:exists?coreParameters.minimumValues[index]:null,
      modelMax:exists?coreParameters.maximumValues[index]:null,
      modelDefault:exists?coreParameters.defaultValues[index]:null,
      rangeMatches:exists && coreParameters.minimumValues[index]===binding.min
        && coreParameters.maximumValues[index]===binding.max,
    };
  });
}

export function applySupportedParameters(model, inspection, values) {
  let writes=0;
  for(const binding of inspection) {
    if(!binding.exists || !Number.isFinite(values[binding.id])) continue;
    const value=Math.max(binding.modelMin,Math.min(binding.modelMax,values[binding.id]));
    model.setParameterValueByIndex(binding.index,value,1); writes++;
  }
  return writes;
}
