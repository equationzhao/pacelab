// Read-only evaluation of the actual application path, with separate diagnostics.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const here=__dirname,root=path.resolve(here,'../..');
const context=vm.createContext({window:{}}),hashes={};
for(const name of ['core','turnpoints','analysis']){
  const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');
  hashes[name]=crypto.createHash('sha256').update(source).digest('hex');
  vm.runInContext(source,context);
}
const manifest=JSON.parse(fs.readFileSync(path.join(here,'sources.json')));
for(const name of Object.keys(hashes)){
  if(hashes[name]!==manifest.engineSha256[name])throw Error('Engine changed: '+name+'; use the recorded commit to reproduce this evaluation.');
}
// A separate VM exposes existing internals for diagnostics only. Production
// outputs above are obtained from the original, unmodified source.
const diagnostic=vm.createContext({window:{Lab:{core:context.window.Lab.core}}});
vm.runInContext(fs.readFileSync(path.join(root,'src/turnpoints.js'),'utf8')
  .replace('Lab.turnpoints={estimate,METHOD};','Lab.turnpoints={estimate,METHOD,fit,bestFit,hasShape,stableFit,localStep};'),diagnostic);
const internals=diagnostic.window.Lab.turnpoints;
function shapeFailure(model,points){
  if(!model)return 'no_model';
  const s=model.slopes;
  if(s[1]<=0||Math.abs(s[0])>s[1]*.25)return 'initial_slope_ratio';
  const base=points.filter(p=>p.x<=model.knots[0]),f=internals.fit(base,[]);
  if(!f)return 'baseline_fit';
  const mean=base.reduce((a,p)=>a+p.x,0)/base.length;
  const sxx=base.reduce((a,p)=>a+(p.x-mean)**2,0);
  if(sxx<=1e-12)return 'baseline_span';
  const variance=Math.max(f.sse/Math.max(1,base.length-2),.1**2/12);
  const span=base[base.length-1].x-base[0].x;
  if(Math.abs(f.slopes[0])*span>Math.max(.1,2*Math.sqrt(variance/sxx)*span)+1e-9)return 'baseline_trend';
  const edges=[0,...model.knots,1],minimum=Math.max(.2,3*model.rmse);
  for(let i=0;i<model.knots.length;i++){
    const change=s[i+1]-s[i],span=Math.min(edges[i+1]-edges[i],edges[i+2]-edges[i+1]);
    if(change<=0||change*span<minimum-1e-9)return 'slope_change_signal';
  }
  return null;
}
function stabilityFailure(points,model){
  for(let omit=0;omit<points.length;omit++){
    const subset=points.filter((p,i)=>i!==omit),c=internals.bestFit(subset,model.knots.length,2);
    const shape=shapeFailure(c,subset);
    if(shape)return {omit,reason:shape};
    const simpler=internals.bestFit(subset,model.knots.length-1,2);
    if(!simpler||simpler.bic-c.bic<2)return {omit,reason:'leave_one_out_bic'};
    if(c.knots.some((k,i)=>Math.abs(k-model.knots[i])>internals.localStep(points,model.knots[i])+1e-9))
      return {omit,reason:'knot_moved_more_than_one_step'};
  }
  return null;
}
function diagnose(curve){
  const pts=curve.points,lo=pts[0].power,range=pts.at(-1).power-lo;
  const points=pts.map(p=>({x:(p.power-lo)/range,y:p.lactate}));
  const fits=[internals.bestFit(points,0),internals.bestFit(points,1),points.length>=9?internals.bestFit(points,2):null];
  return [1,2].map(n=>{
    const m=fits[n];if(!m)return {knots:n,unavailable:true};
    const shape=shapeFailure(m,points);
    if((shape===null)!==internals.hasShape(m,points))throw Error('Diagnostic shape mismatch');
    const failure=shape?null:stabilityFailure(points,m);
    if(!shape&&(!failure)!==Boolean(internals.stableFit(points,m)))throw Error('Diagnostic stability mismatch');
    return {knots:n,powers:m.knots.map(x=>lo+x*range),slopesPerWatt:m.slopes.map(x=>x/range),
      bicGainVsSimpler:fits[n-1].bic-m.bic,bicGainVsLine:fits[0].bic-m.bic,
      shapeFailure:shape,stabilityFailure:failure&&{...failure,omittedPower:pts[failure.omit].power}};
  });
}
const curves=JSON.parse(fs.readFileSync(path.join(here,'inputs.json')));
const pick=r=>({lt1:r.lt1,lt2:r.lt2,reason:r.reason,lt2Reason:r.lt2Reason,validCount:r.validCount,fit:r.fit});
const results=curves.map(c=>({id:c.id,source:c.source,subject:c.subject,
  exerciseOnly:pick(context.window.Lab.analysis.analyze(c.points)),
  withRestSensitivity:pick(context.window.Lab.analysis.analyze([...c.rest,...c.points])),
  diagnostics:diagnose(c)}));
const summary={};
for(const source of ['Nolte2022','Pallares2016']){
  const group=results.filter(r=>r.source===source);
  const scenarios={};
  for(const scenario of ['exerciseOnly','withRestSensitivity']){
    const rs=group.map(r=>r[scenario]),reasons={};
    for(const r of rs)reasons[r.reason||'both_detected']=(reasons[r.reason||'both_detected']||0)+1;
    scenarios[scenario]={curves:rs.length,minReadings:Math.min(...rs.map(r=>r.validCount)),maxReadings:Math.max(...rs.map(r=>r.validCount)),
      atLeastNine:rs.filter(r=>r.validCount>=9).length,lt1:rs.filter(r=>r.lt1).length,lt2:rs.filter(r=>r.lt2).length,reasons};
  }
  summary[source]=scenarios;
}
fs.writeFileSync(path.join(here,'results.json'),JSON.stringify({method:context.window.Lab.turnpoints.METHOD,hashes,summary,results},null,2)+'\n');
const rows=[['id','source','exercise_readings','LT1_W','LT2_W','reason','rest_sensitivity_LT1_W','rest_sensitivity_LT2_W']];
for(const r of results)rows.push([r.id,r.source,r.exerciseOnly.validCount,r.exerciseOnly.lt1?.power??'',r.exerciseOnly.lt2?.power??'',r.exerciseOnly.reason,r.withRestSensitivity.lt1?.power??'',r.withRestSensitivity.lt2?.power??'']);
fs.writeFileSync(path.join(here,'results.csv'),'\ufeff'+rows.map(row=>row.map(s=>'"'+String(s).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
