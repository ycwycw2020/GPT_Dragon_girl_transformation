const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chooseNotice,noticeBounds}=require('./question-notice.cjs');
const id='01999999-9999-7431-8fff-000000000001';
test('question notices carry the selected hashed session and a strictly validated thread UUID',()=>{
  const old={id:'a'.repeat(64),threadId:id.toUpperCase(),questionNotice:{id:'old',createdAt:100,expiresAt:2000}};
  const recent={id:'b'.repeat(64),threadId:'codex://threads/'+id,questionNotice:{id:'new',createdAt:200,expiresAt:2000}};
  assert.equal(chooseNotice([old,recent],old.id,new Map(),300).threadId,id);
  const notice=chooseNotice([old,recent],'',new Map(),300);assert.equal(notice.sessionId,recent.id);assert.equal(notice.threadId,null);
  assert.equal(chooseNotice([old,recent],'',new Map([[notice.key,2000]]),300).threadId,id);
  assert.equal(chooseNotice([old,recent],'',new Map(),2001),null);
});
test('older question records remain displayable without claiming they have a conversation address',()=>{
  const chosen=chooseNotice([{id:'legacy',questionNotice:{id:'question',createdAt:100,expiresAt:2000}}],'',new Map(),300);
  assert.equal(chosen.threadId,null);assert.equal(chosen.sessionId,'legacy');
  const bounds=noticeBounds({x:-200,y:100,width:180,height:200},{x:-1920,y:0,width:1920,height:1040});
  assert(bounds.x>=-1920&&bounds.x+bounds.width<=0&&bounds.y>=0);
});
