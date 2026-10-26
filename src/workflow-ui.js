(function(){
'use strict';
const Lab=window.Lab,W=Lab.workflow,{esc,icon}=Lab.core;
let draft=[],editingId=null;
const $=q=>document.querySelector(q);
function renderEditor({athlete={},source=null,edit=false}={}){
 editingId=edit?source?.id:null;draft=[];
 $('#modal-root').innerHTML=`<div class="modal-layer" data-dismiss="modal"><div class="modal workflow-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
 <div class="modal-head"><div><h2 id="modal-title">${edit?'编辑':'新建'}自定义流程</h2><p class="workflow-help">粘贴训练文本，预览后可逐段调整。</p></div><button class="btn btn-icon btn-ghost" data-action="close-modal" aria-label="关闭">${icon('x')}</button></div>
 <form id="workflow-form"><div class="modal-body">
 ${edit?'':`<div class="mode-options"><button type="button" class="btn" data-action="new">乳酸阶梯</button><button type="button" class="btn btn-soft" aria-pressed="true">自定义流程</button></div>`}
 <div class="form-grid">
 <div class="form-group span2"><label for="workflow-name">流程名称</label><input class="form-control" id="workflow-name" maxlength="100" required value="${esc(source?source.name+(edit?'':'（副本）'):'自定义流程')}"></div>
 <div class="form-group"><label for="workflow-athlete">姓名</label><input class="form-control" id="workflow-athlete" maxlength="100" required value="${esc(athlete.name||'')}"></div>
 <div class="form-group"><label for="workflow-ftp">本次 FTP / W</label><input class="form-control" id="workflow-ftp" type="number" min="20" max="1200" step="1" required value="${esc(athlete.ftp||'')}"></div>
 <div class="form-group"><label for="workflow-sex">性别</label><select class="form-control" id="workflow-sex"><option value="undisclosed">不透露</option><option value="female">女</option><option value="male">男</option></select></div>
 <div class="form-group"><label for="workflow-age">年龄 / 岁</label><input class="form-control" id="workflow-age" type="number" min="1" max="120" step="1" required value="${esc(athlete.age||'')}"></div>
 </div><div class="divider"></div>
 <div class="workflow-toolbar"><label for="workflow-text"><strong>流程文本</strong></label><button type="button" class="btn btn-sm" data-workflow-action="example">填入示例</button></div>
 <textarea id="workflow-text" class="form-control workflow-text" rows="9" spellcheck="false" maxlength="100000" placeholder="- Warmup 20m ramp 40-70%&#10;- Work 10m 91% lac 30s/60s&#10;- Cooldown 10m ramp 55-40%">${esc(source?.protocol.text||'')}</textarea>
 <p class="workflow-help">一行一段 · % FTP 或 W · ramp 起止功率<br><code>lac 30s/60s</code>：最后 30 秒采样，窗口开始前 60 秒提醒。<br>重复组：单独一行写 <code>4x</code>，下接分段，以空行或下一组标题结束。</p>
 <p class="form-error" id="workflow-error" role="alert"></p>
 <div id="workflow-preview"></div>
 <div class="workflow-toolbar"><button type="button" class="btn btn-sm" data-workflow-action="add">${icon('plus')} 添加分段</button><label class="toggle"><input id="workflow-beep" type="checkbox" ${(source?.protocol.beep??true)?'checked':''}> 切段与采样声音提醒</label></div>
 </div><div class="modal-foot"><button type="button" class="btn" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary" id="workflow-save">${edit?'保存流程':'创建流程'}</button></div></form></div></div>`;
 $('#workflow-sex').value=athlete.sex||'undisclosed';
 $('#workflow-form').addEventListener('input',event=>{if(['workflow-text','workflow-ftp'].includes(event.target.id))parsePreview()});
 $('#workflow-form').addEventListener('change',event=>{if(event.target.dataset.stepField)updateRow(event.target)});
 $('#workflow-form').addEventListener('click',handleEditorClick);
 parsePreview();$('#workflow-text').focus();
}
function showError(message){$('#workflow-error').textContent=message;$('#workflow-save').disabled=!!message}
function parsePreview(){
 try{draft=W.parseText($('#workflow-text').value,Number($('#workflow-ftp').value));showError('');renderPreview()}
 catch(error){draft=[];$('#workflow-preview').innerHTML='';showError($('#workflow-text').value.trim()?error.message:'请粘贴流程文本，或添加分段。')}
}
function renderPreview(){
 const range=Lab.devices?.slots.trainer.erg?.state.range;
 const total=draft.reduce((sum,s)=>sum+s.durationSec,0),samples=draft.filter(s=>s.sampling).length;
 $('#workflow-preview').innerHTML=`<div class="protocol-totals"><div><span>计划时长 · ${draft.length} 段</span><strong>${W.formatDuration(total)}</strong></div><div><span>乳酸采样</span><strong>${samples} 次</strong></div></div><div class="workflow-profile">${W.renderProfile(draft)}</div>${range?`<p class="workflow-help">ERG 范围 ${range.min}–${range.max} W · 步长 ${range.step} W；发送目标按设备步长取最近支持值，超出范围将阻止开始。</p>`:''}
 <div class="workflow-toolbar"><span>勾选分段后批量设置采样</span><label>窗口 <input id="batch-window" type="number" min="1" step="1" value="30" aria-label="批量采样窗口秒数"> 秒</label><label>提前 <input id="batch-lead" type="number" min="0" step="1" value="60" aria-label="批量提前提醒秒数"> 秒</label><button type="button" class="btn btn-sm" data-workflow-action="sample">设置采样</button><button type="button" class="btn btn-sm" data-workflow-action="clear-sample">取消采样</button></div>
 <div class="data-table-wrap"><table class="data-table workflow-table"><thead><tr><th><input type="checkbox" aria-label="选择全部分段" data-workflow-action="select-all"></th><th>分段</th><th>时长</th><th>目标</th><th>采样 / 提醒（秒）</th><th>调整</th></tr></thead><tbody>${draft.map((s,i)=>`<tr data-step="${i}"><td><input type="checkbox" data-step-check="${i}" aria-label="选择第 ${i+1} 段"></td><td><input class="field" data-step-field="label" aria-label="第 ${i+1} 段名称" value="${esc(s.label)}" maxlength="100">${s.repeat?`<small>${s.repeat.iteration}/${s.repeat.count}</small>`:''}</td><td><input class="field" data-step-field="duration" aria-label="第 ${i+1} 段时长" value="${W.formatDuration(s.durationSec)}"></td><td><input class="field workflow-target" data-step-field="target" aria-label="第 ${i+1} 段目标" value="${esc(W.formatTarget(s,false))}"><small>${s.power}${s.target.kind==='ramp'?'–'+s.endPower:''} W</small></td><td><input class="field" data-step-field="sample" aria-label="第 ${i+1} 段采样" placeholder="关闭" value="${s.sampling?s.sampling.windowSec+'/'+s.sampling.leadSec:''}"></td><td><button type="button" class="btn btn-sm" data-workflow-action="up" aria-label="上移第 ${i+1} 段" ${i?'':'disabled'}>↑</button><button type="button" class="btn btn-sm" data-workflow-action="down" aria-label="下移第 ${i+1} 段" ${i===draft.length-1?'disabled':''}>↓</button><button type="button" class="btn btn-sm" data-workflow-action="copy" aria-label="复制第 ${i+1} 段">复制</button><button type="button" class="btn btn-sm" data-workflow-action="remove" aria-label="删除第 ${i+1} 段">删除</button></td></tr>`).join('')}</tbody></table></div><p class="workflow-help">修改表格会同步为逐段文本。模板可保存为未开始的流程，使用时从历史记录复制。</p>`;
}
function commitDraft(next){
 const validated=W.validateSteps(next,Number($('#workflow-ftp').value));
 $('#workflow-text').value=W.formatText(validated);parsePreview();
}
function updateRow(input){
 input.setCustomValidity('');
 try{
  const row=input.closest('[data-step]'),index=Number(row.dataset.step),read=field=>row.querySelector(`[data-step-field="${field}"]`).value.trim();
  const sample=read('sample');if(sample&&!/^\d+(?:\/\d+)?$/.test(sample))throw Error('采样请填写 30/60，留空关闭');
  const parts=sample.split('/'),line=`- ${read('label')} ${read('duration')} ${read('target')}${sample?` lac ${parts[0]}s/${parts[1]||0}s`:''}`;
  const next=[...draft];next[index]=W.parseText(line,Number($('#workflow-ftp').value))[0];commitDraft(next);
 }catch(error){input.setCustomValidity(error.message);showError(error.message)}
}
function handleEditorClick(event){
 const button=event.target.closest('[data-workflow-action]');if(!button)return;
 const action=button.dataset.workflowAction;
 if(action==='select-all'){document.querySelectorAll('[data-step-check]').forEach(input=>input.checked=button.checked);return}
 event.preventDefault();
 try{
  if(action==='example'){
   if($('#workflow-text').value.trim()&&!window.confirm('用示例替换当前流程文本？'))return;
   $('#workflow-text').value=W.example;parsePreview();return;
  }
  if(document.querySelector('[data-step-field]:invalid'))throw Error('请先修正分段表格中的错误');
  const next=draft.map(s=>({...s})),index=Number(button.closest('[data-step]')?.dataset.step);
  if(action==='add'){
   if(!draft.length&&$('#workflow-text').value.trim())throw Error('请先修正文本中的错误');
   next.push(...W.parseText('- Work 10m 70%',Number($('#workflow-ftp').value)));
  }else if(action==='sample'||action==='clear-sample'){
   const selected=[...document.querySelectorAll('[data-step-check]:checked')];if(!selected.length)throw Error('请先勾选需要修改的分段');
   for(const input of selected)next[Number(input.dataset.stepCheck)].sampling=action==='clear-sample'?null:{windowSec:Number($('#batch-window').value),leadSec:Number($('#batch-lead').value)};
  }else if(action==='copy')next.splice(index+1,0,{...next[index]});
  else if(action==='remove')next.splice(index,1);
  else if(action==='up'&&index>0)[next[index-1],next[index]]=[next[index],next[index-1]];
  else if(action==='down'&&index<next.length-1)[next[index+1],next[index]]=[next[index],next[index+1]];
  commitDraft(next);
 }catch(error){showError(error.message)}
}
function readSession(){
 const form=$('#workflow-form');if(!form?.reportValidity())return null;
 const session=W.createSession({name:$('#workflow-name').value,athlete:{name:$('#workflow-athlete').value,ftp:Number($('#workflow-ftp').value),sex:$('#workflow-sex').value,age:Number($('#workflow-age').value)},text:$('#workflow-text').value,beep:$('#workflow-beep').checked});
 return {session,editingId};
}
Lab.workflowUi={renderEditor,readSession,showError};
})();
