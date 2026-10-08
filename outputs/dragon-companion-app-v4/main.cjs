const { app, BrowserWindow, Menu, Tray, nativeImage, screen, globalShortcut, session, ipcMain, shell }=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const { pathToFileURL }=require('node:url');
const sizing=require('./window-sizing.cjs');
const movement=require('./window-interaction.cjs');
const {newChatLink}=require('./chat-link.cjs');
const {createConversationNavigation,displayedTask}=require('./conversation-navigation.cjs');
const {taskFollowOptions,projectTaskSelection,assertKnownTask}=require('./task-follow.cjs');
const openConversation=createConversationNavigation({openExternal:url=>shell.openExternal(url)});
const {noticeBounds,chooseNotice}=require('./question-notice.cjs');
const {pinCompanionWindows}=require('./virtual-desktops.cjs');
const taskbarOptions=Object.freeze({skipTaskbar:true});
let desktopPin,topmostEnabled=true,visualMode='auto';
let lastChatOpen=0;
async function openNewChat() {
  if(Date.now()-lastChatOpen<1000)return {opened:false};
  const task=followSession?lastCombinedState?.tasks?.find(t=>t.id===followSession):lastCombinedState?.tasks?.[0];
  const url=newChatLink(task?.cwd);lastChatOpen=Date.now();
  await shell.openExternal(url);return {opened:true};
}

let window,tray,server,origin,clickThrough=false,quitting=false;
let quotaService,lifeModule,lifeState,lifeWrite=Promise.resolve(),lifeQueue=Promise.resolve(),lastCombinedState=null;
let exitFlushed=false;
let menuStateKey='';
let greetingTimer,restControlModule,restWakeModule,restWakeTracker=null,restControl=null;
let viewScale=sizing.DEFAULT_SCALE,viewWrite=Promise.resolve();
let taskWindow,panelVisible=true,taskBubbleVisible=true,followSession='',dragState,dragTimer,moveSaveTimer,restoredView={};
let noticeWindow,currentNotice=null;const dismissedNotices=new Map();
let presentationView={mirrored:false,screenSide:'left',displayId:null};
let runtimeReportSnapshot=null,runtimeReportWrite=Promise.resolve();
let petURL='';
function persistRuntimeReport(){
  if(!runtimeReportSnapshot||smokeTest||!window||window.isDestroyed()||!taskWindow||taskWindow.isDestroyed())return runtimeReportWrite;
  const report={...runtimeReportSnapshot,presentationView:{...presentationView},bounds:window.getBounds(),
    panelBounds:taskWindow.getBounds(),panelVisible:taskWindow.isVisible(),scale:viewScale,
    followSession,taskFollowOptions:taskFollowOptions(lastCombinedState?.tasks,followSession)};
  const serialized=JSON.stringify(report,null,2);
  runtimeReportWrite=runtimeReportWrite.then(()=>fs.writeFile(path.resolve(__dirname,'../../work/desktop-app-v4/desktop-runtime-report.json'),serialized))
    .catch(error=>console.error('Presentation report: '+error.message));
  return runtimeReportWrite;
}
function syncPresentationView(force=false){
  if(!window||window.isDestroyed())return presentationView;
  const bounds=window.getBounds(),next=movement.presentationView(bounds,screen.getDisplayMatching(bounds),presentationView);
  const changed=next.mirrored!==presentationView.mirrored||next.displayId!==presentationView.displayId;
  presentationView=next;
  if(lastCombinedState)lastCombinedState.presentationView={...next};
  if(force||changed){
    for(const target of [window,taskWindow,noticeWindow])if(target&&!target.isDestroyed())target.webContents.send('dragon:view-update',{...next});
    // The same move callback positions child bubbles before this snapshot.
    queueMicrotask(()=>persistRuntimeReport());
  }
  return {...next};
}
function positionNotice(){
  if(!window||!noticeWindow||noticeWindow.isDestroyed())return;
  const bounds=window.getBounds();noticeWindow.setBounds(noticeBounds(bounds,screen.getDisplayMatching(bounds).workArea));
}
function syncNotice(state=lastCombinedState){
  if(!noticeWindow||noticeWindow.isDestroyed())return;
  for(const [key,expiry] of dismissedNotices)if(expiry<=Date.now())dismissedNotices.delete(key);
  const previousKey=currentNotice?.key;currentNotice=chooseNotice(state?.tasks,state?.followSession,dismissedNotices);
  if(currentNotice&&window.isVisible()&&!smokeTest){
    positionNotice();const newlyShown=!noticeWindow.isVisible();if(newlyShown)noticeWindow.showInactive();
    if(newlyShown||currentNotice.key!==previousKey)noticeWindow.webContents.send('dragon:notice-show');
  }
  else noticeWindow.hide();
}
const lifeOptions={timeZone:'Asia/Shanghai'};
const smokeTest=process.argv.includes('--smoke-test');
// Isolated, never-shown test conversations. Real launches merge global Codex
// metadata with trusted Hooks; these fixtures never enter that path.
const taskFollowFixture=smokeTest?[
  {id:'a'.repeat(64),cwd:'D:/task-follow-test/shared',threadId:'00000000-0000-4000-8000-000000000001',active:true,label:'读取与检索',updatedAt:Date.now(),expiresAt:Date.now()+900000,turn:'turn-a',
    questionNotice:{id:'qa',createdAt:Date.now(),expiresAt:Date.now()+300000}},
  {id:'b'.repeat(64),cwd:'D:/task-follow-test/shared',threadId:'00000000-0000-4000-8000-000000000002',active:false,label:'本轮已结束',terminalEvent:'Stop',updatedAt:Date.now()-1000,expiresAt:Date.now()+900000,turn:'turn-b'},
]:null;
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const sessionDirectory=path.resolve(__dirname,`../../work/desktop-app-v4/${smokeTest?'smoke-session':'session'}`);
const lifeFile=path.resolve(__dirname,`../../work/desktop-app-v4/${smokeTest?'smoke-life-state':'life-state'}.json`);
const viewFile=path.resolve(__dirname,`../../work/desktop-app-v4/${smokeTest?'smoke-window-settings':'window-settings'}.json`);
app.setPath('userData',sessionDirectory);
app.setName('GPT_Dragon_girl_transformation');
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();

function showCompanion() {
  if(!window)return;clickThrough=false;window.setIgnoreMouseEvents(false);
  taskWindow?.setIgnoreMouseEvents(!taskBubbleVisible,{forward:true});
  noticeWindow?.setIgnoreMouseEvents(false);
  window.show();window.focus();updateMenu();
  if(panelVisible){positionPanel();taskWindow?.showInactive();}
  syncNotice();
}
function saveView() {
  const bounds=window.getBounds();
  const data=JSON.stringify({version:3,bubbleVersion:1,scale:viewScale,x:bounds.x,y:bounds.y,panelVisible,followSession},null,2);
  viewWrite=viewWrite.then(async()=>{await fs.writeFile(viewFile+'.tmp',data);await fs.rename(viewFile+'.tmp',viewFile);})
    .catch(error=>console.error('Window settings save failed: '+error.message));
  return viewWrite;
}
async function setFollowTask(id=''){
  assertKnownTask(lastCombinedState?.tasks,id);
  followSession=id;
  if(lastCombinedState)lastCombinedState=projectTaskSelection(lastCombinedState,id);
  syncNotice(lastCombinedState);
  // Selecting a different conversation may reveal a previously popped cloud;
  // retain the user's separate preference to hide the whole task bubble.
  taskWindow?.webContents.send('dragon:action','bubble:show');
  updateMenu();
  await saveView();
  await persistRuntimeReport();
  return id;
}
function positionPanel() {
  syncPresentationView();
  if(!window||!taskWindow||taskWindow.isDestroyed())return;
  const bounds=window.getBounds();taskWindow.setBounds(movement.panelBounds(bounds,screen.getDisplayMatching(bounds).workArea,presentationView.mirrored));
  positionNotice();
}
function setPanelVisible(value) {
  panelVisible=value;positionPanel();
  if(value&&taskWindow&&!taskWindow.isDestroyed())taskWindow.webContents.send('dragon:action','bubble:show');
  if(value&&window.isVisible())taskWindow?.showInactive();else taskWindow?.hide();
  saveView();updateMenu();return panelVisible;
}
function updateDrag() {
  if(!dragState)return;
  const point=screen.getCursorScreenPoint(),dx=point.x-dragState.point.x,dy=point.y-dragState.point.y;
  if(!dragState.moved&&Math.hypot(dx,dy)<=4)return;
  dragState.moved=true;
  const bounds=movement.clampPosition({...dragState.bounds,x:dragState.bounds.x+dx,y:dragState.bounds.y+dy},screen.getDisplayNearestPoint(point).workArea);
  window.setPosition(bounds.x,bounds.y);
}
function endDrag() {
  if(dragState)updateDrag();const moved=dragState?.moved??false;
  clearInterval(dragTimer);dragTimer=null;dragState=null;
  if(window&&!window.isDestroyed())saveView();return {moved};
}
function validSender(event,allowPanel=false) {
  return (event.sender===window.webContents||(allowPanel&&event.sender===taskWindow?.webContents))
    &&event.senderFrame?.url.startsWith(origin+'/');
}
function scaleSnapshot(){return {scale:viewScale,defaultScale:sizing.DEFAULT_SCALE,bounds:window.getBounds()};}
function setCompanionScale(value,{resetPosition=false}={}) {
  viewScale=sizing.normalizeScale(value);
  const previous=resetPosition?null:window.getBounds();
  const area=(previous?screen.getDisplayMatching(previous):screen.getPrimaryDisplay()).workArea;
  window.setBounds(sizing.scaledBounds(viewScale,area,previous));
  saveView();positionPanel();
  updateMenu();return scaleSnapshot();
}
function changeScale(action) {
  if(!['get','in','out','default'].includes(action))throw new Error('Unknown scale action');
  return action==='get'?scaleSnapshot():setCompanionScale(sizing.nextScale(viewScale,action));
}
function updateMenu() {
  const quota=lastCombinedState?.remainingPercent;
  const taskLabel=lastCombinedState?.taskSource==='codex-global'?'Codex全局任务已接入':lastCombinedState?.taskSource==='codex-hooks'?'Codex任务已接入':lastCombinedState?.taskKnown?'手动任务状态':'任务状态未接入';
  const menu=Menu.buildFromTemplate([
    {label:'GPT_Dragon_girl_transformation',enabled:false},
    {label:`${taskLabel} · 额度 ${Number.isFinite(quota)?quota+'%':'未知'}`,enabled:false},
    {label:'显示 / 恢复交互',click:showCompanion},
    {label:'显示任务气泡',type:'checkbox',checked:panelVisible&&taskBubbleVisible,click:item=>setPanelVisible(item.checked)},
    {id:'task-follow-menu',label:'切换监听任务',submenu:taskFollowOptions(lastCombinedState?.tasks,followSession).map(option=>({
      id:'follow-'+(option.id===null?'none':option.id||'auto'),label:option.label,type:option.id===null?'normal':'radio',checked:option.checked,enabled:option.enabled,
      click:option.enabled?()=>setFollowTask(option.id).catch(error=>console.error('Task selection: '+error.message)):undefined,
    }))},
    {label:'在 Codex 新建聊天',click:()=>openNewChat().catch(error=>console.error('Open Codex chat: '+error.message))},
    {label:'鼠标穿透',type:'checkbox',checked:clickThrough,click:item=>{clickThrough=item.checked;window.setIgnoreMouseEvents(clickThrough,{forward:true});taskWindow?.setIgnoreMouseEvents(clickThrough||!taskBubbleVisible,{forward:true});noticeWindow?.setIgnoreMouseEvents(clickThrough,{forward:true});updateMenu();}},
    {label:'始终置顶',type:'checkbox',checked:topmostEnabled,click:item=>{topmostEnabled=item.checked;window.setAlwaysOnTop(item.checked);taskWindow?.setAlwaysOnTop(item.checked);noticeWindow?.setAlwaysOnTop(item.checked);desktopPin?.setTopmost(item.checked);}},
    {label:'角色状态',submenu:[['auto','跟随任务与额度'],['working_thinking','工作 · 思考'],['idle_high_energy','精力满满'],['idle_mid_energy','略有疲惫'],['idle_low_energy','非常疲惫']].map(([id,label])=>({label,type:'radio',checked:visualMode===id,click:()=>{visualMode=id;window.webContents.send('dragon:action','state:'+id);updateMenu();}}))},
    {label:`缩放 · ${Number((viewScale*100).toFixed(1))}%`,submenu:[
      {label:'放大（Ctrl + 滚轮向上）',click:()=>changeScale('in')},
      {label:'缩小（Ctrl + 滚轮向下）',click:()=>changeScale('out')},
      {label:'恢复默认 1/3（180 × 200）',click:()=>changeScale('default')},
      {type:'separator'},
      ...sizing.PRESETS.map(value=>({label:value===sizing.DEFAULT_SCALE?'33.3% · 默认':`${value*100}%`,type:'radio',checked:Math.abs(viewScale-value)<.001,click:()=>setCompanionScale(value)})),
    ]},
    {type:'separator'},
    {label:lifeState?growthMenuLabel():'好感成长',click:()=>window.webContents.send('dragon:action','growth')},
    {label:'打个招呼',click:()=>handleManualGreeting()},
    {label:'休息',click:()=>handleLife('sleep')},
    ...(lifeState?.temporaryMode?.kind==='sleep_mode'&&restControl?.supported===false
      ?[{label:'Codex任务未停止 · 控制接口未接通',enabled:false}]:[]),
    {label:'回到工作状态',click:()=>handleLife('normal')},
    {type:'separator'},
    {label:'暂停 / 继续动作',click:()=>window.webContents.send('dragon:action','pause')},
    {label:'重新读取模型',click:()=>window.webContents.send('dragon:action','reload')},
    {label:'重置位置',click:()=>{setCompanionScale(viewScale,{resetPosition:true});showCompanion();}},
    {type:'separator'},
    {label:'退出',click:()=>{quitting=true;app.quit();}},
  ]);
  tray?.setContextMenu(menu);return menu;
}
function growthMenuLabel(){const p=lifeModule.getProgression(lifeState,lifeOptions);return p.isMax?'♡ 好感 Lv.100 · MAX':`♡ 好感 Lv.${p.level} · ${p.levelXp}/${p.levelXpCost}`;}
function lifeSnapshot(result=null) {
  lifeState=lifeModule.normalizeLifeState(lifeState,lifeOptions);
  return {progression:lifeModule.getProgression(lifeState,lifeOptions),affection:lifeState.affection,
    mode:lifeModule.getEffectiveMode(lifeState,lifeOptions),restControl,result};
}
async function handleManualGreeting(){
  const value=await handleLife('greeting');
  if(value.mode==='sleep_mode')return value;
  const snapshot={...value,result:{kind:'greeting',greeting:value.result?.greeting||lifeModule.getGreeting(lifeOptions)}};
  if(window&&!window.isDestroyed())window.webContents.send('dragon:life-update',snapshot);
  return snapshot;
}
function handleLife(action='get',expectedTracker=null) {
  // Keep mode changes and rewards ordered even if a future control transport
  // or a save takes time; a sleeping snapshot must not overwrite newer XP.
  const operation=lifeQueue.then(()=>expectedTracker&&restWakeTracker!==expectedTracker?lifeSnapshot():applyLifeAction(action));
  lifeQueue=operation.catch(()=>{});return operation;
}
async function applyLifeAction(action='get') {
  let change;
  if(action==='click')change=lifeModule.applyInteraction(lifeState,'click',lifeOptions);
  else if(action==='greeting')change=lifeModule.claimGreeting(lifeState,lifeOptions);
  else if(['sleep','normal'].includes(action)){
    visualMode='auto';window?.webContents.send('dragon:action','state:auto');
    const restBaseline=lastCombinedState?.tasks||[];
    change=lifeModule.setTemporaryMode(lifeState,action==='sleep'?'sleep_mode':null,{...lifeOptions,restBaseline});
    if(action==='sleep'){
      restWakeTracker=restWakeModule.createRestWakeTracker({startedAt:change.state.temporaryMode.startedAt,baseline:restBaseline});
      restControl=await restControlModule.requestCodexRest();
    }else{restWakeTracker=null;restControl=null;}
  }
  if(change&&!(action==='greeting'&&!change.result.greeting)) {
    lifeState=change.state;const serialized=lifeModule.serializeLifeState(lifeState,lifeOptions);
    lifeWrite=lifeWrite.then(async()=>{const temporary=lifeFile+'.tmp';await fs.writeFile(temporary,serialized);await fs.rename(temporary,lifeFile);}).catch(error=>console.error('Life save failed: '+error.message));
    await lifeWrite;
  }
  const snapshot=lifeSnapshot(change?.result);if(change&&tray)updateMenu();
  if(change&&window&&!window.isDestroyed())window.webContents.send('dragon:life-update',snapshot);
  return snapshot;
}
async function createCompanion() {
  await fs.mkdir(sessionDirectory,{recursive:true});
  viewScale=sizing.readScale(await fs.readFile(viewFile,'utf8').catch(()=>''));
  try{restoredView=JSON.parse(await fs.readFile(viewFile,'utf8'));}catch{}
  panelVisible=restoredView.bubbleVersion===1?restoredView.panelVisible!==false:true;
  followSession=/^[a-f0-9]{64}$/.test(restoredView.followSession)?restoredView.followSession:'';
  const {startServer}=await import(pathToFileURL(path.resolve(__dirname,'../live2d-preview-v4/server.mjs')).href);
  const {readState}=await import(pathToFileURL(path.join(__dirname,'state-bridge.mjs')).href);
  const {aggregate}=await import(pathToFileURL(path.resolve(__dirname,'../dragon-codex-bridge-v4/hook.mjs')).href);
  const {createGlobalThreadReader}=await import(pathToFileURL(path.resolve(__dirname,'../dragon-codex-bridge-v4/global-threads.mjs')).href);
  const {mergeTaskSources}=await import(pathToFileURL(path.resolve(__dirname,'../dragon-codex-bridge-v4/merge-task-sources.mjs')).href);
  const readGlobalThreads=createGlobalThreadReader();
  lifeModule=await import(pathToFileURL(path.join(__dirname,'life/index.mjs')).href);
  lifeState=lifeModule.parseLifeState(await fs.readFile(lifeFile,'utf8').catch(()=>''),lifeOptions);
  restControlModule=await import(pathToFileURL(path.join(__dirname,'codex-rest-control.mjs')).href);
  restWakeModule=await import(pathToFileURL(path.join(__dirname,'rest-wakeup.mjs')).href);
  if(lifeState.temporaryMode?.kind==='sleep_mode'){restWakeTracker=restWakeModule.createRestWakeTracker({startedAt:lifeState.temporaryMode.startedAt,baseline:lifeState.temporaryMode.restBaseline||[]});restControl=restControlModule.getCodexRestCapability();}
  const quotaEnabled=!smokeTest||process.argv.includes('--with-quota');
  const {createQuotaService,combineStateAndQuota}=await import(pathToFileURL(path.join(__dirname,'quota-service.mjs')).href);
  let initialQuota;
  if(quotaEnabled) {
    const {readAccountQuota,saveQuota}=await import(pathToFileURL(path.resolve(__dirname,'../dragon-codex-bridge-v4/quota.mjs')).href);
    quotaService=createQuotaService({readQuota:options=>readAccountQuota({...options,executable:argument('--codex-exe')||'codex'}),saveQuota});
    initialQuota=quotaService.start();initialQuota.catch(error=>console.error('Quota reader: '+error.message));
  }
  if(smokeTest&&initialQuota)await initialQuota;
  server=await startServer({port:0,stateProvider:async()=>{
    let state=await readState(argument('--state-file'));
    const hookState=smokeTest?{tasks:taskFollowFixture,isWorking:true,remainingPercent:null,activeSessionCount:1,activeAgentCount:1,expiresAt:Date.now()+900000}:await aggregate();
    const discovered=smokeTest?{available:false,tasks:[]}:await readGlobalThreads();
    const observed=mergeTaskSources(hookState,discovered);
    if(state.source==='codex-hooks'||observed.tasks.length||discovered.available)state={...state,...observed,connection:'local_file',source:observed.source};
    let combined=quotaEnabled?combineStateAndQuota(state,quotaService.current()):state;
    const wakingTracker=restWakeTracker,wake=wakingTracker?.observe(combined.tasks||[]);
    if(wake?.wake){
      const awakened=await handleLife('normal',wakingTracker);
      // Wake onto the task that actually started, including when the previous
      // followed task is idle. Otherwise the pet would wake into an idle pose.
      if(awakened.result?.kind==='mode'&&awakened.result.mode===null){
        followSession=wake.taskId;
        if(window&&!window.isDestroyed())saveView();
      }
    }
    combined=projectTaskSelection(combined,followSession);
    combined.life=lifeSnapshot();
    combined.presentationMode=combined.life.mode;
    combined.presentationView=syncPresentationView();
    combined.restControl=restControl;
    lastCombinedState=combined;
    syncNotice(combined);
    const nextMenuKey=JSON.stringify([combined.taskSource,combined.isWorking,combined.remainingPercent,combined.life.progression.level,combined.life.progression.levelXp,combined.life.mode,taskFollowOptions(combined.tasks,followSession)]);
    if(nextMenuKey!==menuStateKey){menuStateKey=nextMenuKey;if(tray)updateMenu();}
    return combined;
  }});origin=`http://127.0.0.1:${server.address().port}`;
  petURL=`${origin}/?model=working_thinking&view=pet&auto=${smokeTest?'0':'1'}`;
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  const area=screen.getPrimaryDisplay().workArea;
  window=new BrowserWindow({...movement.restoreBounds(sizing.scaledBounds(viewScale,area),restoredView,screen.getAllDisplays().map(d=>d.workArea)),
    show:false,transparent:true,frame:false,hasShadow:false,alwaysOnTop:true,resizable:false,...taskbarOptions,
    backgroundColor:'#00000000',title:'GPT_Dragon_girl_transformation',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,
      webSecurity:true,backgroundThrottling:false},
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('did-finish-load',()=>syncPresentationView(true));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.on('context-menu',()=>updateMenu().popup({window}));
  window.webContents.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown'||!input.control||input.alt||input.meta)return;
    const action=['+','='].includes(input.key)?'in':input.key==='-'?'out':input.key==='0'?'default':null;
    if(action){event.preventDefault();changeScale(action);}
  });
  ipcMain.handle('dragon:scale',(event,action)=>{
    if(event.sender!==window.webContents||!event.senderFrame?.url.startsWith(origin+'/'))throw new Error('Unexpected scale sender');
    return changeScale(action);
  });
  ipcMain.handle('dragon:view',event=>{
    const known=[window,taskWindow,noticeWindow].some(target=>target&&!target.isDestroyed()&&event.sender===target.webContents);
    if(!known||!event.senderFrame?.url.startsWith(origin+'/'))throw new Error('Unexpected presentation sender');
    return syncPresentationView();
  });
  ipcMain.handle('dragon:drag',(event,action)=>{
    if(!validSender(event,true)||!['begin','end'].includes(action))throw new Error('Unexpected drag request');
    if(action==='end')return endDrag();
    endDrag();const point=screen.getCursorScreenPoint(),sender=BrowserWindow.fromWebContents(event.sender),bounds=sender.getBounds();
    if(point.x<bounds.x||point.x>bounds.x+bounds.width||point.y<bounds.y||point.y>bounds.y+bounds.height)return {started:false};
    dragState={point,bounds:window.getBounds(),moved:false,started:Date.now()};
    dragTimer=setInterval(()=>{if(Date.now()-dragState.started>30000)endDrag();else updateDrag();},16);
    return {started:true};
  });
  ipcMain.handle('dragon:panel',(event,action)=>{
    if(!validSender(event,true)||!['show','hide'].includes(action))throw new Error('Unexpected panel request');
    return setPanelVisible(action==='show');
  });
  ipcMain.handle('dragon:bubble-visibility',(event,visible)=>{
    if(event.sender!==taskWindow?.webContents||event.senderFrame?.url!==origin+'/mini.html'||typeof visible!=='boolean')throw new Error('Unexpected bubble visibility request');
    taskBubbleVisible=visible;taskWindow.setIgnoreMouseEvents(clickThrough||!visible,{forward:true});
    updateMenu();
    return {visible:taskBubbleVisible,ignoringMouse:clickThrough||!visible};
  });
  ipcMain.handle('dragon:follow',(event,id)=>{
    if(!validSender(event,true)||event.senderFrame!==event.sender.mainFrame
      ||![petURL,origin+'/mini.html'].includes(event.senderFrame.url))throw new Error('Unexpected task selection sender');
    return setFollowTask(id);
  });
  ipcMain.handle('dragon:new-chat',event=>{
    if(!validSender(event,true))throw new Error('Unexpected chat request');
    return openNewChat();
  });
  ipcMain.handle('dragon:dismiss-notice',event=>{
    if(event.sender!==noticeWindow?.webContents||event.senderFrame?.url!==origin+'/notice.html')throw new Error('Unexpected notice sender');
    if(currentNotice)dismissedNotices.set(currentNotice.key,currentNotice.expiresAt);
    syncNotice();return {dismissed:true};
  });
  ipcMain.handle('dragon:open-question',event=>{
    if(event.sender!==noticeWindow?.webContents||event.senderFrame?.url!==origin+'/notice.html')throw new Error('Unexpected question sender');
    syncNotice();return openConversation(currentNotice,{question:true});
  });
  ipcMain.handle('dragon:open-task',(event,taskId)=>{
    if(event.sender!==taskWindow?.webContents||event.senderFrame?.url!==origin+'/mini.html')throw new Error('Unexpected task sender');
    if(typeof taskId!=='string'||!/^[a-f0-9]{64}$/.test(taskId))throw new Error('Invalid displayed task');
    // Open exactly the task displayed when clicked, even if another thread has
    // since produced a newer message. Unknown hashes never select a fallback.
    const selected=displayedTask(lastCombinedState?.tasks,taskId);
    return openConversation(selected);
  });
  ipcMain.handle('dragon:life',(event,action)=>{
    if(event.sender!==window.webContents||!event.senderFrame?.url.startsWith(origin+'/'))throw new Error('Unexpected interaction sender');
    if(!['get','click','greeting','sleep','normal'].includes(action))throw new Error('Unknown life action');
    return action==='greeting'?handleManualGreeting():handleLife(action);
  });
  window.on('move',()=>{positionPanel();clearTimeout(moveSaveTimer);moveSaveTimer=setTimeout(saveView,250);});
  window.on('resize',positionPanel);
  for(const eventName of ['display-added','display-removed','display-metrics-changed'])screen.on(eventName,positionPanel);
  window.on('hide',()=>{taskWindow?.hide();noticeWindow?.hide();});
  window.on('close',event=>{if(!quitting){event.preventDefault();endDrag();window.hide();}});
  taskWindow=new BrowserWindow({parent:window,width:168,height:66,show:false,transparent:true,frame:false,hasShadow:false,alwaysOnTop:true,resizable:false,
    ...taskbarOptions,backgroundColor:'#00000000',title:'GPT_Dragon_girl_transformation · 当前任务',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  taskWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  taskWindow.webContents.on('did-finish-load',()=>syncPresentationView(true));
  taskWindow.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
  taskWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  taskWindow.webContents.on('context-menu',()=>updateMenu().popup({window:taskWindow}));
  taskWindow.on('close',event=>{if(!quitting){event.preventDefault();setPanelVisible(false);}});
  await taskWindow.loadURL(`${origin}/mini.html`);positionPanel();
  noticeWindow=new BrowserWindow({parent:window,width:278,height:104,show:false,transparent:true,frame:false,hasShadow:false,alwaysOnTop:true,resizable:false,
    ...taskbarOptions,backgroundColor:'#00000000',title:'GPT_Dragon_girl_transformation · 提问提醒',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  noticeWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  noticeWindow.webContents.on('did-finish-load',()=>syncPresentationView(true));
  noticeWindow.webContents.on('will-navigate',event=>event.preventDefault());
  noticeWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  noticeWindow.on('close',event=>{if(!quitting){event.preventDefault();if(currentNotice)dismissedNotices.set(currentNotice.key,currentNotice.expiresAt);syncNotice();}});
  await noticeWindow.loadURL(`${origin}/notice.html`);positionNotice();
  if(!smokeTest) {
    const iconFile=path.resolve(__dirname,'../hd-v3/working_thinking.png');
    let icon=nativeImage.createFromPath(iconFile);
    if(icon.isEmpty())throw new Error('Tray icon source is missing: '+iconFile);
    tray=new Tray(icon.resize({width:32,height:32,quality:'best'}));tray.setToolTip('GPT_Dragon_girl_transformation · 拖动角色移动 · Ctrl + 滚轮缩放');
    tray.on('double-click',showCompanion);updateMenu();
    globalShortcut.register('CommandOrControl+Alt+Shift+D',showCompanion);
  }
  await window.loadURL(petURL);
  if(smokeTest) {
    const deadline=Date.now()+30000;let evidence;
    do {
      evidence=await window.webContents.executeJavaScript('window.dragonPreview');
      if(['rendering','missing_model','error'].includes(evidence?.status))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    } while(Date.now()<deadline);
    const ambientBefore=evidence?.ambient;
    // A never-shown Windows window may stop receiving compositor frames.
    // Capture requests a real frame without showing/focusing the test window.
    let ambientAfter;const animationDeadline=Date.now()+4000;
    do {
      await window.webContents.capturePage();
      await new Promise(resolve=>setTimeout(resolve,100));
      ambientAfter=await window.webContents.executeJavaScript('window.dragonPreview.ambient');
      if(ambientAfter?.time>ambientBefore?.time)break;
    } while(Date.now()<animationDeadline);
    const ambientEvidence={before:ambientBefore,after:ambientAfter,
      advancing:!!ambientAfter?.enabled&&ambientAfter.time>ambientBefore?.time};
    if(!ambientEvidence.advancing)throw new Error('Secondary breathing motion did not advance: '+JSON.stringify({status:evidence?.status,error:evidence?.error,...ambientEvidence}));
    let touchEvidence;const touchDeadline=Date.now()+5000;
    do {
      await window.webContents.capturePage();
      touchEvidence=await window.webContents.executeJavaScript('window.dragonPreview.touch');
      if(touchEvidence?.pageReady&&touchEvidence?.earringReady)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<touchDeadline);
    if(!touchEvidence?.pageReady||!touchEvidence?.earringReady)throw new Error('Touch animation artwork did not load');
    const readFollowState=async()=>{
      const state=await window.webContents.executeJavaScript("fetch('/api/companion-state').then(response=>response.json())");
      const expected=state.followSession||taskFollowFixture[0].id;
      const limit=Date.now()+5000;let bubble;
      do{
        bubble=await taskWindow.webContents.executeJavaScript('window.miniEvidence');
        if(bubble?.taskId===expected)break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }while(Date.now()<limit);
      if(bubble?.taskId!==expected)throw new Error('Selected task did not reach the task bubble');
      return {followSession:state.followSession,isWorking:state.isWorking,taskKnown:state.taskKnown,
        bubbleTaskId:bubble.taskId,operation:bubble.operation,noticeSession:currentNotice?.sessionId??null};
    };
    await window.webContents.executeJavaScript("fetch('/api/companion-state').then(response=>response.json())");
    const nativeFollow=updateMenu().getMenuItemById('task-follow-menu');
    const followIpc={nativeMenuPresent:!!nativeFollow,options:taskFollowOptions(lastCombinedState.tasks,followSession)};
    if(!nativeFollow?.submenu.getMenuItemById('follow-'+taskFollowFixture[1].id))throw new Error('Task switch menu is missing a known conversation');
    // Exercise the native menu callback, then the main and bubble IPC entry
    // points. Test preferences and conversations belong only to smoke mode.
    await nativeFollow.submenu.getMenuItemById('follow-'+taskFollowFixture[1].id).click();
    await viewWrite;
    followIpc.selectedCompleted=await readFollowState();
    followIpc.persistedCompleted=JSON.parse(await fs.readFile(viewFile,'utf8')).followSession;
    await window.webContents.executeJavaScript(`window.dragonDesktop.follow('${taskFollowFixture[0].id}')`);
    followIpc.selectedWorking=await readFollowState();
    followIpc.invalidRejected=await window.webContents.executeJavaScript("window.dragonDesktop.follow('invalid').then(()=>false,()=>true)");
    followIpc.unknownRejected=await window.webContents.executeJavaScript(`window.dragonDesktop.follow('${'c'.repeat(64)}').then(()=>false,()=>true)`);
    followIpc.wrongWindowRejected=await noticeWindow.webContents.executeJavaScript(`window.dragonDesktop.follow('${taskFollowFixture[0].id}').then(()=>false,()=>true)`);
    await taskWindow.webContents.executeJavaScript("window.dragonDesktop.follow('')");
    followIpc.autoState=await readFollowState();
    if(followIpc.selectedCompleted.isWorking||!followIpc.selectedWorking.isWorking||!followIpc.autoState.isWorking
      ||!followIpc.invalidRejected||!followIpc.unknownRejected||!followIpc.wrongWindowRejected)throw new Error('Task switch IPC validation failed');
    const lifeIpc=await window.webContents.executeJavaScript(`(async()=>({
      before:await window.dragonDesktop.life('get'),
      clicked:await window.dragonDesktop.life('click'),
      sleeping:await window.dragonDesktop.life('sleep')
    }))()`);
    async function waitVisual(expected){
      const limit=Date.now()+8000;let current;
      do{await window.webContents.capturePage();current=await window.webContents.executeJavaScript('window.dragonPreview');
        if(current.activeVisual===expected)return current;
        await new Promise(resolve=>setTimeout(resolve,80));
      }while(Date.now()<limit);
      throw new Error('Visual IPC did not reach '+expected+': '+current?.activeVisual);
    }
    const sleepVisual=await waitVisual('sleep_mode');
    lifeIpc.restored=await window.webContents.executeJavaScript("window.dragonDesktop.life('normal')");
    window.webContents.send('dragon:action','state:idle_high_energy');
    await waitVisual('idle_high_energy');
    window.webContents.send('dragon:action','state:working_thinking');
    await waitVisual('working_thinking');
    window.webContents.send('dragon:action','growth');
    const growthDeadline=Date.now()+3000;let growthVisible=false;
    do{growthVisible=await window.webContents.executeJavaScript("Boolean(document.querySelector('#growthCard progress'))");if(growthVisible)break;await new Promise(resolve=>setTimeout(resolve,30));}while(Date.now()<growthDeadline);
    if(!growthVisible)throw new Error('Growth card IPC did not open');
    window.webContents.send('dragon:action','growth');
    lifeIpc.visualValidation={sleep:sleepVisual.activeVisual,sleepFace:sleepVisual.reactionVisuals?.pose,stateMenuPassed:true,growthCardPassed:growthVisible};
    const scaleIpc=await window.webContents.executeJavaScript(`(async()=>({
      default:await window.dragonDesktop.scale('default'),
      enlarged:await window.dragonDesktop.scale('in'),
      reduced:await window.dragonDesktop.scale('out'),
      invalid:await window.dragonDesktop.scale('unsafe').then(()=>false,()=>true),
      restored:await window.dragonDesktop.scale('default')
    }))()`);
    await viewWrite;
    await new Promise(resolve=>setTimeout(resolve,150));
    scaleIpc.persisted=JSON.parse(await fs.readFile(viewFile,'utf8'));
    // Move only this never-shown smoke-test window. The ordinary companion
    // path never moves a user's pet to exercise the mirror boundary.
    const originalBounds=window.getBounds(),mirrorDisplay=screen.getDisplayMatching(originalBounds),presentationIpc={samples:[]};
    const surfaces=[window,taskWindow,noticeWindow];
    for(const target of surfaces)await target.webContents.executeJavaScript("window.__presentationEvents=[];window.__stopPresentationEvents=window.dragonDesktop.onView(value=>window.__presentationEvents.push(value));true;");
    try{
      for(const [fraction,expected] of [[.25,false],[.75,true],[.25,false]]){
        const x=Math.round(mirrorDisplay.bounds.x+mirrorDisplay.bounds.width*fraction-originalBounds.width/2);
        window.setPosition(x,originalBounds.y);
        let views;const limit=Date.now()+3000;
        do{
          await new Promise(resolve=>setTimeout(resolve,30));
          views=await Promise.all(surfaces.map(target=>target.webContents.executeJavaScript('window.dragonDesktop.view()')));
          if(views.every(value=>value.mirrored===expected))break;
        }while(Date.now()<limit);
        if(!views.every(value=>value.mirrored===expected))throw new Error('Mirror direction did not synchronize across windows');
        const petBounds=window.getBounds(),actual=taskWindow.getBounds(),expectedBounds=movement.panelBounds(petBounds,screen.getDisplayMatching(petBounds).workArea,expected);
        if(actual.x!==expectedBounds.x||actual.y!==expectedBounds.y)throw new Error('Mirror task bubble did not follow the monitor');
        const combined=await window.webContents.executeJavaScript("fetch('/api/companion-state').then(response=>response.json())");
        if(combined.presentationView?.mirrored!==expected)throw new Error('State endpoint mirror direction is stale');
        presentationIpc.samples.push({expected,views,petBounds,panelBounds:actual});
      }
      presentationIpc.events=await Promise.all(surfaces.map(target=>target.webContents.executeJavaScript('window.__presentationEvents')));
      if(!presentationIpc.events.every(events=>events.some(value=>value.mirrored)&&events.some(value=>!value.mirrored)))throw new Error('Mirror push events were not delivered');
    }finally{
      window.setBounds(originalBounds);positionPanel();
      for(const target of surfaces)await target.webContents.executeJavaScript('window.__stopPresentationEvents();delete window.__stopPresentationEvents;delete window.__presentationEvents;');
    }
    presentationIpc.restored=await window.webContents.executeJavaScript('window.dragonDesktop.view()');
    // Electron 44 Windows implements skipTaskbar with ITaskbarList::DeleteTab,
    // not WS_EX_TOOLWINDOW. A hidden test can confirm the constructor option
    // and public API call, but cannot observe a visible Shell taskbar button.
    // Source: electron/electron v44.5.1 native_window_views.cc, SetSkipTaskbar.
    let taskbarEvidence={configuredSkipTaskbar:taskbarOptions.skipTaskbar,
      constructorWindowCount:surfaces.length,apiCalls:0,visibleShellVerified:false,
      mechanism:process.platform==='win32'?'ITaskbarList::DeleteTab':'Electron.setSkipTaskbar',
      verification:'hidden-constructor-and-api-call'};
    for(const surface of surfaces){surface.setSkipTaskbar(taskbarOptions.skipTaskbar);taskbarEvidence.apiCalls++;}
    if(process.platform==='win32'){
      try{
        const handle=window.getNativeWindowHandle().readBigUInt64LE().toString();
        const script=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PetWindowStyle { [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr window, int index); }'; $style=[PetWindowStyle]::GetWindowLongPtr([IntPtr]::new(${handle}L),-20).ToInt64(); [pscustomobject]@{toolWindow=(($style -band 128) -ne 0); appWindow=(($style -band 262144) -ne 0)} | ConvertTo-Json -Compress`;
        const {execFile}=require('node:child_process'),{promisify}=require('node:util');
        const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
        const result=await promisify(execFile)(powershell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000});
        taskbarEvidence.nativeStyles={...JSON.parse(result.stdout.trim()),diagnosticOnly:true};
      }catch{taskbarEvidence.nativeStyles={diagnosticOnly:true,available:false};}
    }
    const miniEvidence=await taskWindow.webContents.executeJavaScript('window.miniEvidence');
    const noticeEvidence=await noticeWindow.webContents.executeJavaScript(`(async()=>({text:document.querySelector('strong').textContent,hasEditor:!!document.querySelector('textarea,input'),dismiss:await window.dragonDesktop.dismissNotice()}))()`);
    const noticeCapture=await noticeWindow.webContents.capturePage();
    await fs.writeFile(path.resolve(__dirname,'../../work/desktop-app-v4/notice-smoke.png'),noticeCapture.toPNG());
    const miniCapture=await taskWindow.webContents.capturePage();
    await fs.writeFile(path.resolve(__dirname,'../../work/desktop-app-v4/mini-smoke.png'),miniCapture.toPNG());
    const preferences=window.webContents.getLastWebPreferences();
    const capture=await window.webContents.capturePage(),bitmap=capture.toBitmap();
    let transparentPixels=0,visiblePixels=0;
    for(let index=3;index<bitmap.length;index+=4){if(bitmap[index]===0)transparentPixels++;else visiblePixels++;}
    const report={checkedAt:new Date().toISOString(),appVersion:app.getVersion(),electron:process.versions.electron,
      windowVisible:window.isVisible(),alwaysOnTop:window.isAlwaysOnTop(),backgroundColor:window.getBackgroundColor(),presentationView:{...presentationView},taskbarMode:'tray-only',
      pageCapture:{...capture.getSize(),transparentPixels,visiblePixels},
      security:{sandbox:preferences.sandbox,contextIsolation:preferences.contextIsolation,nodeIntegration:preferences.nodeIntegration,webSecurity:preferences.webSecurity},
      renderer:evidence,ambientEvidence,touchEvidence,miniEvidence,noticeEvidence,noticeBounds:noticeWindow.getBounds(),panelBounds:taskWindow.getBounds(),state:await readState(argument('--state-file')),quota:quotaService?.current()??{status:'disabled_in_test'},lifeIpc,scaleIpc,presentationIpc,taskbarEvidence,followIpc,
      note:'Hidden Electron shell test; a missing model is not a successful Live2D render.'};
    const target=argument('--report')||path.resolve(__dirname,'../../work/desktop-app-v4/electron-smoke-report.json');
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));quitting=true;app.quit();
  } else {
    window.showInactive();window.setAlwaysOnTop(true);updateMenu();await handleLife('greeting');
    if(panelVisible){taskWindow.showInactive();taskWindow.setAlwaysOnTop(true);}
    desktopPin=pinCompanionWindows([window,taskWindow,noticeWindow],{onChange:state=>{
      fs.writeFile(path.resolve(__dirname,'../../work/desktop-app-v4/virtual-desktops.json'),JSON.stringify(state,null,2)).catch(error=>console.error('Desktop pin report: '+error.message));
    }});
    greetingTimer=setInterval(()=>{handleLife('greeting').catch(error=>console.error('Greeting: '+error.message));},60000);
    const deadline=Date.now()+30000;let renderer;
    do {
      renderer=await window.webContents.executeJavaScript('window.dragonPreview');
      if(['rendering','missing_model','error'].includes(renderer?.status))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    } while(Date.now()<deadline);
    const report={checkedAt:new Date().toISOString(),appVersion:app.getVersion(),pid:process.pid,origin,windowVisible:window.isVisible(),
      alwaysOnTop:window.isAlwaysOnTop(),title:window.getTitle(),scale:viewScale,bounds:window.getBounds(),renderer,presentationView:{...presentationView},taskbarMode:'tray-only',
      miniEvidence:await taskWindow.webContents.executeJavaScript('window.miniEvidence'),panelBounds:taskWindow.getBounds(),panelVisible:taskWindow.isVisible()};
    runtimeReportSnapshot=report;await persistRuntimeReport();
  }
}
if(locked) {
  app.on('second-instance',showCompanion);
  app.whenReady().then(createCompanion).catch(error=>{console.error(error);quitting=true;app.quit();});
  app.on('before-quit',event=>{
    quitting=true;if(exitFlushed)return;event.preventDefault();exitFlushed=true;
    endDrag();clearTimeout(moveSaveTimer);
    desktopPin?.stop();quotaService?.stop();if(greetingTimer)clearInterval(greetingTimer);globalShortcut.unregisterAll();tray?.destroy();server?.close();
    Promise.allSettled([lifeQueue,lifeWrite,viewWrite,runtimeReportWrite]).finally(()=>app.quit());
  });
  app.on('window-all-closed',()=>{if(quitting)app.quit();});
}
