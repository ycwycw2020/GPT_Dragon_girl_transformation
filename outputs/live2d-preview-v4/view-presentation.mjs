// IPC is authoritative once received; an older HTTP poll must not undo a move.
export function createPresentationWatcher({onChange,desktop=globalThis.window?.dragonDesktop}={}){
  let revision=0,received=false,disposed=false;
  function accept(value){
    if(disposed||typeof value?.mirrored!=='boolean')return false;
    onChange?.({mirrored:value.mirrored,screenSide:value.mirrored?'right':'left',displayId:value.displayId??null});
    return true;
  }
  const unsubscribe=desktop?.onView?.(value=>{if(accept(value)){revision++;received=true;}});
  const initialRevision=revision;
  if(desktop?.view)Promise.resolve().then(()=>desktop.view()).then(value=>{
    if(revision===initialRevision&&accept(value))received=true;
  }).catch(()=>{});
  return {
    fromBridge(value){if(!received)accept(value);},
    dispose(){disposed=true;if(typeof unsubscribe==='function')unsubscribe();}
  };
}

export function reflectClientX(clientX,rect,mirrored){
  return mirrored?rect.left+rect.width-(clientX-rect.left):clientX;
}
