// Marathon Trainer PWA (v4.6.0) — FI dates, collapsible Settings, one-tap Complete, autosave

// ================== STATE & STORAGE ==================
const STORAGE_KEY = "marathon_trainer_v41";

const defaultRecords = [
  { distKm: 1,    timeSec: null },
  { distKm: 5,    timeSec: null },
  { distKm: 10,   timeSec: null },
  { distKm: 21.1, timeSec: null },
  { distKm: 42.2, timeSec: null },
];

const state = {
  user: {
    race: { name: "", dateTime: null, targetKm: 42.195, targetTimeSec: null, targetPaceSecPerKm: null },
    weeklyGoalKm: 60,
    maxHr: null,
    runsPerWeek: 4,
    taperWeeks: 2,
    preferences: { timeFormat24h: true, units: "km" },

    // AI
    googleApiKey: "",
    googleModel: "",   // e.g. "gemini-2.5-flash"

    // Records
    longestRunEverKm: null,
    records: JSON.parse(JSON.stringify(defaultRecords)),
  },
  plan: [],
  runs: [],
  ui: {
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    weekRef: new Date().toISOString().slice(0,10),

    geminiModels: [],
    // Collapsible sections state
    sectionsOpen: {
      race: true,
      heart: true,
      goals: true,
      ai: false,
    },
  }
};

function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){} }
function load(){ try{
  const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if(s){
    Object.assign(state.user, s.user||{});
    if(!Array.isArray(state.user.records)) state.user.records = JSON.parse(JSON.stringify(defaultRecords));
    state.plan = s.plan||[];
    state.runs = s.runs||[];
    state.ui   = Object.assign(state.ui, s.ui||{});
    // backfill sectionsOpen
    if(!state.ui.sectionsOpen) state.ui.sectionsOpen = { race:true, heart:true, goals:true, ai:false };
  }
}catch(e){} }
load();

// =============== DATE & TIME HELPERS (FI DISPLAY) ===============
const pad = n => String(n).padStart(2,"0");

function toFIfromISO(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`;
}
function toFIfromDate(d){
  if(!(d instanceof Date)) return "—";
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`;
}
function toISODate(d){
  if(!(d instanceof Date)) return "";
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function hmsToSec(hms){
  if(!hms) return null;
  const parts = hms.split(":").map(x=>parseInt(x,10));
  if(parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
  if(parts.length===2) return parts[0]*60+parts[1];
  return parseInt(hms,10);
}
function secToHMS(sec){
  if(sec==null) return "";
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = Math.floor(sec%60);
  if(h>0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}
function paceFmt(sec){ if(sec==null) return "—"; const m=Math.floor(sec/60), s=sec%60; return `${m}:${String(s).padStart(2,"0")}`; }

function computeMissingTarget(){
  const r = state.user.race;
  const D = r.targetKm, T = r.targetTimeSec, P = r.targetPaceSecPerKm;
  if(D && T && !P) r.targetPaceSecPerKm = Math.round(T / D);
  else if(D && P && !T) r.targetTimeSec = Math.round(P * D);
  else if(T && P && !D) r.targetKm = +(T / P).toFixed(2);
}
computeMissingTarget();

function computeZones(maxHr){
  if(!maxHr) return null;
  return [
    {label:"Z1", low: Math.round(maxHr*0.5), high: Math.round(maxHr*0.6)},
    {label:"Z2", low: Math.round(maxHr*0.6), high: Math.round(maxHr*0.7)},
    {label:"Z3", low: Math.round(maxHr*0.7), high: Math.round(maxHr*0.8)},
    {label:"Z4", low: Math.round(maxHr*0.8), high: Math.round(maxHr*0.9)},
    {label:"Z5", low: Math.round(maxHr*0.9), high: maxHr}
  ];
}

// ---- Model helpers ----
function stripModelsPrefix(name){ return (name || "").replace(/^models\//i, "").trim(); }
function normalizeGeminiModel(name){
  let n = (name || "").trim();
  if (!n) return n;
  if (/^[A-Za-z].*\s/.test(n) || /[A-Z]/.test(n)) {
    n = n.toLowerCase().replace(/\s+/g, "-");
    n = n.replace(/-latest$/, "");
  }
  return stripModelsPrefix(n);
}
try {
  if (state.user && typeof state.user.googleModel === "string") {
    let fixed = state.user.googleModel;
    if (/^gemini-1\.5/i.test(fixed)) fixed = "gemini-2.5-flash";
    fixed = normalizeGeminiModel(fixed);
    if (fixed !== state.user.googleModel) {
      state.user.googleModel = fixed; save();
    }
  }
} catch {}

// =============== MOUNT & TABS ===============
const view = document.getElementById("view");
const tabs = Array.from(document.querySelectorAll(".tab"));
let current = "overview";
tabs.forEach(t => t.addEventListener("click", () => {
  current = t.dataset.tab;
  tabs.forEach(x => x.classList.toggle("active", x===t));
  render();
}));

// Optional hard reset
window.hardResetPWA = async function(){
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
    localStorage.removeItem(STORAGE_KEY);
  } finally { location.reload(); }
};

// =============== RENDER ROUTER ===============
function render(){
  if(current==="overview") return renderOverview();
  if(current==="calendar") return renderCalendar();
  if(current==="plan") return renderPlan();
  if(current==="coach") return renderCoach();
  if(current==="settings") return renderSettings();
}

// =============== OVERVIEW (with Records) ===============
function getCountdown(){
  const dt = state.user.race.dateTime? new Date(state.user.race.dateTime) : null;
  if(!dt) return { d:"—", h:"—", m:"—" };
  const now = new Date();
  let diff = Math.max(0, Math.floor((dt-now)/1000));
  const d = Math.floor(diff / 86400); diff -= d*86400;
  const h = Math.floor(diff / 3600); diff -= h*3600;
  const m = Math.floor(diff / 60);
  return { d, h, m };
}
setInterval(()=>{ if(current==="overview") renderOverview(); }, 60000);

function avgPaceFromRecord(rec){
  if(!rec || rec.timeSec==null || !rec.distKm) return "—";
  const perKm = rec.timeSec / rec.distKm;
  return paceFmt(Math.round(perKm)) + "/km";
}
function renderRecordsList(editMode=false){
  const recs = state.user.records || [];
  const rows = recs.map((r, idx) => {
    const timeStr = r.timeSec!=null ? secToHMS(r.timeSec) : "";
    return `
      <tr>
        <td>${r.distKm} km</td>
        <td>${editMode ? `<input data-recid="${idx}" class="rec-time" placeholder="hh:mm:ss" value="${timeStr}">` : (timeStr || "—")}</td>
        <td>${avgPaceFromRecord(r)}</td>
      </tr>`;
  }).join("");
  return `
    <table class="table" style="margin-top:8px">
      <thead><tr>
        <th style="color:#ff7a00">Distance</th>
        <th style="color:#ff7a00">Best Time</th>
        <th style="color:#ff7a00">Avg pace</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
function recalcRecordsFromLogs(){
  const targets = [1,5,10,21.1,42.2];
  const best = {};
  for(const t of targets) best[t] = null;

  for (const run of state.runs){
    const km = run.actualKm;
    const sec = run.actualTimeSec;
    if(!km || !sec) continue;
    for(const t of targets){
      if (Math.abs(km - t) / t <= 0.01){
        if (best[t]==null || sec < best[t]) best[t] = sec;
      }
    }
  }

  for (let i=0;i<state.user.records.length;i++){
    const r = state.user.records[i];
    if (best[r.distKm]!=null) r.timeSec = best[r.distKm];
  }
  save();
}

function renderOverview(){
  const r = state.user.race;
  const countdown = getCountdown();
  const weekly = getWeekStats(new Date(state.ui.weekRef));

  view.innerHTML = `
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <div class="label">Race</div>
          <div class="value" style="color:#ff7a00">${r.name||"—"}</div>
          <div class="small">${r.dateTime? toFIfromISO(r.dateTime): "Set date & time in Settings"}</div>
        </div>
        <span class="right pill" style="background:#ff7a00;color:#111;border-radius:20px;padding:2px 10px">Countdown</span>
      </div>
      <div class="row" style="gap:10px;margin-top:10px">
        <div class="stat"><div class="label">Days</div><div class="value" style="color:#ff7a00">${countdown.d}</div></div>
        <div class="stat"><div class="label">Hours</div><div class="value" style="color:#ff7a00">${countdown.h}</div></div>
        <div class="stat"><div class="label">Min</div><div class="value" style="color:#ff7a00">${countdown.m}</div></div>
      </div>
    </section>

    <section class="grid3">
      <div class="stat card"><div class="label">Target Distance</div><div class="value">${(r.targetKm||0).toFixed(2)} km</div></div>
      <div class="stat card"><div class="label">Target Time</div><div class="value">${secToHMS(r.targetTimeSec)}</div></div>
      <div class="stat card"><div class="label">Target Pace</div><div class="value">${paceFmt(r.targetPaceSecPerKm)}/km</div></div>
    </section>

    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div class="value">Selected Week</div>
        <div class="row" style="gap:6px">
          <button class="btn" id="wkPrev">◀</button>
          <input id="weekRef" type="date" value="${state.ui.weekRef}">
          <button class="btn" id="wkNext">▶</button>
        </div>
      </div>
      <div class="row" style="gap:10px;margin-top:10px">
        <div class="stat"><div class="label">Distance</div><div class="value">${weekly.km.toFixed(2)} km</div></div>
        <div class="stat"><div class="label">Time</div><div class="value">${secToHMS(weekly.sec)}</div></div>
        <div class="stat"><div class="label">Runs</div><div class="value">${weekly.count}</div></div>
      </div>
      <div class="progress" style="margin-top:10px"><div style="background:#ff7a00;width:${Math.min(100, weekly.km/state.user.weeklyGoalKm*100||0)}%"></div></div>
    </section>

    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div class="value">Personal Records</div>
        <div class="row" style="gap:8px">
          <button class="btn" id="editRecsBtn">Edit</button>
          <button class="btn" id="recalcRecsBtn">Recalc from logs</button>
        </div>
      </div>
      <div id="recordsBlock">${renderRecordsList(false)}</div>
    </section>
  `;

  document.getElementById("weekRef").onchange = e => { state.ui.weekRef=e.target.value; save(); render(); };
  document.getElementById("wkPrev").onclick = ()=> shiftWeek(-1);
  document.getElementById("wkNext").onclick = ()=> shiftWeek(1);

  document.getElementById("editRecsBtn").onclick = ()=>{
    const wrap = document.getElementById("recordsBlock");
    wrap.innerHTML = renderRecordsList(true);
    // autosave on edit
    wrap.querySelectorAll("input.rec-time").forEach(inp=>{
      inp.addEventListener("change", ()=>{
        const idx = parseInt(inp.getAttribute("data-recid"),10);
        const sec = hmsToSec(inp.value.trim());
        state.user.records[idx].timeSec = Number.isFinite(sec)? sec : null;
        save(); renderOverview();
      });
    });
  };
  document.getElementById("recalcRecsBtn").onclick = ()=>{ recalcRecordsFromLogs(); renderOverview(); };
}
function shiftWeek(n){
  const d = new Date(state.ui.weekRef);
  d.setDate(d.getDate()+n*7);
  state.ui.weekRef = toISODate(d);
  save(); render();
}

// =============== CALENDAR (Month + swipe weeks + Complete button) ===============
let touchStartX = null;
function renderCalendar(){
  const y = state.ui.calYear;
  const m = state.ui.calMonth;
  const first = new Date(y, m, 1);
  const startDay = first.getDay()===0 ? 6 : first.getDay()-1;
  const daysInMonth = new Date(y, m+1, 0).getDate();

  const cells = [];
  for(let i=0;i<startDay;i++) cells.push("");
  for(let d=1; d<=daysInMonth; d++) cells.push(String(d));

  const plannedDates = {};
  state.plan.forEach(p => plannedDates[p.date]=true);
  const runsByDate = {};
  state.runs.forEach(r => { const dd = r.dateTime.slice(0,10); runsByDate[dd]=(runsByDate[dd]||0)+1; });

  const monthName = new Date(y, m, 1).toLocaleString(undefined, { month:"long", year:"numeric" });

  const gridHtml = cells.map(c => {
    if(!c) return `<div class="day"></div>`;
    const dateStr = `${y}-${pad(m+1)}-${pad(c)}`;
    const hasPlan = !!plannedDates[dateStr];
    const hasRun = !!runsByDate[dateStr];
    return `
      <div class="day" data-date="${dateStr}">
        <div class="num">${c}</div>
        ${hasPlan?'<div class="dot" title="Planned" style="background:#ff7a00"></div>':''}
        ${hasRun?'<div class="dot" style="background:#22c55e" title="Completed"></div>':''}
      </div>`;
  }).join("");

  view.innerHTML = `
    <section class="card" id="calCard">
      <div class="row" style="justify-content:space-between;align-items:center">
        <button class="btn" id="prevMonth">◀</button>
        <div class="value" style="color:#ff7a00">${monthName}</div>
        <button class="btn" id="nextMonth">▶</button>
      </div>
      <div class="calendar" style="margin-top:10px" id="calGrid">
        ${gridHtml}
      </div>
      <div class="small" style="margin-top:8px">Swipe month (top). Swipe week block (below) to change week.</div>
    </section>

    <section class="card" id="weekBlock">
      <div class="row" style="justify-content:space-between">
        <div class="value">Week Viewer</div>
        <div class="row" style="gap:6px">
          <button class="btn" id="wkPrev2">◀</button>
          <input id="weekRef2" type="date" value="${state.ui.weekRef}">
          <button class="btn" id="wkNext2">▶</button>
        </div>
      </div>
      <table class="table" style="margin-top:8px">
        <thead><tr>
          <th style="color:#ff7a00">Day</th>
          <th style="color:#ff7a00">Planned</th>
          <th style="color:#ff7a00">Done</th>
          <th></th>
        </tr></thead>
        <tbody id="weekRows"></tbody>
      </table>
      <div class="small">Tip: Tap <span style="color:#ff7a00">Complete</span> once to log time; tap green button to edit/uncomplete.</div>
    </section>`;

  document.getElementById("prevMonth").onclick = ()=> shiftMonth(-1);
  document.getElementById("nextMonth").onclick = ()=> shiftMonth(1);
  document.querySelectorAll(".day[data-date]").forEach(el => { el.onclick = ()=> openDayDetails(el.dataset.date); });

  const grid = document.getElementById("calGrid");
  grid.addEventListener("touchstart", e=>{ touchStartX = e.changedTouches[0].clientX; }, {passive:true});
  grid.addEventListener("touchend", e=>{
    if(touchStartX==null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if(Math.abs(dx)>50){ shiftMonth(dx<0?1:-1); }
    touchStartX = null;
  }, {passive:true});

  // Week block swipe
  const weekBlock = document.getElementById("weekBlock");
  let wkStartX = null;
  weekBlock.addEventListener("touchstart", e=>{ wkStartX = e.changedTouches[0].clientX; }, {passive:true});
  weekBlock.addEventListener("touchend", e=>{
    if(wkStartX==null) return;
    const dx = e.changedTouches[0].clientX - wkStartX;
    if(Math.abs(dx)>50){ shiftWeek2(dx<0?1:-1); }
    wkStartX = null;
  }, {passive:true});

  document.getElementById("wkPrev2").onclick = ()=> shiftWeek2(-1);
  document.getElementById("wkNext2").onclick = ()=> shiftWeek2(1);
  document.getElementById("weekRef2").onchange = e => { state.ui.weekRef=e.target.value; save(); renderCalendar(); };
  fillWeekTable("weekRows", new Date(state.ui.weekRef));
}
function shiftMonth(n){
  let y = state.ui.calYear, m = state.ui.calMonth + n;
  while(m<0){ m+=12; y--; } while(m>11){ m-=12; y++; }
  state.ui.calYear = y; state.ui.calMonth = m; save(); renderCalendar();
}
function shiftWeek2(n){
  const d = new Date(state.ui.weekRef); d.setDate(d.getDate()+n*7); state.ui.weekRef = toISODate(d); save(); renderCalendar();
}
function getWeekRange(date){
  const d = new Date(date);
  const day = (d.getDay()+6)%7;
  const start = new Date(d); start.setDate(d.getDate()-day); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
  return {start, end};
}
function fillWeekTable(tbodyId, date){
  const week = getWeekRange(date);
  const rows = [];
  for(let d=0; d<7; d++){
    const dt = new Date(week.start.getTime() + d*86400000);
    const dsISO = toISODate(dt);
    const dsFI  = toFIfromDate(dt);
    const plan = state.plan.find(p => p.date===dsISO);
    const run  = state.runs.find(r => r.dateTime.slice(0,10)===dsISO);

    const plannedTxt = plan? `${plan.type||"run"} • ${plan.plannedKm||""} km` : '<span class="small">—</span>';
    const doneTxt    = run? `${run.actualKm.toFixed(2)} km • ${secToHMS(run.actualTimeSec)}` : '<span class="small">—</span>';

    const isDone = !!run;
    const btnStyle = isDone
      ? "background:#22c55e;border-color:#22c55e;color:#111"
      : "background:transparent;border-color:#ff7a00;color:#ff7a00";
    const btnText = isDone ? "Completed ✓" : "Complete";

    rows.push(`<tr>
      <td style="width:24%">${dt.toLocaleDateString('fi-FI',{weekday:"short"})} <div class="small">${dsFI}</div></td>
      <td style="width:36%">${plannedTxt}</td>
      <td style="width:30%">${doneTxt}</td>
      <td style="width:10%">
        ${plan ? `<button class="btn" data-complete="${dsISO}" style="${btnStyle}">${btnText}</button>` : `<button class="btn" onclick="openDayDetails('${dsISO}')">Open</button>`}
      </td>
    </tr>`);
  }
  document.getElementById(tbodyId).innerHTML = rows.join("");

  // bind Complete toggles
  document.querySelectorAll("button[data-complete]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const ds = btn.getAttribute("data-complete");
      toggleCompleteForDate(ds, btn);
    });
  });
}

function toggleCompleteForDate(dsISO, buttonEl){
  const plan = state.plan.find(p=>p.date===dsISO);
  const existing = state.runs.find(r=> r.dateTime.slice(0,10)===dsISO);
  if(!plan){ openDayDetails(dsISO); return; }

  if(!existing){
    // Mark complete: ask for time
    const t = prompt(`Mark ${plan.type} ${plan.plannedKm} km as completed.\nEnter time (hh:mm:ss):`, "00:45:00");
    const sec = hmsToSec(t||"");
    if(!sec){ return; }
    const run = {
      id: "run_"+Date.now(),
      dateTime: dsISO+"T12:00:00",
      actualKm: plan.plannedKm||0,
      actualTimeSec: sec,
      notes: "completed from planned"
    };
    state.runs.push(run);
    // update UI styles
    buttonEl.textContent = "Completed ✓";
    buttonEl.style.background = "#22c55e";
    buttonEl.style.borderColor = "#22c55e";
    buttonEl.style.color = "#111";
    save();
    renderCalendar();
  } else {
    // Already completed: allow edit time or uncomplete
    const action = confirm("Edit time? Press OK.\nCancel to uncomplete.");
    if(action){
      const newT = prompt("Enter new time (hh:mm:ss):", secToHMS(existing.actualTimeSec));
      const sec = hmsToSec(newT||"");
      if(!sec){ return; }
      existing.actualTimeSec = sec;
      save();
      renderCalendar();
    }else{
      state.runs = state.runs.filter(r=> r.id !== existing.id);
      save();
      renderCalendar();
    }
  }
}

// =============== STATS =================
function getWeekStats(date){
  const we = getWeekRange(date);
  let km=0, sec=0, count=0;
  for(const r of state.runs){
    const t = new Date(r.dateTime).getTime();
    if(t>=we.start.getTime() && t<=we.end.getTime()){
      km += r.actualKm||0;
      sec += r.actualTimeSec||0;
      count++;
    }
  }
  return {km, sec, count};
}
function getLifetimeStats(){
  let km=0, sec=0;
  for(const r of state.runs){ km+=r.actualKm||0; sec+=r.actualTimeSec||0; }
  return {km, sec, count: state.runs.length};
}

// =============== PLAN VIEW =================
function renderPlan(){
  const byWeek = {};
  for(const p of state.plan){
    const ws = getWeekRange(new Date(p.date)).start.toISOString().slice(0,10);
    (byWeek[ws] = byWeek[ws] || []).push(p);
  }
  const weeks = Object.keys(byWeek).sort();
  let html = `<section class="card"><div class="value">Plan</div><div class="small">Tap a day to edit or log.</div></section>`;
  view.innerHTML = html;

  for(const ws of weeks){
    const items = byWeek[ws].slice().sort((a,b)=>a.date.localeCompare(b.date));
    const rows = items.map(x => `
      <tr>
        <td style="width:26%">${toFIfromISO(x.date)}</td>
        <td style="width:37%">${x.type||'run'}</td>
        <td style="width:27%">${x.plannedKm==null?'—':(x.plannedKm+' km')}</td>
        <td style="width:10%"><button class="btn" onclick="openPlanEditor('${x.date}')">Edit</button></td>
      </tr>
    `).join("");
    const block = `
      <section class="card">
        <div class="value" style="color:#ff7a00">Week of ${toFIfromISO(ws)}</div>
        <table class="table" style="margin-top:8px"><tbody>${rows}</tbody></table>
      </section>`;
    view.insertAdjacentHTML('beforeend', block);
  }
  if(weeks.length===0){
    view.insertAdjacentHTML('beforeend','<section class="card"><div class="small">No planned workouts. Try Coach → Generate Plan.</div></section>');
  }
}

// =============== DAY MODALS =================
function openDayDetails(dateStr){
  const plan = state.plan.find(p => p.date===dateStr);
  const run = state.runs.find(r => r.dateTime.slice(0,10)===dateStr);
  const isDone = !!run;
  const btnStyle = isDone
    ? "background:#22c55e;border-color:#22c55e;color:#111"
    : "background:transparent;border-color:#ff7a00;color:#ff7a00";
  const btnText = isDone ? "Completed ✓" : "Complete";

  const html = `
  <div class="card" style="position:fixed;inset:0 0 auto 0; margin:10px; z-index:9999">
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="value">${new Date(dateStr).toLocaleDateString('fi-FI', { weekday:"long", day:"numeric", month:"short", year:"numeric"})}</div>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
    <div class="grid2" style="margin-top:10px">
      <div class="stat"><div class="label">Planned</div><div>${plan? (plan.type||"run")+" • "+(plan.plannedKm||"")+" km" : "—"}</div></div>
      <div class="stat"><div class="label">Completed</div><div>${run? (run.actualKm.toFixed(2)+" km • "+secToHMS(run.actualTimeSec)):"—"}</div></div>
    </div>
    <div class="row" style="margin-top:10px;gap:10px">
      ${plan ? `<button class="btn" id="toggleCompleteBtn" style="${btnStyle}">${btnText}</button>` : ""}
      <button class="btn" onclick="openPlanEditor('${dateStr}')">Edit Plan</button>
      <button class="btn primary" onclick="openLogRunModal('${dateStr}')">Log Run</button>
      ${run? `<button class="btn" onclick="deleteRun('${run.id}')">Delete Run</button>`:""}
    </div>
  </div>`;
  showModal(html);

  const tBtn = document.getElementById("toggleCompleteBtn");
  if (tBtn) {
    tBtn.onclick = ()=> toggleCompleteForDate(dateStr, tBtn);
  }
}
function deleteRun(id){ state.runs = state.runs.filter(r => r.id!==id); save(); closeModal(); render(); }

function openPlanEditor(dateStr){
  const plan = state.plan.find(p => p.date===dateStr) || { date:dateStr||new Date().toISOString().slice(0,10), type:"easy", plannedKm: null, notes:"" };
  const idx = state.plan.findIndex(p => p.date===plan.date);
  const isNew = idx===-1;
  const html = `
  <div class="card" style="position:fixed;inset:auto 0 0 0; margin:10px; z-index:9999">
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="value">${isNew? "Add Workout":"Edit Workout"}</div>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
    <div class="grid2" style="margin-top:10px">
      <div><div class="label">Date</div><input id="plDate" type="date" value="${plan.date}"></div>
      <div><div class="label">Type</div>
        <select id="plType">
          ${["easy","long","tempo","interval","recovery"].map(t=>`<option ${t===plan.type?'selected':''}>${t}</option>`).join("")}
        </select>
      </div>
      <div><div class="label">Planned km</div>
        <input id="plKm" type="number" min="0" step="0.1" value="${plan.plannedKm==null?'':plan.plannedKm}" readonly style="cursor:pointer">
      </div>
      <div style="grid-column:1/-1"><div class="label">Notes</div><textarea id="plNotes" rows="3">${plan.notes||""}</textarea></div>
    </div>
    <div class="row" style="margin-top:10px;gap:10px">
      ${!isNew? '<button class="btn" id="plDeleteBtn">Delete</button>':""}
    </div>
  </div>`;
  showModal(html);

  // input opens picker (no separate Pick button)
  document.getElementById("plKm").addEventListener("click", ()=> openKmPicker('plKm'));

  // instant save on changes
  const commit = ()=>{
    const date = document.getElementById("plDate").value;
    const type = document.getElementById("plType").value;
    const plannedKm = parseFloat(document.getElementById("plKm").value||"0")||null;
    const notes = document.getElementById("plNotes").value;

    if(date!==plan.date && !isNew){ state.plan = state.plan.filter(p=>p.date!==plan.date); }
    const ix = state.plan.findIndex(p=>p.date===date);
    const item = { id:'pl_'+date, date, type, plannedKm, plannedTimeSec:null, notes };
    if(ix>=0) state.plan[ix]=item; else state.plan.push(item);
    state.plan.sort((a,b)=> a.date.localeCompare(b.date));
    save();
  };

  document.getElementById("plDate").addEventListener("change", ()=>{ commit(); render(); });
  document.getElementById("plType").addEventListener("change", ()=>{ commit(); render(); });
  document.getElementById("plKm").addEventListener("input", ()=>{ commit(); render(); });
  document.getElementById("plNotes").addEventListener("input", ()=>{ commit(); });

  if(!isNew){
    document.getElementById("plDeleteBtn").onclick = ()=>{ state.plan = state.plan.filter(p=>p.date!==plan.date); save(); closeModal(); render(); };
  }
}

function openLogRunModal(dateStr){
  const defaultDate = dateStr || toISODate(new Date());
  const html = `
  <div class="card" style="position:fixed;inset:auto 0 0 0; margin:10px; z-index:9999">
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="value">Log Run</div>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
    <div class="grid2" style="margin-top:10px">
      <div><div class="label">Date</div><input id="runDate" type="date" value="${defaultDate}"></div>
      <div><div class="label">Time (hh:mm:ss)</div><input id="runTime" type="text" placeholder="00:45:00"></div>
      <div><div class="label">Distance (km)</div>
        <input id="runKm" type="number" step="0.01" min="0" readonly style="cursor:pointer">
      </div>
      <div class="stat"><div class="label">Avg Pace</div><div id="runPace" class="value">—</div></div>
      <div style="grid-column:1/-1"><div class="label">Notes</div><textarea id="runNotes" rows="3"></textarea></div>
    </div>
    <div class="row" style="margin-top:10px;gap:10px">
      <button class="btn primary" id="runSaveBtn">Save</button>
    </div>
  </div>`;
  showModal(html);

  document.getElementById("runKm").addEventListener("click", ()=> openKmPicker('runKm'));

  const kmEl = document.getElementById("runKm");
  const tEl = document.getElementById("runTime");
  function updatePace(){
    const km = parseFloat(kmEl.value||"0");
    const sec = hmsToSec(tEl.value);
    const pace = km>0 && sec? Math.round(sec/km) : null;
    document.getElementById("runPace").textContent = pace? (Math.floor(pace/60)+":"+String(pace%60).padStart(2,"0")+"/km") : "—";
  }
  kmEl.addEventListener("input", updatePace);
  tEl.addEventListener("input", updatePace);

  document.getElementById("runSaveBtn").onclick = ()=>{
    const date = document.getElementById("runDate").value;
    const timeTxt = document.getElementById("runTime").value;
    const km = parseFloat(document.getElementById("runKm").value||"0");
    const notes = document.getElementById("runNotes").value;
    const sec = hmsToSec(timeTxt);
    if(!date || !sec || !km){ alert("Please fill date, time, and distance."); return; }
    const id = "run_"+Date.now();
    const dateTime = date+"T12:00:00";
    state.runs.push({ id, dateTime, actualKm: km, actualTimeSec: sec, notes });
    if(!state.user.longestRunEverKm || km > state.user.longestRunEverKm){
      state.user.longestRunEverKm = km;
    }
    save(); closeModal(); render();
  };
}

// =============== SETTINGS (ALL COLLAPSIBLE; AI LAST; AUTOSAVE) ===============
function renderSettings(){
  const r = state.user.race;
  const zones = computeZones(state.user.maxHr);
  const open = state.ui.sectionsOpen;

  const section = (key, title, bodyHtml) => `
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;cursor:pointer" data-toggle="${key}">
        <div class="value">${title}</div>
        <button class="btn" title="Show/Hide">${open[key] ? "▾" : "▸"}</button>
      </div>
      <div id="${key}Body" style="${open[key] ? "" : "display:none"};margin-top:10px">${bodyHtml}</div>
    </section>
  `;

  const raceBody = `
    <div class="grid2">
      <div><div class="label">Race name</div><input id="raceName" value="${r.name||""}"></div>
      <div><div class="label">Start date & time</div><input id="raceDT" type="datetime-local" value="${r.dateTime? r.dateTime.slice(0,16): ""}"></div>
      <div><div class="label">Target distance (km)</div>
        <input id="raceKm" type="number" step="0.1" min="0" value="${r.targetKm==null?'':r.targetKm}" readonly style="cursor:pointer">
      </div>
      <div><div class="label">Target time (hh:mm:ss)</div><input id="raceTime" type="text" value="${secToHMS(r.targetTimeSec)}" placeholder="03:45:00"></div>
      <div><div class="label">Target pace (min/km)</div><input id="racePace" type="text" value="${paceFmt(r.targetPaceSecPerKm)}" placeholder="5:20"></div>
    </div>
    <div class="row" style="margin-top:10px;gap:10px">
      <button class="btn" id="btnRecalc">Recalculate missing</button>
    </div>
  `;

  const heartBody = `
    <div class="grid2">
      <div><div class="label">Max HR (bpm)</div><input id="maxHr" type="number" min="60" max="230" value="${state.user.maxHr==null?'':state.user.maxHr}"></div>
      <div class="stat"><div class="label">Zones</div><div class="small">${zones? zones.map(z=>`${z.label}: ${z.low}–${z.high} bpm`).join("<br>"):"—"}</div></div>
      <div>
        <div class="label">Runs per week (1–7)</div>
        <input id="rpw" type="range" min="1" max="7" step="1" value="${state.user.runsPerWeek||4}">
        <div class="small">Selected: <span id="rpwVal">${state.user.runsPerWeek||4}</span></div>
      </div>
      <div>
        <div class="label">Taper weeks</div>
        <input id="taper" type="range" min="1" max="4" step="1" value="${state.user.taperWeeks||2}">
        <div class="small">Selected: <span id="taperVal">${state.user.taperWeeks||2}</span></div>
      </div>
      <div>
        <div class="label">Longest run ever (km)</div>
        <input id="longestRunEver" type="number" min="0" step="0.1" value="${state.user.longestRunEverKm==null?'':state.user.longestRunEverKm}">
      </div>
    </div>
  `;

  const goalsBody = `
    <div class="grid2">
      <div>
        <div class="label">Weekly goal km</div>
        <input id="weeklyGoal" type="number" step="1" min="0" value="${state.user.weeklyGoalKm||60}" readonly style="cursor:pointer">
      </div>
      <div class="stat"><div class="label">Lifetime totals</div><div class="value">${getLifetimeStats().km.toFixed(1)} km • ${secToHMS(getLifetimeStats().sec)}</div></div>
    </div>
    <div class="row" style="margin-top:10px;gap:10px">
      <button class="btn" id="btnExport">Export JSON</button>
      <button class="btn" id="btnImport">Import JSON</button>
    </div>
  `;

  const aiBody = `
    <div class="grid2">
      <div>
        <div class="label">Google API Key</div>
        <input id="googleApiKey" type="password" placeholder="AI... (AI Studio key)" value="${state.user.googleApiKey? "********":""}">
      </div>
      <div>
        <div class="label">Selected Model (ID)</div>
        <input id="googleModel" placeholder="gemini-2.5-flash" value="${state.user.googleModel||""}">
      </div>
      <div class="row" style="gap:8px">
        <button class="btn" id="fetchModels">Fetch Gemini Models</button>
        <button class="btn" id="testGemini">Test Gemini</button>
      </div>
      <div>
        <div class="label">Available Models (generate-capable)</div>
        <select id="modelsSelect" size="6" style="width:100%"></select>
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn" id="useSelectedModel">Use selected</button>
        </div>
      </div>
    </div>
  `;

  // NOTE: AI section is last
  view.innerHTML = `
    ${section("race",  "Race & Targets", raceBody)}
    ${section("heart", "Heart Rate & Training Preferences", heartBody)}
    ${section("goals", "Goals & Data", goalsBody)}
    ${section("ai",    "AI Settings (Google Gemini)", aiBody)}
  `;

  // toggle handlers
  document.querySelectorAll('[data-toggle]').forEach(h=>{
    h.addEventListener('click', (e)=>{
      const key = h.getAttribute('data-toggle');
      if(!key) return;
      // prevent toggling when clicking inside inputs
      if(e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName==="BUTTON")) return;
      state.ui.sectionsOpen[key] = !state.ui.sectionsOpen[key];
      save(); renderSettings();
    });
  });

  // ----- AUTOSAVE BINDINGS -----
  // Race section
  const nameEl = document.getElementById("raceName");
  const dtEl   = document.getElementById("raceDT");
  const kmEl   = document.getElementById("raceKm");
  const ttEl   = document.getElementById("raceTime");
  const paceEl = document.getElementById("racePace");

  if (kmEl) kmEl.addEventListener("click", ()=> openKmPicker('raceKm'));
  if (nameEl) nameEl.addEventListener("input", ()=>{ state.user.race.name = nameEl.value.trim(); save(); });
  if (dtEl) dtEl.addEventListener("change", ()=>{ state.user.race.dateTime = dtEl.value? new Date(dtEl.value).toISOString(): null; save(); });
  if (kmEl) kmEl.addEventListener("input", ()=>{ const v=parseFloat(kmEl.value||""); state.user.race.targetKm = Number.isFinite(v)? v:null; computeMissingTarget(); save(); });
  if (ttEl) ttEl.addEventListener("input", ()=>{ state.user.race.targetTimeSec = hmsToSec(ttEl.value); computeMissingTarget(); save(); });
  if (paceEl) paceEl.addEventListener("input", ()=>{ const pp = hmsToSec("0:"+paceEl.value); state.user.race.targetPaceSecPerKm = Number.isFinite(pp)? pp:null; computeMissingTarget(); save(); });

  const recalcBtn = document.getElementById("btnRecalc");
  if (recalcBtn) recalcBtn.onclick = ()=>{ computeMissingTarget(); save(); renderSettings(); };

  // Heart section
  const maxHrEl = document.getElementById("maxHr");
  const rpwEl   = document.getElementById("rpw");
  const taperEl = document.getElementById("taper");
  const lreEl   = document.getElementById("longestRunEver");

  if (maxHrEl) maxHrEl.addEventListener("input", ()=>{ state.user.maxHr = parseInt(maxHrEl.value||"",10)||null; save(); renderSettings(); });
  if (rpwEl) {
    rpwEl.addEventListener("input", ()=>{ state.user.runsPerWeek = parseInt(rpwEl.value,10)||4; document.getElementById("rpwVal").textContent=state.user.runsPerWeek; save(); });
    rpwEl.addEventListener("change", ()=> save());
  }
  if (taperEl) {
    taperEl.addEventListener("input", ()=>{ state.user.taperWeeks = parseInt(taperEl.value,10)||2; document.getElementById("taperVal").textContent=state.user.taperWeeks; save(); });
    taperEl.addEventListener("change", ()=> save());
  }
  if (lreEl) lreEl.addEventListener("input", ()=>{ const v=parseFloat(lreEl.value||""); state.user.longestRunEverKm = Number.isFinite(v)? v:null; save(); });

  // Goals
  const weeklyGoalEl = document.getElementById("weeklyGoal");
  if (weeklyGoalEl){
    weeklyGoalEl.addEventListener("click", ()=> openKmPicker("weeklyGoal", {maxInt: 300}));
    weeklyGoalEl.addEventListener("input", ()=>{ const v=parseFloat(weeklyGoalEl.value||""); state.user.weeklyGoalKm = Number.isFinite(v)? v: state.user.weeklyGoalKm; save(); });
  }
  const exportBtn = document.getElementById("btnExport");
  const importBtn = document.getElementById("btnImport");
  if (exportBtn) exportBtn.onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="marathon-data.json"; a.click();
    URL.revokeObjectURL(url);
  };
  if (importBtn) importBtn.onclick = ()=>{
    const inp = document.createElement("input"); inp.type="file"; inp.accept="application/json";
    inp.onchange = e=>{
      const file = e.target.files[0];
      const fr = new FileReader();
      fr.onload = ()=>{
        try{ const s = JSON.parse(fr.result); localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); location.reload(); }catch(err){ alert("Invalid JSON: "+err.message); }
      };
      fr.readAsText(file);
    };
    inp.click();
  };

  // AI (bottom)
  const gKey = document.getElementById("googleApiKey");
  const gModel = document.getElementById("googleModel");
  if (gKey) gKey.addEventListener("change", ()=>{ const raw=gKey.value||""; if(raw.trim()) state.user.googleApiKey = raw.trim(); save(); gKey.value="********"; });
  if (gModel) gModel.addEventListener("change", ()=>{ state.user.googleModel = normalizeGeminiModel(gModel.value||""); save(); });

  const fetchBtn = document.getElementById("fetchModels");
  const testBtn  = document.getElementById("testGemini");
  const useBtn   = document.getElementById("useSelectedModel");
  if (fetchBtn) fetchBtn.onclick = async ()=>{
    const key = (state.user.googleApiKey||"").trim();
    if(!key){ alert("Save your Google API key first."); return; }
    try {
      const models = await listGeminiModels(key);
      state.ui.geminiModels = models;
      populateModelsDropdown(models);
      save();
      alert("Fetched "+models.length+" models.");
    } catch(e) {
      alert("Fetch models failed:\n"+e.message);
    }
  };
  if (testBtn) testBtn.onclick = async ()=>{
    const key = (state.user.googleApiKey||"").trim();
    if(!key){ alert("Save your Google API key first."); return; }
    const model = normalizeGeminiModel(state.user.googleModel || "gemini-2.5-flash");
    try {
      const reply = await geminiReply({ key, model, prompt: "Reply with: OK ✅" });
      alert("Gemini test reply: " + reply);
    } catch(e) {
      alert("Gemini test failed:\n" + e.message);
    }
  };
  if (useBtn) useBtn.onclick = ()=>{
    const sel = document.getElementById("modelsSelect");
    if(!sel || !sel.value){ alert("Fetch models and pick one first."); return; }
    state.user.googleModel = normalizeGeminiModel(sel.value);
    if (gModel) gModel.value = state.user.googleModel;
    save(); alert("Model set to: " + state.user.googleModel);
  };
  if (state.ui.geminiModels && state.ui.geminiModels.length) populateModelsDropdown(state.ui.geminiModels);
}

function populateModelsDropdown(models){
  const sel = document.getElementById("modelsSelect");
  if(!sel) return;
  const opts = models
    .filter(m => m.supportsGenerate)
    .map(m=>{
      const id = stripModelsPrefix(m.name || "");
      const label = (m.displayName || id);
      const selected = stripModelsPrefix(state.user.googleModel||"") === id ? " selected" : "";
      return `<option value="${id}"${selected}>${label}</option>`;
    }).join("");
  sel.innerHTML = opts || `<option disabled>(No generate-capable models)</option>`;
}

// =============== COACH (unchanged UI + Show last raw) ===============
let coachMessages = [];
let lastCoachText = "";
let lastGeneratedPlan = [];

function renderCoach(){
  const weeksToRace = weeksUntilRace();
  view.innerHTML = `
  <section class="card">
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="value">Coach</div>
      <div class="small">Weeks to race: ${weeksToRace==null?'—':weeksToRace} • RPW: ${state.user.runsPerWeek} • Taper: ${state.user.taperWeeks}w</div>
    </div>
    <div id="chat" style="margin-top:10px;display:flex;flex-direction:column;gap:8px;max-height:40vh;overflow:auto"></div>
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
      <input id="coachInput" placeholder="Ask the coach... e.g., build me a plan">
      <button class="btn" id="coachSend">Send</button>
      <button class="btn primary" id="coachGen">Generate Plan</button>
      <button class="btn" id="applyPlan">Apply last plan</button>
      <button class="btn" id="parseLast">Parse last reply → Plan</button>
      <button class="btn" id="showRaw" style="color:#ff7a00;border-color:#ff7a00">Show last raw</button>
    </div>
  </section>
  <section class="card">
    <div id="lastPlan" class="small" style="margin-top:8px;color:#fff"></div>
  </section>`;

  updateChatUI();
  document.getElementById("coachSend").onclick = handleCoachSend;
  document.getElementById("coachGen").onclick = generatePlanFromState;
  document.getElementById("applyPlan").onclick = applyLastPlanToCalendar;
  document.getElementById("parseLast").onclick = parseLastCoachToPlan;
  document.getElementById("showRaw").onclick = ()=>{
    if(!lastCoachText){ alert("No coach reply yet."); return; }
    const box = document.getElementById("lastPlan");
    box.innerText = lastCoachText;
  };
}
function updateChatUI(){
  const el = document.getElementById("chat"); if(!el) return;
  el.innerHTML = coachMessages.map(m => `
    <div style="align-self:${m.role==='user'?'flex-end':'flex-start'};max-width:90%">
      <div class="small" style="opacity:.7">${m.role==='user'?'You':'Coach'}</div>
      <div class="stat" style="background:rgba(255,122,0,.10);border:1px solid rgba(255,122,0,.25)">${m.content}</div>
    </div>`).join("");
  el.scrollTop = el.scrollHeight;
}
async function handleCoachSend(){
  const input = document.getElementById("coachInput");
  const text = (input.value||"").trim(); if(!text) return;
  coachMessages.push({role:"user", content: text}); updateChatUI(); input.value = "";
  const reply = await coachReply(text); lastCoachText = reply; coachMessages.push({role:"assistant", content: reply}); updateChatUI();
}

function localAdvice(text){
  const weeks = weeksUntilRace() || 12;
  return `I'll build a progressive plan for ${weeks} weeks, ${state.user.runsPerWeek} runs/week with a ${state.user.taperWeeks}-week taper. Tap "Generate Plan".`;
}

// ---- Gemini REST helpers ----
async function listGeminiModels(key){
  const url = "https://generativelanguage.googleapis.com/v1beta/models";
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-goog-api-key": key.trim() },
    mode: "cors",
    credentials: "omit"
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} listing models: ${raw.slice(0,300)}`);
  let data; try { data = JSON.parse(raw); } catch { throw new Error("Non-JSON from models.list"); }
  const models = (data.models||[]).map(m => ({
    name: m.name,
    displayName: m.displayName || m.name,
    supportsGenerate: Array.isArray(m.supportedActions) ? m.supportedActions.includes("generateContent") : true
  }));
  return models;
}
function extractGeminiText(data){
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const txt = parts.map(p => p?.text || "").filter(Boolean).join("\n").trim();
  if (txt) return txt;

  const finish = cand?.finishReason || cand?.finish_reason;
  const safety = cand?.safetyRatings || cand?.safety || data?.promptFeedback?.safetyRatings;
  const block = data?.promptFeedback?.blockReason || data?.promptFeedback?.block_reason;

  let why = [];
  if (finish) why.push(`finishReason=${finish}`);
  if (block) why.push(`blockReason=${block}`);
  if (Array.isArray(safety) && safety.length) {
    const hit = safety.map(s => `${s.category}:${s.probability || s.threshold || "n/a"}`).join(",");
    why.push(`safety=[${hit}]`);
  }
  if (why.length) throw new Error("Empty text (diagnostics: " + why.join("; ") + ")");
  return "";
}
async function geminiReply({ key, model, prompt }) {
  const desired = normalizeGeminiModel(model || "gemini-2.5-flash");
  const url = "https://generativelanguage.googleapis.com/v1beta/models/"
            + encodeURIComponent(desired)
            + ":generateContent";

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 2200 }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "x-goog-api-key": key.trim()
    },
    body: JSON.stringify(body),
    mode: "cors",
    credentials: "omit",
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}\nURL: ${url}\nRAW: ${raw.slice(0,300)}`);
  }

  let data; try { data = JSON.parse(raw); } catch(e){ throw new Error("Non-JSON response\nURL: "+url+"\nRAW: "+raw.slice(0,200)); }
  const text = extractGeminiText(data);
  if (!text) throw new Error("Empty response from Gemini.");
  return text;
}

// ---- Robust JSON salvage ----
function tryRepairJSON(src){
  if(!src) return null;
  let s = String(src).replace(/```json/i,"").replace(/```/g,"").trim();
  const firstBrace = s.indexOf("{");
  if (firstBrace > 0) s = s.slice(firstBrace);
  s = s.replace(/,(\s*[\]}])/g, "$1");

  const keyIdx = s.search(/"workouts"\s*:/);
  if (keyIdx === -1) return s;
  const arrStart = s.indexOf("[", keyIdx);
  if (arrStart === -1) return s;

  let i = arrStart + 1;
  let depthArr = 1;
  let depthObj = 0;
  let inStr = false;
  let esc = false;
  let lastGoodPos = -1;

  while (i < s.length) {
    const ch = s[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      i++; continue;
    }

    if (ch === "\"") { inStr = true; i++; continue; }
    if (ch === "[")  { depthArr++; i++; continue; }
    if (ch === "]")  { depthArr--; i++; if (depthArr === 0) { lastGoodPos = i; break; } continue; }
    if (ch === "{")  { depthObj++; i++; continue; }
    if (ch === "}")  {
      depthObj--; i++;
      if (depthArr === 1 && depthObj === 0) {
        let j = i;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === ",") j++;
        lastGoodPos = j;
      }
      continue;
    }
    i++;
  }

  if (lastGoodPos > -1) {
    const head = s.slice(0, arrStart + 1);
    const body = s.slice(arrStart + 1, lastGoodPos).replace(/,(\s*$)/, "");
    const repaired = head + body + "] }";
    return repaired;
  }

  const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastBrace > -1) s = s.slice(0, lastBrace + 1);
  const openCurly  = (s.match(/{/g) || []).length;
  const closeCurly = (s.match(/}/g) || []).length;
  const openBrack  = (s.match(/\[/g) || []).length;
  const closeBrack = (s.match(/]/g) || []).length;
  if (openBrack > closeBrack)  s += "]".repeat(openBrack - closeBrack);
  if (openCurly > closeCurly)  s += "}".repeat(openCurly - closeCurly);
  return s;
}
function parseFencedJSON(text) {
  if (!text) return null;

  let m = text.match(/```json\s*([\s\S]*?)```/i);
  if (m && m[1]) {
    try { return JSON.parse(m[1]); } catch(e) {
      const repaired = tryRepairJSON(m[1]);
      if (repaired) { try { return JSON.parse(repaired); } catch(_){} }
    }
  }

  const fenceStart = text.search(/```json/i);
  if (fenceStart >= 0) {
    const body = text.slice(fenceStart).replace(/```json/i,"").trim();
    const repaired = tryRepairJSON(body);
    if (repaired) { try { return JSON.parse(repaired); } catch(_){} }
  }

  const i = text.indexOf("{");
  if (i >= 0) {
    const tail = text.slice(i);
    try { return JSON.parse(tail); } catch(e) {
      const repaired = tryRepairJSON(tail);
      if (repaired) { try { return JSON.parse(repaired); } catch(_){} }
    }
  }
  return null;
}

// ---- Strict plan prompt & validation ----
function buildPlanPromptJSONOnly() {
  const runsPerWeek = Math.min(7, Math.max(1, state.user.runsPerWeek || 4));
  const taperWeeks  = Math.min(4, Math.max(1, state.user.taperWeeks  || 2));
  const raceISO     = state.user.race?.dateTime ? new Date(state.user.race.dateTime).toISOString().slice(0,10) : null;
  const startDate   = startOfNextWeek(new Date());
  const startISO    = startDate.toISOString().slice(0,10);
  const weeksToRace = weeksUntilRace() || 12;
  const maxSingle   = state.user.longestRunEverKm ? Math.max(20, Math.min(25, Math.round(state.user.longestRunEverKm+3))) : 25;

  return {
    startISO,
    raceISO,
    runsPerWeek,
    taperWeeks,
    weeksToRace,
    maxSingle,
    prompt:
`You are a running coach. Output MUST be ONLY a fenced JSON code block, and nothing else.
NO prose. NO markdown outside the code fence. NO comments.

Goal: Create a training plan of dated workouts from ${startISO} (inclusive) up to ${raceISO} (inclusive) for a road race.
Hard rules:
- EXACT OUTPUT FORMAT (JSON):
\`\`\`json
{
  "workouts": [
    { "date": "YYYY-MM-DD", "type": "easy|long|tempo|interval|recovery", "km": 0.1, "pace": "m:ss" }
  ]
}
\`\`\`
- Every training day MUST be a separate item in "workouts".
- Dates MUST be sorted ascending and in ISO format.
- All dates must be between ${startISO} and ${raceISO} inclusive.
- About ${runsPerWeek} runs per week on average with a ${taperWeeks}-week taper reducing volume.
- Use only these types: easy, long, tempo, interval, recovery.
- km is a number (dot decimal). No units in fields.
- pace is recommended average pace for the workout in m:ss per km (e.g., "5:20").
- Do not exceed ${maxSingle} km for any single run.
- Consider user history (examples below) to scale safely.

User data (for context only; do not echo it): ${JSON.stringify({
  race: state.user.race,
  weeklyGoalKm: state.user.weeklyGoalKm,
  maxHr: state.user.maxHr,
  runsPerWeek: state.user.runsPerWeek,
  taperWeeks: state.user.taperWeeks,
  longestRunEverKm: state.user.longestRunEverKm,
  recentSamples: state.runs.slice(-8).map(r=>({date:r.dateTime.slice(0,10), km:r.actualKm, timeSec:r.actualTimeSec}))
})}

ONLY return the JSON code block as shown.`
  };
}
function validateAIPlanObject(obj, startISO, raceISO) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.workouts)) {
    return ["Missing 'workouts' array."];
  }
  const errs = [];
  let prev = null;
  const startT = new Date(startISO).getTime();
  const raceT  = new Date(raceISO ).getTime();
  const seen   = new Set();
  const maxSingle = state.user.longestRunEverKm ? Math.max(20, Math.min(25, Math.round(state.user.longestRunEverKm+3))) : 25;

  for (let i=0;i<obj.workouts.length;i++){
    const w = obj.workouts[i];
    if (!w || typeof w !== "object") { errs.push(`Item ${i} not an object`); continue; }
    if (!w.date || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) errs.push(`Item ${i} has invalid date`);
    const t = w.date ? new Date(w.date).getTime() : NaN;
    if (!(t>=startT && t<=raceT)) errs.push(`Item ${i} date out of range ${w.date}`);
    if (prev && w.date && prev > t) errs.push(`Item ${i} not sorted by date`);
    if (w.date) {
      if (seen.has(w.date)) errs.push(`Duplicate date ${w.date}`);
      seen.add(w.date);
    }
    prev = t;

    if (!w.type || !/^(easy|long|tempo|interval|recovery)$/.test(w.type)) errs.push(`Item ${i} has invalid type '${w.type}'`);
    if (typeof w.km !== "number" || !(w.km >= 0)) errs.push(`Item ${i} has invalid km '${w.km}'`);
    if (w.km > maxSingle) errs.push(`Item ${i} km ${w.km} exceeds cap ${maxSingle}`);
    if (typeof w.pace !== "string" || !/^\d{1,2}:\d{2}$/.test(w.pace)) errs.push(`Item ${i} has invalid pace '${w.pace}'`);
  }
  const weeks = Math.max(1, Math.ceil((raceT - startT) / (7*86400000)));
  const approxMin = Math.floor(weeks * (state.user.runsPerWeek||4) * 0.6);
  const approxMax = Math.ceil (weeks * (state.user.runsPerWeek||4) * 1.5);
  if (obj.workouts.length < approxMin) errs.push(`Too few workouts (${obj.workouts.length} < ${approxMin})`);
  if (obj.workouts.length > approxMax) errs.push(`Too many workouts (${obj.workouts.length} > ${approxMax})`);
  return errs;
}
function parseFencedJSONOrShowRaw(text){
  const obj = parseFencedJSON(text);
  if (obj) return obj;
  return null;
}
function storeValidatedPlan(obj) {
  const items = obj.workouts.map(w => ({
    date: w.date,
    type: w.type,
    plannedKm: Math.round(w.km*10)/10,
    notes: (w.type==="easy"?"Easy Z2": w.type==="long"?"Long Z2":"Quality Z3–4"),
    pace: w.pace
  }));
  lastGeneratedPlan = items;
  const summary = summarizePlan(items);
  const div = document.getElementById("lastPlan"); if(div) div.innerHTML = summary.replace(/\n/g,"<br>");
  return items.length;
}

async function coachReply(text){
  const key   = (state.user.googleApiKey || "").trim();
  const model = normalizeGeminiModel(state.user.googleModel || "gemini-2.5-flash");
  const wantStructured = /plan|json|calendar|schedule/i.test(text);

  if (!key) {
    if (wantStructured) return "No Google API key saved. Open Settings → AI and add your key.";
    return localAdvice(text);
  }

  if (wantStructured) {
    const spec = buildPlanPromptJSONOnly();
    try {
      const first = await geminiReply({ key, model, prompt: spec.prompt });
      lastCoachText = first;

      let obj = parseFencedJSONOrShowRaw(first);
      if (!obj) {
        const second = await geminiReply({ key, model, prompt: spec.prompt + `\n\nReminder: JSON only. No extra text.` });
        lastCoachText = second;
        obj = parseFencedJSONOrShowRaw(second);
      }
      if (!obj) return "The model didn't return valid JSON. You can tap 'Parse last reply → Plan' to try free-text parsing, or ask again with: 'JSON only'. — Raw model reply available via 'Show last raw'.";

      const errs = validateAIPlanObject(obj, spec.startISO, spec.raceISO);
      if (errs.length) {
        const fixed = await geminiReply({ key, model, prompt:
`${spec.prompt}

Your previous JSON had these issues:
- ${errs.join("\n- ")}

Please fix them and return ONLY the corrected JSON block.`});
        lastCoachText = fixed;
        const obj2 = parseFencedJSONOrShowRaw(fixed);
        if (!obj2) return "Model returned non-JSON again. Use 'Parse last reply → Plan' or ask for 'JSON only'.";
        const errs2 = validateAIPlanObject(obj2, spec.startISO, spec.raceISO);
        if (errs2.length) return "Plan still invalid:\n- " + errs2.join("\n- ") + "\nI’ll keep your previous plan. You can also use 'Generate Plan' (local).";
        const n2 = storeValidatedPlan(obj2);
        return `Created ${n2} dated workouts (JSON). Tap **Apply last plan**.`;
      }

      const n = storeValidatedPlan(obj);
      return `Created ${n} dated workouts (JSON). Tap **Apply last plan**.`;

    } catch (e) {
      return "Google API error: " + e.message + "\nFalling back to local coach.\n\n" + localAdvice(text);
    }
  }

  try {
    const payloadText =
      "You are a helpful, safety-conscious running coach. Provide non-medical, general guidance.\n\n" +
      "User data:\n" + JSON.stringify({
        race: state.user.race,
        weeklyGoalKm: state.user.weeklyGoalKm,
        maxHr: state.user.maxHr,
        runsPerWeek: state.user.runsPerWeek,
        taperWeeks: state.user.taperWeeks,
        longestRunEverKm: state.user.longestRunEverKm
      }) + "\n\nUser request:\n" + text;

    const reply = await geminiReply({ key, model, prompt: payloadText });
    return reply;
  } catch (e) {
    return "Google API error: " + e.message + "\nFalling back to local coach.\n\n" + localAdvice(text);
  }
}

// =============== PLAN GENERATOR (local) =================
function weeksUntilRace(){
  const dt = state.user.race.dateTime? new Date(state.user.race.dateTime): null;
  if(!dt) return null;
  const diff = dt - new Date();
  return Math.max(0, Math.ceil(diff / (1000*60*60*24*7)));
}
function startOfNextWeek(d){ const day=(d.getDay()+6)%7; const nextMon=new Date(d); nextMon.setDate(d.getDate()-day+7); nextMon.setHours(0,0,0,0); return nextMon; }

function distributeRuns(n){
  const preferred = [1,3,5,6,0,2,4]; // Tue, Thu, Sat, Sun, Mon, Wed, Fri
  return preferred.slice(0,n).sort((a,b)=>a-b);
}
function assignTypes(n){
  const arr = [];
  if(n>=1) arr.push("long");
  if(n>=2) arr.unshift("tempo");
  if(n>=3) arr.unshift("easy");
  if(n>=4) arr.splice(2,0,"easy");
  if(n>=5) arr.unshift("interval");
  if(n>=6) arr.push("easy");
  if(n>=7) arr.splice(1,0,"easy");
  return arr.slice(0,n);
}
function summarizePlan(plan){
  const byWeek = {};
  for(const p of plan){
    const ws = getWeekRange(new Date(p.date)).start.toISOString().slice(0,10);
    (byWeek[ws] = byWeek[ws] || []).push(p);
  }
  const keys = Object.keys(byWeek).sort();
  const lines = [];
  for(const ws of keys){
    const items = byWeek[ws];
    const km = items.reduce((a,b)=> a+(b.plannedKm||0),0);
    lines.push("Week of "+toFIfromISO(ws)+": "+km+" km");
    items.sort((a,b)=>a.date.localeCompare(b.date)).forEach(x=>{
      lines.push("  "+toFIfromISO(x.date)+" • "+x.type+" • "+x.plannedKm+" km");
    });
  }
  return lines.join("\n");
}
function generatePlanFromState(){
  const weeks = weeksUntilRace() || 12;
  const runsPerWeek = Math.min(7, Math.max(1, state.user.runsPerWeek||4));
  const taper = Math.min(4, Math.max(1, state.user.taperWeeks||2));
  const startDate = startOfNextWeek(new Date());
  const longStart = Math.max(8, Math.round((state.user.weeklyGoalKm||40)/3));
  const cap = state.user.longestRunEverKm ? Math.max(20, Math.min(25, Math.round(state.user.longestRunEverKm+3))) : 25;

  const plan = []; let longRun = longStart;
  const taperFactors = (n => n===1?[0.6]: n===2?[0.7,0.5]: n===3?[0.8,0.6,0.4]: [0.85,0.7,0.55,0.4])(taper);

  for(let w=0; w<weeks; w++){
    const weekStart = new Date(startDate.getTime() + w*7*86400000);
    const dates = []; for(let i=0;i<7;i++){ dates.push(new Date(weekStart.getTime()+i*86400000).toISOString().slice(0,10)); }
    const dayIdx = distributeRuns(runsPerWeek);
    const isTaper = (weeks-1 - w) < taper;
    const factor = isTaper ? (taperFactors[(weeks-1 - w)] || 0.6) : 1.0;

    let longToday = Math.max(8, Math.round(longRun * factor));
    longToday = Math.min(longToday, cap);
    const easy = Math.max(5, Math.round(longToday*0.4));
    const workout = Math.max(6, Math.round(longToday*0.5));

    const types = assignTypes(runsPerWeek);
    for(let j=0; j<dayIdx.length; j++){
      const idx = dayIdx[j];
      const date = dates[idx];
      const type = types[j];
      const km = (type==='long')? longToday : ((type==='tempo'||type==='interval')? workout : easy);
      plan.push({date, type, plannedKm: km, plannedTimeSec:null, notes: type==='easy'?'Easy Z2': (type==='long'?'Long Z2':'Quality Z3–4')});
    }

    if(!isTaper){
      if((w+1)%4===0) longRun = Math.max(longStart, Math.round(longRun*0.87));
      else longRun += 2;
    }
  }

  lastGeneratedPlan = plan;
  const summary = summarizePlan(plan);
  coachMessages.push({role:"assistant", content: "Generated plan (with taper):\n\n"+summary+"\n\nPress **Apply last plan** to add it."});
  updateChatUI();
  const div = document.getElementById("lastPlan"); if(div) div.innerHTML = summary.replace(/\n/g,"<br>");
}
function applyLastPlanToCalendar(){
  if(!lastGeneratedPlan || lastGeneratedPlan.length===0){ alert("Generate or parse a plan first."); return; }
  for(const it of lastGeneratedPlan){
    const idx = state.plan.findIndex(p=> p.date===it.date && p.type===it.type);
    const item = { id:'pl_'+it.date+'_'+it.type, date:it.date, type:it.type, plannedKm:it.plannedKm, plannedTimeSec:null, notes:it.notes };
    if(idx>=0) state.plan[idx]=item; else state.plan.push(item);
  }
  state.plan.sort((a,b)=> a.date.localeCompare(b.date));
  save(); alert("Plan added to Calendar/Plan.");
}

// =============== PARSERS (AI → Plan) ===============
function extractJSONFromText(text){
  if(!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if(!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch(e){
    try {
      const repaired = tryRepairJSON(m[1]);
      if (repaired) return JSON.parse(repaired);
    } catch(_) {}
    return null;
  }
}
function absorbAIPlan(aiText){
  const obj = extractJSONFromText(aiText);
  if(!obj || !Array.isArray(obj.workouts)) return 0;

  const items = obj.workouts
    .filter(w => w && w.date && w.type && typeof w.km === "number")
    .map(w => ({
      date: w.date,
      type: String(w.type||"run"),
      plannedKm: Math.max(0, Math.round(Number(w.km)*10)/10),
      notes: (w.notes || (w.type==="easy"?"Easy Z2": w.type==="long"?"Long Z2":"Quality Z3–4")),
      pace: w.pace
    }));

  if(items.length){
    lastGeneratedPlan = items;
    const summary = summarizePlan(items);
    const div = document.getElementById("lastPlan"); if(div) div.innerHTML = summary.replace(/\n/g,"<br>");
  }
  return items.length;
}
function parseFloatKM(str){
  const m = /(\d+(?:[.,]\d+)?)\s*km/i.exec(str);
  if(!m) return null;
  return parseFloat(m[1].replace(",", "."));
}
function inferType(str){
  const s = str.toLowerCase();
  if (/long/.test(s)) return "long";
  if (/interval/.test(s)) return "interval";
  if (/(tempo|threshold)/.test(s)) return "tempo";
  if (/recovery/.test(s)) return "recovery";
  if (/easy|base/.test(s)) return "easy";
  return "run";
}
function splitWeeksByHeadings(text){
  const lines = text.split(/\r?\n/);
  const buckets = [];
  let cur = [];
  for (let ln of lines){
    if (/^\s*\*?\s*weeks?\s*\d+/i.test(ln) || /^\s*week\s*\d+/i.test(ln)) {
      if (cur.length) buckets.push(cur), cur=[];
    }
    cur.push(ln);
  }
  if (cur.length) buckets.push(cur);
  if (buckets.length === 0) return [lines];
  return buckets;
}
function extractDayEntries(lines){
  const out = [];
  for (let ln of lines){
    const km = parseFloatKM(ln);
    if (km == null) continue;
    const type = inferType(ln);
    out.push({ type, km: Math.max(0, Math.round(km*10)/10) });
  }
  return out;
}
function tryParsePlanFromFreeText(text){
  if(!text || !/\dkm/i.test(text)) return 0;
  const weekBlocks = splitWeeksByHeadings(text);
  const runsPerWeek = Math.min(7, Math.max(1, state.user.runsPerWeek || 4));
  const dayIdxTemplate = distributeRuns(runsPerWeek);
  const startDate = startOfNextWeek(new Date());

  const items = [];
  for (let w=0; w<weekBlocks.length; w++){
    const lines = weekBlocks[w];
    const entries = extractDayEntries(lines);
    if (entries.length === 0) continue;

    const weekStart = new Date(startDate.getTime() + w*7*86400000);
    const toSchedule = entries.slice(0, runsPerWeek);
    const idxs = dayIdxTemplate.slice(0, toSchedule.length).sort((a,b)=>a-b);

    for (let j=0; j<toSchedule.length; j++){
      const e = toSchedule[j];
      const date = toISODate(new Date(weekStart.getTime() + idxs[j]*86400000));
      items.push({
        date,
        type: e.type,
        plannedKm: e.km,
        notes: e.type==="easy"?"Easy Z2": e.type==="long"?"Long Z2":"Quality Z3–4"
      });
    }
  }
  if (items.length){
    lastGeneratedPlan = items;
    const summary = summarizePlan(items);
    const div = document.getElementById("lastPlan"); if(div) div.innerHTML = summary.replace(/\n/g,"<br>");
  }
  return items.length;
}
function parseLastCoachToPlan(){
  if(!lastCoachText){ alert("No coach reply to parse yet."); return; }
  let n = 0;
  try { n = absorbAIPlan(lastCoachText); } catch(e){ /* ignore */ }
  if (n === 0) n = tryParsePlanFromFreeText(lastCoachText);
  if (n > 0){
    alert("Parsed "+n+" workouts from the last reply. Tap 'Apply last plan'.");
  } else {
    alert("Couldn’t parse a plan from the last reply. Ask the coach to include a JSON block, or try again.");
  }
}

// =============== MODAL + KM PICKER =================
let __modal;
function showModal(html){
  closeModal();
  __modal = document.createElement("div");
  __modal.style.position="fixed"; __modal.style.inset="0"; __modal.style.background="rgba(0,0,0,.4)"; __modal.style.backdropFilter="blur(4px)"; __modal.style.zIndex="9998";
  __modal.addEventListener("click", e=>{ if(e.target===__modal) closeModal(); });
  document.body.appendChild(__modal);
  const box = document.createElement("div");
  box.innerHTML = html;
  __modal.appendChild(box.firstElementChild);
}
function closeModal(){ if(__modal){ __modal.remove(); __modal=null; } }

function openKmPicker(targetId, opts){
  opts = opts || {};
  const maxInt = opts.maxInt || 50;
  const html = `
  <div class="card" style="position:fixed;left:10px;right:10px;bottom:10px;margin:0;z-index:9999">
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="value">Pick distance</div>
      <button class="btn" id="kmCloseBtn">Close</button>
    </div>
    <div class="row" style="margin-top:10px;gap:10px;justify-content:space-between">
      <div style="flex:1">
        <div class="label">Kilometers</div>
        <select id="kmInt" size="6" style="width:100%"></select>
      </div>
      <div style="width:90px">
        <div class="label">.x</div>
        <select id="kmDec" size="6" style="width:100%"></select>
      </div>
    </div>
    <div class="small" style="margin-top:6px">Use the right wheel for decimal tenths (default .0)</div>
    <div class="row" style="margin-top:10px;gap:10px">
      <button class="btn primary" id="kmUseBtn">Use</button>
    </div>
  </div>`;
  showModal(html);

  const intSel = document.getElementById('kmInt');
  const decSel = document.getElementById('kmDec');
  for (let i=0; i<=maxInt; i++){ const o=document.createElement('option'); o.textContent=i; intSel.appendChild(o); }
  for (let d=0; d<=9; d++){ const p=document.createElement('option'); p.textContent='.'+d; decSel.appendChild(p); }

  document.getElementById('kmCloseBtn').onclick = closeModal;
  document.getElementById('kmUseBtn').onclick = function(){
    const i = parseInt(intSel.value||'0',10);
    const dec = parseInt((decSel.value||'.0').replace('.',''),10) || 0;
    const val = (i + dec/10).toFixed(1);
    const el = document.getElementById(targetId);
    if (el){ el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); }
    closeModal();
  };
}

// =============== BOOT =================
render();
