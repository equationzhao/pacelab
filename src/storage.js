(function(){
'use strict';
const Lab=window.Lab=window.Lab||{};
const STORAGE_KEY='pacelab.sessions.v1';
let observedValue=null,readSucceeded=false;
let state={status:'ready',reason:null,savedAt:null};
function failSave(reason){state={...state,status:'failed',reason};return false}
function readDatabase(){
 try{
  observedValue=localStorage.getItem(STORAGE_KEY);
  const value=observedValue===null?{schemaVersion:1,sessions:[],activeId:null}:JSON.parse(observedValue);
  if(value?.schemaVersion!==1||!Array.isArray(value.sessions)||value.sessions.some(s=>!s||!s.protocol||!s.execution||!Array.isArray(s.stages)||!s.stages.length))throw Error('Invalid database');
  readSucceeded=true;state={status:observedValue===null?'ready':'saved',reason:null,savedAt:null};
  return value;
 }catch{
  readSucceeded=false;failSave('read');
  return {schemaVersion:1,sessions:[],activeId:null};
 }
}
function writeDatabase(value){
 if(!readSucceeded)return failSave('read');
 try{
  const next=JSON.stringify(value);
  // Refuse a stale tab's write before it can replace another tab's records.
  if(localStorage.getItem(STORAGE_KEY)!==observedValue)return failSave('conflict');
  localStorage.setItem(STORAGE_KEY,next);
  observedValue=next;state={status:'saved',reason:null,savedAt:Date.now()};return true;
 }catch(error){return failSave(error?.name==='QuotaExceededError'?'quota':'unavailable')}
}
function checkForConflict(){
 try{if(localStorage.getItem(STORAGE_KEY)!==observedValue){failSave('conflict');return true}}
 catch{failSave('unavailable');return true}
 return false;
}
function readStatus(){return {...state}}
function readOriginal(){return observedValue}
Lab.storage={STORAGE_KEY,readDatabase,writeDatabase,checkForConflict,readStatus,readOriginal};
})();
