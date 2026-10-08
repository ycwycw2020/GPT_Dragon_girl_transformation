const TASK_ID=/^[a-f0-9]{64}$/;

function uniqueTasks(tasks) {
  const byId=new Map();
  for(const task of Array.isArray(tasks)?tasks:[]) {
    if(!task||typeof task!=='object'||typeof task.id!=='string'||!TASK_ID.test(task.id))continue;
    const previous=byId.get(task.id);
    if(!previous||(Number.isFinite(task.updatedAt)?task.updatedAt:0)>
      (Number.isFinite(previous.updatedAt)?previous.updatedAt:0))byId.set(task.id,task);
  }
  return [...byId.values()];
}

function menuProject(cwd) {
  const clean=typeof cwd==='string'?cwd.replace(/[\\/]+$/,'').split(/[\\/]/).pop():'';
  const text=(clean||'未命名项目').replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,' ').trim()||'未命名项目';
  return Array.from(text).slice(0,32).join('').replace(/&/g,'&&');
}

function taskStatus(task) {
  if(task.waitingForInput===true)return '等待回答';
  if(task.stale===true)return '等待连接';
  if(task.active===true)return '进行中';
  if(task.historyStatus==='failed')return '出错';
  if(task.terminalEvent==='Stop')return '已完成';
  if(['Interrupt','SessionEnd'].includes(task.terminalEvent))return '已停止';
  return '待机';
}

function menuTitle(task) {
  if(typeof task.name!=='string'||!task.name.trim())return menuProject(task.cwd);
  // A chat title is not a path. Preserve separators as readable glyphs.
  return menuProject(task.name.replace(/[\\/]/g,'／'));
}

function taskFollowOptions(tasks,followSession='') {
  const unique=uniqueTasks(tasks).sort((a,b)=>Number(b.active===true)-Number(a.active===true)||
    (Number.isFinite(b.updatedAt)?b.updatedAt:0)-(Number.isFinite(a.updatedAt)?a.updatedAt:0)||a.id.localeCompare(b.id));
  const options=[{id:'',label:'自动跟随任务',checked:followSession==='',enabled:true}];
  for(const task of unique)options.push({id:task.id,
    label:`${menuTitle(task)} · #${task.id.slice(-8)} · ${taskStatus(task)}`,
    checked:task.id===followSession,enabled:true});
  if(followSession&&!unique.some(task=>task.id===followSession))options.push({id:followSession,
    label:`所选任务暂无状态 · #${TASK_ID.test(followSession)?followSession.slice(-8):'未知'}`,
    checked:true,enabled:false});
  if(!unique.length)options.push({id:null,label:'暂无可监听任务',checked:false,enabled:false});
  return options;
}

function assertKnownTask(tasks,id) {
  if(typeof id!=='string'||(id!==''&&!TASK_ID.test(id)))throw new TypeError('Invalid task identifier');
  if(id!==''&&!uniqueTasks(tasks).some(task=>task.id===id))throw new Error('Unknown task');
  return id;
}

function projectTaskSelection(state,id='') {
  if(!state||typeof state!=='object'||Array.isArray(state))throw new TypeError('Invalid task state');
  if(typeof id!=='string'||(id!==''&&!TASK_ID.test(id)))throw new TypeError('Invalid task identifier');
  const tasks=uniqueTasks(state.tasks),next={...state,followSession:id};
  if(id) {
    const chosen=tasks.find(task=>task.id===id);
    return {...next,isWorking:chosen?.active===true,taskKnown:!!chosen,
      connection:chosen?'local_file':'task_unknown'};
  }
  // A state may already contain a previous fixed selection's isWorking=false.
  // Rebuild automatic activity from every task instead of reusing that value.
  if(tasks.length)return {...next,isWorking:tasks.some(task=>task.active===true),taskKnown:true,connection:'local_file'};
  // Empty hook lists must not erase explicitly provided manual task activity.
  return next;
}

module.exports={taskFollowOptions,projectTaskSelection,assertKnownTask};
