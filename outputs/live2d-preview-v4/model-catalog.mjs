// Keep the original Cubism export distinct from the program-driven layered
// variants. Their own approved artwork is used; no duplicate moc3 is invented.
export const MODEL_CATALOG = Object.freeze([
  {id:'working_thinking',label:'工作 · 思考',kind:'cubism',files:['dragon-working.model3.json','dragon.model3.json']},
  ...['high','mid','low'].map((energy,index)=>({id:`idle_${energy}_energy`,label:['精力满满','略有疲惫','非常疲惫'][index],kind:'layered-runtime',files:[],assetManifest:`assets/idle/idle_${energy}_energy/manifest.json`})),
]);

export function selectModelId(value) {
  return MODEL_CATALOG.some(model=>model.id===value)?value:'working_thinking';
}

export function inputForModel(id) {
  return {isWorking:selectModelId(id)==='working_thinking',remainingPercent:({idle_high_energy:75,idle_mid_energy:35,idle_low_energy:10})[id]??75};
}
export function visualForState(state,{sleep=false,isWorking=false}={}){
  if(isWorking||state==='working_thinking')return 'working_thinking';
  if(sleep)return 'idle_low_energy';
  return MODEL_CATALOG.some(item=>item.id===state)?state:'working_thinking';
}
