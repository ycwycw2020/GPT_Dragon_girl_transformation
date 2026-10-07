// One account reader per app lifecycle. Renderer reloads never create a reader.
export function createQuotaService({readQuota,saveQuota,intervalMs=120000,now=()=>Date.now(),setTimer=setInterval,clearTimer=clearInterval}={}) {
  let value=null,timer=null,inFlight=null,aborter=null,stopped=false,lastError=null;
  const current=()=>value&&value.expiresAt>now()?{status:'fresh',...value}:{status:'unknown',remainingPercent:null,source:'unavailable',error:lastError};
  function poll() {
    if(stopped)return Promise.resolve(current());
    if(inFlight)return inFlight;
    aborter=new AbortController();
    inFlight=(async()=>{
      try {value=await readQuota({signal:aborter.signal});lastError=null;}
      catch(error){value=null;lastError=error.message;}
      if(!stopped)await saveQuota(value);
      return current();
    })().finally(()=>{inFlight=null;aborter=null;});
    return inFlight;
  }
  return {current,poll,start(){if(!timer&&!stopped)timer=setTimer(()=>{poll().catch(()=>{});},intervalMs);return poll();},
    stop(){stopped=true;if(timer)clearTimer(timer);timer=null;aborter?.abort();}};
}

export function combineStateAndQuota(state,quota) {
  const taskKnown=state.connection==='local_file';
  return {...state,connection:taskKnown?'local_file':'task_unknown',taskKnown,
    note:taskKnown?'Task state comes from the declared local source.':'Task hook is unconnected; quota availability does not imply task visibility.',
    taskSource:taskKnown?state.source:'unconnected',isWorking:taskKnown&&state.isWorking===true,
    remainingPercent:quota.status==='fresh'?quota.remainingPercent:null,
    quotaStatus:quota.status,quotaSource:quota.status==='fresh'?quota.source:'unavailable',
    quotaExpiresAt:quota.status==='fresh'?quota.expiresAt:null};
}
