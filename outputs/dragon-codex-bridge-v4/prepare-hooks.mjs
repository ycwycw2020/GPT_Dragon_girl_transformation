import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
if(Number(process.versions.node.split('.')[0])<24)throw new Error('Prepare this hook with Node 24 or newer.');
const script=path.join(here,'hook.mjs').replaceAll('\\','/');
const node=process.execPath.replaceAll('\\','/');
// A bare Windows executable path works under both cmd and PowerShell. A quoted
// first token alone is a string expression in PowerShell, not an invocation.
if(process.platform==='win32'&&/[\s&|<>^()!`$;]/.test(node))throw new Error('Use a Node 24 executable path without spaces or shell metacharacters to prepare Windows hooks.');
const executable=process.platform==='win32'?node:`"${node}"`;
const definition={description:'GPT_Dragon_girl_transformation：仅向本地文件发送任务活动状态，不保存聊天正文。',hooks:{}};
for(const name of ['UserPromptSubmit','SubagentStart','PreToolUse','PostToolUse','Stop','SubagentStop','Interrupt','SessionEnd']) {
  definition.hooks[name]=[{hooks:[{type:'command',command:`${executable} --disable-warning=ExperimentalWarning "${script}"`,timeout:3}]}];
}
await writeFile(path.join(here,'hooks.ready.json'),JSON.stringify(definition,null,2));
console.log('Prepared hooks.ready.json; not installed or trusted.');
