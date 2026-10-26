(function(){
  'use strict';
  const Lab=window.Lab;
  const {uid,clamp}=Lab.core;
  const goals=[
    {id:'fine',name:'细步长阶梯',minIncrement:10,maxIncrement:15,incrementRatio:1/18,stageMinutes:7,stageCount:10},
    {id:'standard',name:'标准阶梯',minIncrement:15,maxIncrement:25,incrementRatio:.075,stageMinutes:6,stageCount:10},
    {id:'short',name:'短时阶梯',minIncrement:25,maxIncrement:30,incrementRatio:.1,stageMinutes:4,stageCount:9}
  ];
  const definitions=[
    {id:'lactate-step',name:'乳酸阶梯测试',icon:'droplet'},
    {id:'custom-workflow',name:'自定义流程',icon:'layers'}
  ];
  function validAthlete(x){
    const a={name:String(x?.name||'').trim().slice(0,100),sex:String(x?.sex||''),age:Number(x?.age),ftp:Number(x?.ftp)};
    if(!a.name)throw Error('请填写姓名');
    if(!['male','female','undisclosed'].includes(a.sex))throw Error('请选择性别');
    if(!Number.isInteger(a.age)||a.age<1||a.age>120)throw Error('年龄应为 1–120 的整数');
    if(!Number.isInteger(a.ftp)||a.ftp<20||a.ftp>1200)throw Error('FTP 应为 20–1200 W 的整数');
    return a;
  }
  function readAthlete(x){try{return validAthlete(x)}catch{return null}}
  function readGoalId(id){const legacy={lt1:'fine',both:'standard',overview:'short'};return goals.some(g=>g.id===id)?id:Object.hasOwn(legacy,id)?legacy[id]:null}
  function generate(ftp,goalId){
    const power=Number(ftp),goal=goals.find(g=>g.id===readGoalId(goalId));
    if(!Number.isInteger(power)||power<20||power>1200)throw Error('FTP 应为 20–1200 W 的整数');
    if(!goal)throw Error('请选择阶梯方案');
    const nearest5=value=>Math.round(value/5)*5;
    return {startPower:clamp(nearest5(power*.45),20,600),increment:clamp(nearest5(power*goal.incrementRatio),goal.minIncrement,goal.maxIncrement),stageMinutes:goal.stageMinutes,stageCount:goal.stageCount};
  }
  function newSession(input){
    const stages=[];
    for(let i=0;i<input.stageCount;i++){
      stages.push({id:uid(),power:input.startPower+i*input.increment,durationSec:input.stageMinutes*60,lactate:null,hr:null,rpe:null,quality:'normal',notes:'',recordedAt:null});
    }
    const now=new Date().toISOString();
    return {id:uid(),type:'lactate-step',schemaVersion:1,name:input.name||'乳酸阶梯测试',createdAt:now,updatedAt:now,
      athlete:input.athlete?{...input.athlete}:null,
      protocol:{preset:readGoalId(input.preset)||input.preset||'custom',goal:readGoalId(input.goal),startPower:input.startPower,increment:input.increment,stageMinutes:input.stageMinutes,stageCount:input.stageCount,samplingMode:input.samplingMode,samplePauseSec:input.samplePauseSec||45,sampleSite:input.sampleSite||'earlobe',beep:input.beep!==false},
      metadata:{notes:'',device:'',environment:'',operator:''},
      restingSample:null,
      stages,
      execution:{stageIndex:0,phase:'effort',status:'idle',elapsedMs:0,startedAt:null,finishedAt:null}
    };
  }
  function validInput(x){
    const v={startPower:Number(x.startPower),increment:Number(x.increment),stageMinutes:Number(x.stageMinutes),stageCount:Number(x.stageCount),samplePauseSec:Number(x.samplePauseSec||45),name:String(x.name||'').trim().slice(0,100),samplingMode:x.samplingMode==='solo'?'solo':'assisted',sampleSite:['earlobe','fingertip'].includes(x.sampleSite)?x.sampleSite:'earlobe',beep:x.beep!==false,preset:String(x.preset||'custom')};
    v.goal=readGoalId(x.goal);v.preset=readGoalId(x.preset)||v.preset;
    v.athlete=x.athlete?validAthlete(x.athlete):null;
    if(!Number.isInteger(v.startPower)||v.startPower<20||v.startPower>600)throw Error('起始功率应为 20–600 W 的整数');
    if(!Number.isInteger(v.increment)||v.increment<5||v.increment>100)throw Error('功率步长应为 5–100 W 的整数');
    if(!Number.isInteger(v.stageMinutes)||v.stageMinutes<2||v.stageMinutes>15)throw Error('单级时间应为 2–15 分钟的整数');
    if(!Number.isInteger(v.stageCount)||v.stageCount<3||v.stageCount>25)throw Error('阶段数量应为 3–25');
    if(v.startPower+(v.stageCount-1)*v.increment>1200)throw Error('末级功率超出 1200 W，请调整协议');
    if(!Number.isInteger(v.samplePauseSec)||v.samplePauseSec<15||v.samplePauseSec>120)throw Error('采样预留应为 15–120 秒');
    return v;
  }
  Lab.tests={definitions,goals,generate,validAthlete,readAthlete,readGoalId,byId:(id)=>definitions.find(x=>x.id===id),newSession,validInput};
})();
