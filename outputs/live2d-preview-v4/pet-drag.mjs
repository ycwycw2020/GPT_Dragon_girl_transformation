export function bindPetDrag(element) {
  if(!window.dragonDesktop?.drag)return;
  let pointer=null,start=null,moved=false,suppressUntil=0;
  element.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button,select,input,a'))return;
    pointer=event.pointerId;start={x:event.screenX,y:event.screenY};moved=false;
    element.setPointerCapture(pointer);
    window.dragonDesktop.drag('begin').catch(()=>{});
  });
  element.addEventListener('pointermove',event=>{
    if(event.pointerId===pointer&&Math.hypot(event.screenX-start.x,event.screenY-start.y)>4)moved=true;
  });
  const end=event=>{
    if(pointer===null||event.pointerId!==pointer)return;
    if(moved)suppressUntil=performance.now()+500;
    const id=pointer;pointer=null;
    if(element.hasPointerCapture(id))element.releasePointerCapture(id);
    window.dragonDesktop.drag('end').catch(()=>{});
  };
  element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);element.addEventListener('lostpointercapture',end);
  element.addEventListener('click',event=>{if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener('blur',()=>{if(pointer!==null){pointer=null;window.dragonDesktop.drag('end').catch(()=>{});}});
}
