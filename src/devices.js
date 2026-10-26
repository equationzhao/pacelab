(function(){
'use strict';
const Lab=window.Lab;
const specs={power:{label:'功率计',service:0x1818,characteristic:0x2a63},heart:{label:'心率带',service:0x180d,characteristic:0x2a37},trainer:{label:'ERG 骑行台',service:0x1826,characteristic:0x2ad2}};
const slots=Object.fromEntries(Object.keys(specs).map(key=>[key,{status:'disconnected',name:'',values:{},crank:null}]));
const listeners=new Set();
const heartListeners=new Set();
function emitHeart(packet){heartListeners.forEach(fn=>fn(packet))}
function emitChange(){listeners.forEach(fn=>fn())}
function parseHeart(view){
 if(view.byteLength<2)throw Error('心率数据不完整');
 const flags=view.getUint8(0),hr=flags&1?view.getUint16(1,true):view.getUint8(1);
 let offset=flags&1?3:2;const rr=[];
 if(flags&8)offset+=2;
 if(offset>view.byteLength||(flags&16)&&((view.byteLength-offset)%2||offset===view.byteLength))throw Error('RR 数据不完整');
 if(flags&16)for(;offset<view.byteLength;offset+=2)rr.push(view.getUint16(offset,true)*1000/1024);
 // Contact status is meaningful only when the sensor advertises contact support.
 return {hr:(flags&4)&&!(flags&2)?null:hr>0&&hr<255?hr:null,rr,contact:flags&4?!!(flags&2):null};
}
function parsePower(view,previous=null,now=Date.now()){
 const flags=view.getUint16(0,true),power=view.getInt16(2,true);let offset=4,crank=null,cadence;
 if(flags&1)offset++;
 if(flags&4)offset+=2;
 if(flags&16)offset+=6;
 if(flags&32){
  crank={revs:view.getUint16(offset,true),time:view.getUint16(offset+2,true),changedAt:now};offset+=4;
  if(previous){
   const revs=(crank.revs-previous.revs+65536)%65536,ticks=(crank.time-previous.time+65536)%65536;
   if(revs===0){crank.changedAt=previous.changedAt;if(now-previous.changedAt>=3000)cadence=0}
   else if(ticks>0&&now-previous.changedAt<10000){const rpm=revs*61440/ticks;if(rpm<=254)cadence=rpm}
  }
 }
 for(const [bit,size] of [[6,4],[7,4],[8,3],[9,2],[10,2],[11,2]])if(flags&(1<<bit))offset+=size;
 if(offset>view.byteLength)throw Error('功率数据不完整');
 return {values:{power:power>=0?power:null,...(cadence===undefined?{}:{cadence})},crank};
}
function parseTrainer(view){
 const flags=view.getUint16(0,true),values={};let offset=2;
 if(!(flags&1)){values.speed=view.getUint16(offset,true)/360;offset+=2}
 for(const [bit,size,key,scale,signed] of [[1,2],[2,2,'cadence',.5],[3,2],[4,3,'trainerDistance',1],[5,2,'trainerResistance',1,true],[6,2,'power',1,true],[7,2],[8,5],[9,1,'hr',1],[10,1],[11,2],[12,2]]){
  if(!(flags&(1<<bit)))continue;
  if(offset+size>view.byteLength)throw Error('骑行台数据不完整');
  if(key){const value=size===3?view.getUint16(offset,true)+view.getUint8(offset+2)*65536:size===1?view.getUint8(offset):signed?view.getInt16(offset,true):view.getUint16(offset,true);values[key]=((key==='power'&&value<0)||(key==='hr'&&(value===0||value===255))||(key==='cadence'&&value*scale>254))?null:value*scale}
  offset+=size;
 }
 return values;
}
function parseTrainerStatus(view){
 if(!view.byteLength)throw Error('骑行台状态不完整');
 const opcode=view.getUint8(0);
 // FTMS status 0x12 is a simulation setting, not a measured road inclination.
 if(opcode===0x12){if(view.byteLength<7)throw Error('骑行台模拟参数不完整');return {grade:view.getInt16(3,true)/100}}
 if(opcode===1||opcode===0xff||[5,6,7,8].includes(opcode)&&view.byteLength>=3)return {grade:null};
 return {};
}
function describeSupport(){return !window.isSecureContext?'蓝牙连接需要 HTTPS 或 localhost，请打开在线版。':!navigator.bluetooth?'当前浏览器不支持蓝牙连接，请使用电脑端 Chrome / Edge 或 Android Chrome。':''}
function clearConnection(slot){
 if(slot===slots.heart)emitHeart({timestamp:Date.now(),rr:[],status:'disconnected'});
 slot.erg?.disposeController();slot.erg=null;
 if(slot.characteristic&&slot.onValue)slot.characteristic.removeEventListener('characteristicvaluechanged',slot.onValue);
 if(slot.device&&slot.onDisconnect)slot.device.removeEventListener('gattserverdisconnected',slot.onDisconnect);
 slot.characteristic=null;slot.onValue=null;slot.onDisconnect=null;slot.values={};slot.crank=null;slot.distanceEpoch=null;
}
async function connectDevice(kind){
 const spec=specs[kind],slot=slots[kind];if(!spec||slot.status==='connecting')return;
 const reason=describeSupport();if(reason)throw Error(reason);
 await disconnectDevice(kind);slot.status='connecting';slot.error='';emitChange();
 const token={};slot.connectionToken=token;
 const checkConnection=()=>{if(slot.connectionToken!==token)throw Error('连接已取消')};
 try{
  const device=await navigator.bluetooth.requestDevice({filters:[{services:[spec.service]}]});
  checkConnection();
  slot.device=device;slot.name=device.name||spec.label;
  slot.onDisconnect=()=>{if(slot.connectionToken!==token)return;clearConnection(slot);slot.connectionToken=null;slot.status='disconnected';slot.error=kind==='trainer'?'ERG 骑行台已断开，请在设备端确认负载已停止':'';emitChange()};
  device.addEventListener('gattserverdisconnected',slot.onDisconnect);
  const server=await device.gatt.connect(),service=await server.getPrimaryService(spec.service);
  const characteristic=await service.getCharacteristic(spec.characteristic);checkConnection();slot.characteristic=characteristic;
  slot.onValue=event=>{
   if(slot.connectionToken!==token)return;
   try{
    const now=Date.now(),view=event.target.value;let values;
    if(kind==='heart'){const parsed=parseHeart(view);values={hr:parsed.hr};emitHeart({...parsed,timestamp:now})}
    else if(kind==='trainer')values=parseTrainer(view);
    else{const parsed=parsePower(view,slot.crank,now);values=parsed.values;slot.crank=parsed.crank}
    for(const [key,value] of Object.entries(values))slot.values[key]={value,at:now};
    emitChange();
   }catch{/* A malformed notification must not replace the last valid measurement. */}
  };
  characteristic.addEventListener('characteristicvaluechanged',slot.onValue);
  await characteristic.startNotifications();checkConnection();
  if(kind==='trainer'){
   const clearGrade=()=>{delete slot.values.grade};
   slot.erg=Lab.erg.createController(service,emitChange,{onPowerTarget:clearGrade,onStatus:view=>{
    try{
     const values=parseTrainerStatus(view);
     if(view.getUint8(0)===1){slot.distanceEpoch={};delete slot.values.trainerDistance;delete slot.values.speed}
     for(const [key,value] of Object.entries(values))slot.values[key]={value,at:Date.now()};emitChange();
    }catch{/* Ignore truncated status notifications. */}
   }});await slot.erg.initializeController();
  }
  checkConnection();
  if(!device.gatt.connected)throw Error('设备已断开，请重新连接');
  slot.status='connected';emitChange();
 }catch(error){
  if(slot.connectionToken!==token)return;
  clearConnection(slot);slot.connectionToken=null;slot.device?.gatt?.disconnect();slot.status='disconnected';slot.error=error.name==='NotFoundError'?'':error.message;emitChange();
  if(error.name!=='NotFoundError')throw Error(`连接${spec.label}失败：${error.message}`);
 }
}
async function disconnectDevice(kind){
 const slot=slots[kind];if(!slot||slot.status==='connecting')return;
 const token=slot.connectionToken;
 let error;
 if(kind==='trainer'&&slot.erg){
  if(!(['ready','stopped'].includes(slot.erg.state.phase)&&!slot.erg.state.error)){slot.erg.setDesired('stopped');await slot.erg.waitForIdle()}
  error=slot.erg?.state.error;
 }
 if(slot.connectionToken!==token)return;
 clearConnection(slot);slot.connectionToken=null;slot.device?.gatt?.disconnect();slot.status='disconnected';emitChange();
 if(error)throw Error(`已断开 ERG 连接，请在设备端确认停止负载：${error}`);
}
function readSnapshot(now=Date.now()){
 const fresh=(kind,key)=>{const slot=slots[kind],sample=slot.values[key];return slot.status==='connected'&&sample&&now>=sample.at&&now-sample.at<=5000&&Number.isFinite(sample.value)?{value:sample.value,source:kind}:null};
 const output={powerMeterPower:fresh('power','power')?.value??null,trainerPower:fresh('trainer','power')?.value??null};
 for(const [key,kinds] of Object.entries({power:['power','trainer'],cadence:['power','trainer'],hr:['heart','trainer'],speed:['trainer'],trainerDistance:['trainer'],trainerResistance:['trainer']})){
  const sample=kinds.map(kind=>fresh(kind,key)).find(Boolean);output[key]=sample?.value??null;output[key+'Source']=sample?.source??null;
 }
 // Settings arrive only when changed. Retain them while live trainer telemetry continues.
 const liveTrainer=['speed','power','cadence','trainerDistance'].some(key=>fresh('trainer',key));
 output.grade=liveTrainer&&Number.isFinite(slots.trainer.values.grade?.value)?slots.trainer.values.grade.value:null;
 output.gradeSource=output.grade===null?null:'trainerSimulation';
 output.trainerConnection=slots.trainer.distanceEpoch??slots.trainer.connectionToken;
 output.trainerDistanceAt=slots.trainer.values.trainerDistance?.at;
 output.speedAt=slots.trainer.values.speed?.at;
 return output;
}
Lab.devices={specs,slots,describeSupport,connectDevice,disconnectDevice,readSnapshot,parseHeart,parsePower,parseTrainer,parseTrainerStatus,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)},subscribeHeart(fn){heartListeners.add(fn);return ()=>heartListeners.delete(fn)}};
})();
