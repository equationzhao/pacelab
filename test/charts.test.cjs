const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({window:{}});for(const name of ['core','charts'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);
const {renderScatter}=context.window.Lab.charts;
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
