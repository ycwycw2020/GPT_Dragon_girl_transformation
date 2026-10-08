const test=require('node:test'),assert=require('node:assert/strict');
const {createConversationNavigation,displayedTask}=require('./conversation-navigation.cjs');
const id='01999999-9999-7431-8fff-000000000001';
test('a new output cannot redirect a click on an already displayed task',()=>{
  const old={id:'a'.repeat(64),threadId:id},recent={id:'b'.repeat(64),threadId:'01a110f5-2455-7431-8fff-9dd1c74c62c4'};
  assert.equal(displayedTask([recent,old],old.id),old);
  for(const invalid of ['c'.repeat(64),id,'codex://threads/'+id,undefined,''])assert.equal(displayedTask([recent,old],invalid),null);
  assert.equal(displayedTask([recent],old.id),null);
});
test('routes an existing conversation and never falls back to new chat',async()=>{
  const calls=[],open=createConversationNavigation({openExternal:async url=>calls.push(url)});
  assert.deepEqual(await open({threadId:id}),{opened:true});
  assert.deepEqual(calls,['codex://threads/'+id]);
  for(const threadId of [null,'https://example.com','../new',id+'?command=execute'])
    assert.equal((await open({threadId})).reason,'missing_thread_id');
  assert.equal(calls.length,1);
});
test('question expiration is checked at click time',async()=>{
  const calls=[],open=createConversationNavigation({now:()=>100,openExternal:async u=>calls.push(u)});
  for(const expiresAt of [99,100,undefined,NaN])assert.equal((await open({threadId:id,expiresAt},{question:true})).reason,'no_notice');
  assert.equal((await open({threadId:id,expiresAt:101},{question:true})).opened,true);assert.equal(calls.length,1);
});
test('pending and rapid repeated clicks open once, then unlock after cooldown',async()=>{
  let finish,time=100,calls=0;const open=createConversationNavigation({now:()=>time,openExternal:()=>{calls++;return new Promise(r=>finish=r);}});
  const first=open({threadId:id});assert.equal((await open({threadId:id})).reason,'rate_limited');finish();await first;
  assert.equal((await open({threadId:id})).reason,'rate_limited');time=1100;
  const next=open({threadId:id});finish();await next;assert.equal(calls,2);
});
test('failed launches remain retryable and do not leak system errors',async()=>{
  let attempts=0;const open=createConversationNavigation({openExternal:async()=>{if(++attempts===1)throw new Error('private system detail');}});
  const fail=await open({threadId:id});assert.equal(fail.reason,'open_failed');assert.ok(!JSON.stringify(fail).includes('private'));
  assert.equal((await open({threadId:id})).opened,true);
});
