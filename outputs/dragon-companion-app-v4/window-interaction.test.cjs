const {test}=require('node:test');
const assert=require('node:assert/strict');
const {clampPosition,panelBounds,restoreBounds,presentationView}=require('./window-interaction.cjs');
test('dragging clamps on negative-coordinate monitor and restores within available displays',()=>{
  const area={x:-1920,y:0,width:1920,height:1040};
  assert.deepEqual(clampPosition({x:-2100,y:1200,width:180,height:200},area),{x:-1920,y:840,width:180,height:200});
  const initial={x:100,y:100,width:180,height:200};
  assert.equal(restoreBounds(initial,{x:9000,y:9000},[area]),initial);
  assert.equal(restoreBounds(initial,{x:-1900,y:100},[area]).x,-1900);
});
test('task bubble remains inside a small or secondary display',()=>{
  for(const area of [{x:0,y:0,width:1440,height:900},{x:-1280,y:-800,width:1280,height:800},{x:0,y:0,width:240,height:300},{x:-160,y:40,width:160,height:80}]){
    for(const x of [area.x,area.x+area.width-180]){
      const card=panelBounds({x,y:area.y+50,width:180,height:200},area);
      assert(card.x>=area.x&&card.y>=area.y);assert(card.x+card.width<=area.x+area.width);assert(card.y+card.height<=area.y+area.height);
    }
  }
});
test('task bubble points above the monitor at every pet scale without growing with the pet',()=>{
  const area={x:-1920,y:-1000,width:3840,height:2000};
  for(const [width,height] of [[180,200],[540,600],[810,900]]){
    const pet={x:-1000,y:-200,width,height},bubble=panelBounds(pet,area);
    assert.equal(bubble.width,168);assert.equal(bubble.height,66);
    assert(Math.abs(bubble.x+bubble.width/2-(pet.x+width*.80))<=.5);
    assert(Math.abs(bubble.y+bubble.height-(pet.y+height*.22-4))<=.5);
  }
});
test('mirrored bubble follows the reflected monitor and still clamps on negative displays',()=>{
  const area={x:-1920,y:-1000,width:3840,height:2000};
  for(const [width,height] of [[180,200],[540,600],[810,900]]){
    const pet={x:-1000,y:-200,width,height},bubble=panelBounds(pet,area,true);
    assert(Math.abs(bubble.x+bubble.width/2-(pet.x+width*.20))<=.5);
    assert(Math.abs(bubble.y+bubble.height-(pet.y+height*.22-4))<=.5);
  }
  const small={x:-800,y:-400,width:300,height:250};
  for(const mirrored of [false,true]){
    const result=panelBounds({x:-800,y:-400,width:180,height:200},small,mirrored);
    assert(result.x>=small.x&&result.x+result.width<=small.x+small.width);
  }
});
test('presentation direction uses display bounds rather than work area or absolute desktop position',()=>{
  const display={id:2,bounds:{x:-1920,y:-1080,width:1920,height:1080},workArea:{x:-1920,y:-1000,width:1920,height:1000}};
  assert.equal(presentationView({x:-1600,width:180},display).mirrored,false);
  assert.equal(presentationView({x:-800,width:180},display).mirrored,true);
  assert.equal(presentationView({x:-1050,width:180},display).mirrored,false);
});
test('center hysteresis avoids oscillation and switching monitors resets direction',()=>{
  const display={id:1,bounds:{x:0,width:1920}},at=center=>({x:center-90,width:180});
  let state=presentationView(at(960),display);
  for(const center of [959,961,967,968]){
    state=presentationView(at(center),display,state);assert.equal(state.mirrored,false);
  }
  state=presentationView(at(969),display,state);assert.equal(state.mirrored,true);
  for(const center of [960,959,953,952]){
    state=presentationView(at(center),display,state);assert.equal(state.mirrored,true);
  }
  state=presentationView(at(951),display,state);assert.equal(state.mirrored,false);
  state=presentationView(at(964),{...display,id:2},state);assert.equal(state.mirrored,true);
  state=presentationView(at(960),{...display,id:3},state);assert.equal(state.mirrored,false);
});
