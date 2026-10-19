(function(){
 'use strict';
 const Lab=window.Lab;
 const valid=(st)=>st&&st.quality!=='exclude'&&st.lactate!==''&&st.lactate!==null&&st.lactate!==undefined&&Number.isFinite(Number(st.lactate))&&Number(st.lactate)>=0.2&&Number(st.lactate)<=30;
 const value=(v)=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
 const cache=new WeakMap();
 function analyze(stages){
  const signature=JSON.stringify(stages.map(s=>[s.power,s.lactate,s.quality]));
  const cached=cache.get(stages);if(cached?.signature===signature)return cached.result;
  const points=stages.map((s,i)=>({...s,x:Number(s.power),y:value(s.lactate),index:i})).filter(s=>valid(s));
  const turns=Lab.turnpoints.estimate(points);
  const peak=points.length?Math.max(...points.map(x=>x.y)):null;
  const flags=[];
  if(turns.reason)flags.push({kind:'neutral',text:turns.reason});
  if(points.length===0)flags.push({kind:'neutral',text:'无有效乳酸数据'});
  else{
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
  const result={points,...turns,peak,flags,validCount:points.length,completePct:Math.round(points.length/Math.max(stages.length,1)*100)};
  cache.set(stages,{signature,result});return result;
 }
 Lab.analysis={analyze,valid,value};
})();
