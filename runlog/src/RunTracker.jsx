import { useState, useEffect, useRef, useCallback } from "react";

// ─── THEMES ───────────────────────────────────────────────────────────────────
// Each theme: bg=page, surface=card bg, card=inner card, border=lines,
// accent=highlight colour, text=primary text, sub=muted text, btn=text ON accent button
const THEMES = {
  midnight: {
    name:"Midnight Green", tag:"Dark & focused",
    bg:"#080f0c", surface:"#0f1a14", card:"#162010", border:"#1e3020",
    accent:"#22c55e", text:"#e8f5ec", sub:"#5a8a68", btn:"#041008",
  },
  ocean: {
    name:"Deep Ocean", tag:"Cool & calm",
    bg:"#05080f", surface:"#0a1020", card:"#101828", border:"#182435",
    accent:"#0ea5e9", text:"#e0f0ff", sub:"#3a6080", btn:"#020810",
  },
  amber: {
    name:"Amber Dusk", tag:"Warm & energetic",
    bg:"#0c0800", surface:"#1a1000", card:"#261800", border:"#382200",
    accent:"#f59e0b", text:"#fff8e8", sub:"#8a6a20", btn:"#1a0a00",
  },
  violet: {
    name:"Violet Storm", tag:"Bold & modern",
    bg:"#07050f", surface:"#100e1c", card:"#181528", border:"#241e3a",
    accent:"#a78bfa", text:"#f0eeff", sub:"#5a5080", btn:"#08060f",
  },
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
async function loadRuns()  { try { const r=await window.storage.get("rl_v4"); return r?JSON.parse(r.value):[]; } catch { return []; } }
async function saveRuns(x) { try { await window.storage.set("rl_v4",JSON.stringify(x)); } catch {} }
async function loadPrefs() { try { const r=await window.storage.get("rl_prefs"); return r?JSON.parse(r.value):{};  } catch { return {}; } }
async function savePrefs(x){ try { await window.storage.set("rl_prefs",JSON.stringify(x)); } catch {} }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2,"0");
function fmtTime(ms) {
  const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return h>0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
function fmtPace(ms,km) {
  if(!km||km===0) return "--:--";
  const s=ms/1000/km;
  return `${Math.floor(s/60)}:${pad(Math.floor(s%60))} /km`;
}
function haversine(a,b) {
  const R=6371000, toR=d=>d*Math.PI/180;
  const dLat=toR(b.lat-a.lat), dLng=toR(b.lng-a.lng);
  const x=Math.sin(dLat/2)**2+Math.cos(toR(a.lat))*Math.cos(toR(b.lat))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function todayStr() { return new Date().toISOString().slice(0,10); }
function daysInMonth(y,m) { return new Date(y,m+1,0).getDate(); }
function firstDow(y,m)    { return new Date(y,m,1).getDay(); }
function monthLabel(y,m)  { return new Date(y,m,1).toLocaleDateString("en-IN",{month:"long",year:"numeric"}); }
function autoName()       { return new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
const DAY_HDRS = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const KM = 1000;

// ─── AUDIO ────────────────────────────────────────────────────────────────────
// Strategy: create a BRAND NEW AudioContext for every alert call.
// This sidesteps all suspension issues — each context is fresh from a queued task.
// We use setTimeout to space out beeps so they don't overlap.

function makeTone(freq, durationMs, vol) {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g);
    g.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationMs / 1000);
    setTimeout(() => { try { ctx.close(); } catch {} }, durationMs + 200);
  } catch(e) { console.warn("beep failed", e); }
}

// KM alert:
// - Number of beeps = km just completed (KM 1 = 1 beep, KM 5 = 5 beeps, KM 10 = 10 beeps)
// - All beeps spread evenly across exactly 5 seconds so it can't be missed
function kmAlert(type, kmCount) {
  const count    = Math.max(1, kmCount || 1);
  const totalMs  = 5000;
  const spacing  = Math.floor(totalMs / count);
  const beepDur  = Math.min(550, spacing - 80);

  if (type === "beep" || type === "both") {
    for (let i = 0; i < count; i++) {
      setTimeout(() => makeTone(1100, beepDur, 0.9), i * spacing);
    }
  }
  if (type === "vibrate" || type === "both") {
    const onMs  = Math.min(450, spacing - 100);
    const offMs = spacing - onMs;
    const pat   = [];
    for (let i = 0; i < count; i++) {
      pat.push(onMs);
      if (i < count - 1) pat.push(offMs);
    }
    try { navigator.vibrate(pat); } catch {}
  }
}

// Interval stage alert — 3 beeps/pulses spread across 5 seconds
// High pitch = run phase starting, Low pitch = rest phase starting
function stageAlert(type, starting) {
  const freq    = starting ? 1050 : 500;
  const count   = 3;
  const spacing = Math.floor(5000 / count);
  const beepDur = 500;

  if (type === "beep" || type === "both") {
    for (let i = 0; i < count; i++) {
      setTimeout(() => makeTone(freq, beepDur, 0.9), i * spacing);
    }
  }
  if (type === "vibrate" || type === "both") {
    try { navigator.vibrate([600, 1050, 600, 1050, 600]); } catch {}
  }
}

// No-op kept for compat
function initAudio() {}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const VIEWS = {HOME:"home",THEMES:"themes",SETUP:"setup",RUN:"run",DAY:"day",DETAIL:"detail"};

export default function App() {
  const [view,       setView]       = useState(VIEWS.HOME);
  const [runs,       setRuns]       = useState([]);
  const [themeKey,   setThemeKey]   = useState("midnight");
  const [loaded,     setLoaded]     = useState(false);
  const [selDay,     setSelDay]     = useState(null);
  const [selRun,     setSelRun]     = useState(null);
  const [runCfg,     setRunCfg]     = useState(null);
  const C = THEMES[themeKey];

  useEffect(() => {
    Promise.all([loadRuns(),loadPrefs()]).then(([r,p]) => {
      setRuns(r);
      if(p.theme && THEMES[p.theme]) setThemeKey(p.theme);
      else setThemeKey("midnight");
      setLoaded(true);
    });
  },[]);

  const persist = useCallback((run) => {
    setRuns(prev => {
      const i = prev.findIndex(r=>r.id===run.id);
      const next = i>=0 ? prev.map(r=>r.id===run.id?run:r) : [run,...prev];
      saveRuns(next); return next;
    });
  },[]);

  const remove = useCallback((id) => {
    setRuns(prev => { const next=prev.filter(r=>r.id!==id); saveRuns(next); return next; });
  },[]);

  const byDay = {};
  runs.forEach(r => { const d=r.date.slice(0,10); (byDay[d]||(byDay[d]=[])).push(r); });

  if(!loaded) return (
    <div style={rs(C)}>
      <div style={ps(C)}>
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.sub,fontSize:15}}>Loading…</div>
      </div>
    </div>
  );

  const goDetail = (run) => { setSelRun(run); setView(VIEWS.DETAIL); };

  return (
    <div style={rs(C)}>
      <div style={ps(C)}>

        {view===VIEWS.HOME && (
          <HomeScreen C={C}
            byDay={byDay}
            onSetup={()=>setView(VIEWS.SETUP)}
            onDayClick={d=>{ setSelDay(d); setView(VIEWS.DAY); }}
            onThemes={()=>setView(VIEWS.THEMES)}
          />
        )}

        {view===VIEWS.THEMES && (
          <ThemesScreen C={C} current={themeKey}
            onChange={k=>{ setThemeKey(k); savePrefs({theme:k}); }}
            onBack={()=>setView(VIEWS.HOME)}
          />
        )}

        {view===VIEWS.SETUP && (
          <SetupScreen C={C}
            onStart={cfg=>{ setRunCfg(cfg); setView(VIEWS.RUN); }}
            onCancel={()=>setView(VIEWS.HOME)}
          />
        )}

        {view===VIEWS.RUN && runCfg && (
          <RunScreen C={C} config={runCfg}
            onFinish={run=>{ persist(run); goDetail(run); }}
            onCancel={()=>setView(VIEWS.HOME)}
          />
        )}

        {view===VIEWS.DAY && selDay && (
          <DayScreen C={C}
            day={selDay}
            runs={byDay[selDay]||[]}
            onBack={()=>setView(VIEWS.HOME)}
            onSelect={goDetail}
          />
        )}

        {view===VIEWS.DETAIL && selRun && (
          <DetailScreen C={C}
            run={runs.find(r=>r.id===selRun.id)||selRun}
            onRename={n=>{ const u={...selRun,name:n}; setSelRun(u); persist(u); }}
            onSaveLoc={loc=>{ const u={...selRun,location:loc}; setSelRun(u); persist(u); }}
            onDelete={()=>{ remove(selRun.id); setView(VIEWS.HOME); }}
            onBack={()=>{ const d=selRun.date.slice(0,10); byDay[d]?.length ? (setSelDay(d),setView(VIEWS.DAY)) : setView(VIEWS.HOME); }}
          />
        )}

      </div>
    </div>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomeScreen({C,byDay,onSetup,onDayClick,onThemes}) {
  const now = new Date();
  const [cy,setCy] = useState(now.getFullYear());
  const [cm,setCm] = useState(now.getMonth());
  const today = todayStr();
  const allRuns = Object.values(byDay).flat();
  const totalKm = allRuns.reduce((s,r)=>s+r.distanceM/1000,0).toFixed(1);

  const days   = daysInMonth(cy,cm);
  const offset = firstDow(cy,cm);
  const cells  = [...Array(offset).fill(null),...Array.from({length:days},(_,i)=>i+1)];

  const prevM = () => cm===0 ? (setCy(cy-1),setCm(11)) : setCm(cm-1);
  const nextM = () => cm===11? (setCy(cy+1),setCm(0))  : setCm(cm+1);

  return (
    <div style={sc(C)}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:26,fontWeight:900,color:C.accent,letterSpacing:3,fontStyle:"italic"}}>RUNLOG</div>
          <div style={{fontSize:10,color:C.sub,letterSpacing:1.5,marginTop:3}}>Track · Split · Improve</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{background:C.surface,borderRadius:14,padding:"8px 12px",border:`1px solid ${C.border}`,display:"flex",gap:8,alignItems:"center"}}>
            <MiniStat C={C} v={allRuns.length} l="runs"/>
            <div style={{width:1,height:22,background:C.border}}/>
            <MiniStat C={C} v={totalKm} l="km"/>
          </div>
          <button onClick={onThemes} style={{...iconBtn(C),fontSize:16}}>🎨</button>
        </div>
      </div>

      {/* Calendar */}
      <div style={{background:C.surface,borderRadius:22,padding:"14px 12px",border:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <button style={nbtn(C)} onClick={prevM}>‹</button>
          <span style={{fontSize:14,fontWeight:800,color:C.text}}>{monthLabel(cy,cm)}</span>
          <button style={nbtn(C)} onClick={nextM}>›</button>
        </div>
        {/* Day headers */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
          {DAY_HDRS.map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:10,color:C.sub,fontWeight:700,paddingBottom:5}}>
              {d}
            </div>
          ))}
        </div>
        {/* Date cells */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {cells.map((d,i)=>{
            if(!d) return <div key={"e"+i} style={{height:36}}/>;
            const ds=`${cy}-${pad(cm+1)}-${pad(d)}`;
            const cnt = byDay[ds]?.length||0;
            const isToday = ds===today;
            return (
              <div key={ds} onClick={()=>cnt>0&&onDayClick(ds)}
                style={{height:36,borderRadius:9,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative",
                  background:cnt>0?C.accent:"transparent",
                  border:`1px solid ${isToday&&!cnt?C.accent+"66":"transparent"}`,
                  cursor:cnt>0?"pointer":"default"}}>
                <span style={{fontSize:12,fontWeight:cnt>0?900:400,
                  color:cnt>0?C.btn:isToday?C.accent:C.sub}}>{d}</span>
                {cnt>1&&<span style={{position:"absolute",top:1,right:2,background:C.btn,color:C.accent,fontSize:8,fontWeight:900,borderRadius:5,padding:"1px 3px",lineHeight:1.4}}>{cnt}</span>}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:7,marginTop:10,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
          <div style={{width:10,height:10,borderRadius:3,background:C.accent,flexShrink:0}}/>
          <span style={{fontSize:11,color:C.sub}}>Run day — tap to view details</span>
        </div>
      </div>

      <button style={bigBtn(C)} onClick={onSetup}>
        <span style={{fontSize:22}}>▶</span> Start a Run
      </button>
    </div>
  );
}
function MiniStat({C,v,l}) {
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
    <span style={{fontSize:16,fontWeight:900,color:C.accent}}>{v}</span>
    <span style={{fontSize:9,color:C.sub,letterSpacing:0.5}}>{l}</span>
  </div>;
}

// ─── THEMES ───────────────────────────────────────────────────────────────────
function ThemesScreen({C,current,onChange,onBack}) {
  return (
    <div style={sc(C)}>
      <NavBar C={C} title="Themes" onBack={onBack}/>
      <div style={{fontSize:13,color:C.sub}}>Choose your colour theme</div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {Object.entries(THEMES).map(([k,T])=>(
          <div key={k} onClick={()=>onChange(k)}
            style={{background:T.surface,border:`2px solid ${current===k?T.accent:T.border}`,borderRadius:20,padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:44,height:44,borderRadius:14,background:`linear-gradient(140deg,${T.accent} 0%,${T.surface} 100%)`,flexShrink:0,border:`2px solid ${T.accent}44`}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:800,color:T.text}}>{T.name}</div>
              <div style={{fontSize:11,color:T.sub,marginTop:2}}>{T.tag}</div>
              <div style={{display:"flex",gap:5,marginTop:7}}>
                {[T.bg,T.surface,T.card,T.accent,T.sub].map((col,i)=>(
                  <div key={i} style={{width:16,height:16,borderRadius:4,background:col,border:`1px solid ${T.border}`}}/>
                ))}
              </div>
            </div>
            {current===k && <span style={{fontSize:18,color:T.accent}}>✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
function toSec(val, unit) { return unit === "min" ? +val * 60 : +val; }

function SetupScreen({C,onStart,onCancel}) {
  const [rtype,    setRtype]    = useState(null);
  const [alert,    setAlert]    = useState("both");
  const [itype,    setItype]    = useState("distance");
  const [distM,    setDistM]    = useState("400");
  const [restD,    setRestD]    = useState("60");
  const [restDUnit,setRestDUnit]= useState("sec");
  const [runSec,   setRunSec]   = useState("1");
  const [runUnit,  setRunUnit]  = useState("min");
  const [rstSec,   setRstSec]   = useState("1");
  const [rstUnit,  setRstUnit]  = useState("min");
  const [reps,     setReps]     = useState("8");

  const canGo = rtype && (rtype==="long" || (
    itype==="distance" ? (+distM>0 && +restD>0) :
    (+runSec>0 && +rstSec>0 && +reps>0)
  ));

  const go = () => {
    const cfg = {rtype, alert, itype};
    if (rtype === "interval") {
      if (itype === "distance") {
        cfg.distM   = +distM;
        cfg.restSec = toSec(restD, restDUnit);
      } else {
        cfg.runSec  = toSec(runSec, runUnit);
        cfg.restSec = toSec(rstSec, rstUnit);
        cfg.reps    = +reps;
      }
    }
    onStart(cfg);
  };

  return (
    <div style={sc(C)}>
      <NavBar C={C} title="Choose Run" onBack={onCancel}/>

      <SegPicker C={C} label="Run Type" val={rtype} set={setRtype}
        opts={[{v:"long",l:"🏃 Long Run"},{v:"interval",l:"⚡ Intervals"}]}/>

      {rtype && (
        <SegPicker C={C} label="KM Alert" val={alert} set={setAlert}
          opts={[{v:"beep",l:"🔔 Beep"},{v:"vibrate",l:"📳 Vibrate"},{v:"both",l:"🔔+📳 Both"}]}/>
      )}

      {/* Test button — triggers audio inside a fresh user gesture */}
      {rtype && (
        <button onClick={()=>{ initAudio(); kmAlert(alert, 3); }}
          style={{background:C.card,border:`1px solid ${C.accent}55`,color:C.accent,borderRadius:14,
            padding:"10px 0",fontSize:13,fontWeight:700,cursor:"pointer",width:"100%"}}>
          🔊 Test Alert (3 beeps = KM 3 demo)
        </button>
      )}

      {rtype==="long" && (
        <InfoBox C={C} text="You'll get an alert after every km so you know your progress without checking your phone." />
      )}

      {rtype==="interval" && (<>
        <SegPicker C={C} label="Interval Type" val={itype} set={setItype}
          opts={[{v:"distance",l:"📏 Distance"},{v:"time",l:"⏱ Time"}]}/>

        {itype==="distance" && (
          <div style={{background:C.card,borderRadius:18,padding:16,border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:12,color:C.accent,fontWeight:700}}>Distance Interval</div>
            <div style={{display:"flex",gap:10}}>
              <NumInput C={C} label="Run Distance" val={distM} set={setDistM} unit="m"/>
              <TimeInput C={C} label="Rest Time" val={restD} set={setRestD} unit={restDUnit} setUnit={setRestDUnit}/>
            </div>
            <div style={{fontSize:11,color:C.sub,lineHeight:1.7}}>
              Run {distM}m → alert → rest {restD} {restDUnit} → alert → repeat
            </div>
          </div>
        )}

        {itype==="time" && (
          <div style={{background:C.card,borderRadius:18,padding:16,border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:12,color:C.accent,fontWeight:700}}>Time Interval</div>
            <div style={{display:"flex",gap:10}}>
              <TimeInput C={C} label="Run Time"  val={runSec} set={setRunSec} unit={runUnit}  setUnit={setRunUnit}/>
              <TimeInput C={C} label="Rest Time" val={rstSec} set={setRstSec} unit={rstUnit}  setUnit={setRstUnit}/>
            </div>
            <NumInput C={C} label="Intervals" val={reps} set={setReps} unit="reps"/>
            {(() => {
              const rS = toSec(runSec, runUnit), rsS = toSec(rstSec, rstUnit);
              const total = Math.round((rS + rsS) * (+reps) / 60);
              return <div style={{fontSize:11,color:C.sub,lineHeight:1.7}}>
                {runSec} {runUnit} run + {rstSec} {rstUnit} rest × {reps} = ~{total} min total
              </div>;
            })()}
          </div>
        )}
      </>)}

      <div style={{flex:1}}/>
      <button style={{...bigBtn(C),opacity:canGo?1:0.4}} disabled={!canGo} onClick={go}>
        ▶ Start Run
      </button>
    </div>
  );
}

function SegPicker({C,label,val,set,opts}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:7}}>
      <div style={{fontSize:11,color:C.sub,letterSpacing:1,textTransform:"uppercase"}}>{label}</div>
      <div style={{display:"flex",gap:8}}>
        {opts.map(o=>(
          <button key={o.v} onClick={()=>set(o.v)}
            style={{flex:1,padding:"10px 4px",borderRadius:14,border:`1.5px solid ${val===o.v?C.accent:C.border}`,
              background:val===o.v?C.accent+"25":C.surface,color:val===o.v?C.accent:C.sub,
              fontSize:12,fontWeight:700,cursor:"pointer"}}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}
function NumInput({C,label,val,set,unit}) {
  return (
    <div style={{flex:1}}>
      <div style={{fontSize:11,color:C.sub,letterSpacing:0.8,marginBottom:6,textTransform:"uppercase"}}>{label}</div>
      <div style={{display:"flex",alignItems:"center",gap:5,background:C.card,borderRadius:12,padding:"9px 11px",border:`1px solid ${C.border}`}}>
        <input type="number" min={1} value={val} onChange={e=>set(e.target.value)}
          style={{flex:1,background:"transparent",border:"none",outline:"none",color:C.text,fontSize:17,fontWeight:800,width:50}}/>
        <span style={{fontSize:11,color:C.sub}}>{unit}</span>
      </div>
    </div>
  );
}

function TimeInput({C, label, val, set, unit, setUnit}) {
  return (
    <div style={{flex:1}}>
      <div style={{fontSize:11,color:C.sub,letterSpacing:0.8,marginBottom:6,textTransform:"uppercase"}}>{label}</div>
      <div style={{display:"flex",gap:5}}>
        <div style={{flex:1,display:"flex",alignItems:"center",background:C.card,borderRadius:12,padding:"9px 10px",border:`1px solid ${C.border}`}}>
          <input type="number" min={1} value={val} onChange={e=>set(e.target.value)}
            style={{flex:1,background:"transparent",border:"none",outline:"none",color:C.text,fontSize:17,fontWeight:800,width:40}}/>
        </div>
        <select value={unit} onChange={e=>setUnit(e.target.value)}
          style={{background:C.surface,border:`1px solid ${C.accent}66`,borderRadius:12,
            color:C.accent,fontSize:12,fontWeight:700,padding:"0 8px",cursor:"pointer",
            outline:"none",appearance:"none",WebkitAppearance:"none",textAlign:"center",minWidth:48}}>
          <option value="sec">sec</option>
          <option value="min">min</option>
        </select>
      </div>
    </div>
  );
}
function InfoBox({C,text}) {
  return <div style={{background:C.card,borderRadius:14,padding:"12px 14px",border:`1px solid ${C.border}`,fontSize:12,color:C.sub,lineHeight:1.7}}>{text}</div>;
}

// ─── RUN SCREEN ───────────────────────────────────────────────────────────────
function RunScreen({C,config,onFinish,onCancel}) {
  const [phase,    setPhase]    = useState("idle");   // idle|running|resting|paused|done
  const [elapsed,  setElapsed]  = useState(0);
  const [distM,    setDistM]    = useState(0);
  const [splits,   setSplits]   = useState([]);
  const [gps,      setGps]      = useState("waiting"); // waiting|ok|sim
  const [intPhase, setIntPhase] = useState("run");    // run|rest
  const [intEl,    setIntEl]    = useState(0);        // elapsed in current interval phase (ms)
  const [intCount, setIntCount] = useState(0);        // completed full intervals

  // All mutable state lives in refs so setInterval callbacks are always fresh
  const R = useRef({
    timerID:null, watchID:null, simID:null,
    paused:0,
    elapsed:0,
    distM:0,
    splits:[],
    lastKm:0,
    splitStart:0,
    intPhase:"run",
    intPhaseStart:0,
    intCount:0,
    intDistStart:0,
    done:false,
    transitioning:false,
    gps:"waiting",
    sim:false,
  }).current;

  const stopGPS = () => {
    if(R.simID)  { clearInterval(R.simID); R.simID=null; }
    if(R.watchID!=null) { try{navigator.geolocation.clearWatch(R.watchID);}catch{} R.watchID=null; }
  };

  const addDist = useCallback((d) => {
    R.distM += d;
    setDistM(R.distM);

    // KM split (long run alert)
    const k = Math.floor(R.distM/KM);
    if(k > R.lastKm) {
      const sp = R.elapsed - R.splitStart;
      R.splits = [...R.splits, {km:k, splitMs:sp, totalMs:R.elapsed}];
      setSplits([...R.splits]);
      R.lastKm = k;
      R.splitStart = R.elapsed;
      if(config.rtype==="long") kmAlert(config.alert, k);
    }

    // Distance interval: check run-phase coverage
    if(config.rtype==="interval" && config.itype==="distance" && R.intPhase==="run") {
      const covered = R.distM - R.intDistStart;
      if(covered >= config.distM) {
        stageAlert(config.alert, false);
        R.intPhase = "rest";
        R.intPhaseStart = R.elapsed;
        setIntPhase("rest");
        setIntEl(0);
      }
    }
  },[config]);

  const startGPS = () => {
    if(!navigator.geolocation) { startSim(); return; }
    R.gps="waiting"; setGps("waiting");
    R.watchID = navigator.geolocation.watchPosition(
      pos => {
        if(R.gps!=="ok") { R.gps="ok"; setGps("ok"); }
        const cur={lat:pos.coords.latitude,lng:pos.coords.longitude};
        if(R._lastPos) { const d=haversine(R._lastPos,cur); if(d>0&&d<50) addDist(d); }
        R._lastPos = cur;
      },
      () => startSim(),
      {enableHighAccuracy:true,maximumAge:1000,timeout:8000}
    );
  };

  const startSim = () => {
    if(R.sim) return;
    R.sim=true; R.gps="sim"; setGps("sim");
    R.simID = setInterval(()=>addDist(2.78),1000);
  };

  const tickRef = useRef(null);

  tickRef.current = () => {
    R.elapsed = Date.now() - R._t0;
    setElapsed(R.elapsed);
    if (R.done) return;

    if (config.rtype === "interval") {
      const phaseEl = R.elapsed - R.intPhaseStart;
      setIntEl(phaseEl);

      if (config.itype === "time") {
        if (R.intPhase === "run") {
          if (phaseEl >= config.runSec * 1000 && !R.transitioning) {
            R.transitioning = true;
            stageAlert(config.alert, false);          // end-of-run beep (low)
            R.intPhase = "rest";
            R.intPhaseStart = R.elapsed;
            setIntPhase("rest");
            setIntEl(0);
            setTimeout(() => { R.transitioning = false; }, 500);
          }
        } else {
          if (phaseEl >= config.restSec * 1000 && !R.transitioning) {
            R.transitioning = true;
            R.intCount++;
            setIntCount(R.intCount);
            if (R.intCount >= config.reps) {
              stageAlert(config.alert, true);         // final done beep (high)
              R.done = true;
              setPhase("done");
              clearInterval(R.timerID); R.timerID = null;
              stopGPS();
              return;
            }
            stageAlert(config.alert, true);           // start-of-run beep (high)
            R.intPhase = "run";
            R.intPhaseStart = R.elapsed;
            R.intDistStart = R.distM;
            setIntPhase("run");
            setIntEl(0);
            setTimeout(() => { R.transitioning = false; }, 500);
          }
        }
      } else {
        // distance-based: rest phase timed countdown
        if (R.intPhase === "rest") {
          if (phaseEl >= config.restSec * 1000 && !R.transitioning) {
            R.transitioning = true;
            R.intCount++;
            setIntCount(R.intCount);
            stageAlert(config.alert, true);           // start-of-run beep (high)
            R.intPhase = "run";
            R.intPhaseStart = R.elapsed;
            R.intDistStart = R.distM;
            setIntPhase("run");
            setIntEl(0);
            setTimeout(() => { R.transitioning = false; }, 500);
          }
        }
      }
    }
  };

  const startTimer = () => {
    R._t0 = Date.now() - R.paused;
    R.timerID = setInterval(() => tickRef.current(), 200);
  };
  const pauseTimer = () => { clearInterval(R.timerID); R.timerID=null; R.paused=R.elapsed; };

  useEffect(() => () => { clearInterval(R.timerID); stopGPS(); },[]);

  const doStart = () => {
    initAudio(); // must be inside user gesture click handler
    R.intPhase="run"; R.intPhaseStart=0; R.intDistStart=0;
    setPhase("running");
    startTimer(); startGPS();
  };
  const doPause  = () => { setPhase("paused");  pauseTimer(); stopGPS(); };
  const doResume = () => { setPhase("running"); startTimer(); startGPS(); };
  const doFinish = () => {
    pauseTimer(); stopGPS();
    onFinish({
      id: Date.now().toString(),
      name: autoName(),
      date: new Date().toISOString(),
      distanceM: R.distM,
      durationMs: R.elapsed,
      splits: R.splits,
      simulated: R.sim,
      rtype: config.rtype,
      intervalCount: R.intCount,
    });
  };

  const gpsColor = gps==="ok"?C.accent:gps==="sim"?"#f59e0b":C.sub;
  const gpsLbl   = gps==="ok"?"GPS Active":gps==="sim"?"Simulated GPS":"Acquiring GPS…";
  const isInt    = config.rtype==="interval";
  const isDone   = phase==="done";

  // interval progress bar
  let intMax=1, intProg=0, intLbl="";
  if(isInt && phase!=="idle") {
    if(intPhase==="run") {
      if(config.itype==="distance") { intMax=config.distM*1000; intProg=Math.min((R.distM-R.intDistStart)*1000,intMax); intLbl=`${Math.round(R.distM-R.intDistStart)}m / ${config.distM}m`; }
      else                          { intMax=config.runSec*1000; intProg=Math.min(intEl,intMax); intLbl=`${fmtTime(intEl)} / ${fmtTime(intMax)}`; }
    } else {
      intMax=config.restSec*1000; intProg=Math.min(intEl,intMax);
      intLbl=`Rest: ${Math.max(0,Math.ceil((intMax-intEl)/1000))}s`;
    }
  }

  const phaseLabel =
    isDone        ? "✅ All Done!" :
    isInt && intPhase==="rest" ? "😮‍💨 Rest Phase" :
    isInt         ? "⚡ Running"   :
    phase==="idle"? "Ready"       :
    phase==="running"?"🏃 Running":"⏸ Paused";

  return (
    <div style={sc(C)}>
      {/* Nav */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={onCancel} style={iconBtn(C)}>✕</button>
        <div style={{fontSize:15,fontWeight:800,color:C.text}}>{phaseLabel}</div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:gpsColor,boxShadow:`0 0 6px ${gpsColor}`}}/>
        </div>
      </div>
      <div style={{fontSize:10,color:C.sub,textAlign:"center",letterSpacing:0.8}}>{gpsLbl}</div>

      {/* Timer */}
      <div style={{textAlign:"center",fontSize:60,fontWeight:900,color:C.text,letterSpacing:-3,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>
        {fmtTime(elapsed)}
      </div>

      {/* Metrics */}
      <div style={{display:"flex",gap:8}}>
        <MBox C={C} label="Distance" value={`${(R.distM/1000).toFixed(2)} km`}/>
        <MBox C={C} label="Avg Pace" value={fmtPace(elapsed,R.distM/1000)}/>
        {isInt
          ? <MBox C={C} label="Intervals" value={intCount}/>
          : <MBox C={C} label="Splits"    value={splits.length}/>
        }
      </div>

      {/* Interval progress */}
      {isInt && phase!=="idle" && (
        <div style={{background:C.card,borderRadius:16,padding:"12px 14px",border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
            <span style={{fontSize:12,fontWeight:700,color:intPhase==="run"?C.accent:"#f59e0b"}}>
              {intPhase==="run"?"RUN":"REST"}
            </span>
            <span style={{fontSize:12,color:C.sub}}>{intLbl}</span>
          </div>
          <div style={{height:7,borderRadius:4,background:C.surface,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${Math.min(100,(intProg/intMax)*100)}%`,background:intPhase==="run"?C.accent:"#f59e0b",borderRadius:4,transition:"width 0.3s"}}/>
          </div>
          {config.itype==="time" && (
            <div style={{fontSize:11,color:C.sub,marginTop:5,textAlign:"right"}}>
              Rep {intCount+1} of {config.reps}
            </div>
          )}
        </div>
      )}

      {/* Splits */}
      <div style={{flex:1,background:C.surface,borderRadius:18,padding:"12px 14px",border:`1px solid ${C.border}`,overflowY:"auto",maxHeight:160}}>
        <div style={{fontSize:10,color:C.sub,textTransform:"uppercase",letterSpacing:1.5,marginBottom:6}}>KM SPLITS</div>
        {splits.length===0
          ? <div style={{fontSize:13,color:C.sub,textAlign:"center",padding:"14px 0"}}>Splits appear after each km</div>
          : <>
              <SplitHeader C={C}/>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {[...splits].reverse().map(sp=>(
                  <SplitRow key={sp.km} C={C} sp={sp}/>
                ))}
              </div>
            </>
        }
      </div>

      {/* Controls */}
      <div style={{display:"flex",gap:10}}>
        {phase==="idle"   && <button style={bigBtn(C)} onClick={doStart}>▶ Start</button>}
        {phase==="running"&& <>
          <button style={{...ctrlB,background:"#f59e0b"}} onClick={doPause}>⏸ Pause</button>
          <button style={{...ctrlB,background:"#ef4444"}} onClick={doFinish}>⏹ Finish</button>
        </>}
        {phase==="paused" && <>
          <button style={{...ctrlB,background:C.accent,color:C.btn}} onClick={doResume}>▶ Resume</button>
          <button style={{...ctrlB,background:"#ef4444"}}            onClick={doFinish}>⏹ Finish</button>
        </>}
        {isDone && <button style={bigBtn(C)} onClick={doFinish}>💾 Save Run</button>}
      </div>
    </div>
  );
}
const ctrlB = {flex:1,border:"none",borderRadius:18,padding:"15px 0",fontSize:15,fontWeight:800,color:"#fff",cursor:"pointer"};
function MBox({C,label,value}) {
  return (
    <div style={{flex:1,background:C.surface,borderRadius:14,padding:"11px 0",textAlign:"center",border:`1px solid ${C.border}`}}>
      <div style={{fontSize:15,fontWeight:800,color:C.accent}}>{value}</div>
      <div style={{fontSize:10,color:C.sub,marginTop:2,letterSpacing:0.3}}>{label}</div>
    </div>
  );
}

// ─── DAY SCREEN ───────────────────────────────────────────────────────────────
function DayScreen({C,day,runs,onBack,onSelect}) {
  const label = new Date(day+"T12:00:00").toLocaleDateString("en-IN",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  return (
    <div style={sc(C)}>
      <NavBar C={C} title="Runs" onBack={onBack}/>
      <div style={{fontSize:14,fontWeight:700,color:C.text}}>{label}</div>
      <div style={{fontSize:12,color:C.sub}}>{runs.length} run{runs.length>1?"s":""} recorded</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {runs.map((r,i)=>(
          <div key={r.id} onClick={()=>onSelect(r)}
            style={{display:"flex",alignItems:"center",gap:10,background:C.surface,borderRadius:18,padding:"13px 14px",border:`1px solid ${C.border}`,cursor:"pointer"}}>
            <div style={{width:26,height:26,borderRadius:8,background:C.accent+"20",color:C.accent,fontSize:12,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:700,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
              <div style={{fontSize:11,color:C.sub,marginTop:3}}>
                {r.rtype==="interval"?`⚡ Intervals · ${r.intervalCount||0} reps`:"🏃 Long Run"}
                {r.location?` · 📍 ${r.location}`:""}
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:19,fontWeight:900,color:C.accent}}>{(r.distanceM/1000).toFixed(2)}</div>
              <div style={{fontSize:10,color:C.sub}}>km</div>
            </div>
            <span style={{color:C.sub,fontSize:22}}>›</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── DETAIL SCREEN ────────────────────────────────────────────────────────────
function DetailScreen({C,run,onRename,onSaveLoc,onDelete,onBack}) {
  const [name,       setName]      = useState(run.name);
  const [location,   setLocation]  = useState(run.location||"");
  const [nameDirty,  setNameDirty] = useState(false);
  const [locDirty,   setLocDirty]  = useState(false);
  const [fetchingLoc,setFetching]  = useState(false);

  // Keep in sync if parent run prop changes (e.g. after save)
  useEffect(() => { setName(run.name); setNameDirty(false); }, [run.name]);
  useEffect(() => { setLocation(run.location||""); setLocDirty(false); }, [run.location]);

  const dirty = nameDirty||locDirty;

  const handleSave = () => {
    if(nameDirty) { onRename(name);     setNameDirty(false); }
    if(locDirty)  { onSaveLoc(location); setLocDirty(false); }
  };

  const detectLoc = () => {
    if(!navigator.geolocation) return;
    setFetching(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const {latitude:lat,longitude:lng} = pos.coords;
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
          .then(r=>r.json())
          .then(d=>{ const a=d.address; setLocation([a.suburb||a.neighbourhood||a.village,a.city||a.town||a.county].filter(Boolean).join(", ")||`${lat.toFixed(4)},${lng.toFixed(4)}`); setLocDirty(true); })
          .catch(()=>{ setLocation(`${lat.toFixed(4)}, ${lng.toFixed(4)}`); setLocDirty(true); })
          .finally(()=>setFetching(false));
      },
      ()=>setFetching(false),
      {enableHighAccuracy:false,timeout:8000}
    );
  };

  return (
    <div style={sc(C)}>
      <NavBar C={C} title="Run Detail" onBack={onBack}/>

      {/* Name */}
      <FieldBox C={C} label="Run Name" dirty={nameDirty}>
        <input style={inp(C,nameDirty)} value={name}
          onChange={e=>{setName(e.target.value);setNameDirty(true);}}/>
        {nameDirty && <Hint C={C}/>}
      </FieldBox>

      {/* Location */}
      <FieldBox C={C} label="📍 Location" dirty={locDirty}>
        <div style={{display:"flex",gap:8}}>
          <input style={{...inp(C,locDirty),flex:1}} placeholder="e.g. Marine Drive, Mumbai"
            value={location} onChange={e=>{setLocation(e.target.value);setLocDirty(true);}}/>
          <button onClick={detectLoc} disabled={fetchingLoc}
            style={{background:C.accent+"22",border:`1px solid ${C.accent}44`,color:C.accent,borderRadius:12,padding:"0 12px",fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>
            {fetchingLoc?"…":"GPS"}
          </button>
        </div>
        {locDirty && <Hint C={C}/>}
      </FieldBox>

      <div style={{fontSize:12,color:C.sub}}>{new Date(run.date).toLocaleString("en-IN")}</div>

      {run.simulated && <Badge bg="#f59e0b18" col="#f59e0b" text="Simulated GPS"/>}
      {run.rtype==="interval" && <Badge bg={C.accent+"18"} col={C.accent} text={`⚡ Interval · ${run.intervalCount||0} reps`}/>}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[["Distance",`${(run.distanceM/1000).toFixed(2)} km`],["Duration",fmtTime(run.durationMs)],
          ["Avg Pace",fmtPace(run.durationMs,run.distanceM/1000)],["KM Splits",run.splits.length]
        ].map(([l,v])=>(
          <div key={l} style={{background:C.surface,borderRadius:16,padding:"14px",border:`1px solid ${C.border}`,textAlign:"center"}}>
            <div style={{fontSize:19,fontWeight:900,color:C.accent}}>{v}</div>
            <div style={{fontSize:10,color:C.sub,marginTop:4}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Splits */}
      {run.splits.length>0 && (
        <div style={{background:C.surface,borderRadius:18,padding:"12px 14px",border:`1px solid ${C.border}`,maxHeight:220,overflowY:"auto"}}>
          <div style={{fontSize:10,color:C.sub,textTransform:"uppercase",letterSpacing:1.5,marginBottom:6}}>KM SPLITS</div>
          <SplitHeader C={C}/>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {run.splits.map(sp=><SplitRow key={sp.km} C={C} sp={sp}/>)}
          </div>
        </div>
      )}

      {/* Bottom actions */}
      <div style={{display:"flex",gap:10,marginTop:"auto",paddingTop:6}}>
        <button onClick={handleSave}
          style={{flex:1,borderRadius:18,padding:"15px 0",fontSize:14,fontWeight:800,cursor:"pointer",
            background:dirty?C.accent:C.surface,color:dirty?C.btn:C.sub,border:`1.5px solid ${dirty?C.accent:C.border}`}}>
          ✓ Save
        </button>
        <button onClick={onDelete}
          style={{flex:1,borderRadius:18,padding:"15px 0",fontSize:14,fontWeight:800,cursor:"pointer",
            background:"#ef444420",color:"#ef4444",border:"1.5px solid #ef444450"}}>
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

function FieldBox({C,label,dirty,children}) {
  return (
    <div style={{background:C.card,borderRadius:16,padding:14,border:`1px solid ${dirty?C.accent:C.border}`}}>
      <div style={{fontSize:10,color:C.sub,textTransform:"uppercase",letterSpacing:1.2,marginBottom:7}}>{label}</div>
      {children}
    </div>
  );
}
function Hint({C}) { return <div style={{fontSize:10,color:C.accent,marginTop:5}}>Unsaved change</div>; }
function Badge({bg,col,text}) { return <div style={{background:bg,color:col,borderRadius:8,fontSize:11,padding:"3px 10px",fontWeight:700,alignSelf:"flex-start"}}>{text}</div>; }

// ─── SPLIT COMPONENTS ─────────────────────────────────────────────────────────
function SplitHeader({C}) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1.1fr 1.1fr",padding:"4px 10px 6px",gap:4}}>
      <span style={{fontSize:10,color:C.sub,fontWeight:700,letterSpacing:0.5}}>KM</span>
      <span style={{fontSize:10,color:C.sub,fontWeight:700,letterSpacing:0.5,textAlign:"center"}}>SPLIT</span>
      <span style={{fontSize:10,color:C.sub,fontWeight:700,letterSpacing:0.5,textAlign:"right"}}>TOTAL</span>
    </div>
  );
}
function SplitRow({C, sp}) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1.1fr 1.1fr",alignItems:"center",background:C.card,borderRadius:10,padding:"8px 10px",gap:4}}>
      <span style={{fontSize:13,fontWeight:800,color:C.text}}>KM {sp.km}</span>
      <span style={{fontSize:13,fontWeight:700,color:C.accent,textAlign:"center"}}>{fmtTime(sp.splitMs)}</span>
      <span style={{fontSize:12,fontWeight:600,color:C.sub,textAlign:"right"}}>{sp.totalMs!=null ? fmtTime(sp.totalMs) : "—"}</span>
    </div>
  );
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function NavBar({C,title,onBack}) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <button onClick={onBack} style={iconBtn(C)}>‹</button>
      <div style={{fontSize:17,fontWeight:800,color:C.text}}>{title}</div>
      <div style={{width:36}}/>
    </div>
  );
}

function rs(C) { return {minHeight:"100vh",background:`radial-gradient(ellipse at 50% 0%,${C.accent}18 0%,${C.bg} 60%)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'SF Pro Display','Helvetica Neue','Segoe UI',sans-serif",padding:16}; }
function ps(C) { return {width:"100%",maxWidth:390,minHeight:780,background:C.bg,borderRadius:44,overflow:"hidden",border:`1.5px solid ${C.border}`,boxShadow:"0 40px 100px #000c",display:"flex",flexDirection:"column"}; }
function sc(C) { return {flex:1,display:"flex",flexDirection:"column",padding:"48px 20px 30px",gap:14,overflowY:"auto"}; }
function bigBtn(C) { return {display:"flex",alignItems:"center",justifyContent:"center",gap:10,background:`linear-gradient(130deg,${C.accent},${C.accent}cc)`,color:C.btn,border:"none",borderRadius:22,padding:"17px 0",fontSize:17,fontWeight:900,cursor:"pointer",width:"100%",boxShadow:`0 6px 28px ${C.accent}44`}; }
function iconBtn(C) { return {background:C.surface,border:`1px solid ${C.border}`,color:C.sub,borderRadius:12,width:36,height:36,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}; }
function nbtn(C)    { return {background:"transparent",border:`1px solid ${C.border}`,color:C.sub,borderRadius:10,width:32,height:32,cursor:"pointer",fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}; }
function inp(C,d)   { return {width:"100%",background:C.surface,border:`1.5px solid ${d?C.accent:C.border}`,borderRadius:12,color:C.text,fontSize:15,padding:"10px 12px",outline:"none",boxSizing:"border-box"}; }
