(function(){
'use strict';
// Bluetooth FTMS 1.0.1: Control Point 2AD9, Feature 2ACC, Power Range 2AD8, Status 2ADA.
// https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0-1/
const Lab=window.Lab;
function readCapabilities(features,range){
 if(features.byteLength<8||!(features.getUint32(4,true)&8))throw Error('此设备不支持 FTMS ERG 目标功率控制');
 if(range.byteLength<6)throw Error('骑行台功率范围数据不完整');
 const min=range.getInt16(0,true),max=range.getInt16(2,true),step=range.getUint16(4,true)||1;
 if(max<min||max<=0||step>max-min&&max!==min)throw Error('骑行台功率范围无效');
 return {min,max,step};
}
function validatePower(range,power){
 if(!Number.isInteger(power)||power<range.min||power>range.max||(power-range.min)%range.step!==0)throw Error(`目标 ${power} W 不受骑行台支持（${range.min}–${range.max} W，步长 ${range.step} W）`);
}
function createController(service,onChange=()=>{},options={}){
 const state={phase:'connecting',power:null,desiredPower:null,error:'',range:null,requiresReconnect:false};
 let point,status,pending=null,disposed=false,hasControl=false,machineRunning=false,busy=false,work=Promise.resolve();
 let desired={mode:'idle',power:null},version=0,applied=0;
 const emit=()=>onChange();
 const cancelled=()=>Error('ERG 骑行台连接已断开；请在设备端确认负载已停止');
 function settleCommand(error){if(!pending)return;const current=pending;pending=null;clearTimeout(current.timer);error?current.reject(error):current.resolve()}
 function sendCommand(opcode,parameters=[]){
  if(disposed)return Promise.reject(cancelled());
  if(state.requiresReconnect)return Promise.reject(Error('ERG 控制响应超时，请在设备端停止负载后重新连接'));
  if(pending)return Promise.reject(Error('上一条 ERG 指令尚未完成'));
  return new Promise((resolve,reject)=>{
   const fail=error=>{if(pending===command)settleCommand(error)};
   const command={opcode,resolve,reject,timer:null,written:false,acknowledged:false,resultError:null};
   pending=command;command.timer=setTimeout(()=>{
    if(pending!==command)return;state.requiresReconnect=true;fail(Error('ERG 控制响应超时，请在设备端停止负载后重新连接'));
   },options.timeoutMs??5000);
   try{
    const write=point.writeValueWithResponse||point.writeValue;
    if(!write)throw Error('浏览器不支持骑行台控制写入');
    Promise.resolve(write.call(point,Uint8Array.from([opcode,...parameters]))).then(()=>{
     if(pending!==command)return;command.written=true;if(command.acknowledged)settleCommand(command.resultError);
    }).catch(fail);
   }catch(error){fail(error)}
  });
 }
 function handleResponse(event){
  const value=event.target.value;if(value.byteLength<3||value.getUint8(0)!==0x80||!pending||value.getUint8(1)!==pending.opcode)return;
  const result=value.getUint8(2);pending.acknowledged=true;if(result===5)hasControl=false;
  const reason=({2:'设备不支持此控制指令',3:'设备拒绝此功率或控制参数',4:'设备未能执行控制指令',5:'未获得骑行台控制权，请关闭其他控制软件后重试'})[result]||'设备返回未知错误';
  pending.resultError=result===1?null:Error(reason);if(pending.written)settleCommand(pending.resultError);
 }
 function handleStatus(event){
  const value=event.target.value;if(!value.byteLength)return;const opcode=value.getUint8(0);
  if(opcode===4)machineRunning=true;
  let error;
  if(opcode===0xff){hasControl=false;error=Error('ERG 控制权已丢失，请在设备端确认停止，关闭其他控制软件后重试')}
  else if([1,2,3].includes(opcode)){
   machineRunning=false;
   if(desired.mode==='running'&&pending?.opcode!==8)error=Error('骑行台已从设备端停止或暂停，测试已暂停');
  }else if(opcode===8&&value.byteLength>=3&&desired.mode==='running'&&pending?.opcode!==5&&value.getInt16(1,true)!==desired.power){
   error=Error('骑行台目标功率已在设备端改变，测试已暂停');
  }
  if(error){settleCommand(error);state.phase='error';state.power=null;state.error=error.message;emit()}
 }
 async function initializeController(){
  try{
  const features=await (await service.getCharacteristic(0x2acc)).readValue();
  if(features.byteLength<8||!(features.getUint32(4,true)&8))throw Error('此设备不支持 FTMS ERG 目标功率控制');
  const range=await (await service.getCharacteristic(0x2ad8)).readValue();state.range=readCapabilities(features,range);
  point=await service.getCharacteristic(0x2ad9);status=await service.getCharacteristic(0x2ada);
  if(disposed)throw cancelled();
  point.addEventListener('characteristicvaluechanged',handleResponse);status.addEventListener('characteristicvaluechanged',handleStatus);
  await point.startNotifications();await status.startNotifications();
  await sendCommand(0);hasControl=true;
  if(disposed)throw cancelled();state.phase='ready';emit();
  }catch(error){disposeController();throw error}
 }
 async function drainCommands(){
  busy=true;
  try{
   while(!disposed&&applied!==version){
    const current=version,target={...desired};state.phase='setting';state.desiredPower=target.mode==='running'?target.power:null;emit();
    try{
     if(target.mode==='running'){
      validatePower(state.range,target.power);
      if(!hasControl){await sendCommand(0);hasControl=true;if(current!==version)continue}
      const bytes=new DataView(new ArrayBuffer(2));bytes.setInt16(0,target.power,true);
      await sendCommand(5,[bytes.getUint8(0),bytes.getUint8(1)]);if(current!==version)continue;
      if(!machineRunning){await sendCommand(7);machineRunning=true;if(current!==version)continue}
      state.phase='running';state.power=target.power;
     }else{
      // Permission loss must not start a fight for control with another client.
      if(!hasControl&&target.retry){await sendCommand(0);hasControl=true;if(current!==version)continue}
      if(hasControl){await sendCommand(8,[target.mode==='stopped'?1:2]);if(target.mode==='stopped')state.error=''}
      machineRunning=false;if(current!==version)continue;
      state.phase=target.mode;state.power=null;
     }
     applied=current;emit();
    }catch(error){
     if(disposed)return;applied=current;state.phase='error';state.power=null;state.error=error.message+(target.mode==='running'||error.message.includes('设备端')?'':'；请在设备端确认负载已停止');emit();
    }
   }
  }finally{busy=false}
 }
 function setDesired(mode,power=null,retry=false){
  if(disposed||!state.range)return;
  if(mode==='running')validatePower(state.range,power);
  if(desired.mode===mode&&desired.power===power&&!retry)return;
  desired={mode,power,retry};version++;if(mode==='running'||retry)state.error='';
  if(!busy)work=drainCommands();
 }
 async function waitForIdle(){while(busy)await work}
 function disposeController(){
  disposed=true;hasControl=false;settleCommand(cancelled());
  point?.removeEventListener('characteristicvaluechanged',handleResponse);status?.removeEventListener('characteristicvaluechanged',handleStatus);
  state.phase='disconnected';state.power=null;
 }
 return {state,initializeController,setDesired,waitForIdle,disposeController};
}
Lab.erg={readCapabilities,validatePower,createController};
})();
