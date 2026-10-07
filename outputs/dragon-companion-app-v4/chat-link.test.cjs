const {test}=require('node:test');
const assert=require('node:assert/strict');
const {newChatLink}=require('./chat-link.cjs');
test('new chat encodes directory without allowing scheme or query injection',()=>{
  const cwd='D:\\Demo\\GPT娘 & notes#1';
  const url=new URL(newChatLink(cwd));assert.equal(url.protocol,'codex:');assert.equal(url.hostname,'threads');assert.equal(url.pathname,'/new');
  assert.equal(url.searchParams.get('path'),cwd);assert.equal([...url.searchParams].length,1);
  for(const invalid of [undefined,'relative','https://example.com','C:\\bad\npath'])assert.equal(newChatLink(invalid),'codex://threads/new');
});
