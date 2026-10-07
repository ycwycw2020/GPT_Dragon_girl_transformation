// Both entries must resolve to a real Editor export. A missing variant is never
// substituted with a still image or another character/state.
export const MODEL_CATALOG = Object.freeze([
  {id:'working_thinking',label:'工作 · 思考',files:['dragon-working.model3.json','dragon.model3.json']},
  {id:'idle_high_energy',label:'精力满满',files:['dragon-high-energy.model3.json']},
]);

export function selectModelId(value) {
  return MODEL_CATALOG.some(model=>model.id===value)?value:'working_thinking';
}

export function inputForModel(id) {
  return {isWorking:selectModelId(id)==='working_thinking',remainingPercent:75};
}
