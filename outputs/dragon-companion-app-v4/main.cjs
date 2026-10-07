const { app, BrowserWindow, Menu, Tray, nativeImage, screen, globalShortcut, session, ipcMain, shell }=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const { pathToFileURL }=require('node:url');
const sizing=require('./window-sizing.cjs');
const movement=require('./window-interaction.cjs');
const {newChatLink}=require('./chat-link.cjs');
const {noticeBounds,chooseNotice}=require('./question-notice.cjs');
let lastChatOpen=0;
async function openNewChat() {
  if(Date.now()-lastChatOpen<1000)return {opened:false};
  const task=followSession?lastCombinedState?.tasks?.find(t=>t.id===followSession):lastCombinedState?.tasks?.[0];
  const url=newChatLink(task?.cwd);lastChatOpen=Date.now();
  await shell.openExternal(url);return {opened:true};
}

let window,tray,server,origin,clickThrough=false,quitting=false;
let quotaService,lifeModule,lifeState,lifeWrite=Promise.resolve(),lastCombinedState=null;
let exitFlushed=false;
let menuStateKey='';
let greetingTimer;
let viewScale=sizing.DEFAULT_SCALE,viewWrite=Promise.resolve();
let taskWindow,panelVisible=true,followSession='',dragState,dragTimer,moveSaveTimer,restoredView={};
let noticeWindow,currentNotice=null;const dismissedNotices=new Map();
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
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const sessionDirectory=path.resolve(__dirname,`../../work/desktop-app-v4/${smokeTest?'smoke-session':'session'}`);
const lifeFile=path.resolve(__dirname,`../../work/desktop-app-v4/${smokeTest?'smoke-life-state':'life-state'}.json`);
const viewFile=path.resolve(__dirname,`../../work/desktop-app-v4/${smokeTest?'smoke-window-settings':'window-settings'}.json`);
app.setPath('userData',sessionDirectory);
app.setName('GPT娘');
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();

function showCompanion() {
  if(!window)return;clickThrough=false;window.setIgnoreMouseEvents(false);
  taskWindow?.setIgnoreMouseEvents(false);
  noticeWindow?.setIgnoreMouseEvents(false);
  window.show();window.focus();updateMenu();
  if(panelVisible){positionPanel();taskWindow?.showInactive();}
  syncNotice();
}
function saveView() {
  const bounds=window.getBounds();
  const data=JSON.stringify({version:2,scale:viewScale,x:bounds.x,y:bounds.y,panelVisible,followSession},null,2);
  viewWrite=viewWrite.then(async()=>{await fs.writeFile(viewFile+'.tmp',data);await fs.rename(viewFile+'.tmp',viewFile);})
    .catch(error=>console.error('Window settings save failed: '+error.message));
}
function positionPanel() {
  if(!window||!taskWindow||taskWindow.isDestroyed())return;
  const bounds=window.getBounds();taskWindow.setBounds(movement.panelBounds(bounds,screen.getDisplayMatching(bounds).workArea));
  positionNotice();
}
function setPanelVisible(value) {
  panelVisible=value;positionPanel();
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
  const taskLabel=lastCombinedState?.taskSource==='codex-hooks'?'Codex任务已接入':lastCombinedState?.taskKnown?'手动任务状态':'任务状态未接入';
  const menu=Menu.buildFromTemplate([
    {label:'GPT娘',enabled:false},
    {label:`${taskLabel} · 额度 ${Number.isFinite(quota)?quota+'%':'未知'}`,enabled:false},
    {label:'显示 / 恢复交互',click:showCompanion},
    {label:'显示当前任务卡片',type:'checkbox',checked:panelVisible,click:item=>setPanelVisible(item.checked)},
    {label:'在 Codex 新建聊天',click:()=>openNewChat().catch(error=>console.error('Open Codex chat: '+error.message))},
    {label:'鼠标穿透',type:'checkbox',checked:clickThrough,click:item=>{clickThrough=item.checked;window.setIgnoreMouseEvents(clickThrough,{forward:true});taskWindow?.setIgnoreMouseEvents(clickThrough,{forward:true});noticeWindow?.setIgnoreMouseEvents(clickThrough,{forward:true});updateMenu();}},
    {label:'始终置顶',type:'checkbox',checked:window?.isAlwaysOnTop()!==false,click:item=>{window.setAlwaysOnTop(item.checked);taskWindow?.setAlwaysOnTop(item.checked);noticeWindow?.setAlwaysOnTop(item.checked);}},
    {label:`缩放 · ${Number((viewScale*100).toFixed(1))}%`,submenu:[
      {label:'放大（Ctrl + 滚轮向上）',click:()=>changeScale('in')},
      {label:'缩小（Ctrl + 滚轮向下）',click:()=>changeScale('out')},
      {label:'恢复默认 1/3（180 × 200）',click:()=>changeScale('default')},
      {type:'separator'},
      ...sizing.PRESETS.map(value=>({label:value===sizing.DEFAULT_SCALE?'33.3% · 默认':`${value*100}%`,type:'radio',checked:Math.abs(viewScale-value)<.001,click:()=>setCompanionScale(value)})),
    ]},
    {type:'separator'},
    {label:'打个招呼',click:()=>handleLife('greeting')},
    {label:'游戏陪伴 · 30分钟',click:()=>handleLife('gaming')},
    {label:'休息 · 60分钟',click:()=>handleLife('sleep')},
    {label:'结束临时模式',click:()=>handleLife('normal')},
    {type:'separator'},
    {label:'暂停 / 继续动作',click:()=>window.webContents.send('dragon:action','pause')},
    {label:'重新读取模型',click:()=>window.webContents.send('dragon:action','reload')},
    {label:'重置位置',click:()=>{setCompanionScale(viewScale,{resetPosition:true});showCompanion();}},
    {type:'separator'},
    {label:'退出',click:()=>{quitting=true;app.quit();}},
  ]);
  tray?.setContextMenu(menu);return menu;
}
function lifeSnapshot(result=null) {
  lifeState=lifeModule.normalizeLifeState(lifeState,lifeOptions);
  return {progression:lifeModule.getProgression(lifeState,lifeOptions),affection:lifeState.affection,
    mode:lifeModule.getEffectiveMode(lifeState,lifeOptions),result};
}
async function handleLife(action='get') {
  let change;
  if(action==='click')change=lifeModule.applyInteraction(lifeState,'click',lifeOptions);
  else if(action==='greeting')change=lifeModule.claimGreeting(lifeState,lifeOptions);
  else if(['gaming','sleep','normal'].includes(action))change=lifeModule.setTemporaryMode(lifeState,{gaming:'gaming_mode',sleep:'sleep_mode',normal:null}[action],lifeOptions);
  if(change&&!(action==='greeting'&&!change.result.greeting)) {
    lifeState=change.state;const serialized=lifeModule.serializeLifeState(lifeState,lifeOptions);
    lifeWrite=lifeWrite.then(async()=>{const temporary=lifeFile+'.tmp';await fs.writeFile(temporary,serialized);await fs.rename(temporary,lifeFile);}).catch(error=>console.error('Life save failed: '+error.message));
    await lifeWrite;
  }
  const snapshot=lifeSnapshot(change?.result);
  if(change&&window&&!window.isDestroyed())window.webContents.send('dragon:life-update',snapshot);
  return snapshot;
}
async function createCompanion() {
  await fs.mkdir(sessionDirectory,{recursive:true});
  viewScale=sizing.readScale(await fs.readFile(viewFile,'utf8').catch(()=>''));
  try{restoredView=JSON.parse(await fs.readFile(viewFile,'utf8'));}catch{}
  panelVisible=restoredView.panelVisible!==false;
  followSession=/^[a-f0-9]{64}$/.test(restoredView.followSession)?restoredView.followSession:'';
  const {startServer}=await import(pathToFileURL(path.resolve(__dirname,'../live2d-preview-v4/server.mjs')).href);
  const {readState}=await import(pathToFileURL(path.join(__dirname,'state-bridge.mjs')).href);
  const {aggregate}=await import(pathToFileURL(path.resolve(__dirname,'../dragon-codex-bridge-v4/hook.mjs')).href);
  lifeModule=await import(pathToFileURL(path.join(__dirname,'life/index.mjs')).href);
  lifeState=lifeModule.parseLifeState(await fs.readFile(lifeFile,'utf8').catch(()=>''),lifeOptions);
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
    const hookState=await aggregate();
    if(state.source==='codex-hooks'||hookState.tasks.length)state={...state,...hookState,connection:'local_file',source:'codex-hooks'};
    const combined=quotaEnabled?combineStateAndQuota(state,quotaService.current()):state;
    combined.followSession=followSession;
    if(followSession){
      const chosen=combined.tasks?.find(task=>task.id===followSession);
      combined.isWorking=chosen?.active===true;
      if(!chosen){combined.taskKnown=false;combined.connection='task_unknown';}
    }
    combined.life=lifeSnapshot();
    combined.presentationMode=combined.isWorking?null:combined.life.mode;
    lastCombinedState=combined;
    syncNotice(combined);
    const nextMenuKey=JSON.stringify([combined.taskSource,combined.isWorking,combined.remainingPercent]);
    if(nextMenuKey!==menuStateKey){menuStateKey=nextMenuKey;if(tray)updateMenu();}
    return combined;
  }});origin=`http://127.0.0.1:${server.address().port}`;
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  const area=screen.getPrimaryDisplay().workArea;
  window=new BrowserWindow({...movement.restoreBounds(sizing.scaledBounds(viewScale,area),restoredView,screen.getAllDisplays().map(d=>d.workArea)),
    show:false,transparent:true,frame:false,hasShadow:false,alwaysOnTop:true,resizable:false,
    backgroundColor:'#00000000',title:'GPT娘',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,
      webSecurity:true,backgroundThrottling:false},
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
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
  ipcMain.handle('dragon:follow',(event,id)=>{
    if(!validSender(event,true)||typeof id!=='string'||(id!==''&&!lastCombinedState?.tasks?.some(t=>t.id===id)))throw new Error('Unknown task');
    followSession=id;saveView();return id;
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
  ipcMain.handle('dragon:life',(event,action)=>{
    if(event.sender!==window.webContents||!event.senderFrame?.url.startsWith(origin+'/'))throw new Error('Unexpected interaction sender');
    if(!['get','click','greeting','gaming','sleep','normal'].includes(action))throw new Error('Unknown life action');
    return handleLife(action);
  });
  window.on('move',()=>{positionPanel();clearTimeout(moveSaveTimer);moveSaveTimer=setTimeout(saveView,250);});
  window.on('hide',()=>{taskWindow?.hide();noticeWindow?.hide();});
  window.on('close',event=>{if(!quitting){event.preventDefault();endDrag();window.hide();}});
  taskWindow=new BrowserWindow({width:294,height:180,show:false,transparent:true,frame:false,hasShadow:false,alwaysOnTop:true,resizable:false,
    skipTaskbar:true,backgroundColor:'#00000000',title:'GPT娘 · 当前任务',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  taskWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  taskWindow.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
  taskWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  taskWindow.webContents.on('context-menu',()=>updateMenu().popup({window:taskWindow}));
  taskWindow.on('close',event=>{if(!quitting){event.preventDefault();setPanelVisible(false);}});
  await taskWindow.loadURL(`${origin}/mini.html`);positionPanel();
  noticeWindow=new BrowserWindow({width:278,height:104,show:false,transparent:true,frame:false,hasShadow:false,alwaysOnTop:true,resizable:false,
    skipTaskbar:true,backgroundColor:'#00000000',title:'GPT娘 · 提问提醒',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  noticeWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  noticeWindow.webContents.on('will-navigate',event=>event.preventDefault());
  noticeWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  noticeWindow.on('close',event=>{if(!quitting){event.preventDefault();if(currentNotice)dismissedNotices.set(currentNotice.key,currentNotice.expiresAt);syncNotice();}});
  await noticeWindow.loadURL(`${origin}/notice.html`);positionNotice();
  if(!smokeTest) {
    const iconFile=path.resolve(__dirname,'../hd-v3/working_thinking.png');
    let icon=nativeImage.createFromPath(iconFile);
    if(icon.isEmpty())throw new Error('Tray icon source is missing: '+iconFile);
    tray=new Tray(icon.resize({width:32,height:32,quality:'best'}));tray.setToolTip('GPT娘 · 拖动角色移动 · Ctrl + 滚轮缩放');
    tray.on('double-click',showCompanion);updateMenu();
    globalShortcut.register('CommandOrControl+Alt+Shift+D',showCompanion);
  }
  await window.loadURL(`${origin}/?model=working_thinking&view=pet`);
  if(smokeTest) {
    const deadline=Date.now()+30000;let evidence;
    do {
      evidence=await window.webContents.executeJavaScript('window.dragonPreview');
      if(['rendering','missing_model','error'].includes(evidence?.status))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    } while(Date.now()<deadline);
    const lifeIpc=await window.webContents.executeJavaScript(`(async()=>({
      before:await window.dragonDesktop.life('get'),
      clicked:await window.dragonDesktop.life('click'),
      sleeping:await window.dragonDesktop.life('sleep'),
      restored:await window.dragonDesktop.life('normal')
    }))()`);
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
    const report={checkedAt:new Date().toISOString(),electron:process.versions.electron,
      windowVisible:window.isVisible(),alwaysOnTop:window.isAlwaysOnTop(),backgroundColor:window.getBackgroundColor(),
      pageCapture:{...capture.getSize(),transparentPixels,visiblePixels},
      security:{sandbox:preferences.sandbox,contextIsolation:preferences.contextIsolation,nodeIntegration:preferences.nodeIntegration,webSecurity:preferences.webSecurity},
      renderer:evidence,miniEvidence,noticeEvidence,noticeBounds:noticeWindow.getBounds(),panelBounds:taskWindow.getBounds(),state:await readState(argument('--state-file')),quota:quotaService?.current()??{status:'disabled_in_test'},lifeIpc,scaleIpc,
      note:'Hidden Electron shell test; a missing model is not a successful Live2D render.'};
    const target=argument('--report')||path.resolve(__dirname,'../../work/desktop-app-v4/electron-smoke-report.json');
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));quitting=true;app.quit();
  } else {
    window.showInactive();window.setAlwaysOnTop(true);updateMenu();await handleLife('greeting');
    if(panelVisible){taskWindow.showInactive();taskWindow.setAlwaysOnTop(true);}
    greetingTimer=setInterval(()=>{handleLife('greeting').catch(error=>console.error('Greeting: '+error.message));},60000);
    const deadline=Date.now()+30000;let renderer;
    do {
      renderer=await window.webContents.executeJavaScript('window.dragonPreview');
      if(['rendering','missing_model','error'].includes(renderer?.status))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    } while(Date.now()<deadline);
    const report={checkedAt:new Date().toISOString(),pid:process.pid,origin,windowVisible:window.isVisible(),
      alwaysOnTop:window.isAlwaysOnTop(),title:window.getTitle(),scale:viewScale,bounds:window.getBounds(),renderer,
      miniEvidence:await taskWindow.webContents.executeJavaScript('window.miniEvidence'),panelBounds:taskWindow.getBounds(),panelVisible:taskWindow.isVisible()};
    await fs.writeFile(path.resolve(__dirname,'../../work/desktop-app-v4/desktop-runtime-report.json'),JSON.stringify(report,null,2));
  }
}
if(locked) {
  app.on('second-instance',showCompanion);
  app.whenReady().then(createCompanion).catch(error=>{console.error(error);quitting=true;app.quit();});
  app.on('before-quit',event=>{
    quitting=true;if(exitFlushed)return;event.preventDefault();exitFlushed=true;
    endDrag();clearTimeout(moveSaveTimer);
    quotaService?.stop();if(greetingTimer)clearInterval(greetingTimer);globalShortcut.unregisterAll();tray?.destroy();server?.close();
    Promise.allSettled([lifeWrite,viewWrite]).finally(()=>app.quit());
  });
  app.on('window-all-closed',()=>{if(quitting)app.quit();});
}
