import { useState, useRef, useCallback } from 'react';
import { useRemoteSession } from './hooks/useRemoteSession';
import './App.css';

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}
function fmtBytes(b) {
  if (!b) return '—';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}
function fmtDuration(d) {
  if (d == null) return '—';
  return `${Math.round(d)}ms`;
}
function dlJSON(data, name) {
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
  a.download = `${name}-${Date.now()}.json`;
  a.click();
}
function dlCSV(rows, headers, name) {
  const body = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(body);
  a.download = `${name}-${Date.now()}.csv`;
  a.click();
}

const TYPE_COLORS = {
  console:'#00FF66', network:'#0099FF', error:'#FF0066',
  performance:'#FFA500', agent:'#888', device:'#888', script:'#CC88FF',
  media:'#FF6633',
};
function typeColor(type) { return TYPE_COLORS[type?.split('.')[0]] || '#777'; }

// ── Shared: tiny log row ──────────────────────────────────────────────────────

function LogRow({ event }) {
  const [exp, setExp] = useState(false);
  const color = typeColor(event.type);
  const level = event.payload?.level;
  const levelColor = { error:'#FF0066', warn:'#FFA500', info:'#0099FF', log:'#ccc', debug:'#888' };

  let summary = '';
  switch (event.type) {
    case 'console':
      summary = `[${level}] ${event.payload?.args?.join(' ')}`; break;
    case 'network.request':
      summary = `${event.payload?.method} ${event.payload?.url}`; break;
    case 'network.response':
      // url is on the request event, not here — show status + duration
      summary = `${event.payload?.status}${event.payload?.statusText ? ' '+event.payload.statusText : ''} · ${fmtDuration(event.payload?.duration)}`; break;
    case 'network.error':
      summary = event.payload?.error; break;
    case 'error':
      summary = `${event.payload?.message}${event.payload?.filename ? ` (${event.payload.filename}:${event.payload.lineno})` : ''}`; break;
    case 'error.unhandled_rejection':
      summary = `Unhandled: ${String(event.payload?.reason)}`; break;
    case 'media.error':
      summary = `[${event.payload?.tag}] ${event.payload?.src} code:${event.payload?.error?.code}`; break;
    case 'performance.metrics':
      summary = event.payload?.memory
        ? `heap ${(event.payload.memory.usedJSHeapSize/1048576).toFixed(1)}MB / ${(event.payload.memory.jsHeapSizeLimit/1048576).toFixed(1)}MB limit`
        : 'no memory API'; break;
    case 'performance.fps':
      summary = `${event.payload?.fps} fps`; break;
    case 'script.result':
      summary = event.payload?.success ? event.payload.result : `✕ ${event.payload?.error}`; break;
    case 'agent.started':
      // agent emits { config, userAgent, url } — no version field
      summary = `${event.payload?.url} · ${event.payload?.userAgent?.split(' ').slice(-1)[0] || ''}`;
      break;
    case 'device.info':
      summary = `${event.payload?.platform || ''} · ${event.payload?.screenResolution || ''} · ${event.payload?.userAgent?.slice(0,60)}`; break;
    default:
      summary = JSON.stringify(event.payload)?.slice(0,120);
  }

  const summaryColor =
    event.type === 'console'            ? (levelColor[level] || '#ccc')
    : event.type?.startsWith('error')   ? '#FF6688'
    : event.type === 'media.error'      ? '#FF6633'
    : event.type === 'script.result'    ? (event.payload?.success ? '#00FF66' : '#FF0066')
    : event.type === 'network.response' ? (event.payload?.status >= 400 ? '#FF0066' : '#00FF66')
    : '#777';

  return (
    <div className="log-row" style={{ borderLeft: `2px solid ${color}` }} onClick={() => setExp(e => !e)}>
      <span className="lr-time">{fmtTime(event.timestamp)}</span>
      <span className="lr-type" style={{ color }}>{event.type}</span>
      <span className="lr-summary" style={{ color: summaryColor }}>{summary}</span>
      {exp && <pre className="lr-detail">{JSON.stringify(event.payload, null, 2)}</pre>}
    </div>
  );
}

// ── TAB: Console ──────────────────────────────────────────────────────────────

function ConsoleTab({ events, sendCommand }) {
  const [filter, setFilter] = useState('all');
  const [cmd, setCmd] = useState('');
  const [hist, setHist] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);

  // Console events + script results (so you see eval output inline)
  const all = events.filter(e => e.type === 'console' || e.type === 'script.result');
  const counts = {};
  ['log','warn','error','info','debug'].forEach(l => {
    counts[l] = events.filter(e => e.type === 'console' && e.payload?.level === l).length;
  });
  const shown = filter === 'all' ? all : all.filter(e => e.payload?.level === filter);

  function run() {
    if (!cmd.trim()) return;
    setHist(h => [...h, cmd]);
    setHistIdx(-1);
    sendCommand('script.execute', { code: cmd });
    setCmd('');
  }
  function onKey(e) {
    if (e.key === 'Enter') { run(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(i); setCmd(hist[i] || '');
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = histIdx + 1;
      if (i >= hist.length) { setHistIdx(-1); setCmd(''); }
      else { setHistIdx(i); setCmd(hist[i]); }
    }
  }

  return (
    <div className="tab-inner">
      <div className="toolbar">
        <div className="filter-pills">
          {['all','log','warn','error','info','debug'].map(f => (
            <button key={f} className={`pill ${filter===f?'active':''}`} onClick={() => setFilter(f)}>
              {f} ({f==='all' ? all.length : counts[f] || 0})
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <button className="tbtn" onClick={() => dlJSON(shown,'console')}>JSON</button>
          <button className="tbtn" onClick={() => dlCSV(
            shown.map(e=>[e.payload?.level||'result', e.payload?.args?.join(' ') || e.payload?.result || e.payload?.error || '', fmtTime(e.timestamp)]),
            ['Level','Message','Time'], 'console'
          )}>CSV</button>
        </div>
      </div>
      <div className="stream">
        {shown.length === 0 && <div className="empty">No console output yet</div>}
        {[...shown].reverse().map((e,i) => <LogRow key={i} event={e} />)}
      </div>
      <div className="console-bar">
        <span className="c-prompt">▶</span>
        <input
          className="c-input"
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={onKey}
          placeholder="Execute JavaScript on device… (↑↓ history, Enter to run)"
        />
        <button className="tbtn accent" onClick={run}>Run</button>
      </div>
    </div>
  );
}

// ── TAB: Network ──────────────────────────────────────────────────────────────

function NetworkTab({ events }) {
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('all');

  // Reconstruct request/response pairs from event stream.
  // IMPORTANT: request and response events carry different fields.
  // - network.request:  { requestId, url, method, headers (req headers), body (req body) }
  // - network.response: { requestId, status, statusText, headers (resp headers), responseBody, duration, size }
  // - network.error:    { requestId, error, duration }
  // We store req and resp headers separately to show both in detail panel.
  const map = {};
  events.filter(e => e.type?.startsWith('network.')).forEach(e => {
    const id = e.payload?.requestId;
    if (!id) return;
    if (!map[id]) map[id] = { requestId: id, ts: e.timestamp, status: 'pending' };

    if (e.type === 'network.request') {
      map[id].url       = e.payload.url;
      map[id].method    = e.payload.method;
      map[id].reqHeaders = e.payload.headers || {};
      map[id].reqBody   = e.payload.body || null;
      map[id].ts        = e.timestamp;
      // Detect fetch vs XHR from requestId prefix (agent uses req_ and xhr_)
      map[id].transport = id.startsWith('xhr_') ? 'xhr' : 'fetch';
    }
    if (e.type === 'network.response') {
      map[id].status      = e.payload.status;
      map[id].statusText  = e.payload.statusText;
      map[id].respHeaders = e.payload.headers || {};
      map[id].responseBody = e.payload.responseBody || e.payload.body || '';
      map[id].duration    = e.payload.duration;
      map[id].size        = e.payload.size;
    }
    if (e.type === 'network.error') {
      map[id].status   = 'failed';
      map[id].error    = e.payload.error;
      map[id].duration = e.payload.duration;
    }
  });

  const reqs = Object.values(map).sort((a, b) => a.ts - b.ts);
  const shown = filter === 'all'     ? reqs
    : filter === 'failed'            ? reqs.filter(r => r.status === 'failed')
    : reqs.filter(r => r.transport === filter);

  function sc(s) {
    if (s === 'pending') return 'c-pending';
    if (s === 'failed')  return 'c-fail';
    if (s >= 200 && s < 300) return 'c-ok';
    if (s >= 300 && s < 400) return 'c-redir';
    if (s >= 400) return 'c-err';
    return '';
  }

  const counts = {
    all: reqs.length,
    fetch: reqs.filter(r=>r.transport==='fetch').length,
    xhr:   reqs.filter(r=>r.transport==='xhr').length,
    failed:reqs.filter(r=>r.status==='failed').length,
  };

  return (
    <div className="tab-inner net-layout">
      <div className="net-list">
        <div className="toolbar">
          <div className="filter-pills">
            {['all','fetch','xhr','failed'].map(f => (
              <button key={f} className={`pill ${filter===f?'active':''}`} onClick={() => setFilter(f)}>
                {f} ({counts[f]})
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <button className="tbtn" onClick={() => dlJSON(shown,'network')}>JSON</button>
            <button className="tbtn" onClick={() => dlCSV(
              shown.map(r=>[r.method||'',r.url||'',r.status||'',r.transport||'',fmtDuration(r.duration),fmtBytes(r.size)]),
              ['Method','URL','Status','Transport','Duration','Size'],'network'
            )}>CSV</button>
          </div>
        </div>
        <div className="net-head">
          <span className="nc-m">Method</span>
          <span className="nc-u">URL</span>
          <span className="nc-s">Status</span>
          <span className="nc-sz">Size</span>
          <span className="nc-d">Time</span>
        </div>
        <div className="stream">
          {shown.length === 0 && <div className="empty">No network requests yet</div>}
          {shown.map((r,i) => (
            <div key={i} className={`net-row ${sel?.requestId===r.requestId?'sel':''}`} onClick={() => setSel(r)}>
              <span className="nc-m">{r.method||'?'}</span>
              <span className="nc-u" title={r.url}>{r.url}</span>
              <span className={`nc-s ${sc(r.status)}`}>{r.status==='pending'?'…':r.status}</span>
              <span className="nc-sz">{fmtBytes(r.size)}</span>
              <span className="nc-d">{fmtDuration(r.duration)}</span>
            </div>
          ))}
        </div>
      </div>

      {sel && (
        <div className="net-detail">
          <div className="nd-head">
            Request Details
            <button className="x-btn" onClick={() => setSel(null)}>✕</button>
          </div>
          <div className="nd-body">
            {[
              ['URL',        sel.url],
              ['Method',     sel.method],
              ['Status',     sel.status !== 'pending' && sel.status !== 'failed' ? `${sel.status} ${sel.statusText||''}` : sel.status],
              ['Transport',  sel.transport],
              ['Duration',   fmtDuration(sel.duration)],
              ['Size',       fmtBytes(sel.size)],
            ].map(([k,v]) => (
              <div key={k} className="nd-row">
                <span className="nd-k">{k}</span>
                <span className="nd-v">{v ?? '—'}</span>
              </div>
            ))}

            {sel.reqHeaders && Object.keys(sel.reqHeaders).length > 0 && <>
              <div className="nd-sec">Request Headers</div>
              {Object.entries(sel.reqHeaders).map(([k,v]) => (
                <div key={k} className="nd-row"><span className="nd-k">{k}</span><span className="nd-v">{v}</span></div>
              ))}
            </>}

            {sel.reqBody && <>
              <div className="nd-sec">Request Body</div>
              <pre className="nd-pre">{sel.reqBody}</pre>
            </>}

            {sel.respHeaders && Object.keys(sel.respHeaders).length > 0 && <>
              <div className="nd-sec">Response Headers</div>
              {Object.entries(sel.respHeaders).map(([k,v]) => (
                <div key={k} className="nd-row"><span className="nd-k">{k}</span><span className="nd-v">{v}</span></div>
              ))}
            </>}

            {sel.responseBody && <>
              <div className="nd-sec">Response Body</div>
              <pre className="nd-pre">{sel.responseBody.slice(0,4000)}</pre>
            </>}

            {sel.error && <>
              <div className="nd-sec">Error</div>
              <pre className="nd-pre nd-err">{sel.error}</pre>
            </>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── TAB: Errors ───────────────────────────────────────────────────────────────

function ErrorsTab({ events }) {
  // Include both JS errors and media errors
  const errs = events.filter(e =>
    e.type === 'error' ||
    e.type === 'error.unhandled_rejection' ||
    e.type === 'media.error'
  );
  return (
    <div className="tab-inner">
      <div className="toolbar">
        <span style={{color: errs.length ? '#FF0066' : '#444', fontSize:12}}>
          {errs.length} error{errs.length !== 1 ? 's' : ''}
        </span>
        <div className="toolbar-right">
          <button className="tbtn" onClick={() => dlJSON(errs,'errors')}>Export JSON</button>
        </div>
      </div>
      <div className="stream">
        {errs.length === 0 && <div className="empty">No errors recorded</div>}
        {[...errs].reverse().map((e,i) => (
          <div key={i} className="err-block">
            <div className="err-hd">
              <span className="err-type">{e.type}</span>
              <span className="err-t">{fmtTime(e.timestamp)}</span>
            </div>
            {/* JS error */}
            {e.type === 'error' && <>
              <div className="err-msg">{e.payload?.message}</div>
              {e.payload?.filename && (
                <div className="err-loc">{e.payload.filename}:{e.payload.lineno}:{e.payload.colno}</div>
              )}
              {e.payload?.error?.stack && <pre className="err-stack">{e.payload.error.stack}</pre>}
            </>}
            {/* Unhandled rejection — reason may be object or string */}
            {e.type === 'error.unhandled_rejection' && <>
              <div className="err-msg">{String(e.payload?.reason)}</div>
            </>}
            {/* Media error */}
            {e.type === 'media.error' && <>
              <div className="err-msg">[{e.payload?.tag}] code {e.payload?.error?.code}: {e.payload?.error?.message}</div>
              <div className="err-loc">{e.payload?.src}</div>
              <div className="err-loc">networkState: {e.payload?.networkState} · readyState: {e.payload?.readyState}</div>
            </>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TAB: Monitor / Performance ────────────────────────────────────────────────

function MonitorTab({ events }) {
  // Agent emits performance.metrics (memory + timing) every 5s
  // and performance.fps every second via requestAnimationFrame
  const perfEvts = events.filter(e => e.type === 'performance.metrics');
  const fpsEvts  = events.filter(e => e.type === 'performance.fps');

  // Last known values
  const latestMetrics = perfEvts.slice(-1)[0];
  const latestFps     = fpsEvts.slice(-1)[0];

  const mem    = latestMetrics?.payload?.memory;   // { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit }
  const timing = latestMetrics?.payload?.timing;   // { loadTime, domReady }
  const fps    = latestFps?.payload?.fps ?? null;

  // Chart history (last 30 data points)
  const fpsHist = fpsEvts.slice(-30).map(e => e.payload?.fps ?? 0);
  const memHist = perfEvts.filter(e => e.payload?.memory).slice(-30)
    .map(e => Math.round(e.payload.memory.usedJSHeapSize / 1048576));

  const memUsed  = mem ? Math.round(mem.usedJSHeapSize  / 1048576) : null;
  const memTotal = mem ? Math.round(mem.totalJSHeapSize / 1048576) : null;
  const memLimit = mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null;

  function fpsColor(f) { return f >= 55 ? '#00FF66' : f >= 30 ? '#88FF44' : f >= 20 ? '#FFA500' : '#FF0066'; }
  function fpsLabel(f) { return f >= 55 ? 'excellent' : f >= 30 ? 'good' : f >= 20 ? 'fair' : 'poor'; }
  function memColor(used, limit) {
    const pct = used / limit * 100;
    return pct < 50 ? '#00FF66' : pct < 70 ? '#88FF44' : pct < 85 ? '#FFA500' : '#FF0066';
  }

  function MiniBar({ data, color, max, h = 50 }) {
    const m = max || Math.max(...data, 1);
    return (
      <div style={{display:'flex',alignItems:'flex-end',height:h,gap:1,marginTop:8}}>
        {data.map((v,i) => (
          <div key={i} style={{flex:1,minWidth:3,height:`${Math.max((v/m)*100,2)}%`,background:color,borderRadius:'1px 1px 0 0',opacity:.85}} title={`${v}`} />
        ))}
        {data.length === 0 && <span style={{color:'#222',fontSize:10,alignSelf:'center'}}>no data yet</span>}
      </div>
    );
  }

  return (
    <div className="tab-inner">
      <div className="metric-grid">
        <div className="metric-card">
          <div className="mc-title">
            FPS
            {fps !== null && <span style={{color:fpsColor(fps),fontSize:10}}>{fpsLabel(fps)}</span>}
          </div>
          <div className="mc-val" style={{color: fps !== null ? fpsColor(fps) : '#333'}}>
            {fps !== null ? fps : '—'}
          </div>
          <div className="mc-sub">frames per second</div>
          <MiniBar data={fpsHist} color={fps !== null ? fpsColor(fps) : '#2a2a2a'} max={60} />
        </div>

        <div className="metric-card">
          <div className="mc-title">
            JS Heap
            {memUsed !== null && memLimit !== null && (
              <span style={{color:memColor(memUsed,memLimit),fontSize:10}}>
                {Math.round(memUsed/memLimit*100)}%
              </span>
            )}
          </div>
          <div className="mc-val">{memUsed !== null ? `${memUsed} MB` : '—'}</div>
          <div className="mc-sub">
            {memTotal !== null
              ? `total ${memTotal} MB · limit ${memLimit} MB`
              : 'memory API not available on this device'}
          </div>
          <MiniBar data={memHist} color="#0099FF" max={memLimit || undefined} />
        </div>

        <div className="metric-card">
          <div className="mc-title">Page Load</div>
          <div className="mc-val">{timing?.loadTime ? `${timing.loadTime}ms` : '—'}</div>
          <div className="mc-sub">
            {timing?.domReady ? `DOM ready ${timing.domReady}ms` : ''}
          </div>
          <div style={{marginTop:12,fontSize:10,color:'#333'}}>
            {perfEvts.length} metric samples · {fpsEvts.length} fps samples
          </div>
        </div>
      </div>

      <div className="stream" style={{flex:1}}>
        <div className="sec-title">Full metrics history</div>
        {[...perfEvts].reverse().slice(0,200).map((e,i) => <LogRow key={i} event={e} />)}
        {perfEvts.length === 0 && (
          <div className="empty">Performance metrics are emitted every 5 seconds by the agent</div>
        )}
      </div>
    </div>
  );
}

// ── TAB: Storage ──────────────────────────────────────────────────────────────
// Uses a fetch-ID to avoid confusing results from Script Runner tab
// with results triggered here.

function StorageTab({ events, sendCommand }) {
  const [tab, setTab] = useState('local');
  const [loading, setLoading] = useState(false);
  const [fetchId, setFetchId] = useState(null);   // track which script.result belongs to us
  const [data, setData] = useState(null);          // last parsed storage result

  // When a script.result arrives after our fetch, capture it
  const resultEvents = events.filter(e => e.type === 'script.result');
  const lastResult = resultEvents.slice(-1)[0];

  // Only update our display if this result was triggered by the latest fetch
  // We embed the fetchId in a comment in the code so we can match it
  const myResult = lastResult?.payload?._fetchId === fetchId ? lastResult : null;

  // Parse on new matching result
  if (myResult && myResult.payload.success) {
    let parsed = null;
    try { parsed = JSON.parse(myResult.payload.result); } catch(e) {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed).map(([k,v]) => ({ key: k, value: String(v) }));
      // Update data only if it changed (avoid infinite render)
      if (JSON.stringify(entries) !== JSON.stringify(data)) {
        // use effect-free update via ref trick would be cleaner, but this works for now
      }
    }
  }

  // Simpler approach: just use the last script.result that is valid JSON object
  // and was triggered after the last Fetch click (tracked by timestamp)
  const [lastFetchTs, setLastFetchTs] = useState(null);
  const matchedResult = resultEvents
    .filter(e => lastFetchTs && e.timestamp >= lastFetchTs && e.payload?.success)
    .slice(-1)[0];

  let entries = null;
  if (matchedResult?.payload?.success) {
    try {
      const p = JSON.parse(matchedResult.payload.result);
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        entries = Object.entries(p).map(([k,v]) => ({ key: k, value: String(v) }));
      }
    } catch(e) {}
  }

  function fetchStorage(type) {
    const ts = Date.now();
    setLastFetchTs(ts);
    setLoading(true);
    const code = {
      local:   `JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(function(k){return[k,localStorage.getItem(k)]})))`,
      session: `JSON.stringify(Object.fromEntries(Object.keys(sessionStorage).map(function(k){return[k,sessionStorage.getItem(k)]})))`,
      cookies: `JSON.stringify(document.cookie.split(';').reduce(function(acc,c){var p=c.trim().split('=');if(p[0])acc[decodeURIComponent(p[0])]=decodeURIComponent(p.slice(1).join('='));return acc;},{}))`,
    }[type];
    sendCommand('script.execute', { code });
    setTimeout(() => setLoading(false), 3000);
  }

  function deleteKey(key) {
    const code = tab === 'local'   ? `localStorage.removeItem(${JSON.stringify(key)});'deleted ${key}'`
      : tab === 'session'          ? `sessionStorage.removeItem(${JSON.stringify(key)});'deleted ${key}'`
      : `document.cookie=${JSON.stringify(key+'=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/')};'deleted ${key}'`;
    sendCommand('script.execute', { code });
    // Re-fetch after short delay so the view updates
    setTimeout(() => fetchStorage(tab), 500);
  }

  function clearAll() {
    if (!window.confirm(`Clear all ${tab} on the device?`)) return;
    const code = tab === 'local'   ? `localStorage.clear();'localStorage cleared'`
      : tab === 'session'          ? `sessionStorage.clear();'sessionStorage cleared'`
      : `document.cookie.split(';').forEach(function(c){var k=c.split('=')[0].trim();document.cookie=k+'=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/;';});'cookies cleared'`;
    sendCommand('script.execute', { code });
    setTimeout(() => fetchStorage(tab), 500);
  }

  function switchTab(t) { setTab(t); setLastFetchTs(null); }

  return (
    <div className="tab-inner">
      <div className="toolbar">
        <div className="filter-pills">
          {[['local','localStorage'],['session','sessionStorage'],['cookies','Cookies']].map(([id,lbl]) => (
            <button key={id} className={`pill ${tab===id?'active':''}`} onClick={() => switchTab(id)}>{lbl}</button>
          ))}
        </div>
        <div className="toolbar-right">
          <button className="tbtn accent" onClick={() => fetchStorage(tab)} disabled={loading}>
            {loading ? 'Loading…' : 'Fetch from Device'}
          </button>
          {entries && <button className="tbtn" onClick={() => dlJSON(entries, tab)}>JSON</button>}
          {entries && <button className="tbtn" onClick={() => dlCSV(entries.map(e=>[e.key,e.value]),['Key','Value'],tab)}>CSV</button>}
        </div>
      </div>

      {entries ? (
        <>
          <div className="st-head">
            <span className="stc-k">Key ({entries.length})</span>
            <span className="stc-v">Value</span>
            <span className="stc-a"> </span>
          </div>
          <div className="stream">
            {entries.length === 0
              ? <div className="empty">{tab} is empty on device</div>
              : entries.map((item,i) => (
                <div key={i} className="st-row">
                  <span className="stc-k c-green" title={item.key}>{item.key}</span>
                  <span className="stc-v" title={item.value}>{item.value.slice(0,200)}</span>
                  <button className="mini-btn" onClick={() => deleteKey(item.key)}>Del</button>
                </div>
              ))
            }
          </div>
          <div className="bottom-bar">
            <button className="tbtn danger" onClick={clearAll}>Clear All</button>
            <button className="tbtn" onClick={() => fetchStorage(tab)}>↻ Refresh</button>
          </div>
        </>
      ) : (
        <div className="empty">
          Click "Fetch from Device" to load {tab === 'local' ? 'localStorage' : tab === 'session' ? 'sessionStorage' : 'cookies'} from the device
        </div>
      )}
    </div>
  );
}

// ── TAB: System Info ──────────────────────────────────────────────────────────

function SystemInfoTab({ events, sendCommand }) {
  const [loading, setLoading] = useState(false);
  const [lastFetchTs, setLastFetchTs] = useState(null);

  // Populated automatically when device connects
  const devInfo  = [...events].reverse().find(e => e.type === 'device.info')?.payload || {};
  // agent.started carries { config, userAgent, url } — no version field in this agent build
  const agentEvt = [...events].reverse().find(e => e.type === 'agent.started')?.payload || {};

  const resultEvents = events.filter(e => e.type === 'script.result');
  const matchedResult = resultEvents
    .filter(e => lastFetchTs && e.timestamp >= lastFetchTs)
    .slice(-1)[0];

  function fetchAll() {
    const ts = Date.now();
    setLastFetchTs(ts);
    setLoading(true);
    sendCommand('script.execute', { code: `(function(){
      var i = {
        url: location.href,
        title: document.title,
        platform: navigator.platform,
        language: navigator.language,
        languages: navigator.languages && navigator.languages.join(', '),
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        cpuCores: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory != null ? navigator.deviceMemory + ' GB' : 'unknown',
        screen: screen.width + 'x' + screen.height,
        availScreen: screen.availWidth + 'x' + screen.availHeight,
        colorDepth: screen.colorDepth + '-bit',
        pixelRatio: window.devicePixelRatio,
        orientation: screen.orientation && screen.orientation.type,
        touch: 'ontouchstart' in window,
        maxTouchPoints: navigator.maxTouchPoints,
        fullscreen: document.fullscreenElement != null
      };
      if (performance.memory) {
        i.heapUsed  = Math.round(performance.memory.usedJSHeapSize  / 1048576) + ' MB';
        i.heapTotal = Math.round(performance.memory.totalJSHeapSize / 1048576) + ' MB';
        i.heapLimit = Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB';
        i.heapPct   = Math.round(performance.memory.usedJSHeapSize  / performance.memory.jsHeapSizeLimit * 100) + '%';
      }
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        i.connType = conn.effectiveType;
        i.downlink = conn.downlink + ' Mbps';
        i.rtt      = conn.rtt + ' ms';
        i.saveData = conn.saveData;
      }
      try {
        var c = document.createElement('canvas');
        var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        if (gl) {
          i.webgl = 'Supported';
          var ext = gl.getExtension('WEBGL_debug_renderer_info');
          if (ext) {
            i.gpuVendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
            i.gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          }
        } else { i.webgl = 'Not supported'; }
      } catch(e) { i.webgl = 'Error: ' + e.message; }
      return JSON.stringify(i, null, 2);
    })()` });
    setTimeout(() => setLoading(false), 5000);
  }

  function InfoRow({ k, v }) {
    if (v == null || v === '') return null;
    return (
      <div className="ir">
        <span className="ik">{k}</span>
        <span className="iv">{String(v)}</span>
      </div>
    );
  }

  return (
    <div className="tab-inner" style={{overflowY:'auto'}}>
      <div className="toolbar">
        <button className="tbtn accent" onClick={fetchAll} disabled={loading}>
          {loading ? 'Fetching…' : 'Fetch Full Info from Device'}
        </button>
        <div className="toolbar-right">
          <button className="tbtn" onClick={() => { setLastFetchTs(Date.now()); sendCommand('script.execute',{code:`JSON.stringify({online:navigator.onLine,url:location.href,title:document.title})`}); }}>Online status</button>
          <button className="tbtn" onClick={() => { setLastFetchTs(Date.now()); sendCommand('script.execute',{code:`performance.memory?JSON.stringify({usedMB:Math.round(performance.memory.usedJSHeapSize/1048576),limitMB:Math.round(performance.memory.jsHeapSizeLimit/1048576)}):'Memory API not available'`}); }}>Memory</button>
          <button className="tbtn" onClick={() => { setLastFetchTs(Date.now()); sendCommand('script.execute',{code:`'storage' in navigator&&navigator.storage.estimate?navigator.storage.estimate().then(function(e){return Math.round(e.usage/1048576)+'MB used of '+Math.round(e.quota/1048576)+'MB'}):'Storage API not available'`}); }}>Storage quota</button>
        </div>
      </div>

      {/* Script result from fetch or quick actions */}
      {matchedResult && (
        <div className="info-sec">
          <div className="sec-title">Result</div>
          {matchedResult.payload.success
            ? <pre className="pre-block">{matchedResult.payload.result}</pre>
            : <pre className="pre-block pre-err">{matchedResult.payload.error}</pre>}
        </div>
      )}

      {/* device.info — emitted automatically by agent on connect */}
      {Object.keys(devInfo).length > 0 && (
        <div className="info-sec">
          <div className="sec-title">Device info (auto-collected on connect)</div>
          <InfoRow k="User Agent"    v={devInfo.userAgent} />
          <InfoRow k="Platform"      v={devInfo.platform} />
          <InfoRow k="Language"      v={devInfo.language} />
          <InfoRow k="Online"        v={devInfo.onLine != null ? (devInfo.onLine ? 'Yes' : 'No') : null} />
          <InfoRow k="Cookies"       v={devInfo.cookieEnabled != null ? (devInfo.cookieEnabled ? 'Enabled' : 'Disabled') : null} />
          <InfoRow k="Screen"        v={devInfo.screenResolution} />
          <InfoRow k="Viewport"      v={devInfo.viewport} />
          <InfoRow k="CPU Cores"     v={devInfo.hardwareConcurrency} />
          <InfoRow k="Device Memory" v={devInfo.deviceMemory != null ? `${devInfo.deviceMemory} GB` : null} />
        </div>
      )}

      {/* agent.started — emitted when agent initialises */}
      {agentEvt.url && (
        <div className="info-sec">
          <div className="sec-title">Agent startup info</div>
          <InfoRow k="URL"        v={agentEvt.url} />
          <InfoRow k="User Agent" v={agentEvt.userAgent} />
          {/* agent.config fields */}
          {agentEvt.config && Object.entries(agentEvt.config).map(([k,v]) => (
            <InfoRow key={k} k={`config.${k}`} v={String(v)} />
          ))}
        </div>
      )}

      {Object.keys(devInfo).length === 0 && !agentEvt.url && !matchedResult && (
        <div className="empty">Waiting for device.info event from agent…<br/>This is emitted automatically on connect.</div>
      )}
    </div>
  );
}

// ── TAB: Application ──────────────────────────────────────────────────────────

function ApplicationTab({ events, sendCommand }) {
  const [lastFetchTs, setLastFetchTs] = useState(null);
  const resultEvents = events.filter(e => e.type === 'script.result');
  const lastResult = resultEvents
    .filter(e => lastFetchTs && e.timestamp >= lastFetchTs)
    .slice(-1)[0];

  function run(code) {
    setLastFetchTs(Date.now());
    sendCommand('script.execute', { code });
  }

  const checks = [
    { label:'Service Workers',
      code:`'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then(function(rs){return JSON.stringify(rs.map(function(r){return{scope:r.scope,state:r.active&&r.active.state,scriptURL:r.active&&r.active.scriptURL}}))}) : 'Not supported'` },
    { label:'Cache Storage',
      code:`'caches' in window ? caches.keys().then(function(keys){return Promise.all(keys.map(function(n){return caches.open(n).then(function(c){return c.keys().then(function(r){return{name:n,entries:r.length}})})})).then(JSON.stringify)}) : 'Not supported'` },
    { label:'App Manifest',
      code:`JSON.stringify(Array.from(document.querySelectorAll('link[rel="manifest"]')).map(function(l){return l.href}))` },
    { label:'Online / readyState',
      code:`JSON.stringify({online:navigator.onLine,protocol:location.protocol,host:location.host,readyState:document.readyState,visibilityState:document.visibilityState})` },
    { label:'Storage Estimate',
      code:`'storage' in navigator && navigator.storage.estimate ? navigator.storage.estimate().then(function(e){return JSON.stringify({usageMB:+(e.usage/1048576).toFixed(2),quotaMB:+(e.quota/1048576).toFixed(2)})}) : 'StorageManager not available'` },
  ];

  return (
    <div className="tab-inner" style={{overflowY:'auto'}}>
      <div className="info-sec">
        <div className="sec-title">Checks</div>
        <div className="snippet-row">
          {checks.map(c => <button key={c.label} className="snip-btn" onClick={() => run(c.code)}>{c.label}</button>)}
        </div>
      </div>
      <div className="info-sec">
        <div className="sec-title">Cache Management</div>
        <div className="snippet-row">
          <button className="snip-btn" onClick={() => run(`caches.keys().then(function(k){return k.join(', ') || 'no caches'})`)}> List cache names</button>
          <button className="snip-btn danger" onClick={() => { if(window.confirm('Delete ALL caches on device?')) run(`caches.keys().then(function(k){return Promise.all(k.map(function(n){return caches.delete(n)}))}).then(function(){return 'All caches cleared'})`); }}>Clear All Caches</button>
          <button className="snip-btn" onClick={() => run(`'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}).then(function(){return rs.length + ' SW(s) unregistered'}) : 'Not supported'`)}>Unregister SWs</button>
        </div>
      </div>
      {lastResult && (
        <div className="info-sec">
          <div className="sec-title">Result</div>
          {lastResult.payload.success
            ? <pre className="pre-block">{lastResult.payload.result}</pre>
            : <pre className="pre-block pre-err">{lastResult.payload.error}</pre>}
        </div>
      )}
    </div>
  );
}

// ── TAB: Quick Actions ────────────────────────────────────────────────────────

function QuickActionsTab({ events, sendCommand, device }) {
  const [refreshH, setRefreshH] = useState(1);
  const [lastFetchTs, setLastFetchTs] = useState(null);
  const resultEvents = events.filter(e => e.type === 'script.result');
  const lastResult = resultEvents.filter(e => lastFetchTs && e.timestamp >= lastFetchTs).slice(-1)[0];

  function run(code) { setLastFetchTs(Date.now()); sendCommand('script.execute', { code }); }

  const actions = [
    { label:'Clear Everything', sub:'localStorage + sessionStorage + cookies + caches → reload', danger:true,
      fn:()=>{ if(window.confirm('Clear ALL storage and caches on device, then reload?')) run(
        `localStorage.clear(); sessionStorage.clear();
         document.cookie.split(';').forEach(function(c){var k=c.split('=')[0].trim();document.cookie=k+'=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/;';});
         ('caches' in window ? caches.keys().then(function(k){return Promise.all(k.map(function(n){return caches.delete(n)}))}).then(function(){window.location.reload();}) : (window.location.reload(), 'done'))`
      ); }},
    { label:'Stop All Media',  sub:'Pause + unload all video/audio elements',
      fn:()=>run(`var els=document.querySelectorAll('video,audio');els.forEach(function(m){m.pause();m.removeAttribute('src');m.load();});'Stopped '+els.length+' media element(s)'`)},
    { label:'Reset Videos',    sub:'Reload video src (triggers re-buffering)',
      fn:()=>run(`var vs=document.querySelectorAll('video');vs.forEach(function(v){var s=v.src;v.src='';v.load();v.src=s;v.load();});'Reset '+vs.length+' video(s)'`)},
    { label:'Force GC',        sub:'Trigger garbage collection (requires --expose-gc)',
      fn:()=>run(`window.gc ? (window.gc(), 'GC triggered') : 'GC not available — needs --expose-gc flag'`)},
    { label:'Check Resources', sub:'Find broken img/video/audio elements',
      fn:()=>run(`JSON.stringify(Array.from(document.querySelectorAll('img,video,audio')).filter(function(e){return (e.tagName==='IMG'&&!e.complete)||e.error}).map(function(e){return{tag:e.tagName,src:e.currentSrc||e.src,error:e.error&&e.error.message}}))`)},
    { label:'Toggle Fullscreen',sub:'Enter or exit fullscreen',
      fn:()=>run(`document.fullscreenElement ? document.exitFullscreen().then(function(){return 'Exited fullscreen'}) : document.documentElement.requestFullscreen().then(function(){return 'Entered fullscreen'})`)},
    { label:'Page Info',       sub:'URL, title, readyState, visibility',
      fn:()=>run(`JSON.stringify({url:location.href,title:document.title,readyState:document.readyState,visibility:document.visibilityState,scrollY:window.scrollY})`)},
    { label:'Reload Page',     sub:'window.location.reload() on device', danger:false,
      fn:()=>{ if(window.confirm('Reload the device page?')) sendCommand('agent.reload'); }},
  ];

  return (
    <div className="tab-inner" style={{overflowY:'auto'}}>
      <div className="qa-grid">
        {actions.map(a => (
          <button key={a.label} className={`qa-card ${a.danger?'qa-danger':''}`} onClick={a.fn}>
            <div className="qa-title">{a.label}</div>
            <div className="qa-sub">{a.sub}</div>
          </button>
        ))}
      </div>

      {lastResult && (
        <div className="info-sec">
          <div className="sec-title">Last Result</div>
          {lastResult.payload.success
            ? <pre className="pre-block">{lastResult.payload.result}</pre>
            : <pre className="pre-block pre-err">{lastResult.payload.error}</pre>}
        </div>
      )}

      <div className="info-sec">
        <div className="sec-title">Auto-Refresh Scheduler</div>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <label style={{fontSize:12,color:'#666'}}>Reload device every</label>
          <input type="number" min="1" max="168" value={refreshH}
            onChange={e=>setRefreshH(Number(e.target.value))} className="mini-input" style={{width:60}} />
          <label style={{fontSize:12,color:'#666'}}>hour(s)</label>
          <button className="tbtn" onClick={() => run(`setTimeout(function(){window.location.reload();},${refreshH*3600000});'Auto-reload scheduled in ${refreshH}h'`)}>
            Schedule
          </button>
        </div>
      </div>

      <div className="info-sec">
        <div className="sec-title">Export Debug Report</div>
        <button className="tbtn accent" onClick={() => dlJSON({
          exportedAt: new Date().toISOString(),
          device,
          eventCount: events.length,
          errors: events.filter(e=>e.type==='error'||e.type==='error.unhandled_rejection'),
          events: events.slice(-500),
        }, 'insidr-debug-report')}>
          Download (last 500 events + all errors)
        </button>
      </div>
    </div>
  );
}

// ── TAB: Script Runner ────────────────────────────────────────────────────────

const SNIPPETS = [
  { label:'Video status',     code:`var v=document.querySelector('video');v?JSON.stringify({src:v.src,currentSrc:v.currentSrc,readyState:v.readyState,networkState:v.networkState,paused:v.paused,currentTime:v.currentTime,duration:v.duration,error:v.error&&{code:v.error.code,message:v.error.message}}):'No video element found'` },
  { label:'All videos',       code:`JSON.stringify(Array.from(document.querySelectorAll('video')).map(function(v,i){return{i:i,src:v.currentSrc||v.src,readyState:v.readyState,networkState:v.networkState,paused:v.paused,error:v.error&&v.error.message}}))` },
  { label:'Memory',           code:`performance.memory?JSON.stringify({usedMB:Math.round(performance.memory.usedJSHeapSize/1048576),totalMB:Math.round(performance.memory.totalJSHeapSize/1048576),limitMB:Math.round(performance.memory.jsHeapSizeLimit/1048576)}):'Memory API not available'` },
  { label:'localStorage',     code:`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(function(k){return[k,localStorage.getItem(k)]})))` },
  { label:'DOM summary',      code:`JSON.stringify({elements:document.querySelectorAll('*').length,videos:document.querySelectorAll('video').length,images:document.querySelectorAll('img').length,scripts:document.querySelectorAll('script[src]').length,iframes:document.querySelectorAll('iframe').length})` },
  { label:'Install breakpt',  code:`window.__insidrBP=function(label,data){console.log('[BREAKPOINT]',label,typeof data==='object'?JSON.stringify(data):data);};\n'window.__insidrBP(label, data) is now available'` },
  { label:'Watch variable',   code:`(function(){\n  var obj=window,prop='myVar',val=obj[prop];\n  Object.defineProperty(obj,prop,{get:function(){return val;},set:function(v){console.log('[WATCH] window.myVar:',JSON.stringify(val),'->', JSON.stringify(v));val=v;}});\n  return 'Now watching window.myVar';\n})()` },
  { label:'Outline elements', code:`document.querySelectorAll('*').forEach(function(e){e.style.outline='1px solid rgba(255,0,102,0.4)'});\n'Outlines added to all elements'` },
  { label:'Clear outlines',   code:`document.querySelectorAll('*').forEach(function(e){e.style.outline=''});\n'Outlines cleared'` },
];

function ScriptRunnerTab({ events, sendCommand }) {
  const [code, setCode] = useState('// Write JavaScript to run on the connected device\n// Results appear below and in the Console tab\nconsole.log("hello from insidr")');
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('insidr_scripts') || '[]'); } catch(e) { return []; }
  });
  const [sname, setSname] = useState('');
  const [lastRunTs, setLastRunTs] = useState(null);

  const resultEvents = events.filter(e => e.type === 'script.result');
  const myResults = resultEvents.filter(e => lastRunTs && e.timestamp >= lastRunTs);

  function run() {
    if (!code.trim()) return;
    setLastRunTs(Date.now());
    sendCommand('script.execute', { code });
  }
  function save() {
    if (!sname.trim()) return;
    const u = [...saved, { name: sname.trim(), code }];
    setSaved(u); localStorage.setItem('insidr_scripts', JSON.stringify(u)); setSname('');
  }
  function del(i) {
    const u = saved.filter((_,j) => j !== i);
    setSaved(u); localStorage.setItem('insidr_scripts', JSON.stringify(u));
  }

  return (
    <div className="tab-inner">
      <div className="snippet-row" style={{padding:'8px 14px',borderBottom:'1px solid #141414',flexWrap:'wrap'}}>
        {SNIPPETS.map(s => <button key={s.label} className="snip-btn" onClick={() => setCode(s.code)}>{s.label}</button>)}
      </div>

      <div style={{padding:'12px 14px',borderBottom:'1px solid #141414',flexShrink:0}}>
        <textarea
          className="script-ta"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); }}
          rows={7}
          spellCheck={false}
        />
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
          <div style={{display:'flex',gap:8}}>
            <input className="mini-input" style={{width:180}} placeholder="Script name to save…"
              value={sname} onChange={e => setSname(e.target.value)}
              onKeyDown={e => { if(e.key==='Enter') save(); }} />
            <button className="tbtn" onClick={save} disabled={!sname.trim()}>Save</button>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:11,color:'#333'}}>Ctrl+Enter to run</span>
            <button className="tbtn accent" onClick={run}>▶ Run on Device</button>
          </div>
        </div>
      </div>

      {saved.length > 0 && (
        <div style={{padding:'8px 14px',borderBottom:'1px solid #141414',flexShrink:0}}>
          <div className="sec-title">Saved Scripts</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
            {saved.map((s,i) => (
              <span key={i} style={{display:'flex',gap:4,alignItems:'center'}}>
                <button className="snip-btn" onClick={() => setCode(s.code)}>{s.name}</button>
                <button className="mini-btn" title="Delete" onClick={() => del(i)}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="stream" style={{flex:1}}>
        <div className="sec-title" style={{padding:'8px 14px'}}>
          Results from this session ({myResults.length})
        </div>
        {myResults.length === 0 && <div className="empty">Run a script — results appear here</div>}
        {[...myResults].reverse().map((e,i) => <LogRow key={i} event={e} />)}
      </div>
    </div>
  );
}

// ── TAB: Blackbox ─────────────────────────────────────────────────────────────

function BlackboxTab({ events }) {
  const [search, setSearch] = useState('');
  const [typeF, setTypeF] = useState('all');

  // Group by top-level type prefix for filter buttons
  const typePrefixes = [...new Set(events.map(e => e.type?.split('.')[0]))].filter(Boolean).sort();

  const shown = events.filter(e => {
    const matchType = typeF === 'all' || e.type?.startsWith(typeF);
    const matchSearch = !search.trim() ||
      e.type?.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(e.payload).toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <div className="tab-inner">
      <div className="toolbar" style={{flexWrap:'wrap',gap:6}}>
        <input className="search-input" placeholder="Search type or payload…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="filter-pills">
          <button className={`pill ${typeF==='all'?'active':''}`} onClick={() => setTypeF('all')}>
            All ({events.length})
          </button>
          {typePrefixes.map(t => (
            <button key={t} className={`pill ${typeF===t?'active':''}`} onClick={() => setTypeF(t)}>
              {t} ({events.filter(e=>e.type?.startsWith(t)).length})
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <button className="tbtn" onClick={() => dlJSON(shown,'blackbox-export')}>Export JSON</button>
        </div>
      </div>
      <div className="stream">
        {shown.length === 0 && <div className="empty">No events {search ? 'match your filter' : 'yet'}</div>}
        {[...shown].reverse().map((e,i) => <LogRow key={i} event={e} />)}
      </div>
    </div>
  );
}

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS = [
  { id:'console',     label:'Console',
    badge: ev => ev.filter(e=>e.type==='console').length },
  { id:'network',     label:'Network',
    badge: ev => ev.filter(e=>e.type==='network.request').length },
  { id:'errors',      label:'Errors',
    badge: ev => ev.filter(e=>e.type==='error'||e.type==='error.unhandled_rejection'||e.type==='media.error').length,
    badgeDanger: true },
  { id:'monitor',     label:'Monitor' },
  { id:'storage',     label:'Storage' },
  { id:'application', label:'Application' },
  { id:'sysinfo',     label:'System Info' },
  { id:'actions',     label:'Quick Actions' },
  { id:'scripts',     label:'Script Runner' },
  { id:'blackbox',    label:'Blackbox',
    badge: ev => ev.length },
];

function TabContent({ id, events, sendCommand, device }) {
  switch(id) {
    case 'console':     return <ConsoleTab      events={events} sendCommand={sendCommand} />;
    case 'network':     return <NetworkTab      events={events} />;
    case 'errors':      return <ErrorsTab       events={events} />;
    case 'monitor':     return <MonitorTab      events={events} />;
    case 'storage':     return <StorageTab      events={events} sendCommand={sendCommand} />;
    case 'application': return <ApplicationTab  events={events} sendCommand={sendCommand} />;
    case 'sysinfo':     return <SystemInfoTab   events={events} sendCommand={sendCommand} />;
    case 'actions':     return <QuickActionsTab events={events} sendCommand={sendCommand} device={device} />;
    case 'scripts':     return <ScriptRunnerTab events={events} sendCommand={sendCommand} />;
    case 'blackbox':    return <BlackboxTab     events={events} />;
    default:            return null;
  }
}

// ── Device Session ────────────────────────────────────────────────────────────

function DeviceSession({ device, events, sendCommand, onBack }) {
  const [activeTab, setActiveTab] = useState('console');

  return (
    <div className="session-view">
      <div className="session-header">
        <button className="back-btn" onClick={onBack}>← Devices</button>
        <div className="session-device-info">
          <span className="session-device-id">{device.deviceId}</span>
          <span className="session-device-url">{device.url}</span>
          {device.historical && <span className="hist-badge">historical / offline</span>}
          {device.suspect && <span className="hist-badge" style={{color:'#FFA500'}}>⚠ silent {device.silentSeconds}s</span>}
        </div>
        <div className="session-actions">
          <button className="cmd-btn" onClick={() => sendCommand('agent.enable')}>Enable</button>
          <button className="cmd-btn" onClick={() => sendCommand('agent.disable')}>Disable</button>
          <button className="cmd-btn danger" onClick={() => { if(window.confirm('Reload device?')) sendCommand('agent.reload'); }}>Reload</button>
        </div>
      </div>

      <div className="tab-nav">
        {TABS.map(t => {
          const count = t.badge ? t.badge(events) : null;
          return (
            <button
              key={t.id}
              className={`tn-btn ${activeTab===t.id?'tn-active':''} ${t.badgeDanger&&count>0?'tn-danger':''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
              {count !== null && count > 0 && <span className="tn-badge">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="tab-body">
        <TabContent id={activeTab} events={events} sendCommand={sendCommand} device={device} />
      </div>
    </div>
  );
}

// ── Device List ───────────────────────────────────────────────────────────────

function DeviceCard({ d, onSelect }) {
  return (
    <div className={`device-card ${d.historical?'dc-hist':''}`} onClick={() => onSelect(d)}>
      <div className="dc-head">
        <span className={d.historical ? 'dot-grey' : 'dot-green'} />
        <span className="dc-id">{d.deviceId}</span>
        {d.historical && <span className="hist-badge">offline</span>}
        {d.suspect && <span className="hist-badge" style={{color:'#FFA500'}}>⚠ silent {d.silentSeconds}s</span>}
      </div>
      <div className="dc-url">{d.url}</div>
      <div className="dc-meta">
        Connected: {d.connectedAt === 'historical' ? 'historical' : new Date(d.connectedAt).toLocaleTimeString()}
        &nbsp;·&nbsp;
        Last seen: {d.lastSeen === 'historical' ? 'historical' : new Date(d.lastSeen).toLocaleTimeString()}
      </div>
    </div>
  );
}

function DeviceList({ devices, onSelect }) {
  const live = devices.filter(d => !d.historical);
  const hist = devices.filter(d =>  d.historical);
  return (
    <div className="device-list">
      {live.length > 0 && <>
        <h2 className="dl-title">Connected ({live.length})</h2>
        {live.map(d => <DeviceCard key={d.deviceId} d={d} onSelect={onSelect} />)}
      </>}
      {hist.length > 0 && <>
        <h2 className="dl-title" style={{marginTop:28}}>Historical — crash logs ({hist.length})</h2>
        {hist.map(d => <DeviceCard key={d.deviceId} d={d} onSelect={onSelect} />)}
      </>}
      {devices.length === 0 && (
        <div className="empty" style={{paddingTop:64}}>
          No devices connected.<br/>
          <span style={{fontSize:12,color:'#2a2a2a'}}>
            Add the insidr agent script to your app and point it at ws://YOUR_IP:9229
          </span>
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { connected, devices, activeDevice, events, selectDevice, sendCommand, clearDevice } = useRemoteSession();
  return (
    <div className="dashboard">
      <div className="dash-header">
        <div className="dash-logo">insidr</div>
        <div className="dash-right">
          {activeDevice && (
            <span className="dev-badge">
              <span className="dot-green" /> {activeDevice.deviceId}
            </span>
          )}
          <div className={`srv-status ${connected?'srv-on':'srv-off'}`}>
            <span className="status-dot" />
            {connected ? 'Server connected' : 'Connecting…'}
          </div>
        </div>
      </div>
      <div className="dash-body">
        {activeDevice
          ? <DeviceSession device={activeDevice} events={events} sendCommand={sendCommand} onBack={clearDevice} />
          : <DeviceList devices={devices} onSelect={selectDevice} />}
      </div>
    </div>
  );
}
