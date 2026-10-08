// A narrow, registered retouch of the anatomical left (screen-right) eyebrow.
// Only the mask below is composited; the generated face is never substituted.
// The patch follows the same head transform as the eyes and face.
export const BROW_REPAIR_BOUNDS = Object.freeze([1378, 599, 1494, 640]);
const SOURCE_CROP = [980, 520, 690, 560];
const MASK_CROP_POINTS = [
  [803,167],[825,169],[859,174],[882,183],[921,188],[961,188],
  [987,186],[1011,178],[1018,198],[993,212],[953,224],
  [914,229],[876,227],[850,220],[823,208],[809,194],[801,181],
];
// Source crop -> normalized generated crop. Estimated from 57 stable hair
// feature inliers, excluding the retouched eyebrow; see registration.json.
const REGISTRATION = [0.9995395013250779, -0.00017906001581421353,
  0.00017906001581421353, 0.9995395013250779,
  0.7185839323451156, 0.6674874591298166];

export async function createBrowRepair(gl) {
  const art = new Image();
  art.src = '/assets/brow-repair/left-brow-removed-reference.png';
  await art.decode();
  const bounds = BROW_REPAIR_BOUNDS;
  const mask = document.createElement('canvas');
  const resolution = 4;
  mask.width = (bounds[2] - bounds[0]) * resolution;
  mask.height = (bounds[3] - bounds[1]) * resolution;
  const ctx = mask.getContext('2d');
  ctx.scale(resolution, resolution);
  ctx.translate(-bounds[0], -bounds[1]);
  ctx.fillStyle = 'white';
  ctx.beginPath();
  MASK_CROP_POINTS.forEach(([x, y], i) => {
    const point = [SOURCE_CROP[0] + x / 2, SOURCE_CROP[1] + y / 2];
    i ? ctx.lineTo(...point) : ctx.moveTo(...point);
  });
  ctx.closePath(); ctx.fill();
  // Blur the whole mask, including its inner edge. A solid fill with only an
  // outer shadow would leave a visible colour step along the fill contour.
  const feathered = document.createElement('canvas');
  feathered.width = mask.width; feathered.height = mask.height;
  const featherContext = feathered.getContext('2d');
  featherContext.filter = 'blur(8px)'; featherContext.drawImage(mask,0,0);

  const shader = (kind, source) => {
    const result = gl.createShader(kind); gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER,
    'attribute vec2 p;attribute vec2 uv;varying vec2 t;void main(){t=uv;gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
    precision highp float;varying vec2 t;
    uniform sampler2D art;uniform sampler2D coverage;
    uniform vec4 region;uniform mat3 registration;
    void main(){
      vec2 original=(region.xy+t*region.zw-vec2(980.,520.))*2.;
      vec2 registered=(registration*vec3(original,1.)).xy/vec2(1380.,1120.);
      gl_FragColor=texture2D(art,registered)*texture2D(coverage,t).a;
    }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const texture = source => {
    const result = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, result);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.LINEAR);
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
    return result;
  };
  const artwork = texture(art), coverage = texture(feathered), buffer = gl.createBuffer();
  const p = gl.getAttribLocation(program, 'p'), uv = gl.getAttribLocation(program, 'uv');
  const uniforms = Object.fromEntries(['art','coverage','region','registration'].map(name => [name, gl.getUniformLocation(program, name)]));
  const [a,b,c,d,e,f] = REGISTRATION;
  return {
    bounds, evidence: 'left-brow-removed-local-v0411',
    draw(project, follow, width, height) {
      const point = (x,y) => {
        const [px,py] = project(...follow('ArtMesh28',x,y));
        return [px / width * 2 - 1, 1 - py / height * 2];
      };
      const tl = point(bounds[0],bounds[1]), bl = point(bounds[0],bounds[3]);
      const tr = point(bounds[2],bounds[1]), br = point(bounds[2],bounds[3]);
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([...tl,0,0,...bl,0,1,...tr,1,0,...br,1,1]),gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,16,0);
      gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,artwork); gl.uniform1i(uniforms.art,0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,coverage); gl.uniform1i(uniforms.coverage,1);
      gl.uniform4f(uniforms.region,bounds[0],bounds[1],bounds[2]-bounds[0],bounds[3]-bounds[1]);
      gl.uniformMatrix3fv(uniforms.registration,false,new Float32Array([a,b,0,c,d,0,e,f,1]));
      gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      gl.disableVertexAttribArray(p); gl.disableVertexAttribArray(uv); gl.activeTexture(gl.TEXTURE0);
    },
  };
}
