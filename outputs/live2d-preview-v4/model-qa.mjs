// Run only on a real Core model. Units are converted using the exported model's
// PixelsPerUnit, never screen zoom, device pixels, or texture-atlas dimensions.
const EPSILON_PX=.001;
const EPSILON_OPACITY=.00001;
const round=value=>Number(value.toFixed(6));

function snapshot(model) {
  const core=model.getModel();
  return Array.from(core.drawables.ids,(id,index)=>({id,
    vertices:Array.from(model.getDrawableVertices(index)),
    opacity:core.drawables.opacities[index],
  }));
}

export function compareDrawables(before,after,pixelsPerUnit) {
  const changes=[];
  for(let i=0;i<before.length;i++) {
    const a=before[i],b=after[i];
    let maxDx=0,maxDy=0,maxDistance=0,changedVertices=0;
    for(let j=0;j<a.vertices.length;j+=2) {
      const dx=(b.vertices[j]-a.vertices[j])*pixelsPerUnit;
      const dy=(b.vertices[j+1]-a.vertices[j+1])*pixelsPerUnit;
      maxDx=Math.max(maxDx,Math.abs(dx));maxDy=Math.max(maxDy,Math.abs(dy));
      maxDistance=Math.max(maxDistance,Math.hypot(dx,dy));
      if(Math.hypot(dx,dy)>EPSILON_PX)changedVertices++;
    }
    const opacityDelta=b.opacity-a.opacity;
    if(changedVertices||Math.abs(opacityDelta)>EPSILON_OPACITY) {
      changes.push({id:a.id,changedVertices,totalVertices:a.vertices.length/2,
        maxDxPx:round(maxDx),maxDyPx:round(maxDy),maxDistancePx:round(maxDistance),
        opacityBefore:round(a.opacity),opacityAfter:round(b.opacity),opacityDelta:round(opacityDelta)});
    }
  }
  return changes;
}

export function inspectParameterEffects(model,{modelId,expectations={}}={}) {
  const core=model.getModel(),parameters=core.parameters;
  const original=Array.from(parameters.values),ppu=model.getPixelsPerUnit();
  if(!Number.isFinite(ppu)||ppu<=0)throw new Error('Core PixelsPerUnit 无效');
  const reset=()=>{parameters.values.set(parameters.defaultValues);model.update();};
  const reports=[];
  try {
    reset();const neutral=snapshot(model);
    for(const [id,rule] of Object.entries(expectations)) {
      const index=Array.from(parameters.ids).indexOf(id);
      const report={id,exists:index>=0,required:rule.required!==false,rule,tests:[]};
      reports.push(report);if(index<0){report.status=report.required?'missing':'optional_missing';continue;}
      report.range=[parameters.minimumValues[index],parameters.maximumValues[index]];
      report.defaultValue=parameters.defaultValues[index];
      const samples=[...new Set([report.range[0],0,.5,1,report.range[1]])].filter(v=>v>=report.range[0]&&v<=report.range[1]);
      for(const value of samples) {
        reset();model.setParameterValueByIndex(index,value,1);model.update();
        const changes=compareDrawables(neutral,snapshot(model),ppu);
        const allowed=rule.allowedDrawables;
        const unexpected=Array.isArray(allowed)?changes.filter(item=>!allowed.includes(item.id)).map(item=>item.id):null;
        const maxDistancePx=Math.max(0,...changes.map(item=>item.maxDistancePx));
        const maxDxPx=Math.max(0,...changes.map(item=>item.maxDxPx));
        const maxDyPx=Math.max(0,...changes.map(item=>item.maxDyPx));
        const limitExceeded=(rule.maxDistancePx!=null&&maxDistancePx>rule.maxDistancePx+.01)
          ||(rule.maxDxPx!=null&&maxDxPx>rule.maxDxPx+.01)
          ||(rule.maxDyPx!=null&&maxDyPx>rule.maxDyPx+.01);
        report.tests.push({value,changes,maxDistancePx,maxDxPx,maxDyPx,
          isolation:unexpected===null?'needs_drawable_mapping':unexpected.length?'unexpected_drawables':'verified',
          unexpectedDrawables:unexpected,limitExceeded});
      }
      const movingTests=report.tests.filter(item=>item.value!==report.defaultValue);
      const noEffect=!movingTests.some(item=>item.changes.length);
      const missingExpected=(rule.requiredDrawables||[]).filter(id=>!movingTests.some(item=>item.changes.some(change=>change.id===id)));
      report.missingExpectedDrawables=missingExpected;
      report.status=noEffect?'unbound':movingTests.some(item=>item.limitExceeded)?'excessive_displacement':
        movingTests.some(item=>item.unexpectedDrawables?.length)||missingExpected.length?'wrong_drawables':
        movingTests.some(item=>item.isolation==='needs_drawable_mapping')?'effect_confirmed_isolation_unreviewed':'verified';
    }
    return {modelId,method:'Independent parameter evaluation at defaults; Core drawable vertices and opacity',
      pixelsPerUnit:ppu,canvasInfo:{...core.canvasinfo},
      displacementUnits:'Original model canvas pixels (not texture atlas or display pixels)',
      drawableInventory:neutral.map(item=>({id:item.id,vertexCount:item.vertices.length/2,opacity:item.opacity})),
      parameters:reports,allRequiredVerified:reports.filter(item=>item.required).every(item=>item.status==='verified'),
      visualReviewRequired:true,note:'Geometry tests cannot certify eyelash style, seams, alpha holes, or visual quality.'};
  } finally {parameters.values.set(original);model.update();}
}
