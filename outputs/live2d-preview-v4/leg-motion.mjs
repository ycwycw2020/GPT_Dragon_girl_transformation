// Low-amplitude lower-leg rotation inside the existing repaired artwork.
// Coordinates are in the approved 2426 x 2592 art space; no body scaling.
const TAU=Math.PI*2;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const LEG_MOTION_PROFILE='all-state-anchored-sway-v0412';
// Chair-protection boundaries stay well conditioned below this combined angle.
export const LEG_MAX_ANGLE=.018;
export const LEG_MAX_REACTION=.012;

export function legMotionSample(time,{state='working_thinking',disabled=false,sleep=false,strength=1,reactionLeg=0}={}){
  if(disabled||!Number.isFinite(time))return {front:0,back:0};
  // All four art states share this clock and amplitude. Changing energy does
  // not reset the pose or make the legs jump. Sleeping keeps a quieter sway.
  const gain=clamp(Number.isFinite(strength)?strength:1,0,1)*((sleep||state==='sleep_mode') ? .25 : 1);
  // The legs move together, with a very small phase difference. This keeps the
  // approved overlap intact rather than opening an unpainted gap between them.
  const swing=.016*Math.sin(time*TAU/5.8),secondary=.0015*Math.sin(time*TAU/11.7);
  const reaction=clamp(Number.isFinite(reactionLeg)?reactionLeg:0,-LEG_MAX_REACTION,LEG_MAX_REACTION)*gain;
  return {front:clamp((swing+secondary)*gain+reaction,-LEG_MAX_ANGLE,LEG_MAX_ANGLE),back:clamp((swing-secondary*.6)*gain+reaction,-LEG_MAX_ANGLE,LEG_MAX_ANGLE)};
}

// Conservative outlines of the two repaired stockings/shoes, inset from their
// painted contours. These deliberately exclude nearby ribbons, chair arms and
// wheels. Coordinates refer to legs-corrected.png at the 2426 x 2592 art scale.
const legPolygons=[
  [[20,44],[184,35],[217,122],[250,230],[287,348],[312,416],[345,488],[378,542],[407,589],[440,643],[437,692],[412,719],[355,734],[297,716],[255,685],[231,626],[222,566],[235,514],[232,465],[204,419],[167,350],[128,282],[103,205],[94,132],[25,116]],
  [[220,31],[274,25],[300,75],[327,142],[354,226],[383,306],[410,373],[440,435],[480,490],[494,523],[521,548],[545,588],[575,627],[592,665],[582,690],[551,704],[484,707],[455,694],[451,660],[421,606],[405,553],[384,525],[359,474],[334,412],[310,358],[288,289],[261,214],[243,139]]
].map(polygon=>polygon.map(([x,y])=>[1140+x,1760+y]));

function insidePolygon(x,y,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const [ax,ay]=polygon[i],[bx,by]=polygon[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }
  return inside;
}

export function legHitTest(x,y,sample={front:0,back:0},alphaAt=()=>255){
  if(!Number.isFinite(x)||!Number.isFinite(y))return false;
  const [sourceX,sourceY]=inverseLegPoint(x,y,sample);
  return legPolygons.some(polygon=>insidePolygon(sourceX,sourceY,polygon))&&alphaAt(sourceX,sourceY)>=24;
}

function weight(x,y){
  // Pin the thighs and both knee/seat contacts. The lower-leg region receives
  // a rotation. A separate protection field pins the neighbouring chair parts.
  const left=1190+Math.max(0,Math.min(400,y-1950))*.40;
  const right=1535+Math.max(0,Math.min(420,y-1950))*.49;
  const ax=x-1550,ay=y-2140,along=Math.max(0,Math.min(1,(ax*170+ay*50)/31400));
  const armDistance=Math.hypot(ax-along*170,ay-along*50);
  const wheelDistance=Math.hypot((x-1725)/82,(y-2285)/67);
  return smooth(1935,2170,y)*(1-smooth(2520,2560,y))
    *smooth(left-36,left+12,x)*(1-smooth(right+3,right+39,x))
    *smooth(22,50,armDistance)*smooth(1,1.32,wheelDistance);
}

export function forwardLegPoint(x,y,sample){
  const right=smooth(1305+(y-1900)*.40,1395+(y-1900)*.40,x);
  const a=(sample.front*(1-right)+sample.back*right)*weight(x,y);
  if(a===0)return [x,y];
  const px=1235+right*160,py=1935,ox=x-px,oy=y-py,c=Math.cos(a),s=Math.sin(a);
  return [px+ox*c-oy*s,py+ox*s+oy*c];
}

export function inverseLegPoint(x,y,sample){
  let px=x,py=y;
  for(let i=0;i<8;i++){const q=forwardLegPoint(px,py,sample);px=x-(q[0]-px);py=y-(q[1]-py);}
  return [px,py];
}

// Keep GPU and CPU formulas together so QA can check geometry without relying
// on a screenshot. Eight bounded fixed-point iterations invert the deformation.
export const LEG_WARP_GLSL=`
uniform vec2 legAngles;
float legWeight(vec2 p){
  float left=1190.+clamp(p.y-1950.,0.,400.)*.40;
  float right=1535.+clamp(p.y-1950.,0.,420.)*.49;
  vec2 arm=p-vec2(1550.,2140.);
  float along=clamp(dot(arm,vec2(170.,50.))/31400.,0.,1.);
  float armDistance=length(arm-along*vec2(170.,50.));
  float wheelDistance=length((p-vec2(1725.,2285.))/vec2(82.,67.));
  return smoothstep(1935.,2170.,p.y)*(1.-smoothstep(2520.,2560.,p.y))
    *smoothstep(left-36.,left+12.,p.x)*(1.-smoothstep(right+3.,right+39.,p.x))
    *smoothstep(22.,50.,armDistance)*smoothstep(1.,1.32,wheelDistance);
}
vec2 legForward(vec2 p){
  float right=smoothstep(1305.+(p.y-1900.)*.40,1395.+(p.y-1900.)*.40,p.x);
  float a=mix(legAngles.x,legAngles.y,right)*legWeight(p);
  vec2 pivot=vec2(1235.+right*160.,1935.),o=p-pivot;
  return pivot+vec2(o.x*cos(a)-o.y*sin(a),o.x*sin(a)+o.y*cos(a));
}
vec2 legInverse(vec2 target){
  if(dot(legAngles,legAngles)==0.)return target;
  vec2 p=target;
  for(int i=0;i<8;i++)p=target-(legForward(p)-p);
  return p;
}`;
