const { contextBridge, ipcRenderer }=require('electron');
function presentationView(value) {
  if(typeof value?.mirrored!=='boolean')throw new Error('Invalid presentation view');
  return Object.freeze({mirrored:value.mirrored,screenSide:value.mirrored?'right':'left',displayId:value.displayId});
}
contextBridge.exposeInMainWorld('dragonDesktop',Object.freeze({
  view() {return ipcRenderer.invoke('dragon:view').then(presentationView);},
  onView(callback) {
    if(typeof callback!=='function')return ()=>{};
    const handler=(_event,value)=>{if(typeof value?.mirrored==='boolean')callback(presentationView(value));};
    ipcRenderer.on('dragon:view-update',handler);
    return ()=>ipcRenderer.removeListener('dragon:view-update',handler);
  },
  drag(action) {
    if(!['begin','end'].includes(action))return Promise.reject(new Error('Unsupported drag action'));
    return ipcRenderer.invoke('dragon:drag',action);
  },
  panel(action) {
    if(!['hide','show'].includes(action))return Promise.reject(new Error('Unsupported panel action'));
    return ipcRenderer.invoke('dragon:panel',action);
  },
  bubbleVisibility(visible) {
    if(typeof visible!=='boolean')return Promise.reject(new Error('Invalid bubble visibility'));
    return ipcRenderer.invoke('dragon:bubble-visibility',visible);
  },
  follow(id='') {
    if(typeof id!=='string'||id!==''&&!/^[a-f0-9]{64}$/.test(id))return Promise.reject(new Error('Invalid task identifier'));
    return ipcRenderer.invoke('dragon:follow',id);
  },
  newChat() {return ipcRenderer.invoke('dragon:new-chat');},
  openTask(taskId) {
    if(typeof taskId!=='string'||!/^[a-f0-9]{64}$/.test(taskId))return Promise.reject(new Error('Invalid task identifier'));
    return ipcRenderer.invoke('dragon:open-task',taskId);
  },
  openQuestion() {return ipcRenderer.invoke('dragon:open-question');},
  dismissNotice() {return ipcRenderer.invoke('dragon:dismiss-notice');},
  onNotice(callback) {
    if(typeof callback!=='function')return ()=>{};
    const handler=()=>callback();ipcRenderer.on('dragon:notice-show',handler);
    return ()=>ipcRenderer.removeListener('dragon:notice-show',handler);
  },
  scale(action='get') {
    if(!['get','in','out','default'].includes(action))return Promise.reject(new Error('Unsupported scale action'));
    return ipcRenderer.invoke('dragon:scale',action);
  },
  life(action='get') {
    if(!['get','click','greeting','sleep','normal'].includes(action))return Promise.reject(new Error('Unsupported interaction'));
    return ipcRenderer.invoke('dragon:life',action);
  },
  onLife(callback) {
    if(typeof callback!=='function')return ()=>{};
    const handler=(_event,value)=>callback(value);ipcRenderer.on('dragon:life-update',handler);
    return ()=>ipcRenderer.removeListener('dragon:life-update',handler);
  },
  onAction(callback) {
    if(typeof callback!=='function')return ()=>{};
    const handler=(_event,action)=>{if(['pause','reset','reload','growth','bubble:show','state:auto','state:working_thinking','state:idle_high_energy','state:idle_mid_energy','state:idle_low_energy'].includes(action))callback(action);};
    ipcRenderer.on('dragon:action',handler);
    return ()=>ipcRenderer.removeListener('dragon:action',handler);
  },
}));
