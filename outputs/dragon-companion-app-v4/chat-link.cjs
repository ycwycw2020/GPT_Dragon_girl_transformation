const path=require('node:path');
function newChatLink(cwd) {
  const url=new URL('codex://threads/new');
  if(typeof cwd==='string'&&cwd.length<=1024&&!/[\x00-\x1f]/.test(cwd)&&path.isAbsolute(cwd))url.searchParams.set('path',cwd);
  return url.href;
}
module.exports={newChatLink};
