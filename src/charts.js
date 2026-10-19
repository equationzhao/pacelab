(function(){
'use strict';
const Lab=window.Lab;
const {esc,round}=Lab.core;
const palette=['#178a72','#dc9053','#648ab6','#9a7aca','#ca6c80'];
function svg(options){
 const W=760,H=312,pl=64,pr=23,pt=19,pb=49;
 const series=(options.series||[]).map((s,i)=>({...s,color:s.color||palette[i%palette.length],points:(s.points||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).sort((a,b)=>a.x-b.x)}));
 const all=series.flatMap(s=>s.points);
 if(!all.length)return `<div class="empty" style="padding:42px 10px"><div class="empty-illustration" style="width:54px;height:54px;border-radius:15px">${Lab.core.icon('chart')}</div><h3 style="font-size:15px">暂无数据</h3></div>`;
 let minX=options.minX??Math.min(...all.map(p=>p.x));let maxX=options.maxX??Math.max(...all.map(p=>p.x));
 if(maxX===minX){minX-=25;maxX+=25}
 const minY=options.minY??Math.min(0,...all.map(p=>p.y));
 const high=Math.max(...all.map(p=>p.y));
 let maxY=options.maxY??Math.ceil((Math.max(2,high)*1.15)/2)*2;
 if(maxY<=minY)maxY=minY+2;
 const mx=v=>pl+(v-minX)/(maxX-minX)*(W-pl-pr);
 const my=v=>pt+(1-(v-minY)/(maxY-minY))*(H-pt-pb);
 const grid=[];
 for(let i=0;i<=5;i++){
   const y=pt+(H-pt-pb)*i/5;let val=round(maxY-(maxY-minY)*i/5,1);
   grid.push(`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="#e8eeeb" stroke-width="1"/><text x="${pl-12}" y="${y+4}" text-anchor="end" font-size="11" fill="#94a2a7">${val}</text>`);
 }
 for(let i=0;i<=5;i++){
   const x=pl+(W-pl-pr)*i/5;let val=Math.round(minX+(maxX-minX)*i/5);
   grid.push(`<line x1="${x}" x2="${x}" y1="${pt}" y2="${H-pb}" stroke="#f2f4f2" stroke-width="1"/><text x="${x}" y="${H-pb+23}" text-anchor="middle" font-size="11" fill="#94a2a7">${val}</text>`);
 }
 const markers=[];
 for(const marker of options.markers||[]){
   if(marker.x<minX||marker.x>maxX)continue;
   const x=mx(marker.x);
   if(marker.between){const [low,high]=marker.between;markers.push(`<rect x="${mx(Math.max(low,minX))}" y="${pt}" width="${Math.max(0,mx(Math.min(high,maxX))-mx(Math.max(low,minX)))}" height="${H-pt-pb}" fill="${marker.color||'#adc177'}" opacity=".07"/>`)}
   markers.push(`<line x1="${x}" x2="${x}" y1="${pt}" y2="${H-pb}" stroke="${marker.color||'#adc177'}" stroke-width="2" stroke-dasharray="6 5" opacity=".9"/><text x="${x+5}" y="${pt+11}" font-size="9" fill="${marker.color||'#67845c'}">${esc(marker.label||'参考交点')}</text>`);
 }
 const lines=series.map(s=>{
  if(s.points.length===1&&s.showPoints!==false){const p=s.points[0];return `<circle cx="${mx(p.x)}" cy="${my(p.y)}" r="5" fill="${s.color}"/>`}
  const d=s.points.map((p,i)=>`${i===0?'M':'L'} ${mx(p.x).toFixed(2)} ${my(p.y).toFixed(2)}`).join(' ');
  let circles=s.showPoints===false?'':s.points.map(p=>`<circle cx="${mx(p.x)}" cy="${my(p.y)}" r="4.5" fill="white" stroke="${s.color}" stroke-width="2.8"><title>${esc(s.label||'数据')} · ${p.x} W · ${p.y}</title></circle>`).join('');
  return `<path d="${d}" stroke="${s.color}" stroke-width="${s.showPoints===false?2:3}" ${s.dashed?'stroke-dasharray="7 5"':''} stroke-linejoin="round" stroke-linecap="round" fill="none"/>${circles}`;
 }).join('');
 return `<svg role="img" aria-label="${esc(options.description||'测试曲线')}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><g>${grid.join('')}</g>${markers.join('')}${lines}<text x="${(pl+W-pr)/2}" y="${H-7}" text-anchor="middle" font-size="11" font-weight="600" fill="#829198">功率 / W</text><text x="16" y="${H/2}" text-anchor="middle" transform="rotate(-90 16 ${H/2})" font-size="11" font-weight="600" fill="#829198">${esc(options.yAxisLabel||'数值')}</text></svg>`;
}
function curve(stages,metric,markers=[],fit=[],lt2Fit=[]){
 const filtered=stages.filter(s=>metric!=='lactate'||Lab.analysis.valid(s)).map(s=>({x:Number(s.power),y:Lab.analysis.value(s[metric]),quality:s.quality})).filter(p=>p.y!==null&&Number.isFinite(p.x)&&p.quality!=='exclude');
 return svg({series:[{label:metric==='lactate'?'血乳酸':metric==='hr'?'心率':'RPE',points:filtered},...(fit.length?[{label:'拟合曲线',points:fit,color:'#c98d56',dashed:true,showPoints:false}]:[]),...(lt2Fit.length?[{label:'LT2 分区拟合',points:lt2Fit,color:'#709bbd',showPoints:false}]:[])],yAxisLabel:metric==='lactate'?'血乳酸 / mmol/L':metric==='hr'?'心率 / bpm':'主观用力 / 0–10',minY:metric==='hr'?Math.max(0,Math.min(...filtered.map(x=>x.y))-20):0,markers,description:'功率与'+metric+'关系曲线'});
}
Lab.charts={svg,curve,palette};
})();
