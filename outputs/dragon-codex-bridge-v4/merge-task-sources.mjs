// Join conversations by identity, never by directory or a display name.
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stamp=value=>Number.isFinite(value)?value:0;
const key=task=>uuid(task?.threadId)|| (hash(task?.id)?task.id:null);
function newerActivity(left,right,now){
  const valid=value=>value&&value.expiresAt>now&&value.updatedAt<=now+60000;
  if(!valid(left))return valid(right)?right:null;
  if(!valid(right))return left;
  return right.updatedAt>left.updatedAt?right:left;
}
export function mergeTaskSources(hooks={},global={},now=Date.now()){
  const rows=new Map();
  const excluded=global.available===true?new Set((Array.isArray(global.excludedThreadIds)?global.excludedThreadIds:[]).map(uuid).filter(Boolean)):new Set();
  for(const task of Array.isArray(global.tasks)?global.tasks:[])if(key(task)&&hash(task.id))rows.set(key(task),{...task});
  for(const hook of Array.isArray(hooks.tasks)?hooks.tasks:[]){
    const identity=key(hook);if(!identity||!hash(hook.id)||excluded.has(uuid(hook.threadId)))continue;
    const observed=rows.get(identity);
    if(!observed){rows.set(identity,{...hook,activitySource:'codex-hooks'});continue;}
    const hookIsNewTurn=hook.turn&&hook.turn!==observed.turn&&stamp(hook.turnStartedAt)>(stamp(observed.turnStartedAt)||stamp(observed.updatedAt));
    const hookFresh=hook.active===true&&hook.stale!==true&&hook.expiresAt>now;
    // A known completed turn wins over delayed tool hooks for that same turn.
    // A newly confirmed prompt may precede the history database projection.
    const observedCurrent=observed.statusKnown===true&&!hookIsNewTurn;
    const useHookActivity=!observedCurrent||observed.stale===true&&hookFresh&&(!observed.turn||observed.turn===hook.turn);
    const selected=useHookActivity?hook:observed;
    const terminal=selected.active!==true&&['Stop','Interrupt','SessionEnd'].includes(selected.terminalEvent);
    rows.set(identity,{...observed,...hook,...selected,
      id:hook.id,threadId:uuid(observed.threadId)||uuid(hook.threadId),name:observed.name||'',cwd:observed.cwd||hook.cwd||'',
      activitySource:useHookActivity?'codex-hooks':observed.activitySource,
      questionNotice:terminal||observed.turn&&hook.turn&&observed.turn!==hook.turn&&!useHookActivity?null:hook.questionNotice??null,
      assistantActivity:newerActivity(hook.assistantActivity,observed.assistantActivity,now),
    });
  }
  const tasks=[...rows.values()].map(task=>task.active===true&&stamp(task.expiresAt)<=now
    ?{...task,active:false,turnActive:false,stale:true}:task)
    .sort((a,b)=>Number(b.active===true)-Number(a.active===true)||stamp(b.updatedAt)-stamp(a.updatedAt));
  const active=tasks.filter(task=>task.active===true&&task.stale!==true);
  return {...hooks,tasks,isWorking:active.length>0,activeSessionCount:active.length,
    source:global.available?'codex-global':'codex-hooks',globalDiscoveryAvailable:global.available===true,
    expiresAt:active.length?Math.max(now+1000,...active.map(task=>stamp(task.expiresAt))):now+900000};
}
