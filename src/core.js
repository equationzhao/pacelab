(function(){
  'use strict';
  const Lab=window.Lab=window.Lab||{};
  const STORAGE_KEY='pacelab.sessions.v1';
  const esc=(v)=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const attr=esc;
  const n=(v)=>{if(v===''||v==null)return null;const x=Number(v);return Number.isFinite(x)?x:null};
  const fmt=(value,digits=0)=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toFixed(digits);
  const dateText=(iso)=>{try{return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}catch{return '—'}};
  const uid=()=> (window.crypto && crypto.randomUUID)?crypto.randomUUID():'session-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
  const round=(v,digits=1)=>Math.round(v*(10**digits))/(10**digits);
  const ico={
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    arrow:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
    'arrow-left':'<path d="M19 12H5m7 7-7-7 7-7"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chart:'<path d="M3 18l5-7 4 3 7-10M3 21h18"/>',
    activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    droplet:'<path d="M12 2c-4 5-7 8.5-7 12.3a7 7 0 0 0 14 0C19 10.5 16 7 12 2Z"/>',
    layers:'<path d="m12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5"/>',
    book:'<path d="M4 4.5C7 3 10 3 12 5c2-2 5-2 8-.5V20c-3-1.5-6-1.5-8 .5-2-2-5-2-8-.5V4.5ZM12 5v15.5"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/>',
    upload:'<path d="M12 16V3m-5 5 5-5 5 5M5 16v4h14v-4"/>',
    download:'<path d="M12 3v13m-5-5 5 5 5-5M5 18v3h14v-3"/>',
    file:'<path d="M7 3h8l5 5v13H4V3h3ZM14 3v6h6M8 13h8M8 17h8"/>',
    play:'<path d="m8 5 11 7-11 7V5Z"/>',
    pause:'<path d="M8 5v14M16 5v14"/>',
    stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
    chevron:'<path d="m9 6 6 6-6 6"/>',
    'chevron-down':'<path d="m6 9 6 6 6-6"/>',
    settings:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="11" cy="17" r="2" fill="white"/>',
    edit:'<path d="M4 20h5L20 9l-5-5L4 15v5ZM13 6l5 5"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    shield:'<path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    alert:'<path d="M12 3 2 21h20L12 3ZM12 9v5M12 18h.01"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>',
    'external-link':'<path d="M14 4h6v6M10 14 20 4M19 14v6H4V5h6"/>',
    search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
    printer:'<path d="M7 8V3h10v5M6 17H4V9h16v8h-2M7 14h10v7H7v-7Z"/>',
    x:'<path d="M5 5l14 14M19 5 5 19"/>',
    cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 10h4v4h-4zM2 9h4M2 15h4m12-6h4m-4 6h4M9 2v4m6-4v4M9 18v4m6-4v4"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    refresh:'<path d="M20 8a8 8 0 0 0-14-3L4 7M4 3v4h4M4 16a8 8 0 0 0 14 3l2-2M20 21v-4h-4"/>',
  };
  const icon=(name,cls='icon')=>`<svg class="${cls}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ico[name]||ico.info}</svg>`;
  const emptyState=(title,desc,iconName='activity',button='')=>`<div class="card empty"><div class="empty-illustration">${icon(iconName)}</div><h3>${esc(title)}</h3>${desc?`<p>${esc(desc)}</p>`:''}${button}</div>`;
  const read=()=>{try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');return value?.schemaVersion===1&&Array.isArray(value.sessions)?value:{schemaVersion:1,sessions:[],activeId:null}}catch{return {schemaVersion:1,sessions:[],activeId:null}}};
  const write=(v)=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(v));return true}catch{window.Lab?.ui?.toast?.('浏览器存储失败，请导出 JSON 备份数据');return false}};
  const download=(content,name,mime)=>{const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)};
  const csvCell=(x)=>{const v=String(x??'');const safe=/^[=+@\-\t\r]/.test(v)?"'"+v:v;return `"${safe.replace(/"/g,'""')}"`};
  const sessionCsv=(s)=>{const analysis=Lab.analysis.analyze(s.stages);const heads=['test_id','test_type','name','date','stage','power_w','duration_sec','lactate_mmol_l','heart_rate_bpm','rpe_0_10','sample_quality','entry_recorded_at','note','athlete_name','athlete_sex','athlete_age','ftp_w','test_goal','protocol_preset','analysis_method','lt1_power_w','lt2_power_w','analysis_model','lt1_model','lt2_model','lt2_region_start_w','lt2_region_end_w','resting_lactate_mmol_l','resting_sample_recorded_at','resting_sample_skipped'];const rows=s.stages.map((st,i)=>[s.id,s.type,s.name,s.createdAt,i+1,st.power,st.durationSec,st.lactate??'',st.hr??'',st.rpe??'',st.quality??'',st.recordedAt??'',st.notes??'',s.athlete?.name??'',s.athlete?.sex??'',s.athlete?.age??'',s.athlete?.ftp??'',s.protocol.goal??'',s.protocol.preset??'',analysis.method,analysis.lt1?.power??'',analysis.lt2?.power??'',analysis.model??'',analysis.lt1Model??'',analysis.lt2Model??'',analysis.lt2Region?.[0]??'',analysis.lt2Region?.[1]??'',s.restingSample?.lactate??'',s.restingSample?.recordedAt??'',s.restingSample?.skipped??'']);return '\ufeff'+[heads,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n')};
  Lab.core={esc,attr,n,fmt,dateText,uid,clamp,round,icon,emptyState,read,write,download,sessionCsv,STORAGE_KEY};
})();
