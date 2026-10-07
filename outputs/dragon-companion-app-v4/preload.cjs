const { contextBridge, ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('dragonDesktop',Object.freeze({
  drag(action) {
    if(!['begin','end'].includes(action))return Promise.reject(new Error('Unsupported drag action'));
    return ipcRenderer.invoke('dragon:drag',action);
  },
  panel(action) {
    if(!['hide','show'].includes(action))return Promise.reject(new Error('Unsupported panel action'));
    return ipcRenderer.invoke('dragon:panel',action);
  },
  follow(id='') {return ipcRenderer.invoke('dragon:follow',id);},
  newChat() {return ipcRenderer.invoke('dragon:new-chat');},
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
    if(!['get','click','greeting','gaming','sleep','normal'].includes(action))return Promise.reject(new Error('Unsupported interaction'));
    return ipcRenderer.invoke('dragon:life',action);
  },
  onLife(callback) {
    if(typeof callback!=='function')return ()=>{};
    const handler=(_event,value)=>callback(value);ipcRenderer.on('dragon:life-update',handler);
    return ()=>ipcRenderer.removeListener('dragon:life-update',handler);
  },
  onAction(callback) {
    if(typeof callback!=='function')return ()=>{};
    const handler=(_event,action)=>{if(['pause','reset','reload'].includes(action))callback(action);};
    ipcRenderer.on('dragon:action',handler);
    return ()=>ipcRenderer.removeListener('dragon:action',handler);
  },
}));
