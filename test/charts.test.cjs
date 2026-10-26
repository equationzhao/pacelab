const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({window:{}});for(const name of ['storage','core','recording','charts'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);
const {renderScatter}=context.window.Lab.charts;
test('heart rate timeline survives historical reloads and breaks at missing data, pauses and recording gaps',()=>{
 const r={startedAt:0,endedAt:13000,windows:[],spans:[{startAt:0,endAt:5000},{startAt:6000,endAt:13000}],records:[
  {timestamp:0,hr:120},{timestamp:1000,hr:130},{timestamp:2000,hr:null},{timestamp:3000,hr:140},{timestamp:4000,hr:150},
  {timestamp:6000,hr:160},{timestamp:7000,hr:170},{timestamp:12000,hr:180},{timestamp:13000,hr:181}]};
 const svg=context.window.Lab.charts.renderHeartRate(r);
 assert.equal((svg.match(/<polyline /g)||[]).length,4);assert.doesNotMatch(svg,/NaN|Infinity/);assert.match(svg,/已记录心率随时间变化/);
 assert.equal(context.window.Lab.charts.renderHeartRate(JSON.parse(JSON.stringify(r))),svg);
 assert.match(context.window.Lab.charts.renderHeartRate(null),/暂无已记录心率/);
 assert.match(context.window.Lab.charts.renderHeartRate({...r,records:[{timestamp:0,hr:120}]}),/<circle /);
 assert.match(context.window.Lab.charts.renderHeartRate({...r,records:[{timestamp:0,hr:0},{timestamp:1,hr:255}]}),/暂无已记录心率/);
});
test('plots only original readings, including flagged samples, without paths or reference markers',()=>{
 const stages=[{power:100,lactate:1,quality:'normal'},{power:125,lactate:2,quality:'suspect'},{power:150,lactate:5,quality:'exclude'},{power:175,lactate:null},{power:200,lactate:''}];
 const original=JSON.stringify(stages),svg=renderScatter(stages);
 assert.equal((svg.match(/<circle /g)||[]).length,3);assert.doesNotMatch(svg,/<path|stroke-dasharray|NaN|Infinity/);assert.match(svg,/第 3 级 · 150 W · 乳酸 5 mmol\/L · 标记排除/);assert.equal(JSON.stringify(stages),original);
});
test('preserves zero RPE, duplicate points, single readings and missing heart rate',()=>{
 const stages=[{power:120,rpe:0,hr:150},{power:120,rpe:0,hr:null}];
 assert.equal((renderScatter(stages,'rpe').match(/<circle /g)||[]).length,2);assert.match(renderScatter(stages,'rpe'),/RPE 0 0–10/);
 const hr=renderScatter(stages,'hr');assert.equal((hr.match(/<circle /g)||[]).length,1);assert.doesNotMatch(hr,/NaN|Infinity/);
 assert.match(renderScatter(stages,'lactate'),/暂无乳酸记录/);assert.equal(renderScatter(stages,'unknown'),'');
});
test('HRV chart shows saved estimates, stage and time without bridging invalid windows',()=>{
 const estimates=[{timestamp:120000,alpha1:.8,status:'valid',stage:0,phase:'effort',beatCount:240},{timestamp:125000,alpha1:null,status:'artifacts'},{timestamp:130000,alpha1:.6,status:'valid',stage:1,phase:'sampling',beatCount:241}];
 const svg=context.window.Lab.charts.renderHrv(estimates,0);assert.equal((svg.match(/<circle /g)||[]).length,2);assert.doesNotMatch(svg,/NaN|Infinity|<path/);assert.match(svg,/第 2 级 · 采样间隔 · DFA α1 0.600/);
 assert.match(context.window.Lab.charts.renderHrv([],0),/暂无有效/);
});
