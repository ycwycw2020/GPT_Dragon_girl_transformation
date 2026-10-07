function clampPosition(bounds,area) {
  return {...bounds,x:Math.round(Math.max(area.x,Math.min(area.x+Math.max(0,area.width-bounds.width),bounds.x))),
    y:Math.round(Math.max(area.y,Math.min(area.y+Math.max(0,area.height-bounds.height),bounds.y)))};
}
function panelBounds(pet,area) {
  const width=Math.min(294,area.width),height=Math.min(180,area.height),gap=8;
  let x=pet.x-width-gap,y=pet.y+pet.height-height;
  if(x<area.x)x=pet.x+pet.width+gap;
  if(x+width>area.x+area.width){x=pet.x+pet.width/2-width/2;y=pet.y-height-gap;}
  return clampPosition({x,y,width,height},area);
}
function restoreBounds(bounds,settings,displays) {
  if(!Number.isFinite(settings?.x)||!Number.isFinite(settings?.y))return bounds;
  const candidate={...bounds,x:Math.round(settings.x),y:Math.round(settings.y)};
  const area=displays.find(a=>candidate.x+candidate.width>a.x&&candidate.x<a.x+a.width&&candidate.y+candidate.height>a.y&&candidate.y<a.y+a.height);
  return area?clampPosition(candidate,area):bounds;
}
module.exports={clampPosition,panelBounds,restoreBounds};
