const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const here=__dirname,root=path.resolve(here,'../..'),prior=path.join(here,'../public-data-2026-10-19');
const context=vm.createContext({window:{}}),hashes={};
for(const name of ['core','turnpoints','analysis']){
 const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');
 hashes[name]=crypto.createHash('sha256').update(source).digest('hex');vm.runInContext(source,context);
}
const {analysis}=context.window.Lab;
if(context.window.Lab.turnpoints.METHOD!=='turnpoint-model-selection-v2')throw Error('Use the v2 engine from commit c1846ea to reproduce this archived report.');
const inputs=JSON.parse(fs.readFileSync(path.join(prior,'inputs.json')));
const old=JSON.parse(fs.readFileSync(path.join(prior,'results.json')));
const compact=a=>({lt1:a.lt1,lt2:a.lt2,method:a.method,model:a.model,reason:a.reason,lt2Reason:a.lt2Reason,validCount:a.validCount,fit:a.fit});
const results=inputs.map(c=>({id:c.id,source:c.source,
 previous:old.results.find(r=>r.id===c.id).exerciseOnly,
 current:compact(analysis.analyze(c.points)),
 withRestSensitivity:compact(analysis.analyze([...c.rest,...c.points]))}));
let seed=1477;
const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296-.5};
const controls=[];
for(const kind of ['flat','linear','exponential','quadratic','terminal-spike','late-bend','one-turn','two-turn']){
 for(let trial=0;trial<10;trial++){
  const stages=Array.from({length:10},(_,i)=>{
   let y;
   if(kind==='flat')y=1;
   if(kind==='linear')y=1+i*.5;
   if(kind==='exponential')y=Math.exp(i/9*2);
   if(kind==='quadratic')y=1+6*(i/9)**2;
   if(kind==='terminal-spike')y=i===9?7:1;
   if(kind==='late-bend')y=2+i*.5+Math.max(0,i-3);
   if(kind==='one-turn')y=1+Math.max(0,i-3)*.5;
   if(kind==='two-turn')y=1+Math.max(0,i-3)*.5+Math.max(0,i-6);
   return {power:100+25*i,lactate:Math.round((y+noise()*.1)*100)/100,quality:'normal'};
  });
  const a=analysis.analyze(stages);
  controls.push({kind,trial,stages,result:compact(a),
   expected:kind==='one-turn'?{lt1:175,lt2:null}:kind==='two-turn'?{lt1:175,lt2:250}:{lt1:null,lt2:null}});
 }
}
const summary={};
for(const source of ['Nolte2022','Pallares2016']){
 const group=results.filter(r=>r.source===source);summary[source]={curves:group.length};
 for(const version of ['previous','current','withRestSensitivity'])summary[source][version]={
  lt1:group.filter(r=>r[version].lt1).length,lt2:group.filter(r=>r[version].lt2).length};
}
const controlSummary={};
for(const kind of new Set(controls.map(c=>c.kind))){
 const group=controls.filter(c=>c.kind===kind),expected=group[0].expected;
 controlSummary[kind]={curves:group.length,lt1Outputs:group.filter(c=>c.result.lt1).length,lt2Outputs:group.filter(c=>c.result.lt2).length,
  expected,
  correctWithinOneStage:group.filter(c=>['lt1','lt2'].every(k=>expected[k]===null?c.result[k]===null:!!c.result[k]&&Math.abs(c.result[k].power-expected[k])<=25)).length};
}
const output={method:context.window.Lab.turnpoints.METHOD,engineSha256:hashes,inputSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(prior,'inputs.json'))).digest('hex'),summary,controlSummary,results,controls};
fs.writeFileSync(path.join(here,'results.json'),JSON.stringify(output,null,2)+'\n');
const rows=[['id','source','valid_readings','old_lt1_w','old_lt2_w','new_lt1_w','new_lt2_w','selected_model','reason']];
for(const r of results)rows.push([r.id,r.source,r.current.validCount,r.previous.lt1?.power??'',r.previous.lt2?.power??'',r.current.lt1?.power??'',r.current.lt2?.power??'',r.current.model??'',r.current.reason]);
fs.writeFileSync(path.join(here,'results.csv'),'\ufeff'+rows.map(row=>row.map(s=>'"'+String(s).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
console.log(JSON.stringify({summary,controlSummary},null,2));
if(Object.values(controlSummary).some(g=>g.correctWithinOneStage!==g.curves))throw Error('Synthetic control regression; inspect results.json');
