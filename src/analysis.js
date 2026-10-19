(function(){
 'use strict';
 const Lab=window.Lab;
 const {round}=Lab.core;
 const valid=(st)=>st&&st.quality!=='exclude'&&st.lactate!==''&&st.lactate!==null&&st.lactate!==undefined&&Number.isFinite(Number(st.lactate))&&Number(st.lactate)>=0.2&&Number(st.lactate)<=30;
 const value=(v)=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
 function crossing(points,target,startAt=0){
  if(!Number.isFinite(target)||points.length<2)return null;
  for(let i=Math.max(1,startAt+1);i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(a.y<target&&b.y>=target&&b.y!==a.y){
      return {power:round(a.x+(target-a.y)/(b.y-a.y)*(b.x-a.x),1),between:[a.x,b.x]};
    }
  }
  return null;
 }
 function analyze(stages){
  const points=stages.map((s,i)=>({...s,x:Number(s.power),y:value(s.lactate),index:i})).filter(s=>valid(s)).sort((a,b)=>a.x-b.x);
  const first=points.slice(0,4);
  const baseline=first.length>=2?Math.min(...first.map(p=>p.y)):null;
  const baseIdx=baseline!==null?points.findIndex(x=>x.y===baseline):-1;
  const delta05=baseline===null?null:crossing(points,baseline+.5,baseIdx);
  const fixed2=crossing(points,2);
  const fixed4=crossing(points,4);
  const peak=points.length?Math.max(...points.map(x=>x.y)):null;
  const thresholds=[{name:'低强度参考 (+0.5)',key:'delta05',result:delta05},{name:'2 mmol/L 固定交点',key:'fixed2',result:fixed2},{name:'4 mmol/L 固定交点',key:'fixed4',result:fixed4}];
  const flags=[];
  if(points.length===0)flags.push({kind:'neutral',text:'无有效乳酸数据'});
  else{
    if(points.length<5)flags.push({kind:'warn',text:`有效乳酸读数不足 5 个（${points.length} 个）`});
    const missing=stages.filter(s=>!valid(s)&&s.quality!=='exclude').length;
    if(missing)flags.push({kind:'neutral',text:`缺少乳酸读数：${missing} 级`});
    const excluded=stages.filter(s=>s.quality==='exclude'&&value(s.lactate)!==null).length;
    if(excluded)flags.push({kind:'neutral',text:`已排除样本：${excluded} 个`});
    const suspect=stages.filter(s=>s.quality==='suspect'&&value(s.lactate)!==null).length;
    if(suspect)flags.push({kind:'warn',text:`参与计算的可疑样本：${suspect} 个`});
    if(points[0]?.y>3)flags.push({kind:'warn',text:'首个有效读数超过 3 mmol/L'});
    for(let i=1;i<points.length;i++){
      if(points[i].y-points[i-1].y<-.8){flags.push({kind:'warn',text:`${points[i-1].x}→${points[i].x} W 乳酸下降 ${(points[i-1].y-points[i].y).toFixed(1)} mmol/L`});}
      if(i>=2&&points[i].y-points[i-1].y>3.5&&points[i].y-points[i-2].y<2){flags.push({kind:'warn',text:`${points[i].x} W：乳酸较上一级增加 ${(points[i].y-points[i-1].y).toFixed(1)} mmol/L`});}
    }
  }
  return {points,baseline,baselineSource:`前 ${first.length} 个有效阶段的最低乳酸`,delta05,fixed2,fixed4,peak,thresholds,flags,validCount:points.length,completePct:Math.round(points.length/Math.max(stages.length,1)*100)};
 }
 Lab.analysis={analyze,crossing,valid,value};
})();
