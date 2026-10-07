import {createHash} from 'node:crypto';
export const NOTICE_TTL=5*60*1000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function readNotice(value,now=Date.now()) {
  if(!value||!digest(value.id)||!digest(value.turn)||typeof value.async!=='boolean'
    ||!Number.isFinite(value.createdAt)||!Number.isFinite(value.expiresAt)
    ||value.createdAt>now+60000||value.expiresAt<=now||value.expiresAt!==value.createdAt+NOTICE_TTL)return null;
  return {id:value.id,turn:value.turn,async:value.async,createdAt:value.createdAt,expiresAt:value.expiresAt};
}
// A notification contains only hashed routing identifiers and timestamps.
// Never persist question text, choices, answers, command bodies or thread UUIDs.
export function nextNotice(previous,payload,now=Date.now()) {
  const event=payload.hook_event_name,notice=readNotice(previous,now);
  if(event==='UserPromptSubmit'||event==='SessionEnd')return null;
  if(event==='Interrupt'&&notice?.turn===hash(payload.turn_id||''))return null;
  const callId=typeof payload.tool_use_id==='string'&&payload.tool_use_id.length<=512?payload.tool_use_id:'';
  if(event==='PostToolUse'&&callId&&notice?.id===hash(callId)&&!notice.async)return null;
  if(event==='PreToolUse'&&callId&&typeof payload.turn_id==='string'
    &&/(?:^|[._:])request_user_input(?:_async)?$/.test(payload.tool_name||'')
    &&Array.isArray(payload.tool_input?.questions)&&payload.tool_input.questions.length>0) {
    return {id:hash(callId),turn:hash(payload.turn_id),async:payload.tool_name.endsWith('_async'),createdAt:now,expiresAt:now+NOTICE_TTL};
  }
  return notice;
}
