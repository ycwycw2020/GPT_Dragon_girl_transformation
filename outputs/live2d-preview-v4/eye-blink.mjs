const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
// Shared cadence for both eyes, with a short full closure and slower reopening.
export function blinkClosure(time){
  const periods=[4.8,6.2,5.4,4.1];let t=((time%20.5)+20.5)%20.5;
  for(const period of periods){if(t<period){const age=t-(period-.29);return age<0?0:age<.09?smooth(age/.09):age<.12?1:1-smooth((age-.12)/.17);}t-=period;}
  return 0;
}
// A single interaction clock feeds both eyes. Natural and click blinks may
// overlap, but neither can reopen an eye while the other is still closing it.
export function clickBlinkClosure(age){
  return age>=0&&age<.28?Math.sin(Math.PI*age/.28)**2:0;
}
export function interpolateCurve(points,x){
  if(x<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++)if(x<=points[i][0]){const [a,b]=[points[i-1],points[i]],t=(x-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*t;}
  return points.at(-1)[1];
}
export async function createLeftEyeBlink(gl){
  const base='/assets/left-eye/';
  const load=async name=>{const image=new Image();image.src=base+name;await image.decode();return image;};
  const [skin,eye,lash,closed,geometry]=await Promise.all([load('47_eye_L_skin_base.png'),load('49_eye_L_stationary_eye.png'),load('45_eye_L_upperlash.png'),load('43_eye_L_closed.png'),fetch(base+'blink-geometry.json').then(r=>{if(!r.ok)throw new Error('Missing blink geometry');return r.json();})]);
  const keys=geometry.eyes.L.keyframes,opened=keys[0],shut=keys.at(-1),bounds=[1375,647,1568,836],width=193,height=189;
  const surface=document.createElement('canvas');surface.width=width;surface.height=height;const ctx=surface.getContext('2d');
  const createShader=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
  const program=gl.createProgram();
  gl.attachShader(program,createShader(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec2 uv;varying vec2 t;void main(){t=uv;gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(program,createShader(gl.FRAGMENT_SHADER,'precision highp float;varying vec2 t;uniform sampler2D moving;uniform sampler2D closed;uniform float endpoint;uniform float onset;void main(){gl_FragColor=mix(texture2D(moving,t),texture2D(closed,t),endpoint)*onset;}'));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  const texture=image=>{const value=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,value);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.LINEAR);for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);return value;};
  const moving=texture(surface),endpoint=texture(closed),buffer=gl.createBuffer(),p=gl.getAttribLocation(program,'p'),uv=gl.getAttribLocation(program,'uv');
  const uniforms=Object.fromEntries(['moving','closed','endpoint','onset'].map(n=>[n,gl.getUniformLocation(program,n)]));let lastQ=-1;
  function paint(q){
    ctx.clearRect(0,0,width,height);ctx.drawImage(skin,0,0);
    // Clip the fixed, full-size iris with a curved aperture. Never squash it.
    ctx.save();ctx.beginPath();
    for(let x=0;x<=width;x++){const gx=x+bounds[0],top=(1-q)*interpolateCurve(opened.aperture_upper_native,gx)+q*interpolateCurve(shut.aperture_upper_native,gx);x?ctx.lineTo(x,top-bounds[1]):ctx.moveTo(x,top-bounds[1]);}
    for(let x=width;x>=0;x--){const gx=x+bounds[0],bottom=(1-q**3)*interpolateCurve(opened.aperture_lower_native,gx)+q**3*interpolateCurve(shut.aperture_lower_native,gx);ctx.lineTo(x,bottom-bounds[1]);}
    ctx.closePath();ctx.clip();ctx.drawImage(eye,0,0);ctx.restore();
    // Independent upper-lash columns preserve the texture's thickness.
    for(let x=0;x<lash.width;x++){const dy=q*interpolateCurve(shut.upper_lash_native_y_offset,1410+x);ctx.drawImage(lash,x,0,1,lash.height,1410-bounds[0]+x,662-bounds[1]+dy,1,lash.height);}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,moving);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,surface);lastQ=q;
  }
  return {bounds,draw(q,project,follow,viewWidth,viewHeight){
    q=clamp(q);if(q<=.00001)return;
    if(q!==lastQ)paint(q);
    const point=(x,y)=>{const a=project(...follow('ArtMesh28',x,y));return [a[0]/viewWidth*2-1,1-a[1]/viewHeight*2];};
    const a=point(bounds[0],bounds[1]),b=point(bounds[0],bounds[3]),c=point(bounds[2],bounds[1]),d=point(bounds[2],bounds[3]);
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([...a,0,0,...b,0,1,...c,1,0,...d,1,1]),gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,moving);gl.uniform1i(uniforms.moving,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,endpoint);gl.uniform1i(uniforms.closed,1);
    gl.uniform1f(uniforms.endpoint,smooth((q-.86)/.14));gl.uniform1f(uniforms.onset,smooth(q/.06));
    gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.STENCIL_TEST);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disableVertexAttribArray(p);gl.disableVertexAttribArray(uv);
  }};
}
