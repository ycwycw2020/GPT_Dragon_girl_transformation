const BASE_WIDTH=540,BASE_HEIGHT=600,DEFAULT_SCALE=1/3,MIN_SCALE=.25,MAX_SCALE=1.5;
const PRESETS=[.25,DEFAULT_SCALE,.5,.75,1,1.25,1.5];
function normalizeScale(value) {
  return typeof value==='number'&&Number.isFinite(value)?Math.max(MIN_SCALE,Math.min(MAX_SCALE,value)):DEFAULT_SCALE;
}
function readScale(text) {
  try {return normalizeScale(JSON.parse(text).scale);} catch {return DEFAULT_SCALE;}
}
function nextScale(current,action) {
  if(action==='default')return DEFAULT_SCALE;
  if(action==='in')return normalizeScale(normalizeScale(current)*1.1);
  if(action==='out')return normalizeScale(normalizeScale(current)/1.1);
  return normalizeScale(current);
}
function scaledBounds(scale,area,previous=null) {
  // Keep the desk's bottom centre in place and fit the current monitor in DIP units.
  const effective=Math.min(normalizeScale(scale),Math.max(1,area.width)/BASE_WIDTH,Math.max(1,area.height)/BASE_HEIGHT);
  const width=Math.max(1,Math.round(BASE_WIDTH*effective)),height=Math.max(1,Math.round(BASE_HEIGHT*effective));
  const x=previous?previous.x+previous.width/2-width/2:area.x+area.width-width-20;
  const y=previous?previous.y+previous.height-height:area.y+area.height-height-20;
  return {x:Math.round(Math.max(area.x,Math.min(area.x+area.width-width,x))),
    y:Math.round(Math.max(area.y,Math.min(area.y+area.height-height,y))),width,height};
}
module.exports={BASE_WIDTH,BASE_HEIGHT,DEFAULT_SCALE,MIN_SCALE,MAX_SCALE,PRESETS,normalizeScale,readScale,nextScale,scaledBounds};
