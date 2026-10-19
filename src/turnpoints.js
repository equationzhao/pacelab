(function(){
 'use strict';
 const Lab=window.Lab;
 const METHOD='turnpoint-model-selection-v2';
 // Model selection and support rules, not physiological concentration cut-offs.
 const RESOLUTION=.1,FIRST_BIC_GAIN=2,SECOND_BIC_GAIN=6;
 function solve(matrix,vector){
  const rows=matrix.map((row,i)=>[...row,vector[i]]),n=vector.length;
  for(let c=0;c<n;c++){
   let pivot=c;
   for(let r=c+1;r<n;r++)if(Math.abs(rows[r][c])>Math.abs(rows[pivot][c]))pivot=r;
   if(Math.abs(rows[pivot][c])<1e-10)return null;
   [rows[c],rows[pivot]]=[rows[pivot],rows[c]];
   const divisor=rows[c][c];for(let j=c;j<=n;j++)rows[c][j]/=divisor;
   for(let r=0;r<n;r++)if(r!==c){const factor=rows[r][c];for(let j=c;j<=n;j++)rows[r][j]-=factor*rows[c][j]}
  }
  return rows.map(row=>row[n]);
 }
 function fit(points,knots){
  const columns=knots.length+2,normal=Array.from({length:columns},()=>Array(columns).fill(0)),rhs=Array(columns).fill(0);
  for(const p of points){
   const row=[1,p.x,...knots.map(k=>Math.max(0,p.x-k))];
   for(let i=0;i<columns;i++){rhs[i]+=row[i]*p.y;for(let j=0;j<columns;j++)normal[i][j]+=row[i]*row[j]}
  }
  const coefficients=solve(normal,rhs);if(!coefficients)return null;
  const predict=x=>coefficients[0]+coefficients[1]*x+knots.reduce((sum,k,i)=>sum+coefficients[i+2]*Math.max(0,x-k),0);
  const sse=points.reduce((sum,p)=>sum+(p.y-predict(p.x))**2,0);
  // Count fitted knot positions as parameters; the variance floor reflects input resolution.
  const bic=points.length*Math.log(Math.max(sse/points.length,RESOLUTION**2/12))+(2+2*knots.length)*Math.log(points.length);
  const slopes=[coefficients[1]];knots.forEach((k,i)=>slopes.push(slopes[i]+coefficients[i+2]));
  return {kind:knots.length?'segmented-linear':'linear',knots,coefficients,sse,bic,rmse:Math.sqrt(sse/points.length),slopes,predict};
 }
 function bestFit(points,count,minPoints=3){
  if(!count)return fit(points,[]);
  const candidates=[];
  for(let i=0;i<points.length-1;i++)for(let quarter=0;quarter<4;quarter++){
   const x=points[i].x+(points[i+1].x-points[i].x)*quarter/4;
   const left=points.filter(p=>p.x<=x).length;
   if(left>=minPoints&&points.length-left>=minPoints)candidates.push({x,left});
  }
  let best=null;
  const consider=knots=>{const model=fit(points,knots);if(model&&(!best||model.sse<best.sse-1e-12))best=model};
  for(let i=0;i<candidates.length;i++){
   if(count===1){consider([candidates[i].x]);continue}
   for(let j=i+1;j<candidates.length;j++)if(candidates[j].left-candidates[i].left>=minPoints)consider([candidates[i].x,candidates[j].x]);
  }
  return best;
 }
 function hasShape(model,points){
  if(!model)return false;
  const slopes=model.slopes;
  // LT1 needs a near-flat low-load region; a lone late bend cannot be labelled LT1.
  if(slopes[1]<=0||Math.abs(slopes[0])>slopes[1]*.25)return false;
  const baseline=points.filter(p=>p.x<=model.knots[0]),baselineFit=fit(baseline,[]);
  if(!baselineFit)return false;
  const mean=baseline.reduce((sum,p)=>sum+p.x,0)/baseline.length;
  const sxx=baseline.reduce((sum,p)=>sum+(p.x-mean)**2,0);
  if(sxx<=1e-12)return false;
  const variance=Math.max(baselineFit.sse/Math.max(1,baseline.length-2),RESOLUTION**2/12);
  const baselineSpan=baseline[baseline.length-1].x-baseline[0].x;
  if(Math.abs(baselineFit.slopes[0])*baselineSpan>Math.max(RESOLUTION,2*Math.sqrt(variance/sxx)*baselineSpan)+1e-9)return false;
  const edges=[0,...model.knots,1],minimumChange=Math.max(2*RESOLUTION,3*model.rmse);
  for(let i=0;i<model.knots.length;i++){
   const change=slopes[i+1]-slopes[i],span=Math.min(edges[i+1]-edges[i],edges[i+2]-edges[i+1]);
   if(change<=0||change*span<minimumChange-1e-9)return false;
  }
  return true;
 }
 // A flat baseline followed by continuous exponential growth, inspired by
 // Nolte et al. (2022). Fit baseline and growth amplitude independently so an
 // additive concentration offset cannot move the onset. The growth scale is
 // never labelled LT2. Compare against smooth growth with no observed onset.
 function exponentialAt(points,knot,rate){
  const basis=points.map(p=>Math.expm1(rate*Math.max(0,p.x-knot))),n=points.length;
  let sum=0,squares=0,cross=0,total=0;
  points.forEach((p,i)=>{sum+=basis[i];squares+=basis[i]**2;cross+=p.y*basis[i];total+=p.y});
  const denominator=n*squares-sum**2;
  if(denominator<1e-12)return {baseline:0,amplitude:0,sse:Infinity};
  const amplitude=(n*cross-sum*total)/denominator,baseline=(total-amplitude*sum)/n;
  const sse=points.reduce((sum,p,i)=>sum+(p.y-baseline-amplitude*basis[i])**2,0);
  return {baseline,amplitude,sse};
 }
 function exponentialFit(points,knot,onset=true){
  // Locate a promising basin before refinement; do not assume the full
  // noisy-data objective is unimodal over the entire permitted rate range.
  const rates=[.05,.1,.2,.4,.8,1.2,1.8,2.7,4,6,9,13,18,25];
  let best=0;
  const errors=rates.map(rate=>exponentialAt(points,knot,rate).sse);
  for(let i=1;i<rates.length;i++)if(errors[i]<errors[best])best=i;
  let low=rates[Math.max(0,best-1)],high=rates[Math.min(rates.length-1,best+1)];
  for(let step=0;step<36;step++){
   const a=low+(high-low)/3,b=high-(high-low)/3;
   if(exponentialAt(points,knot,a).sse<exponentialAt(points,knot,b).sse)high=b;else low=a;
  }
  const rate=(low+high)/2,{baseline,amplitude,sse}=exponentialAt(points,knot,rate);
  if(rate>24.99||amplitude<=0||(onset&&baseline<=0))return null;
  return {kind:onset?'exponential-onset':'smooth-exponential',knots:onset?[knot]:[],baseline,amplitude,rate,sse,
   rmse:Math.sqrt(sse/points.length),predict:x=>baseline+amplitude*Math.expm1(rate*Math.max(0,x-knot)),
   bic:points.length*Math.log(Math.max(sse/points.length,RESOLUTION**2/12))+(onset?4:3)*Math.log(points.length)};
 }
 function quadraticFit(points){
  const sums=Array(5).fill(0),rhs=Array(3).fill(0);
  for(const p of points){for(let i=0;i<5;i++)sums[i]+=p.x**i;for(let i=0;i<3;i++)rhs[i]+=p.y*p.x**i}
  const c=solve(Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>sums[i+j])),rhs);
  if(!c)return null;
  const predict=x=>c[0]+c[1]*x+c[2]*x*x,sse=points.reduce((sum,p)=>sum+(p.y-predict(p.x))**2,0);
  return {kind:'smooth-quadratic',knots:[],sse,predict,bic:points.length*Math.log(Math.max(sse/points.length,RESOLUTION**2/12))+3*Math.log(points.length)};
 }
 function noTurnFit(points){return [bestFit(points,0),quadraticFit(points),exponentialFit(points,0,false)].filter(Boolean).sort((a,b)=>a.bic-b.bic)[0]}
 function bestExponential(points,minBaseline=2,minRise=3){
  let best=null;
  for(let i=0;i<points.length-1;i++)for(let quarter=0;quarter<4;quarter++){
   const knot=points[i].x+(points[i+1].x-points[i].x)*quarter/4;
   const left=points.filter(p=>p.x<=knot).length;
   if(left<minBaseline||points.length-left<minRise)continue;
   // At a fixed onset the baseline and amplitude have an analytic solution.
   // Only the dimensionless growth rate needs a bounded scalar search.
   const model=exponentialFit(points,knot);
   if(!model||model.predict(1)-model.baseline<Math.max(2*RESOLUTION,3*model.rmse))continue;
   if(!best||model.sse<best.sse-1e-12)best=model;
  }
  return best;
 }
 function firstModels(points,refit=false){const linear=bestFit(points,1,2);return [hasShape(linear,points)?linear:null,bestExponential(points,refit?1:2,refit?2:3)].filter(Boolean).sort((a,b)=>a.bic-b.bic)}
 function localStep(points,knot){
  const i=points.findIndex(p=>p.x>=knot);
  return Math.max(points[i].x-(points[i-1]?.x??points[i].x),(points[i+1]?.x??points[i].x)-points[i].x);
 }
 function stableFit(points,model){
  const positions=model.knots.map(k=>[k]),tolerances=model.knots.map(k=>localStep(points,k));
  for(let omit=0;omit<points.length;omit++){
   const subset=points.filter((p,i)=>i!==omit);
   const candidate=model.kind==='exponential-onset'?bestExponential(subset,1,2):bestFit(subset,model.knots.length,2);
   if(!candidate||(candidate.kind!=='exponential-onset'&&!hasShape(candidate,subset)))return null;
   const simpler=model.knots.length===2?[noTurnFit(subset),...firstModels(subset,true)].sort((a,b)=>a.bic-b.bic)[0]:noTurnFit(subset);
   if(!simpler||simpler.bic-candidate.bic<2)return null;
   if(candidate.knots.some((k,i)=>Math.abs(k-model.knots[i])>tolerances[i]+1e-9))return null;
   candidate.knots.forEach((k,i)=>positions[i].push(k));
  }
  return positions;
 }
 function estimate(points){
  const empty={method:METHOD,model:null,lt1:null,lt2:null,fit:[],reason:'',lt1Reason:'',lt2Reason:''};
  if(points.length<6)return {...empty,reason:'拐点分析至少需要 6 个有效读数',lt1Reason:'数据不足',lt2Reason:'数据不足'};
  if(points.some((p,i)=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||(i&&p.x<=points[i-1].x)))return {...empty,reason:'功率未严格递增，无法识别拐点',lt1Reason:'功率顺序无效',lt2Reason:'功率顺序无效'};
  const offset=points[0].x,range=points[points.length-1].x-offset;
  const scaled=points.map(p=>({x:(p.x-offset)/range,y:p.y}));
  const noTurn=noTurnFit(scaled),ones=firstModels(scaled),twoCandidate=points.length>=8?bestFit(scaled,2,2):null;
  const two=hasShape(twoCandidate,scaled)?twoCandidate:null;
  let selected=null,positions=null,unstable=false;
  // Two knots must beat both single-onset families and a straight line. Failure
  // to confirm LT2 must not suppress an independently supported LT1 model.
  for(const model of [two,...ones]){
   const simpler=model===two?[noTurn,...ones].sort((a,b)=>a.bic-b.bic)[0]:noTurn;
   const minimumGain=model===two?SECOND_BIC_GAIN:FIRST_BIC_GAIN;
   if(!model||!simpler||simpler.bic-model.bic<minimumGain||noTurn.bic-model.bic<minimumGain)continue;
   const stable=stableFit(scaled,model);
   if(!stable){unstable=true;continue}
   selected=model;positions=stable;break;
  }
  if(!selected)return {...empty,reason:unstable?'拐点位置对单个样本敏感':'未识别到稳定的低强度基线与斜率转折',lt1Reason:'未识别到稳定拐点',lt2Reason:'未识别到稳定拐点'};
  const watts=x=>offset+x*range;
  const turnpoint=i=>{
   const power=watts(selected.knots[i]),low=watts(Math.min(...positions[i])),high=watts(Math.max(...positions[i]));
   // Show the observed power bracket, not a statistical confidence interval.
   const below=[...points].reverse().find(p=>p.x<Math.min(power,low)-1e-7)||points[0];
   const above=points.find(p=>p.x>Math.max(power,high)+1e-7)||points[points.length-1];
   return {power:Lab.core.round(power,1),lactate:Lab.core.round(selected.predict(selected.knots[i]),2),between:[below.x,above.x]};
  };
  const fitXs=selected.kind==='exponential-onset'?[...Array.from({length:61},(_,i)=>i/60),...selected.knots].sort((a,b)=>a-b):[0,...selected.knots,1];
  const fitPoints=fitXs.map(x=>({x:watts(x),y:selected.predict(x)}));
  return {...empty,model:selected.kind,lt1:turnpoint(0),lt2:selected.knots.length===2?turnpoint(1):null,fit:fitPoints,rmse:Lab.core.round(selected.rmse,3),reason:selected.knots.length===1?'仅识别到第一处稳定拐点':'',lt2Reason:selected.knots.length===1?(points.length<8?'数据不足（至少 8 个有效读数）':'未识别到第二处稳定拐点'):''};
 }
 Lab.turnpoints={estimate,METHOD};
})();
