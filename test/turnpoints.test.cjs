const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({window:{}});
for(const name of ['core','turnpoints','analysis'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);
const {analysis,turnpoints,core}=context.window.Lab;
const stages=values=>values.map((lactate,i)=>({power:100+i*25,lactate,quality:'normal'}));
// Known, continuous, piecewise-linear curves with knots at 175 W and 250 W.
const two=[1,1,1,1,1.5,2,2.5,4,5.5,7];
const one=[1,1,1,1,1.5,2,2.5,3,3.5,4];
const plain=value=>JSON.parse(JSON.stringify(value));

test('recovers two known slope changes, not fixed concentration crossings',()=>{
 const a=analysis.analyze(stages(two));
 assert.equal(a.lt1.power,175);assert.equal(a.lt2.power,250);
 assert.equal(a.lt1.lactate,1);assert.equal(a.lt2.lactate,2.5);
 assert.deepEqual(plain(a.lt1.between),[150,200]);
 assert.deepEqual(plain(a.lt2.between),[225,275]);
 assert.equal(a.method,'turnpoint-model-selection-v2');assert.equal(a.fit.length,4);
 assert.ok(!('fixed2' in a)&&!('fixed4' in a)&&!('delta05' in a));
});
test('translating the entire curve above 4 mmol/L preserves breakpoint power',()=>{
 const a=analysis.analyze(stages(two.map(y=>y+4)));
 assert.equal(a.lt1.power,175);assert.equal(a.lt2.power,250);
 assert.equal(a.lt1.lactate,5);assert.equal(a.lt2.lactate,6.5);
});
test('moderate scaling of lactate preserves breakpoint power',()=>{
 const a=analysis.analyze(stages(two.map(y=>y*.7)));
 assert.equal(a.lt1.power,175);assert.equal(a.lt2.power,250);
});
test('uses actual power spacing rather than stage index',()=>{
 const a=analysis.analyze(stages(two).map(s=>({...s,power:50+(s.power-100)*1.6})));
 assert.equal(a.lt1.power,170);assert.equal(a.lt2.power,290);
});
test('keeps the result within a stage under small measurement noise',()=>{
 const a=analysis.analyze(stages([1,.9,1,1,1.5,2.1,2.5,4,5.6,7]));
 assert.ok(a.lt1&&Math.abs(a.lt1.power-175)<=12.5);
 assert.ok(a.lt2&&Math.abs(a.lt2.power-250)<=12.5);
});
test('one supported turn does not manufacture LT2',()=>{
 const a=analysis.analyze(stages(one));
 assert.equal(a.lt1.power,175);assert.equal(a.lt2,null);assert.equal(a.fit.length,3);
 assert.match(a.lt2Reason,/未识别/);
});
test('insufficient data leaves results empty instead of falling back to 2/4 mmol',()=>{
 const a=analysis.analyze(stages([1,2,3,4,5]));
 assert.equal(a.lt1,null);assert.equal(a.lt2,null);assert.match(a.reason,/至少需要 6/);
 const b=analysis.analyze(stages([1,1,1,1,2,3,4]));
 assert.equal(b.lt1.power,175);assert.equal(b.lt2,null);assert.match(b.lt2Reason,/至少 8/);
});
test('requires enough independent support rather than filling every eligible result',()=>{
 const a=analysis.analyze(stages([1,1,1,2,3,4]));
 assert.equal(a.lt1.power,150);assert.equal(a.lt2,null);
 const b=analysis.analyze(stages([1,1,1,1.4,1.8,2.2,3.6,5,6.4]));
 assert.equal(b.lt1.power,150);assert.equal(b.lt2.power,225);
 const c=analysis.analyze(stages([1,1,1,1.5,2,4,6,8]));
 assert.equal(c.lt2,null);assert.match(c.reason,/单个样本/);
});
test('flat, noisy, linear and declining curves do not force turnpoints',()=>{
 for(const values of [Array(10).fill(1),[1,1.1,.9,1,1.1,1,.9,1,1,1.1],Array.from({length:10},(_,i)=>1+i*.5),Array.from({length:10},(_,i)=>3-i*.2)]){
  const a=analysis.analyze(stages(values));assert.equal(a.lt1,null);assert.equal(a.lt2,null);
 }
});
test('a late bend without a near-flat initial region cannot be labelled LT1',()=>{
 const a=analysis.analyze(stages([2,2.5,3,3.5,5,6.5,8,9.5,11,12.5]));
 assert.equal(a.lt1,null);assert.equal(a.lt2,null);
});
test('insufficient sampling above the second turn cannot relabel LT2 as LT1',()=>{
 const a=analysis.analyze(stages([1,1,1,1.3,1.6,1.9,2.2,4.2,6.2]));
 assert.equal(a.lt1,null);assert.equal(a.lt2,null);
});
test('a single terminal spike is rejected by leave-one-out stability',()=>{
 const a=analysis.analyze(stages([1,1,1,1,1,1,1,1,1,7]));
 assert.equal(a.lt1,null);assert.equal(a.lt2,null);assert.match(a.reason,/单个样本/);
});
test('excluded outliers do not participate; suspect samples are identified',()=>{
 const input=stages(two);input.splice(4,0,{power:187.5,lactate:20,quality:'exclude'});
 input[5].quality='suspect';const a=analysis.analyze(input);
 assert.equal(a.lt1.power,175);assert.equal(a.lt2.power,250);assert.equal(a.validCount,10);
 assert.ok(a.flags.some(f=>f.text.includes('已排除样本：1')));
 assert.ok(a.flags.some(f=>f.text.includes('可疑样本：1')));
});
test('duplicate and descending powers are rejected, not silently reordered',()=>{
 for(const input of [stages(two).map((s,i)=>({...s,power:i===4?175:s.power})),stages(two).reverse()]){
  const a=analysis.analyze(input);assert.equal(a.lt1,null);assert.equal(a.lt2,null);assert.match(a.reason,/未严格递增/);
 }
});
test('analysis does not mutate raw data and updates its cache after edits',()=>{
 const input=stages(two),before=JSON.stringify(input),a=analysis.analyze(input);
 assert.equal(JSON.stringify(input),before);assert.equal(analysis.analyze(input),a);
 input.forEach(s=>{s.lactate=1});const b=analysis.analyze(input);
 assert.notEqual(a,b);assert.equal(b.lt1,null);assert.equal(b.lt2,null);
 input[0].quality='exclude';assert.equal(analysis.analyze(input).validCount,9);
});
test('CSV exports the actual method and estimated thresholds, leaving missing values blank',()=>{
 const session={id:'fixture',type:'lactate-step',name:'Fixture',createdAt:'2026-10-19',protocol:{},stages:stages(two)};
 const csv=core.sessionCsv(session);assert.match(csv,/"analysis_method","lt1_power_w","lt2_power_w"/);
 assert.match(csv,/"turnpoint-model-selection-v2","175","250"/);
 session.stages=stages([1,2,3]);assert.match(core.sessionCsv(session),/"turnpoint-model-selection-v2","",""/);
});
test('a supported exponential onset yields LT1 without inventing an LT2',()=>{
 const input=Array.from({length:10},(_,i)=>({power:100+25*i,lactate:Math.exp(Math.max(0,100+25*i-175)/65),quality:'normal'}));
 const a=analysis.analyze(input);
 assert.ok(a.lt1&&Math.abs(a.lt1.power-175)<=6.25);
 assert.equal(a.lt2,null);assert.equal(a.model,'exponential-onset');
 assert.ok(a.fit.length>10);
 for(const offset of [1,4]){
  const shifted=analysis.analyze(input.map(s=>({...s,lactate:s.lactate+offset})));
  assert.equal(shifted.lt1.power,a.lt1.power);assert.equal(shifted.lt2,null);
 }
});
test('continuous exponential growth and smooth curvature do not create a baseline onset',()=>{
 for(const count of [6,8,10,15])for(const value of [x=>Math.exp(2*x),x=>1+6*x*x]){
  const input=Array.from({length:count},(_,i)=>({power:100+i*25,lactate:value(i/(count-1)),quality:'normal'}));
  const a=analysis.analyze(input);assert.equal(a.lt1,null);assert.equal(a.lt2,null);
 }
});
test('a short high-load tail cannot turn the later rise into LT1',()=>{
 const a=analysis.analyze(stages(two).slice(0,8));
 assert.equal(a.lt1,null);assert.equal(a.lt2,null);
});
test('empty readings and excluded records do not count as valid measurements',()=>{
 const input=stages([null,'',undefined,1,1,1]);input[5].quality='exclude';
 const a=analysis.analyze(input);assert.equal(a.validCount,2);assert.equal(a.lt1,null);assert.equal(a.lt2,null);
 assert.equal(turnpoints.estimate([]).lt1,null);
});
