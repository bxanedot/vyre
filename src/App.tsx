import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown, CircleHelp, Clock3, Crosshair, Gamepad2, Gauge, History, LayoutDashboard, Play, Radar, RotateCcw, Settings2, ShieldCheck, Signal, SlidersHorizontal, Wifi, Zap } from "lucide-react";
import type { Game, HistoryPoint, Sample, Settings, View } from "./types";

const defaults: Settings = { internet_target: "1.1.1.1", game_target: "", interval_seconds: 5, auto_detect: true };
const nav: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "home", label: "Overview", icon: LayoutDashboard },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "network", label: "Network", icon: Activity },
  { id: "optimizer", label: "Optimizer", icon: Zap },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings2 },
];
const ms = (value: number | null | undefined) => value == null ? "—" : Math.round(value).toString();
const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const stdJitter = (xs: number[]) => xs.length < 2 ? null : mean(xs.slice(1).map((x, i) => Math.abs(x - xs[i])));
function Chart({ points, kind = "internet" }: { points: HistoryPoint[]; kind?: "internet" | "game" }) {
  const values = points.slice(-36).map(p => kind === "internet" ? p.internet_ms : p.game_ms);
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return <div className="empty-graph"><BarChart3 size={26} /><span>Collecting measured samples…</span></div>;
  const min = Math.max(0, Math.min(...valid) * 0.8);
  const max = Math.max(...valid) * 1.18 + 1;
  const coords = values.map((v, i) => v == null ? null : [20 + i * (760 / Math.max(values.length - 1, 1)), 162 - ((v - min) / (max - min)) * 132] as const);
  const segments: string[] = []; let line = "";
  for (const c of coords) { if (!c) { if (line) segments.push(line); line = ""; } else line += (line ? " L " : "M ") + c[0].toFixed(1) + " " + c[1].toFixed(1); }
  if (line) segments.push(line);
  return <div className="graph"><svg viewBox="0 0 800 184" preserveAspectRatio="none" role="img" aria-label="Measured latency over time">
    {[30,74,118,162].map(y => <line key={y} x1="0" x2="800" y1={y} y2={y} stroke="#27313d" strokeDasharray="4 7" />)}
    {segments.map((d, i) => <path key={i} d={d} fill="none" stroke={kind === "game" ? "#9ca8ff" : "#8de6bb"} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />)}
  </svg><div className="graph-labels"><span>{values.length} recent measurements</span><span>{Math.round(min)}–{Math.round(max)} ms</span></div></div>;
}
function Stat({ title, value, unit, sub, icon: Icon, tone = "green" }: { title: string; value: string; unit?: string; sub: string; icon: typeof Activity; tone?: "green" | "blue" | "neutral" }) {
  return <div className="metric"><div className="metric-top"><span>{title}</span><Icon size={17} /></div><div className="metric-value">{value}<small>{unit}</small></div><div className={"metric-sub "+tone}>{sub}</div></div>;
}
function App() {
  const [view, setView] = useState<View>("home");
  const [settings, setSettings] = useState<Settings>(defaults);
  const [editing, setEditing] = useState<Settings>(defaults);
  const [games, setGames] = useState<Game[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [sample, setSample] = useState<Sample | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const supported = isTauri();
  const detected = games.find(g => g.foreground) ?? games[0] ?? null;
  const recent = history.slice(-30);
  const values = recent.map(p => p.internet_ms).filter((x): x is number => x !== null);
  const failures = recent.filter(p => p.internet_status !== "ok").length;
  const avg = mean(values);
  const jitter = stdJitter(values);
  const loss = recent.length ? 100 * failures / recent.length : null;

  const refresh = useCallback(async () => {
    if (!supported || runningRef.current) return;
    runningRef.current = true; setRunning(true);
    try {
      const result = await invoke<Sample>("sample_network");
      setSample(result);
      const [nextHistory, nextGames] = await Promise.all([invoke<HistoryPoint[]>("get_history"), invoke<Game[]>("detect_games")]);
      setHistory(nextHistory); setGames(nextGames); setError("");
    } catch (e) { setError(String(e)); }
    finally { runningRef.current = false; setRunning(false); }
  }, [supported]);

  useEffect(() => {
    if (!supported) { setError("Open VYRE in the desktop app to collect real measurements."); return; }
    void Promise.all([invoke<Settings>("get_settings"), invoke<HistoryPoint[]>("get_history"), invoke<Game[]>("detect_games")])
      .then(([s, h, g]) => { setSettings(s); setEditing(s); setHistory(h); setGames(g); })
      .catch(e => setError(String(e)));
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), settings.interval_seconds * 1000);
    return () => clearInterval(timer);
  }, [refresh, settings.interval_seconds, supported]);

  const save = async () => {
    if (!supported) return;
    try { const s = await invoke<Settings>("save_settings", { settings: editing }); setSettings(s); setEditing(s); setNotice("Settings saved locally"); setError(""); }
    catch (e) { setError(String(e)); }
  };
  const clear = async () => {
    if (!supported || !window.confirm("Permanently delete local measurement history?")) return;
    try { await invoke("clear_history"); setHistory([]); setSample(null); setNotice("Local history deleted"); }
    catch (e) { setError(String(e)); }
  };
  const gameStatus = !editing.game_target ? "No game server selected" : editing.game_target;
  const status = sample?.internet.status === "ok" ? "Monitoring live" : "Diagnostics active";
  const diagnosis = useMemo(() => {
    if (!recent.length) return "VYRE is collecting an initial baseline. Results are based on actual ICMP replies, not estimated in-game ping.";
    if (loss !== null && loss >= 10) return "Frequent ICMP probe failures were observed. Check Wi-Fi signal, local congestion, or whether the target blocks ICMP.";
    if (jitter !== null && jitter >= 20) return "Latency varies noticeably between probes. Check background downloads and competing traffic.";
    return "No major issue detected in recent internet probes. Game performance still depends on the actual server path and traffic.";
  }, [recent.length, loss, jitter]);

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-logo"><Activity size={23}/></div><div><strong>VYRE</strong><span>NETWORK INTELLIGENCE</span></div></div>
      <div className="side-section">WORKSPACE</div>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={"nav-item "+(view === id ? "selected" : "")} onClick={() => { setView(id); setNotice(""); }}><Icon size={18}/><span>{label}</span>{id==="optimizer"&&<span className="later">SOON</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy"><ShieldCheck size={18}/><div><b>Local-first</b><span>No account. No telemetry.</span></div></div><div className="version">VYRE 0.1.0 <span>•</span> OPEN SOURCE</div></div>
    </aside>
    <main className="main"><header className="topbar"><div className="breadcrumb">VYRE <span>/</span> {nav.find(n=>n.id===view)?.label}</div><div className="top-actions"><span className="live-dot"/><span>{supported ? status : "Desktop required"}</span><div className="avatar">V</div></div></header>
    <div className="page">
    {error && <div className="alert" role="alert"><CircleHelp size={18}/><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {view === "home" && <>
      <div className="eyebrow"><span className="pulse-dot"/> LIVE CONNECTION OVERVIEW</div>
      <div className="title-row"><div><h1>Your network, in focus.</h1><p>Real measurements. Clear diagnostics. No imaginary speed boosts.</p></div><button className="primary" disabled={!supported || running} onClick={() => void refresh()}><RotateCcw size={16} className={running?"spinning":""}/>{running?"Checking…":"Run check"}</button></div>
      <div className="hero"><div><span className="hero-kicker"><Radar size={17}/> ACTIVE SESSION</span><h2>{detected?.name ?? "No active game detected"}</h2><p>{detected ? detected.executable+" • PID "+detected.pid : "Open a supported game or select a custom target in Settings."}</p><div className="hero-tags"><span><span className="tag-dot"/> {detected ? "PROCESS DETECTED" : "AWAITING GAME"}</span><span>ICMP DIAGNOSTICS</span></div></div><div className="hero-orb"><Gauge size={74}/><span>{ms(sample?.internet.latency_ms)} <small>ms</small></span><small>INTERNET PROBE</small></div></div>
      <div className="metrics"><Stat title="Internet latency" value={ms(sample?.internet.latency_ms)} unit="ms" sub={sample?.internet.target ?? settings.internet_target} icon={Wifi}/><Stat title="Average latency" value={ms(avg)} unit="ms" sub="Recent successful probes" icon={Clock3} tone="blue"/><Stat title="Jitter estimate" value={ms(jitter)} unit="ms" sub="Mean consecutive delta" icon={Signal} tone="neutral"/><Stat title="Probe failures" value={loss==null?"—":loss.toFixed(1)} unit="%" sub={recent.length+" recent samples"} icon={Activity} tone="neutral"/></div>
      <div className="two-cols"><section className="panel"><div className="panel-heading"><div><h3>Latency timeline</h3><p>Internet target · measured ICMP response</p></div><span className="outline-label">LIVE</span></div><Chart points={history}/></section><section className="panel insights"><div className="panel-heading"><div><h3>Connection insight</h3><p>Based on recent network samples</p></div><SlidersHorizontal size={18}/></div><div className="insight-icon"><Activity size={22}/></div><h4>{recent.length ? "Current assessment" : "Establishing baseline"}</h4><p>{diagnosis}</p><button className="text-action" onClick={()=>setView("network")}>Explore measurements <ArrowUpRight size={16}/></button></section></div>
      <div className="disclaimer"><ShieldCheck size={17}/> VYRE 0.1.0 diagnoses your connection. It does not change routing, claim in-game ping, or apply privileged tweaks.</div>
    </>}
    {view === "games" && <><div className="page-title"><div className="eyebrow">PROCESS DISCOVERY</div><h1>Detected games</h1><p>Local process matching with conservative recognition. Launchers and browsers are excluded.</p></div><section className="panel"><div className="panel-heading"><div><h3>Running games</h3><p>{games.length} matching game processes</p></div><button className="secondary" onClick={()=>void refresh()} disabled={running||!supported}><RotateCcw size={15}/> Refresh</button></div>{games.length ? games.map(g=><div className="game-item" key={g.pid}><div className="game-icon"><Gamepad2/></div><div className="game-info"><b>{g.name}</b><span>{g.executable} · PID {g.pid}</span></div><span className="item-status">{g.foreground?"FOREGROUND":"RUNNING"}</span></div>) : <div className="empty-state"><Gamepad2 size={34}/><b>No known game processes found</b><p>Start a supported game. Detection is conservative and does not yet cover every executable.</p></div>}</section><section className="panel side-note"><h3>Game server detection</h3><p>Automatic per-process TCP/UDP endpoint association is planned but not implemented in 0.1.0. Set an actual server hostname or IP in Settings to probe it; do not assume a generic ping equals in-game ping.</p><button className="secondary" onClick={()=>setView("settings")}>Configure target <ArrowUpRight size={15}/></button></section></>}
    {view === "network" && <><div className="page-title"><div className="eyebrow">REAL-TIME DIAGNOSTICS</div><h1>Network measurements</h1><p>ICMP echo probes to targets you control. Firewalls can block ICMP without affecting game traffic.</p></div><div className="metrics network-metrics"><Stat title="Internet probe" value={ms(sample?.internet.latency_ms)} unit="ms" sub={settings.internet_target} icon={Wifi}/><Stat title="Game target probe" value={ms(sample?.game?.latency_ms)} unit="ms" sub={settings.game_target||"Not configured"} icon={Crosshair} tone="blue"/><Stat title="Jitter estimate" value={ms(jitter)} unit="ms" sub="Recent internet replies" icon={Activity}/><Stat title="Failed probes" value={loss==null?"—":loss.toFixed(1)} unit="%" sub="Not equivalent to game packet loss" icon={Signal} tone="neutral"/></div><section className="panel"><div className="panel-heading"><div><h3>Internet response time</h3><p>Unmodified ICMP sample history</p></div><span className="outline-label">ms</span></div><Chart points={history}/></section><section className="panel"><div className="panel-heading"><div><h3>Game target response time</h3><p>{settings.game_target||"Choose a target in Settings to enable probes"}</p></div><span className="outline-label">ms</span></div><Chart points={history} kind="game"/></section><div className="note-grid"><div><ArrowDownRight size={19}/><b>Normal network ping</b><p>Measured directly to your chosen public internet host.</p></div><div><ArrowUpRight size={19}/><b>Game endpoint ping</b><p>Only shown when you enter a real reachable game endpoint. Not the game's internal RTT.</p></div></div></>}
    {view === "optimizer" && <><div className="page-title"><div className="eyebrow">SAFE OPTIMIZATION ROADMAP</div><h1>Smart Boost</h1><p>Optimization will only activate after scoped changes and rollback are proven safe.</p></div><section className="panel under-construction"><div className="large-icon"><Zap size={35}/></div><h2>No optimization has been applied</h2><p>VYRE cannot lower ISP path latency without compatible infrastructure. Local congestion controls, QoS and bufferbloat tests require additional implementation, permissions, and reliable before/after verification.</p><button className="primary" disabled><Zap size={16}/> Boost unavailable in 0.1.0</button></section><section className="panel"><h3>Planned safety requirements</h3><div className="check-rows">{["Back up original configuration","Ask before any privileged change","Measure improvements against a baseline","Automatically revert ineffective changes","Recover safely after a crash"].map(t=><div key={t}><ShieldCheck size={18}/>{t}<span>NOT YET IMPLEMENTED</span></div>)}</div></section></>}
    {view === "history" && <><div className="page-title"><div className="eyebrow">LOCAL RECORDS</div><h1>Measurement history</h1><p>Stored in SQLite on your device. Only the latest 2,000 samples are retained.</p></div><section className="panel"><div className="panel-heading"><div><h3>Recent measurements</h3><p>{history.length} entries shown (latest 200)</p></div><button className="danger" onClick={()=>void clear()} disabled={!history.length}>Delete history</button></div><div className="history-wrap"><table><thead><tr><th>Time</th><th>Internet (ms)</th><th>Game target (ms)</th><th>Internet status</th></tr></thead><tbody>{history.slice(-100).reverse().map(p=><tr key={p.id}><td>{fmtTime(p.timestamp)}</td><td>{ms(p.internet_ms)}</td><td>{ms(p.game_ms)}</td><td><span className={"status-pill "+p.internet_status}>{p.internet_status}</span></td></tr>)}</tbody></table>{!history.length&&<div className="empty-state"><History/><p>No measurements recorded yet.</p></div>}</div></section></>}
    {view === "settings" && <><div className="page-title"><div className="eyebrow">LOCAL CONFIGURATION</div><h1>Settings</h1><p>Measurements are run on your computer. No account or cloud service is required.</p></div><section className="panel settings-panel"><h3>Probe targets</h3><p>Hostnames or IP addresses only. Never enter a URL or a port. Probes send one ICMP request per interval.</p><div className="field"><label htmlFor="internet">Internet reference host</label><input id="internet" value={editing.internet_target} onChange={e=>setEditing(s=>({...s,internet_target:e.target.value}))} placeholder="1.1.1.1"/><small>Example: 1.1.1.1. A public reference target is not your game server.</small></div><div className="field"><label htmlFor="game">Game server host <em>optional</em></label><input id="game" value={editing.game_target} onChange={e=>setEditing(s=>({...s,game_target:e.target.value}))} placeholder="Real server IP or hostname"/><small>{gameStatus}. An ICMP reply may not correspond to the game's UDP round-trip time.</small></div><div className="field"><label htmlFor="interval">Sample interval</label><div className="select-wrapper"><select id="interval" value={editing.interval_seconds} onChange={e=>setEditing(s=>({...s,interval_seconds:Number(e.target.value)}))}><option value="3">Every 3 seconds</option><option value="5">Every 5 seconds</option><option value="10">Every 10 seconds</option><option value="30">Every 30 seconds</option></select><ChevronDown size={16}/></div></div><label className="toggle-line"><span><b>Automatic game detection</b><small>Scan known game executable names locally</small></span><input type="checkbox" checked={editing.auto_detect} onChange={e=>setEditing(s=>({...s,auto_detect:e.target.checked}))}/></label><div className="save-row"><button className="primary" disabled={!supported} onClick={()=>void save()}>Save changes</button></div></section><section className="panel side-note"><h3>Updates and recovery</h3><p>Automatic updates, signing, elevated network modifications and crash rollback are not enabled in this first diagnostic build. Only install releases published by the repository owner.</p></section></>}
    </div></main>
  </div>;
}
export default App;
