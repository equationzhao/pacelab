(function(){
'use strict';
const Lab=window.Lab,{esc,n,round}=Lab.core;
const metrics={lactate:{label:'乳酸',unit:'mmol/L'},hr:{label:'心率',unit:'bpm'},rpe:{label:'RPE',unit:'0–10'}};
const qualities={normal:{label:'正常',color:'#178a72'},suspect:{label:'可疑',color:'#dc9053'},exclude:{label:'标记排除',color:'#94a2a7'}};
function renderScatter(stages,metric='lactate',byStage=false){
 const definition=metrics[metric];if(!definition)return '';
 // Plot each stored reading, including marked samples. No interpolation or aggregation.
 const points=stages.map((stage,index)=>({x:byStage?index+1:n(stage.power),y:n(stage[metric]),index,quality:qualities[stage.quality]||qualities.normal})).filter(point=>point.x!==null&&point.y!==null);
 if(!points.length)return `<div class="empty" style="padding:35px 10px"><div class="empty-illustration" style="width:54px;height:54px;border-radius:15px">${Lab.core.icon('chart')}</div><h3 style="font-size:15px">暂无${definition.label}记录</h3></div>`;
 const W=480,H=280,left=58,right=19,top=20,bottom=48;
 const low=Math.min(...points.map(point=>point.x)),high=Math.max(...points.map(point=>point.x));
 const padding=Math.max(byStage?1:10,(high-low)*.08),minX=low-padding,maxX=high+padding;
 const minY=metric==='hr'?Math.max(0,Math.floor((Math.min(...points.map(point=>point.y))-10)/10)*10):0;
 const maxY=Math.max(minY+1,metric==='rpe'?10:Math.ceil(Math.max(1,...points.map(point=>point.y))*1.1));
 const mapX=value=>left+(value-minX)/(maxX-minX)*(W-left-right),mapY=value=>top+(1-(value-minY)/(maxY-minY))*(H-top-bottom);
 const grid=[];
 for(let i=0;i<=4;i++){
  const x=left+(W-left-right)*i/4,y=top+(H-top-bottom)*i/4;
  grid.push(`<line x1="${left}" x2="${W-right}" y1="${y}" y2="${y}" stroke="#e8eeeb"/><text x="${left-10}" y="${y+4}" text-anchor="end" font-size="12" fill="#84959b">${round(maxY-(maxY-minY)*i/4,1)}</text>`);
  grid.push(`<line x1="${x}" x2="${x}" y1="${top}" y2="${H-bottom}" stroke="#f2f4f2"/><text x="${x}" y="${H-bottom+22}" text-anchor="middle" font-size="12" fill="#84959b">${Math.round(minX+(maxX-minX)*i/4)}</text>`);
 }
 const dots=points.map(point=>{
  const label=`第 ${point.index+1} 级 · ${byStage?stages[point.index].label||'分段':point.x+' W'} · ${definition.label} ${point.y} ${definition.unit} · ${point.quality.label}`;
  return `<circle data-stage="${point.index}" cx="${mapX(point.x)}" cy="${mapY(point.y)}" r="5" fill="white" stroke="${point.quality.color}" stroke-width="2.5" tabindex="0" aria-label="${esc(label)}"><title>${esc(label)}</title></circle>`;
 }).join('');
 return `<svg role="img" aria-label="${definition.label}与${byStage?'分段顺序':'阶段目标功率'}原始数据散点图" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${grid.join('')}${dots}<text x="${(left+W-right)/2}" y="${H-7}" text-anchor="middle" font-size="12" fill="#72868d">${byStage?'分段顺序':'阶段目标功率 / W'}</text><text x="15" y="${H/2}" text-anchor="middle" transform="rotate(-90 15 ${H/2})" font-size="12" fill="#72868d">${definition.label} / ${definition.unit}</text></svg>`;
}
function renderHrv(estimates,startedAt,compact=false){
 const points=estimates.filter(x=>x.status==='valid'&&Number.isFinite(x.alpha1));
 if(!points.length)return '<div class="empty"><p>暂无有效 DFA α1 记录</p></div>';
 const W=compact?340:720,H=240,left=42,right=16,top=20,bottom=40;
 const maxX=Math.max(1,(estimates.at(-1).timestamp-startedAt)/60000);
 let minY=0,maxY=2;for(const x of points){minY=Math.min(minY,Math.floor(x.alpha1*2)/2);maxY=Math.max(maxY,Math.ceil(x.alpha1*2)/2)}
 const mapX=t=>left+(t-startedAt)/60000/maxX*(W-left-right),mapY=y=>top+(maxY-y)/(maxY-minY)*(H-top-bottom);
 const grid=[];
 for(let i=0;i<=4;i++){
  const y=top+(H-top-bottom)*i/4,x=left+(W-left-right)*i/4;
  grid.push(`<line x1="${left}" x2="${W-right}" y1="${y}" y2="${y}" stroke="#e8eeeb"/><text x="${left-9}" y="${y+4}" text-anchor="end" font-size="12" fill="#84959b">${round(maxY-(maxY-minY)*i/4,2)}</text><text x="${x}" y="${H-17}" text-anchor="middle" font-size="12" fill="#84959b">${round(maxX*i/4,1)}</text>`);
 }
 const dots=points.map(p=>`<circle cx="${mapX(p.timestamp)}" cy="${mapY(p.alpha1)}" r="3" fill="#178a72"><title>${esc(`${round((p.timestamp-startedAt)/60000,2)} min · 第 ${p.stage+1} 级 · ${p.phase==='sampling'?'采样间隔':'运动'} · DFA α1 ${p.alpha1.toFixed(3)} · ${p.beatCount} 搏`)}</title></circle>`).join('');
 return `<svg role="img" aria-label="DFA α1 随时间变化" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${grid.join('')}${dots}<text x="${W-right}" y="${H-1}" text-anchor="end" font-size="11" fill="#84959b">经过时间 min（含暂停）</text></svg>`;
}
Lab.charts={renderScatter,renderHrv};
})();
