// Sleep wake-up uses hashed task/turn metadata only. Tool activity is not a new turn.
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const time=value=>Number.isSafeInteger(value)&&value>=0?value:null;

export function normalizeRestBaseline(input){
  const rows=new Map();
  for(const entry of Array.isArray(input)?input:[]){
    if(!hash(entry?.id)||rows.size>=512)continue;
    rows.set(entry.id,{id:entry.id,turn:hash(entry.turn)?entry.turn:null});
  }
  return [...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

export function createRestWakeTracker({startedAt,baseline=[]}={}){
  const restStartedAt=time(startedAt),saved=normalizeRestBaseline(baseline),known=new Map(saved.map(row=>[row.id,row.turn]));
  return {
    snapshot:()=>saved.map(row=>({...row})),
    observe(tasks,{now=Date.now()}={}){
      const observedAt=time(now);
      if(restStartedAt===null||observedAt===null)return {wake:false,reason:'invalid_time'};
      for(const task of Array.isArray(tasks)?tasks:[]){
        if(!hash(task?.id)||!hash(task.turn)||task.active!==true||task.turnActive===false||task.stale===true)continue;
        if(known.has(task.id)&&known.get(task.id)===task.turn)continue;
        // An old active task appearing after restart or an updated tool timestamp
        // must not wake the pet. Only a confirmed root UserPromptSubmit qualifies.
        const started=time(task.turnStartedAt);
        if(started===null||started<=restStartedAt||started>observedAt+60_000)continue;
        return {wake:true,reason:known.has(task.id)?'new_turn':'new_task',taskId:task.id,turn:task.turn};
      }
      return {wake:false,reason:'no_new_turn'};
    },
  };
}
