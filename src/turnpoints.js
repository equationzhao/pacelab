(function(){
 'use strict';
 const Lab=window.Lab;
 const METHOD='three-phase-turnpoints-v3';
 // Model selection and support rules, not physiological concentration cut-offs.
 const RESOLUTION=.1,FIRST_BIC_GAIN=2,JOINT_BIC_GAIN=2;
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
 function bestFit(points,count,minPoints=2,shared=false){
  if(!count)return fit(points,[]);
  const candidates=[];
  for(let i=0;i<points.length-1;i++)for(let quarter=0;quarter<4;quarter++){
   const x=points[i].x+(points[i+1].x-points[i].x)*quarter/4;
   const left=points.filter(p=>p.x<=x+1e-9).length;
   const right=points.filter(p=>shared?p.x>=x-1e-9:p.x>x+1e-9).length;
   if(left>=minPoints&&right>=minPoints)candidates.push({x,left});
  }
  let best=null;
  const consider=knots=>{const model=fit(points,knots);if(model&&(!best||model.sse<best.sse-1e-12))best=model};
  for(let i=0;i<candidates.length;i++){
   if(count===1){consider([candidates[i].x]);continue}
   for(let j=i+1;j<candidates.length;j++){
    const middle=shared?points.filter(p=>p.x>=candidates[i].x-1e-9&&p.x<=candidates[j].x+1e-9).length:candidates[j].left-candidates[i].left;
    if(middle>=minPoints)consider([candidates[i].x,candidates[j].x]);
   }
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
   // A well-fitted tail alone cannot identify its onset: the slope jump at
   // the onset must itself be resolvable over a local sampling interval.
   if(model.amplitude*model.rate*localStep(points,knot)<Math.max(2*RESOLUTION,3*model.rmse))continue;
   if(!best||model.sse<best.sse-1e-12)best=model;
  }
  return best;
 }
 function firstModels(points){const linear=bestFit(points,1,2);return [hasShape(linear,points)?linear:null,bestExponential(points)].filter(Boolean).sort((a,b)=>a.bic-b.bic)}
 // LTP2 is the transition from the middle to the steep upper phase. A smooth
 // exponential fit does not disprove this operational three-phase estimate.
 // Test each knot independently: losing baseline support must not erase LT2.
 function jointShape(model,index){
  if(!model)return false;
  const slopes=model.slopes;
  if(slopes[1]<=0||(index===0&&slopes[0]>slopes[1]*.25))return false;
  const edges=[0,...model.knots,1],change=slopes[index+1]-slopes[index];
  const span=Math.min(edges[index+1]-edges[index],edges[index+2]-edges[index+1]);
  return change>0&&change*span>=Math.max(2*RESOLUTION,3*model.rmse)-1e-9;
 }
 function stableJoint(points,model){
  const positions=model.knots.map(k=>[k]),stable=[true,true];
  for(let omit=0;omit<points.length;omit++){
   const subset=points.filter((p,i)=>i!==omit),candidate=bestFit(subset,2,2,true);
   for(let index=0;index<2;index++){
    const reduced=candidate?fit(subset,[candidate.knots[1-index]]):null;
    if(!jointShape(candidate,index)||!reduced||reduced.bic-candidate.bic<2||Math.abs(candidate.knots[index]-model.knots[index])>localStep(points,model.knots[index])+1e-9)stable[index]=false;
    else positions[index].push(candidate.knots[index]);
   }
  }
  return positions.map((xs,index)=>stable[index]?xs:null);
 }
 // Once LT1 is available, locate LT2 in the observed post-LT1 region rather
 // than allowing the baseline to pull both knots towards the high-load tail.
 function upperFit(points,anchor,refit=false){
  const start=[...points].reverse().find(p=>p.x<=anchor+1e-9)?.x??points[0].x;
  const region=points.filter(p=>p.x>=start-1e-9);
  if(region.length<(refit?4:5))return null;
  const model=bestFit(region,1,2,refit);
  if(!model||model.knots[0]-anchor<localStep(points,anchor)-1e-9)return null;
  const change=model.slopes[1]-model.slopes[0];
  const span=Math.min(model.knots[0]-region[0].x,region[region.length-1].x-model.knots[0]);
  if(model.slopes[0]<=0||change<=0||change*span<Math.max(2*RESOLUTION,3*model.rmse)-1e-9||fit(region,[]).bic-model.bic<2)return null;
  return {...model,region};
 }
 function stableUpper(points,first){
  const anchor=first.model.knots[first.index],model=upperFit(points,anchor);
  if(!model)return null;
  const positions=[model.knots[0]],tolerance=localStep(points,model.knots[0]);
  const accept=(subset,boundary,refit)=>{
   const candidate=upperFit(subset,boundary,refit);
   if(!candidate||Math.abs(candidate.knots[0]-model.knots[0])>tolerance+1e-9)return false;
   positions.push(candidate.knots[0]);return true;
  };
  for(let omit=0;omit<points.length;omit++)if(!accept(points.filter((p,i)=>i!==omit),anchor,true))return null;
  // Include uncertainty in the start of the upper region, not just its samples.
  for(const boundary of [Math.min(...first.positions),Math.max(...first.positions)])if(!accept(points,boundary,false))return null;
  return {model,index:0,positions};
 }
 function localStep(points,knot){
  const i=points.findIndex(p=>p.x>=knot);
  return Math.max(points[i].x-(points[i-1]?.x??points[i].x),(points[i+1]?.x??points[i].x)-points[i].x);
 }
 function stableFit(points,model,threePhases=false){
  const positions=model.knots.map(k=>[k]),tolerances=model.knots.map(k=>localStep(points,k));
  for(let omit=0;omit<points.length;omit++){
   const subset=points.filter((p,i)=>i!==omit);
   const candidate=model.kind==='exponential-onset'?bestExponential(subset,1,2):bestFit(subset,model.knots.length,2);
   if(!candidate||(candidate.kind!=='exponential-onset'&&!hasShape(candidate,subset)))return null;
   const simpler=threePhases?bestFit(subset,0):noTurnFit(subset);
   if(!simpler||simpler.bic-candidate.bic<2)return null;
   if(candidate.knots.some((k,i)=>Math.abs(k-model.knots[i])>tolerances[i]+1e-9))return null;
   candidate.knots.forEach((k,i)=>positions[i].push(k));
  }
  return positions;
 }
 function estimate(points){
  const empty={method:METHOD,model:null,lt1Model:null,lt2Model:null,lt2Region:null,lt1:null,lt2:null,fit:[],lt2Fit:[],reason:'',lt1Reason:'',lt2Reason:''};
  if(points.length<6)return {...empty,reason:'拐点分析至少需要 6 个有效读数',lt1Reason:'数据不足',lt2Reason:'数据不足'};
  if(points.some((p,i)=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||(i&&p.x<=points[i-1].x)))return {...empty,reason:'功率未严格递增，无法识别拐点',lt1Reason:'功率顺序无效',lt2Reason:'功率顺序无效'};
  const offset=points[0].x,range=points[points.length-1].x-offset;
  const scaled=points.map(p=>({x:(p.x-offset)/range,y:p.y}));
  const noTurn=noTurnFit(scaled),ones=firstModels(scaled),two=points.length>=7?bestFit(scaled,2,2):null;
  let jointPositions=null,first=null,second=null,unstable=false,secondReason='';
  const singleLine=bestFit(scaled,1,2),straight=bestFit(scaled,0),quadratic=quadraticFit(scaled);
  if(two&&jointShape(two,0)&&jointShape(two,1)&&[singleLine,straight,quadratic].every(model=>model&&model.bic-two.bic>=JOINT_BIC_GAIN)){
   const stable=stableJoint(scaled,two);
   if(stable.some(Boolean))jointPositions=stable;else unstable=true;
  }
  if(jointPositions?.[0])first={model:two,index:0,positions:jointPositions[0]};
  // Within an already supported three-phase curve, refine the baseline onset
  // independently. Use it when it fits the observations better than the joint
  // approximation; retain exact joint knots on genuinely piecewise-linear data.
  for(const model of ones){
   const reference=jointPositions?straight:noTurn;
   if(reference.bic-model.bic<FIRST_BIC_GAIN)continue;
   const stable=stableFit(scaled,model,!!jointPositions);
   if(!stable){unstable=true;continue}
   if(!first||model.sse<first.model.sse-1e-12)first={model,index:0,positions:stable[0]};
  }
  if(points.length>=7&&first){
   second=stableUpper(scaled,first);
   const anchor=first.model.knots[first.index],start=[...scaled].reverse().find(p=>p.x<=anchor+1e-9)?.x??scaled[0].x;
   if(!second)secondReason=scaled.filter(p=>p.x>=start-1e-9).length<5?'高负荷读数不足':'未识别到第二处稳定拐点';
  }
  else if(jointPositions?.[1])second={model:two,index:1,positions:jointPositions[1]};
  if(first&&second&&first.model.knots[first.index]>=second.model.knots[second.index])first=null;
  if(!first&&!second)return {...empty,reason:unstable?'拐点位置对单个样本敏感':'未识别到稳定的低强度基线与斜率转折',lt1Reason:'未识别到稳定拐点',lt2Reason:'未识别到稳定拐点'};
  // Threshold positions and concentration-curve fitting are separate: display
  // the best supported curve rather than introducing an artificial visual kink.
  const selected=[first?.model,jointPositions?two:null].filter(Boolean).sort((a,b)=>a.sse-b.sse)[0];
  const watts=x=>offset+x*range;
  const turnpoint=result=>{
   if(!result)return null;
   const knot=result.model.knots[result.index],power=watts(knot),low=watts(Math.min(...result.positions)),high=watts(Math.max(...result.positions));
   // Show the observed power bracket, not a statistical confidence interval.
   const below=[...points].reverse().find(p=>p.x<Math.min(power,low)-1e-7)||points[0];
   const above=points.find(p=>p.x>Math.max(power,high)+1e-7)||points[points.length-1];
   return {power:Lab.core.round(power,1),lactate:Lab.core.round(selected.predict(knot),2),between:[below.x,above.x]};
  };
  const fitXs=selected.kind==='exponential-onset'?[...Array.from({length:61},(_,i)=>i/60),...selected.knots].sort((a,b)=>a-b):[0,...selected.knots,1];
  const fitPoints=fitXs.map(x=>({x:watts(x),y:selected.predict(x)}));
  const lt1=turnpoint(first),lt2=turnpoint(second);
  const modelName=result=>!result?null:result.model.region?'upper-region-linear':result.model.kind==='exponential-onset'?'exponential-onset':result.model.knots.length===2?'three-phase-linear':'single-turn-linear';
  const lt2Region=second?.model.region?[watts(second.model.region[0].x),watts(second.model.region[second.model.region.length-1].x)]:null;
  const lt2Fit=second?[second.model.region?.[0].x??second.model.knots[0],second.model.knots[second.index],1].map(x=>({x:watts(x),y:second.model.predict(x)})):[];
  return {...empty,model:selected.kind,lt1Model:modelName(first),lt2Model:modelName(second),lt2Region,lt1,lt2,fit:fitPoints,lt2Fit,rmse:Lab.core.round(selected.rmse,3),
   reason:lt1&&lt2?'':lt2?'仅识别到第二处稳定拐点':'仅识别到第一处稳定拐点',
   lt1Reason:lt1?'':'第一处拐点不稳定',lt2Reason:lt2?'':points.length<7?'数据不足（至少 7 个有效读数）':secondReason||'未识别到第二处稳定拐点'};
 }
 Lab.turnpoints={estimate,METHOD};
})();
