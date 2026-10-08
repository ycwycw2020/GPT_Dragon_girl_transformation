// Use original, unresized layer pixels instead of the densely packed 2048 atlas.
// Padding is transparent GPU texture storage; source artwork is not modified.
export function sourceTextureModel(model,manifest){
  const c=model.getModel().canvasinfo,ids=Array.from(model.getModel().drawables.ids),parts=new Map(),textures=[];
  // These meshes were edited after the PSD snapshot (finger/eye repair).
  // Their exported artwork must be retained, rather than restoring old cutouts.
  const keepAtlas=new Set(['ArtMesh6','ArtMesh7','ArtMesh8','ArtMesh12','ArtMesh46','ArtMesh48','ArtMesh50','ArtMesh52']);
  const padding=16;
  for(const layer of manifest.layers){
    const index=ids.indexOf(layer.mesh);if(index<0||keepAtlas.has(layer.mesh))continue;
    const [left,top]=layer.bounds,[width,height]=layer.size,v=model.getDrawableVertices(index),uv=new Float32Array(v.length);
    const storageWidth=2**Math.ceil(Math.log2(width+padding*2)),storageHeight=2**Math.ceil(Math.log2(height+padding*2));
    for(let j=0;j<v.length;j+=2){
      const x=v[j]*c.PixelsPerUnit+c.CanvasOriginX,y=c.CanvasOriginY-v[j+1]*c.PixelsPerUnit;
      uv[j]=(x-left+padding)/storageWidth;uv[j+1]=1-(y-top+padding)/storageHeight;
    }
    const textureIndex=textures.length+1;parts.set(index,{uv,textureIndex});textures.push({...layer,textureIndex,padding,storageWidth,storageHeight});
  }
  if(parts.size+ids.filter(id=>keepAtlas.has(id)).length!==ids.length)throw new Error(`Original layer mapping incomplete: ${parts.size}/${ids.length}`);
  const adapter=Object.create(model);
  adapter.getDrawableVertexUvs=i=>parts.get(i)?.uv??model.getDrawableVertexUvs(i);
  adapter.getDrawableTextureIndex=i=>parts.get(i)?.textureIndex??model.getDrawableTextureIndex(i);
  return {model:adapter,textures};
}

export function restoreCutEdgeCoverage(context,layer,reference,padding,left,top){
  const width=layer.width+padding*2,height=layer.height+padding*2;
  const mask=document.createElement('canvas');mask.width=width;mask.height=height;const m=mask.getContext('2d',{willReadFrequently:true});
  // A narrow overlap, sourced from the approved image rather than invented colour.
  for(const dx of [-3,0,3])for(const dy of [-3,0,3])m.drawImage(layer,padding+dx,padding+dy);
  const coverage=m.getImageData(0,0,width,height).data;
  m.clearRect(0,0,width,height);m.drawImage(reference,padding-left,padding-top);
  const canonical=m.getImageData(0,0,width,height).data,current=context.getImageData(0,0,width,height),a=current.data;
  for(let i=0;i<a.length;i+=4){
    const originalAlpha=a[i+3],target=Math.min(canonical[i+3],coverage[i+3]);if(target<=originalAlpha)continue;
    const added=target-originalAlpha;
    for(let k=0;k<3;k++)a[i+k]=Math.round((a[i+k]*originalAlpha+canonical[i+k]*added)/target);
    a[i+3]=target;
  }
  context.putImageData(current,0,0);
}
