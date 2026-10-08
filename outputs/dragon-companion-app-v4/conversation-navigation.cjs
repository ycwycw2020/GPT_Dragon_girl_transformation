const {existingChatLink}=require('./chat-link.cjs');
function displayedTask(tasks,taskId){
  if(typeof taskId!=='string'||!/^[a-f0-9]{64}$/.test(taskId)||!Array.isArray(tasks))return null;
  return tasks.find(task=>task.id===taskId)??null;
}

// Renderers can request a jump, but never supply a URL or a thread identifier.
// Re-evaluate the native selected record for every click and fail closed.
function createConversationNavigation({openExternal,now=Date.now,cooldown=1000}){
  let pending=false,lastOpened=-Infinity;
  return async function open(record,{question=false}={}){
    if(!record||(question&&(!Number.isFinite(record.expiresAt)||record.expiresAt<=now())))
      return {opened:false,reason:question?'no_notice':'no_task',message:'这条提示已结束，请在 Codex 中查看。'};
    const url=existingChatLink(record.threadId);
    if(!url)return {opened:false,reason:'missing_thread_id',message:'这条旧提示暂无跳转信息，请在 Codex 中查看。'};
    if(pending||now()-lastOpened<cooldown)return {opened:false,reason:'rate_limited',message:'正在打开，请稍等一下～'};
    pending=true;
    try{await openExternal(url);lastOpened=now();return {opened:true};}
    catch{return {opened:false,reason:'open_failed',message:'暂时没能打开 Codex，可以再点一次。'};}
    finally{pending=false;}
  };
}
module.exports={createConversationNavigation,displayedTask};
