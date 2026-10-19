(function(){
 'use strict';
 const Lab=window.Lab;
 const METHOD='segmented-linear-v1';
 // These are conservative model-selection rules, not physiological cut-offs.
 const RESOLUTION=.1,MIN_BIC_GAIN=6;
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
  return {knots,coefficients,sse,bic,rmse:Math.sqrt(sse/points.length),slopes,predict};
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
  const span=baseline[baseline.length-1].x-baseline[0].x;
  // Test the low-load region itself: a gentle initial rise must not be hidden by a much steeper LT2.
  if(Math.abs(baselineFit.slopes[0])*span>Math.max(RESOLUTION,2*Math.sqrt(variance/sxx)*span)+1e-9)return false;
  const edges=[0,...model.knots,1],minimumChange=Math.max(2*RESOLUTION,3*model.rmse);
  for(let i=0;i<model.knots.length;i++){
   const change=slopes[i+1]-slopes[i],span=Math.min(edges[i+1]-edges[i],edges[i+2]-edges[i+1]);
   if(change<=0||change*span<minimumChange-1e-9)return false;
  }
  return true;
 }
 function localStep(points,knot){
  const i=points.findIndex(p=>p.x>=knot);
  return Math.max(points[i].x-(points[i-1]?.x??points[i].x),(points[i+1]?.x??points[i].x)-points[i].x);
 }
 function stableFit(points,model){
  const positions=model.knots.map(k=>[k]),tolerances=model.knots.map(k=>localStep(points,k));
  for(let omit=0;omit<points.length;omit++){
   const subset=points.filter((p,i)=>i!==omit),candidate=bestFit(subset,model.knots.length,2);
   if(!hasShape(candidate,subset))return null;
   const simpler=bestFit(subset,model.knots.length-1,2);
   if(!simpler||simpler.bic-candidate.bic<2)return null;
   if(candidate.knots.some((k,i)=>Math.abs(k-model.knots[i])>tolerances[i]+1e-9))return null;
   candidate.knots.forEach((k,i)=>positions[i].push(k));
  }
  return positions;
 }
 function estimate(points){
  const empty={method:METHOD,lt1:null,lt2:null,fit:[],reason:'',lt1Reason:'',lt2Reason:''};
  if(points.length<6)return {...empty,reason:'拐点分析至少需要 6 个有效读数',lt1Reason:'数据不足',lt2Reason:'数据不足'};
  if(points.some((p,i)=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||(i&&p.x<=points[i-1].x)))return {...empty,reason:'功率未严格递增，无法识别拐点',lt1Reason:'功率顺序无效',lt2Reason:'功率顺序无效'};
  const offset=points[0].x,range=points[points.length-1].x-offset;
  const scaled=points.map(p=>({x:(p.x-offset)/range,y:p.y}));
  const linear=bestFit(scaled,0),one=bestFit(scaled,1),two=points.length>=9?bestFit(scaled,2):null;
  let selected=null,positions=null,unstable=false;
  // A second turn point must improve on a one-knot fit, not just on a straight line.
  for(const model of [two,one]){
   const simpler=model===two?one:linear;
   if(!model||!simpler||simpler.bic-model.bic<MIN_BIC_GAIN||linear.bic-model.bic<MIN_BIC_GAIN||!hasShape(model,scaled))continue;
   const stable=stableFit(scaled,model);
   if(!stable){unstable=true;break}
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
  const fitPoints=[0,...selected.knots,1].map(x=>({x:watts(x),y:selected.predict(x)}));
  return {...empty,lt1:turnpoint(0),lt2:selected.knots.length===2?turnpoint(1):null,fit:fitPoints,rmse:Lab.core.round(selected.rmse,3),reason:selected.knots.length===1?'仅识别到第一处稳定拐点':'',lt2Reason:selected.knots.length===1?(points.length<9?'数据不足（至少 9 个有效读数）':'未识别到第二处稳定拐点'):''};
 }
 Lab.turnpoints={estimate,METHOD};
})();
