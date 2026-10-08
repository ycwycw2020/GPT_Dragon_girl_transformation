const {test}=require('node:test');
const assert=require('node:assert/strict');
const {newChatLink,existingChatLink}=require('./chat-link.cjs');
test('new chat encodes directory without allowing scheme or query injection',()=>{
  const cwd='C:\\Users\\Example\\GPT娘 & notes#1';
  const url=new URL(newChatLink(cwd));assert.equal(url.protocol,'codex:');assert.equal(url.hostname,'threads');assert.equal(url.pathname,'/new');
  assert.equal(url.searchParams.get('path'),cwd);assert.equal([...url.searchParams].length,1);
  for(const invalid of [undefined,'relative','https://example.com','C:\\bad\npath'])assert.equal(newChatLink(invalid),'codex://threads/new');
});
test('existing conversation links accept a canonical UUID only and never arbitrary URLs',()=>{
  const id='01999999-9999-7431-8fff-000000000001';
  assert.equal(existingChatLink(id),'codex://threads/'+id);
  assert.equal(existingChatLink(id.toUpperCase()),'codex://threads/'+id);
  for(const invalid of [undefined,null,{},'',id+'?path=C:/x',id+'/new',' '+id,id+'\n','codex://threads/'+id,'https://example.com',id.replace('-7431-','-z431-'),id.replace('-8fff-','-1fff-'),'00000000-0000-0000-0000-000000000000','a'.repeat(64)])assert.equal(existingChatLink(invalid),null);
});
