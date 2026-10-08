function clampPosition(bounds,area) {
  return {...bounds,x:Math.round(Math.max(area.x,Math.min(area.x+Math.max(0,area.width-bounds.width),bounds.x))),
    y:Math.round(Math.max(area.y,Math.min(area.y+Math.max(0,area.height-bounds.height),bounds.y)))};
}
function panelBounds(pet,area,mirrored=false) {
  // The monitor sits to the character's upper right. Anchor the bubble above
  // it at a stable art-relative point; the text keeps its own readable size.
  const width=Math.min(168,area.width),height=Math.min(66,area.height),gap=4;
  const x=pet.x+pet.width*(mirrored ? .20 : .80)-width/2,y=pet.y+pet.height*.22-height-gap;
  return clampPosition({x,y,width,height},area);
}
function presentationView(pet,display,previous=null) {
  const center=pet.x+pet.width/2,midpoint=display.bounds.x+display.bounds.width/2;
  const sameDisplay=previous?.displayId===display.id;
  // Keep the previous direction in a narrow band so a slow drag does not
  // flicker between poses. A new display is classified immediately.
  const mirrored=sameDisplay&&typeof previous?.mirrored==='boolean'
    ?(previous.mirrored?center>=midpoint-8:center>midpoint+8)
    :center>midpoint;
  return {mirrored,screenSide:mirrored?'right':'left',displayId:display.id};
}
function restoreBounds(bounds,settings,displays) {
  if(!Number.isFinite(settings?.x)||!Number.isFinite(settings?.y))return bounds;
  const candidate={...bounds,x:Math.round(settings.x),y:Math.round(settings.y)};
  const area=displays.find(a=>candidate.x+candidate.width>a.x&&candidate.x<a.x+a.width&&candidate.y+candidate.height>a.y&&candidate.y<a.y+a.height);
  return area?clampPosition(candidate,area):bounds;
}
module.exports={clampPosition,panelBounds,restoreBounds,presentationView};
