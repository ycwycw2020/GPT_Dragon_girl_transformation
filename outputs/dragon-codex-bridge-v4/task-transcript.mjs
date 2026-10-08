// Read-only task metadata fallback for Codex rollout files. Never summarize
// reasoning, user/assistant messages, tool arguments, commands, or tool output.
import {createHash} from 'node:crypto';

export const TRANSCRIPT_TASK_TTL=15*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeHash=value=>typeof value==='string'&&HASH.test(value)?value:null;
const turnHash=value=>typeof value==='string'&&UUID.test(value)?hash(value):null;
const time=value=>typeof value==='string'?Date.parse(value):Number.isSafeInteger(value)&&value>=0?value:NaN;
// Codex lifecycle started_at is Unix seconds in some rollout generations;
// item started_at_ms and record.timestamp use different, explicit formats.
const startedTime=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<100000000000?value*1000:time(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const TERMINALS=new Map([['task_complete','Stop'],['turn_complete','Stop'],['turn_aborted','Interrupt'],['task_aborted','Interrupt'],['session_end','SessionEnd']]);
const ACTIVITY_ITEMS=new Set(['Reasoning','AgentReasoning','AgentMessage','UserMessage','CommandExecution','FileChange','McpToolCall','SubAgentActivity','Extension','WebSearch','ImageView','ContextCompaction']);
const LABELS=new Set(['正在思考','正在处理新任务','执行命令','修改文件','调用工具','读取与检索','查阅资料','生成图片','子任务进行中','有新的进度说明','等待你的回答','本轮已结束','任务已中断','会话已结束','等待任务状态']);

function toolLabel(name){
  if(typeof name!=='string')return '调用工具';
  // Classify the public tool name only. Tool input and shell commands are not
  // inspected, even when they would make the displayed label more detailed.
  if(/(?:^|[.:_])request_user_input(?:_async)?$/.test(name))return '等待你的回答';
  if(/apply_patch|edit|write/i.test(name))return '修改文件';
  if(/web|browse/i.test(name))return '查阅资料';
  if(/imagegen/i.test(name))return '生成图片';
  if(/read|list|find|search|glob/i.test(name))return '读取与检索';
  if(/exec|bash|shell/i.test(name))return '执行命令';
  if(/spawn_agent|send_message|followup_task|wait_agent/i.test(name))return '子任务进行中';
  return '调用工具';
}

function itemLabel(item){
  switch(item.type){
    case 'Reasoning':case 'AgentReasoning':case 'ContextCompaction':return '正在思考';
    case 'UserMessage':return '正在处理新任务';
    case 'AgentMessage':return '有新的进度说明';
    case 'CommandExecution':return '执行命令';
    case 'FileChange':return '修改文件';
    case 'McpToolCall':return toolLabel(item.tool);
    case 'SubAgentActivity':return '子任务进行中';
    case 'WebSearch':return '查阅资料';
    default:return '调用工具';
  }
}

function safePrevious(value){
  if(!value||typeof value!=='object'||integer(value.updatedAt)===null)return null;
  const terminalEvent=['Stop','Interrupt','SessionEnd'].includes(value.terminalEvent)?value.terminalEvent:null;
  const taskObservedAt=integer(value.taskObservedAt)??value.updatedAt;
  return {turn:safeHash(value.turn),turnStartedAt:integer(value.turnStartedAt),
    active:value.active===true,turnActive:value.turnActive===true,statusKnown:value.statusKnown===true,
    terminalEvent,label:LABELS.has(value.label)?value.label:'正在思考',updatedAt:value.updatedAt,
    observedAt:integer(value.observedAt)??value.updatedAt,taskObservedAt,
    expiresAt:taskObservedAt+TRANSCRIPT_TASK_TTL,stale:value.stale===true,
    waitingForInput:value.waitingForInput===true,pendingInputCall:safeHash(value.pendingInputCall)};
}

/**
 * A bounded transcript read may omit task_started or include a huge partial
 * result. Carry only the preceding safe metadata summary between reads.
 * Settings/usage/context/file timestamps do not create or renew task activity.
 */
export function summarizeTaskTail(text,{now=Date.now(),partialFirstLine=false,previous=null}={}){
  if(!Number.isFinite(now)||now<0)throw new TypeError('A finite observation time is required');
  let state=safePrevious(previous);
  if(state&&state.updatedAt>now+60000)state=null;
  if(typeof text!=='string')text='';
  const lines=text.split('\n');if(partialFirstLine)lines.shift();
  for(const line of lines){
    if(!line.trim())continue;
    let record;try{record=JSON.parse(line);}catch{continue;}
    const body=record?.payload;
    if(!body||typeof body!=='object')continue;
    const at=time(record.timestamp);
    if(!Number.isFinite(at)||at<0||at>now+60000||state&&at<state.updatedAt)continue;
    const ownTurn=turnHash(body.turn_id),isEvent=record.type==='event_msg';
    const terminal=isEvent?TERMINALS.get(body.type):null;
    if(terminal){
      const started=startedTime(body.started_at);
      // A late terminal for an earlier turn must not end the current turn.
      // Conversely, a newer terminal's explicit start can prove a later turn
      // even when its task_started line has been buried in a large tool result.
      if(state?.turn&&ownTurn&&state.turn!==ownTurn){
        if(Number.isFinite(started)&&state.turnStartedAt!==null){if(started<=state.turnStartedAt)continue;}
        else if(state.active||state.turnActive)continue;
      }
      // Session end is valid without a turn ID; all turn boundaries require one.
      if(!ownTurn&&terminal!=='SessionEnd')continue;
      state={turn:ownTurn??state?.turn??null,
        turnStartedAt:state?.turn===ownTurn?state.turnStartedAt:
          Number.isFinite(started)&&started<=at?started:null,
        active:false,turnActive:false,statusKnown:true,terminalEvent:terminal,
        label:terminal==='Stop'?'本轮已结束':terminal==='Interrupt'?'任务已中断':'会话已结束',
        updatedAt:at,observedAt:at,taskObservedAt:at,expiresAt:at+TRANSCRIPT_TASK_TTL,
        stale:false,waitingForInput:false,pendingInputCall:null};
      continue;
    }
    if(isEvent&&body.type==='task_started'&&ownTurn){
      // A duplicate start cannot resurrect a completed turn at the same time.
      if(state?.terminalEvent&&state.turn===ownTurn)continue;
      const started=startedTime(body.started_at);
      const start=Number.isFinite(started)&&started<=at?started:at;
      if(state?.turnStartedAt!==null&&state?.turnStartedAt!==undefined&&start<state.turnStartedAt)continue;
      state={turn:ownTurn,turnStartedAt:start,active:true,turnActive:true,statusKnown:true,
        terminalEvent:null,label:'正在处理新任务',updatedAt:at,observedAt:at,taskObservedAt:at,
        expiresAt:at+TRANSCRIPT_TASK_TTL,stale:false,waitingForInput:false,pendingInputCall:null};
      continue;
    }
    let label=null,pendingInputCall=null,clearsInput=false;
    if(isEvent&&(body.type==='item_completed'||body.type==='item_started')&&ACTIVITY_ITEMS.has(body.item?.type)){
      label=itemLabel(body.item);
      if(body.item.type==='UserMessage')clearsInput=true;
    }else if(record.type==='response_item'&&['function_call','custom_tool_call'].includes(body.type)){
      label=toolLabel(body.name);
      if(label==='等待你的回答'&&typeof body.call_id==='string'&&body.call_id.length<=512)pendingInputCall=hash(body.call_id);
    }else if(record.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(body.type)){
      label='正在思考';
      clearsInput=typeof body.call_id==='string'&&body.call_id.length<=512&&hash(body.call_id)===state?.pendingInputCall;
    }else if(isEvent&&body.type==='agent_message'){
      // The event type alone shows a public output; its text is never used.
      label='有新的进度说明';
    }
    if(!label)continue;
    // Once this turn has ended, subsequently appended messages/results for it
    // are not a new turn. An explicit task_started or a different turn is needed.
    if(state?.terminalEvent&&(!ownTurn||state.turn===ownTurn))continue;
    // Item events always carry turn IDs in desktop Codex. An invalid supplied
    // identifier cannot be used to attach arbitrary text to the current turn.
    if(body.turn_id!==undefined&&!ownTurn)continue;
    const itemStarted=time(body.started_at_ms);
    if(ownTurn&&state?.turn&&ownTurn!==state.turn&&state.turnStartedAt!==null
      &&Number.isFinite(itemStarted)&&itemStarted<state.turnStartedAt)continue;
    const sameTurn=!ownTurn||state?.turn===ownTurn;
    const waitingForInput=pendingInputCall!==null||sameTurn&&state?.waitingForInput===true&&!clearsInput;
    state={turn:ownTurn??state?.turn??null,turnStartedAt:sameTurn?state?.turnStartedAt??null:null,
      active:true,turnActive:true,statusKnown:true,terminalEvent:null,
      label:waitingForInput?'等待你的回答':label,updatedAt:at,observedAt:at,taskObservedAt:at,
      expiresAt:at+TRANSCRIPT_TASK_TTL,stale:false,waitingForInput,
      pendingInputCall:pendingInputCall??(waitingForInput&&sameTurn?state?.pendingInputCall??null:null)};
  }
  if(!state)return null;
  // An inactive lifecycle is a fact, not a lease. Running state may expire;
  // no file mtime or settings event extends it after a crashed/disconnected run.
  if(!state.terminalEvent&&state.expiresAt<=now){
    state.active=false;state.turnActive=false;state.statusKnown=false;state.stale=true;
    state.label='等待任务状态';state.waitingForInput=false;state.pendingInputCall=null;
  }
  return state;
}
