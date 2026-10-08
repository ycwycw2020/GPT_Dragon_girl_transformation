const path=require('node:path');
function newChatLink(cwd) {
  const url=new URL('codex://threads/new');
  if(typeof cwd==='string'&&cwd.length<=1024&&!/[\x00-\x1f]/.test(cwd)&&path.isAbsolute(cwd))url.searchParams.set('path',cwd);
  return url.href;
}
function existingChatLink(threadId) {
  if(typeof threadId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(threadId))return null;
  return 'codex://threads/'+threadId.toLowerCase();
}
module.exports={newChatLink,existingChatLink};
