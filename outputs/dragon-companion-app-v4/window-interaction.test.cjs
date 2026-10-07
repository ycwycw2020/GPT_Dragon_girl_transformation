const {test}=require('node:test');
const assert=require('node:assert/strict');
const {clampPosition,panelBounds,restoreBounds}=require('./window-interaction.cjs');
test('dragging clamps on negative-coordinate monitor and restores within available displays',()=>{
  const area={x:-1920,y:0,width:1920,height:1040};
  assert.deepEqual(clampPosition({x:-2100,y:1200,width:180,height:200},area),{x:-1920,y:840,width:180,height:200});
  const initial={x:100,y:100,width:180,height:200};
  assert.equal(restoreBounds(initial,{x:9000,y:9000},[area]),initial);
  assert.equal(restoreBounds(initial,{x:-1900,y:100},[area]).x,-1900);
});
test('task card flips sides and remains inside a small or secondary display',()=>{
  for(const area of [{x:0,y:0,width:1440,height:900},{x:-1280,y:-800,width:1280,height:800},{x:0,y:0,width:240,height:300}]){
    for(const x of [area.x,area.x+area.width-180]){
      const card=panelBounds({x,y:area.y+50,width:180,height:200},area);
      assert(card.x>=area.x&&card.y>=area.y);assert(card.x+card.width<=area.x+area.width);assert(card.y+card.height<=area.y+area.height);
    }
  }
});
