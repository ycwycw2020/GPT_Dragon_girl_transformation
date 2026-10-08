const test=require('node:test');
const assert=require('node:assert/strict');
const {taskFollowOptions,projectTaskSelection,assertKnownTask}=require('./task-follow.cjs');
const A='a'.repeat(56)+'12345678',B='b'.repeat(56)+'87654321',MISSING='c'.repeat(64);
const running={id:A,cwd:'D:\\projects\\同一项目',active:true,updatedAt:200};
const completed={id:B,cwd:'D:\\projects\\同一项目',active:false,terminalEvent:'Stop',updatedAt:300};
const state={tasks:[running,completed],isWorking:true,taskKnown:true,connection:'local_file',remainingPercent:72};

test('fixed selection follows completed B independently of running A',()=>{
  const chosen=projectTaskSelection(state,B);
  assert.equal(chosen.followSession,B);assert.equal(chosen.isWorking,false);
  assert.equal(chosen.taskKnown,true);assert.equal(chosen.connection,'local_file');
  assert.equal(chosen.remainingPercent,72);assert.equal(state.isWorking,true);
});

test('automatic selection rebuilds activity after inactive fixed task',()=>{
  const automatic=projectTaskSelection(projectTaskSelection(state,B),'');
  assert.equal(automatic.isWorking,true);assert.equal(automatic.followSession,'');
  assert.equal(automatic.taskKnown,true);assert.equal(automatic.connection,'local_file');
});

test('running fixed task is active and unknown fixed task stays unknown',()=>{
  assert.equal(projectTaskSelection(state,A).isWorking,true);
  const missing=projectTaskSelection(state,MISSING);
  assert.equal(missing.followSession,MISSING);assert.equal(missing.isWorking,false);
  assert.equal(missing.taskKnown,false);assert.equal(missing.connection,'task_unknown');
  assert.equal(projectTaskSelection(missing,'').isWorking,true);
});

test('manual state survives empty task lists in automatic mode',()=>{
  const manual={tasks:[],isWorking:true,taskKnown:true,connection:'local_file',source:'manual-cli'};
  assert.deepEqual(projectTaskSelection(manual,''),{...manual,followSession:''});
  const unknown={connection:'standalone_preview'};
  assert.deepEqual(projectTaskSelection(unknown,''),{...unknown,followSession:''});
});

test('same project sessions have distinct hash suffixes and accurate radio state',()=>{
  const options=taskFollowOptions([completed,running],B);
  assert.equal(options[0].id,'');assert.equal(options[0].checked,false);
  assert.equal(options.filter(option=>option.checked).length,1);
  assert.match(options.find(option=>option.id===A).label,/同一项目 · #12345678 · 进行中$/);
  assert.match(options.find(option=>option.id===B).label,/同一项目 · #87654321 · 已完成$/);
  assert.equal(options.find(option=>option.id===B).checked,true);
});

test('both Windows and Linux basenames render without parent directories',()=>{
  const windows=taskFollowOptions([{...running,cwd:'D:\\top\\project\\'}])[1];
  const linux=taskFollowOptions([{...running,cwd:'/home/person/project/'}])[1];
  assert.equal(windows.label,linux.label);assert.match(windows.label,/^project ·/);
  assert.doesNotMatch(windows.label,/top|home|person/);
});

test('Codex chat names override directory basenames and keep title separators',()=>{
  const named={...running,name:'光棚 / 衍射实验 · 预习'};
  assert.match(taskFollowOptions([named])[1].label,/^光棚 ／ 衍射实验 · 预习 · #12345678/);
  assert.doesNotMatch(taskFollowOptions([named])[1].label,/同一项目/);
  for(const name of [null,42,{},'  '])assert.match(taskFollowOptions([{...running,name}])[1].label,/^同一项目 ·/);
});

test('equal chat names keep independent task identities and waiting or failed states',()=>{
  const options=taskFollowOptions([{...running,name:'同名聊天',waitingForInput:true},
    {...completed,name:'同名聊天',historyStatus:'failed'}],B);
  assert.match(options.find(row=>row.id===A).label,/同名聊天 · #12345678 · 等待回答$/);
  assert.match(options.find(row=>row.id===B).label,/同名聊天 · #87654321 · 出错$/);
  assert.equal(options.filter(row=>row.checked).length,1);
});

test('menu labels escape accelerators and remove control and directional characters',()=>{
  const label=taskFollowOptions([{...running,cwd:'D:\\safe\\A&B\nC\u202eD'}])[1].label;
  assert.match(label,/^A&&B C D ·/);assert.doesNotMatch(label,/[\n\r\u202e]/);
});

test('duplicate task IDs keep the latest record once for menu and activity',()=>{
  const duplicate={...running,active:false,terminalEvent:'Stop',updatedAt:400};
  const tasks=[running,duplicate,completed];
  assert.equal(taskFollowOptions(tasks).filter(option=>option.id===A).length,1);
  assert.equal(projectTaskSelection({...state,tasks},A).isWorking,false);
  assert.equal(projectTaskSelection({...state,tasks},'').isWorking,false);
});

test('invalid hook rows cannot become selectable sessions',()=>{
  const tasks=[null,{id:'123',active:true},running,{id:A.toUpperCase(),active:true},{id:{toString:()=>A},active:true}];
  assert.equal(taskFollowOptions(tasks).length,2);
  assert.equal(assertKnownTask(tasks,A),A);
});

test('missing persisted selection remains checked with disabled placeholder',()=>{
  const options=taskFollowOptions([running],MISSING);
  const missing=options.find(option=>option.id===MISSING);
  assert.equal(missing.checked,true);assert.equal(missing.enabled,false);
  assert.equal(options[0].checked,false);assert.match(missing.label,/所选任务暂无状态/);
});

test('empty session lists still allow automatic following',()=>{
  const options=taskFollowOptions([]);
  assert.equal(options[0].enabled,true);assert.equal(options[0].checked,true);
  assert.equal(options[1].enabled,false);
});

test('assertKnownTask accepts only automatic or known opaque session IDs',()=>{
  assert.equal(assertKnownTask(state.tasks,''),'');assert.equal(assertKnownTask(state.tasks,B),B);
  for(const invalid of [null,undefined,123,'../other','x'.repeat(64),A.toUpperCase()])
    assert.throws(()=>assertKnownTask(state.tasks,invalid),/Invalid task identifier/);
  assert.throws(()=>assertKnownTask(state.tasks,MISSING),/Unknown task/);
  assert.throws(()=>projectTaskSelection(state,'bad'),/Invalid task identifier/);
});
