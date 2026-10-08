// Shared by the native click handler and the cloud renderer: choose the same
// conversation without accepting an arbitrary URL/thread from the page.
export function pickBubbleTask(state,now=Date.now()){
  const tasks=Array.isArray(state?.tasks)?state.tasks:[];
  if(state?.followSession)return tasks.find(task=>task.id===state.followSession)??null;
  const recent=tasks.filter(task=>validAssistantActivity(task.assistantActivity,now)&&task.assistantActivity.updatedAt>=now-12000)
    .sort((a,b)=>b.assistantActivity.updatedAt-a.assistantActivity.updatedAt)[0];
  return recent??tasks[0]??null;
}
export function validAssistantActivity(value,now=Date.now()){
  return !!value&&['commentary','final'].includes(value.kind)&&typeof value.label==='string'&&value.label.length<=32
    &&/^[a-f0-9]{64}$/.test(value.id??'')&&Number.isFinite(value.updatedAt)&&value.updatedAt<=now+60000
    &&Number.isFinite(value.expiresAt)&&value.expiresAt>now;
}
export function bubbleOperation(task,state,now=Date.now()){
  const activity=task?.assistantActivity;
  if(validAssistantActivity(activity,now)&&(!task.active||activity.updatedAt>=now-12000))return activity.label;
  return task?.label||(state?.followSession?'所选会话暂无状态':state?.taskKnown?'等待新任务':'等待 Codex 任务');
}
