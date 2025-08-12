import React, { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from './h2obot.png';

// MODE can be 'AUTO' | 'JSON' | 'SSE' | 'MOCK'
const CONFIG = {
  MODE: (window?.H2OBOT_MODE ?? import.meta.env.VITE_H2OBOT_MODE ?? 'AUTO'),
  API_BASE: (window?.H2OBOT_API_BASE ?? import.meta.env.VITE_H2OBOT_API_BASE ?? 'http://localhost:8787'),
  SESSION_ID: (() => {
    try {
      return (
        sessionStorage.getItem('h2obot_sid') ||
        (() => { const x = Math.random().toString(36).slice(2); sessionStorage.setItem('h2obot_sid', x); return x; })()
      );
    } catch { return Math.random().toString(36).slice(2); }
  })(),
};

function toArray(x){ return Array.isArray(x)?x:[]; }
function safeDate(x){ const d = new Date(x); return isNaN(+d)?null:d; }
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

const DEMO_KNOWLEDGE = {
  'new york': { answer: 'Yes — NYC tap water generally meets or exceeds federal/state standards. Use cold water and run the tap ~30 seconds if unused for hours. Older buildings may have lead; a certified lead-removing filter is prudent for infants and pregnant people.', sources:[{title:'NYC 2024 Water Quality Report', url:'https://www.nyc.gov/site/dep/water/drinking-water-quality-reports.page', publisher:'NYC DEP'},{title:'Lead in Drinking Water Basics', url:'https://www.epa.gov/ground-water-and-drinking-water/lead-drinking-water-basic-information', publisher:'US EPA'}], safety:{confidence:'high',advisories:[], last_updated: new Date().toISOString()}, suggestions:['How do I get a free lead test kit in NYC?','Are PFAS detected in my borough?']},
  'flint': { answer: 'Caution. Flint has replaced many lead service lines and recent samples are often below action levels, but premise plumbing can still leach lead. Use a certified lead-removing filter and follow city notices.', sources:[{title:'City of Flint Water Quality Updates', url:'https://www.cityofflint.com/updates/water/', publisher:'City of Flint'},{title:'Lead and Copper Rule', url:'https://www.epa.gov/dwreginfo/lead-and-copper-rule', publisher:'US EPA'}], safety:{confidence:'medium', advisories:[{level:'advisory', title:'Use certified lead-removing filter'}], last_updated: new Date().toISOString()}, suggestions:['Where can I pick up replacement filter cartridges?']},
  'jackson': { answer: 'Mixed. Jackson, MS has faced intermittent system issues and advisories. Check current notices. If none are active, properly treated water may be safe; consider a point-of-use filter and keep emergency water on hand.', sources:[{title:'City of Jackson Water Updates', url:'https://www.jacksonms.gov/', publisher:'City of Jackson'},{title:'CDC Boil Water Advisories', url:'https://www.cdc.gov/healthywater/emergency/drinking/drinking-water-advisories.html', publisher:'CDC'}], safety:{confidence:'low', advisories:[{level:'boil', title:'Monitor boil-water notices'}], last_updated: new Date().toISOString()}, suggestions:['Is there a boil-water notice today?']},
};

async function mockSearchAndSummarize({ messages, location }){
  await delay(400);
  const last = [...messages].reverse().find(m=>m.role==='user');
  const q = (last?.content||'').toLowerCase();
  const loc = (location||'').toLowerCase();
  let key = loc || (q.match(/in\s+([^?]+)/)?.[1] || '').trim().toLowerCase();
  key = key.replace(/,.*$/, '');
  return DEMO_KNOWLEDGE[key] || { answer: "I couldn't find specifics for that location in the demo. Try the nearest city/county and state.", sources:[{title:'Consumer Confidence Reports (CCR)', url:'https://www.epa.gov/ccr', publisher:'US EPA'}], safety:{confidence:'unknown', advisories:[], last_updated: new Date().toISOString()}, suggestions:['Where do I find my city\'s CCR?','How to test my tap for lead?'] };
}

async function postJSON(base, path, body){
  const r = await fetch(`${base}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// --- Robust SSE listener with onopen support (Chrome-friendly) ---------
function listenSSE(url, handlers){
  const es = new EventSource(url);
  es.onopen = () => { handlers.onOpen?.(); };
  es.onmessage = (ev)=>{
    try {
      const d = JSON.parse(ev.data);
      const t = d?.type;
      if(t==='delta') handlers.onDelta?.(d.text);
      else if(t==='sources') handlers.onSources?.(d.sources);
      else if(t==='safety') handlers.onSafety?.(d.safety);
      else if(t==='suggestions') handlers.onSuggestions?.(d.suggestions);
      else if(t==='start') handlers.onStart?.();
      else if(t==='done'){ handlers.onDone?.(); es.close(); }
    } catch {}
  };
  es.onerror = (e)=>{ handlers.onError?.(new Error('SSE error')); es.close(); };
  return ()=>es.close();
}

function buildQ(messages, location){
  const last = [...messages].reverse().find(m => m.role === 'user');
  return `${location ?? ''} ${last?.content ?? ''}`.trim();
}

function Thinking(){ return <span className="thinking"><span>•</span><span>•</span><span>•</span></span>; }

export default function H2obotApp(){
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [userMsgCount, setUserMsgCount] = useState(0);
  const [lastTransport, setLastTransport] = useState(null); // 'SSE' | 'JSON' | 'auto→SSE' | 'auto→JSON'
  const MAX_USER_MESSAGES = 5;

  // Starter recommendations
  const RECOMMENDED = [
    'Is tap water safe in New York City?',
    'Are there PFAS advisories in Orange County, CA?',
    'Lead levels in Flint, MI (2025)?',
    'Boil‑water notices in Travis County, TX today?',
  ];

  // Scroll handling
  const threadRef = useRef(null);
  function scrollDown({ force = false } = {}){
    const el = threadRef.current; if(!el) return;
    requestAnimationFrame(()=>{
      const start=el.scrollTop; const end=el.scrollHeight - el.clientHeight; const dist=end-start; if(dist<=0) return;
      const nearBottom = end - start < 120; if(!force && !nearBottom) return;
      const dur = Math.min(600, Math.max(250, Math.abs(dist))); const t0=performance.now();
      const ease = t=>1-Math.pow(1-t,3);
      function step(now){ const k=Math.min(1,(now-t0)/dur); el.scrollTop = start + dist*ease(k); if(k<1) requestAnimationFrame(step);} requestAnimationFrame(step);
    });
  }

  // Seed chat-first onboarding
  useEffect(()=>{
    setMessages([{ role:'assistant', content:'What would you like to know about your water?', suggestions: RECOMMENDED, actions:{ geolocate:true } }]);
  }, []);
  useEffect(()=>{ scrollDown(); }, [messages.length]);

  function applyAssistantPatch(patch){ setMessages(m=>{ const next=[...m]; let j=next.length-1; while(j>=0 && next[j].role!=='assistant') j--; if(j<0){ next.push({ role:'assistant', content:'', sources:[], safety:{}, suggestions:[] }); j=next.length-1; } next[j] = { ...next[j], ...patch, content: (patch.content!==undefined?patch.content:next[j].content) }; return next; }); }
  function appendDelta(text){ setMessages(m=>{ const n=[...m]; for(let i=n.length-1;i>=0;i--){ if(n[i].role==='assistant' && !n[i].done){ n[i] = { ...n[i], content: (n[i].content||'') + text }; break; } } return n; }); scrollDown(); }

  // --- Transport helpers ----------------------------------------------------
  async function doJSON(history, loc){
    const data = await postJSON(CONFIG.API_BASE, '/api/h2obot/query', { messages: history, location: loc });
    setMessages(m=>[...m, { role:'assistant', content: data?.answer||'(No answer)', sources: toArray(data?.sources), safety: data?.safety||{}, suggestions: toArray(data?.suggestions), done:true }]);
  }

  async function trySSE(history, loc, { timeoutMs = 4000 } = {}){
    if (!('EventSource' in window)) return false; // no support
    const q = buildQ(history, loc);
    const streamUrl = `${CONFIG.API_BASE}/api/h2obot/stream?session=${encodeURIComponent(CONFIG.SESSION_ID)}&q=${encodeURIComponent(q)}&ts=${Date.now()}`;

    return await new Promise((resolve) => {
      let settled = false; let opened = false; let close;
      const timer = setTimeout(async () => {
        if (!opened && !settled) {
          if (close) close(); setStreaming(false); setLoading(false);
          await doJSON(history, loc); setLastTransport('auto→JSON'); resolve(false); settled = true;
        }
      }, timeoutMs);

      setStreaming(true); applyAssistantPatch({ content:'' });
      close = listenSSE(streamUrl, {
        onOpen: () => { opened = true; },
        onStart: () => { opened = true; },
        onDelta: (t) => { opened = true; appendDelta(t); },
        onSources: (s) => { opened = true; applyAssistantPatch({ sources:s }); },
        onSafety: (s) => { opened = true; applyAssistantPatch({ safety:s }); },
        onSuggestions: (s) => { opened = true; applyAssistantPatch({ suggestions:s }); },
        onDone: () => { clearTimeout(timer); if (!settled){ setStreaming(false); applyAssistantPatch({ done:true }); setLoading(false); setLastTransport('auto→SSE'); resolve(true); settled = true; } },
        onError: async () => { clearTimeout(timer); if (!settled){ setStreaming(false); setLoading(false); await doJSON(history, loc); setLastTransport('auto→JSON'); resolve(false); settled = true; } },
      });
    });
  }

  async function submitToEngine(history, locOverride=null){
    const loc = locOverride ?? null;
    setLoading(true);
    try{
      if (CONFIG.MODE === 'MOCK') {
        const data = await mockSearchAndSummarize({ messages: history, location: loc });
        setMessages(m=>[...m, { role:'assistant', content: data?.answer||'(No answer)', sources: toArray(data?.sources), safety: data?.safety||{}, suggestions: toArray(data?.suggestions), done:true }]);
        setLastTransport('MOCK');
      } else if (CONFIG.MODE === 'JSON') {
        await doJSON(history, loc);
        setLastTransport('JSON');
      } else if (CONFIG.MODE === 'SSE') {
        // Strict streaming; no fallback
        const q = buildQ(history, loc);
        const url = `${CONFIG.API_BASE}/api/h2obot/stream?session=${encodeURIComponent(CONFIG.SESSION_ID)}&q=${encodeURIComponent(q)}&ts=${Date.now()}`;
        setStreaming(true); applyAssistantPatch({ content:'' });
        await new Promise((resolve,reject)=>{
          listenSSE(url, { onOpen:()=>{}, onDelta:(t)=>appendDelta(t), onSources:(s)=>applyAssistantPatch({sources:s}), onSafety:(s)=>applyAssistantPatch({safety:s}), onSuggestions:(s)=>applyAssistantPatch({suggestions:s}), onDone:()=>{ setStreaming(false); applyAssistantPatch({done:true}); setLastTransport('SSE'); resolve(true); }, onError:(e)=>{ setStreaming(false); applyAssistantPatch({done:true}); reject(e); } });
        });
      } else { // AUTO
        const ok = await trySSE(history, loc);
        if (!ok) { /* JSON fallback already rendered */ }
      }
    } catch (e) {
      setMessages(m=>[...m, { role:'assistant', content:'Sorry — I hit an issue fetching results. Try again.', error:true, done:true }]);
    } finally { setLoading(false); }
  }

  // --- UX flows -------------------------------------------------------------
  async function tryGeolocateAndAsk(){
    if(!('geolocation' in navigator)){
      setMessages(m => ([...m, { role:'assistant', content: 'I could not access your location. Type a city/county and state (e.g., “Austin, TX” or “Travis County, TX”), or ask a water question.' }]));
      return;
    }
    setLoading(true);
    try{
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{ enableHighAccuracy:true, timeout:8000 }));
      const { latitude, longitude } = pos.coords;
      const coarse = `your area (≈ ${latitude.toFixed(2)}, ${longitude.toFixed(2)})`;
      await askInitialQuestion(coarse);
    }catch{
      setMessages(m => ([...m, { role:'assistant', content: 'Couldn’t access your location. You can still type your city/county and state or ask a question.' }]));
    } finally { setLoading(false); }
  }

  async function askInitialQuestion(loc){
    const q = `Should I drink the water in ${loc}?`;
    const newMsgs = [...messages, { role:'user', content: q }];
    setMessages(newMsgs); setUserMsgCount(c=>c+1);
    await submitToEngine(newMsgs, loc);
    scrollDown({ force:true });
  }

  async function onSend(e){
    e?.preventDefault?.();
    if(!input.trim()) return;
    if(userMsgCount>=MAX_USER_MESSAGES) return;
    const userMessage = { role:'user', content: input.trim() };
    const next=[...messages, userMessage];
    setMessages(next); setUserMsgCount(c=>c+1); setInput('');
    await submitToEngine(next, null);
    scrollDown({ force:true });
  }

  const lastAssistant = useMemo(()=>{ for(let i=messages.length-1;i>=0;i--){ if(messages[i].role==='assistant') return messages[i]; } return null; }, [messages]);
  const lastUpdated = safeDate(lastAssistant?.safety?.last_updated);

  const modeBadge = (() => {
    if (CONFIG.MODE === 'MOCK') return 'Demo mode';
    if (CONFIG.MODE === 'JSON') return 'API: JSON';
    if (CONFIG.MODE === 'SSE') return 'API: streaming';
    // AUTO
    return lastTransport ? `AUTO · ${lastTransport}` : 'API: auto';
  })();

  return (
    <div className="bg-gradient" style={{ minHeight:'100vh' }}>
      <div className="container content">
        <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '1.25rem' }}>
              <img src={logoUrl} alt="H2obot" style={{ height: 100, display: 'block' }} />
            </div>
            <span className="badge">{modeBadge}</span>
            <span className="badge">Authoritative sources</span>
          </div>
          <div style={{ display:'flex', gap:'.5rem' }}>
            {lastAssistant?.safety?.confidence && <span className="badge">Confidence: {lastAssistant.safety.confidence}</span>}
            {lastUpdated && <span className="badge">Updated: {lastUpdated.toLocaleString()}</span>}
          </div>
        </header>

        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #e5e7eb', paddingBottom:'.5rem', marginBottom:'.75rem', color:'#4b5563', fontSize:'.875rem' }}>
            <span className="badge">Messages left: {Math.max(0, MAX_USER_MESSAGES - userMsgCount)}</span>
            {(loading || streaming) && <span style={{ display:'inline-flex', alignItems:'center', gap:'.5rem' }}>Searching <Thinking /></span>}
          </div>

          <div ref={threadRef} style={{ maxHeight:'60vh', overflow:'auto', padding:'0 .25rem' }}>
            {messages.map((m,i)=> (
              <div key={i} style={{ display:'flex', justifyContent: m.role==='user'?'flex-end':'flex-start', marginBottom:'.5rem' }}>
                <div className={`bubble ${m.role}`}>
                  <div style={{ whiteSpace:'pre-wrap', lineHeight:1.5 }}>{m.content}</div>

                  {m.actions?.geolocate && (
                    <div style={{ marginTop:'.5rem', display:'flex', gap:'.5rem', flexWrap:'wrap' }}>
                      <button className="btn primary" onClick={tryGeolocateAndAsk} disabled={loading}>Use my location</button>
                    </div>
                  )}

                  {m.sources?.length>0 && (
                    <div style={{ marginTop:'.5rem', display:'flex', gap:'.5rem', flexWrap:'wrap' }}>
                      {m.sources.map((s,idx)=> (
                        <a key={idx} href={s.url} target="_blank" rel="noreferrer" className="badge" style={{ textDecoration:'none' }}>{s.title} · {s.publisher}</a>
                      ))}
                    </div>
                  )}

                  {m.suggestions?.length>0 && (
                    <div style={{ marginTop:'.5rem', display:'flex', gap:'.5rem', flexWrap:'wrap' }}>
                      {m.suggestions.map((s,idx)=> (
                        <button key={idx} className="btn" onClick={()=>{ setInput(s); setTimeout(()=>onSend(),0); }}>{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="footer">
        <form onSubmit={onSend} style={{ marginBottom: '1.2rem', display:'flex', gap:'.5rem', paddingTop:'.5rem' }}>
            <input className="input" disabled={loading||streaming||userMsgCount>=MAX_USER_MESSAGES} placeholder={messages.length? 'Ask a follow‑up…' : 'Type a location or a water question…'} value={input} onChange={e=>setInput(e.target.value)} />
            <button className="btn primary" type="submit" disabled={loading||streaming||userMsgCount>=MAX_USER_MESSAGES}>Send</button>
        </form>
        <p>
          <strong>Disclaimer:</strong> H2obot summarizes public guidance from authoritative
          sources but is not a substitute for official notices. Always follow directions
          from your local water utility and public health agencies.
        </p>
      </footer>
    </div>
  );
}
