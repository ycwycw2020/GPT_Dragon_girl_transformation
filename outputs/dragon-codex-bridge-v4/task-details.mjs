// Persist directory and coarse operation metadata, never command/prompt bodies.
const clean=(value,max)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,max):'';
// Store only a canonical UUID for an explicit jump back to this conversation.
// Arbitrary session strings, URLs, prompts and question content are excluded.
const threadId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
export function taskDetails(payload={}) {
  const cwd=clean(payload.cwd,1024),tool=clean(payload.tool_name,100).replace(/[^\w.:-]/g,'');
  const event=payload.hook_event_name;
  let label='正在思考',detail='';
  if(event==='UserPromptSubmit')label='正在处理新任务';
  if(event==='SubagentStart')label='子任务进行中';
  if(event==='Stop'||event==='SubagentStop')label='本轮已结束';
  if(event==='Interrupt')label='任务已中断';
  if(event==='SessionEnd')label='会话已结束';
  if(event==='PreToolUse'||event==='PostToolUse') {
    if(/apply_patch|edit|write/i.test(tool))label='修改文件';
    else if(/read|list|find|search|glob/i.test(tool))label='读取与检索';
    else if(/web|browse/i.test(tool))label='查阅资料';
    else if(/imagegen/i.test(tool))label='生成图片';
    else if(/exec|bash|shell/i.test(tool)) {
      const command=typeof payload.tool_input?.command==='string'?payload.tool_input.command.slice(0,16000):typeof payload.tool_input?.cmd==='string'?payload.tool_input.cmd.slice(0,16000):'';
      const testing=/--test\b|(?:^|[\s;&])(?:pytest|vitest|jest)(?:\s|$)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i.test(command);
      const building=/(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|pack)\b|(?:python(?:\.exe)?|python3).*\bbuild_portable\.py\b/i.test(command);
      label=testing?'运行测试':building?'构建与打包':/\b(?:Get-Content|Get-ChildItem|rg|cat|type)\b/i.test(command)?'读取与检查文件':'执行命令';
    } else label='调用工具';
    detail=tool;
    if(event==='PostToolUse')label='思考中 · 刚刚'+label;
  }
  return {cwd,tool,label,detail,threadId:threadId(payload.thread_id)??threadId(payload.session_id)};
}
export function readTaskDetails(value) {
  if(!value||typeof value!=='object')return {cwd:'',tool:'',label:'正在处理任务',detail:'',threadId:null};
  return {cwd:clean(value.cwd,1024),tool:clean(value.tool,100),label:clean(value.label,80)||'正在处理任务',detail:clean(value.detail,100),threadId:threadId(value.threadId)};
}
