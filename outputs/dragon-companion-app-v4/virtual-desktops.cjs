const {spawn}=require('node:child_process');
const path=require('node:path');
function nativeHandle(window){const bytes=window.getNativeWindowHandle();return (bytes.length===8?bytes.readBigUInt64LE():BigInt(bytes.readUInt32LE())).toString();}
function pinCompanionWindows(windows,{onChange=()=>{}}={}){
  let worker,retry,stopped=false,topmost=true,status={method:'starting',allPinned:false,windows:[]};
  const report=value=>{status=value;onChange(value);};
  function start(){
    if(stopped||windows.some(w=>w.isDestroyed()))return;
    if(process.platform!=='win32'){
      for(const w of windows)w.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
      report({method:'electron-workspaces',allPinned:true});return;
    }
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=worker=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'virtual-desktops.ps1'),'-OwnerPid',String(process.pid),'-WindowHandles',windows.map(nativeHandle).join(','),'-Topmost',topmost?'1':'0'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let pending='',errors='';
    worker.stdout.on('data',chunk=>{pending+=chunk.toString();let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index).trim();pending=pending.slice(index+1);try{report(JSON.parse(line));}catch{}}});
    worker.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
    worker.on('error',error=>report({method:'windows-shell-window-pin',allPinned:false,error:error.message}));
    worker.on('exit',code=>{if(worker!==child)return;worker=null;if(!stopped){report({method:'windows-shell-window-pin',allPinned:false,error:errors||`Helper exited (${code})`});retry=setTimeout(start,15000);retry.unref();}});
  }
  start();return {status:()=>status,setTopmost(value){if(topmost===!!value)return;topmost=!!value;clearTimeout(retry);const old=worker;worker=null;old?.kill();start();},stop(){stopped=true;clearTimeout(retry);worker?.kill();}};
}
module.exports={nativeHandle,pinCompanionWindows};
