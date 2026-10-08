// Windows Script Host JScript. Run with wscript.exe, never as renderer code.
// Observe process metadata only; do not read Codex chats, inject UI, or change hooks.
var shell = new ActiveXObject('WScript.Shell');
var fs = new ActiveXObject('Scripting.FileSystemObject');
var here = fs.GetParentFolderName(WScript.ScriptFullName);
var root = fs.GetParentFolderName(fs.GetParentFolderName(here));
var data = fs.BuildPath(root, 'work\\desktop-app-v4');
var executable = fs.BuildPath(here, 'runtime\\electron-44.5.1\\electron.exe');
var disabled = fs.BuildPath(data, 'follow-disabled.flag');
var service = GetObject('winmgmts:{impersonationLevel=impersonate}!\\\\.\\root\\cimv2');
var previous = '', lastError = '', failedLaunchAt = 0;
function folder(path) { if (!fs.FolderExists(path)) {folder(fs.GetParentFolderName(path)); fs.CreateFolder(path);} }
folder(data);
function status(message) {
  var file = fs.CreateTextFile(fs.BuildPath(data, 'codex-follower-status.txt'), true, true);
  file.WriteLine(new Date().toUTCString());file.WriteLine(message);file.WriteLine('Project: '+root);file.Close();
}
function desktopPath(path) {
  return /\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$/i.test(path);
}
function decide(snapshot, before) {
  return {edge:!!snapshot.key && snapshot.key !== before, launch:!!snapshot.key && snapshot.key !== before && !snapshot.petRunning};
}
function snapshot() {
  var entries = new Enumerator(service.ExecQuery("SELECT ProcessId,ParentProcessId,ExecutablePath,CreationDate FROM Win32_Process WHERE Name='ChatGPT.exe' OR Name='Codex.exe' OR Name='electron.exe'"));
  var apps = [], ids = {}, petRunning = false;
  for (; !entries.atEnd(); entries.moveNext()) {
    var item=entries.item(), path=String(item.ExecutablePath || '');
    if(path.toLowerCase()===executable.toLowerCase())petRunning=true;
    if(desktopPath(path)){apps.push({id:Number(item.ProcessId),parent:Number(item.ParentProcessId),created:String(item.CreationDate)});ids['p'+item.ProcessId]=true;}
  }
  var roots=[];
  for(var i=0;i<apps.length;i++)if(!ids['p'+apps[i].parent])roots.push(apps[i].id+':'+apps[i].created);
  roots.sort();return {key:roots.join('|'),petRunning:petRunning};
}
if(WScript.Arguments.length && WScript.Arguments(0)==='--self-test') {
  if(!desktopPath('C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0_x64__test\\app\\ChatGPT.exe'))throw new Error('Desktop match failed');
  if(desktopPath('C:\\Users\\test\\AppData\\Local\\OpenAI\\Codex\\bin\\v1\\codex.exe'))throw new Error('CLI must not trigger');
  if(!decide({key:'A',petRunning:false},'').launch)throw new Error('Launch edge failed');
  if(decide({key:'A',petRunning:false},'A').launch)throw new Error('Manual exit was overridden');
  if(decide({key:'A',petRunning:true},'').launch)throw new Error('Duplicate launch');
  if(!decide({key:'B',petRunning:false},'A').launch)throw new Error('Restart edge failed');
  WScript.Echo('PASS: 6 launch policy checks');WScript.Quit(0);
}
if(WScript.Arguments.length && WScript.Arguments(0)==='--probe') {
  var observed=snapshot();WScript.Echo('CodexDesktopDetected='+!!observed.key+'; PetAlreadyRunning='+observed.petRunning);WScript.Quit(0);
}
if(!fs.FileExists(executable)){status('Error: companion runtime missing');WScript.Quit(1);}
while(!fs.FileExists(disabled)) {
  try {
    var current=snapshot(), action=decide(current,previous);
    if(action.edge || failedLaunchAt && new Date().getTime()-failedLaunchAt>30000) {
      if(!current.petRunning && current.key) {
        shell.Environment('Process').Remove('ELECTRON_RUN_AS_NODE');
        shell.CurrentDirectory=here;
        shell.Run('"'+executable+'" "'+here+'"',0,false);
        status('Codex opened: GPT companion launch requested');
      } else status(current.key?'Codex open: existing companion retained':'Waiting for Codex desktop');
      failedLaunchAt=0;
    } else if(previous && !current.key)status('Waiting for next Codex desktop launch; companion left unchanged');
    else if(!previous && !current.key && !lastError)status('Waiting for Codex desktop');
    previous=current.key;lastError='';
  } catch(error) {
    if(String(error.message)!==lastError)status('Retrying: '+error.message);
    lastError=String(error.message);failedLaunchAt=new Date().getTime();
  }
  WScript.Sleep(3000);
}
status('Follow startup disabled by user');
