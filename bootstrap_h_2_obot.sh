#!/usr/bin/env bash
set -euo pipefail

# H2obot local scaffold: frontend (React+Vite) + mock backend (Express) + API spec/types
# This script creates a minimal project structure, installs deps, and sets sane defaults
# so the frontend can talk to a local backend at http://localhost:8787.
#
# Usage:
#   bash bootstrap_h2obot.sh
#   cd h2obot
#   # In one terminal:
#   npm run backend:dev
#   # In another terminal:
#   npm run frontend:dev
#
# Prereqs: node >= 18, npm >= 9

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: missing $1"; exit 1; }; }
need node
need npm

ROOT_DIR="h2obot"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

mkdir -p "$FRONTEND_DIR/src" "$BACKEND_DIR"

###############################################################################
# Monorepo package.json to add helper scripts
###############################################################################
cat > "$ROOT_DIR/package.json" << 'JSON'
{
  "name": "h2obot-monorepo",
  "private": true,
  "workspaces": [
    "frontend",
    "backend"
  ],
  "scripts": {
    "frontend:dev": "npm --workspace frontend run dev",
    "backend:dev": "npm --workspace backend run dev",
    "backend:start": "npm --workspace backend start"
  }
}
JSON

###############################################################################
# Backend: OpenAPI spec, types, and mock Express server with JSON + SSE
###############################################################################
cat > "$BACKEND_DIR/openapi.yaml" << 'YAML'
openapi: 3.0.3
info:
  title: H2obot Backend API
  version: 1.0.0
servers:
  - url: https://api.h2obot.example
paths:
  /api/h2obot/query:
    post:
      summary: Query water quality guidance
      description: Searches authoritative water quality sources for the specified location/question and returns a summarized answer.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/QueryRequest'
      responses:
        '200':
          description: Successful query
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QueryResponse'
  /api/h2obot/stream:
    get:
      summary: Stream water quality guidance
      description: Streams results in real time via Server-Sent Events.
      parameters:
        - name: session
          in: query
          required: false
          schema:
            type: string
      responses:
        '200':
          description: SSE stream
components:
  schemas:
    QueryRequest:
      type: object
      properties:
        messages:
          type: array
          items:
            $ref: '#/components/schemas/Message'
        location:
          type: string
          nullable: true
      required:
        - messages
    Message:
      type: object
      properties:
        role:
          type: string
          enum: [user, assistant]
        content:
          type: string
      required:
        - role
        - content
    QueryResponse:
      type: object
      properties:
        answer:
          type: string
        sources:
          type: array
          items:
            $ref: '#/components/schemas/Source'
        safety:
          $ref: '#/components/schemas/SafetyInfo'
        suggestions:
          type: array
          items:
            type: string
        metrics:
          $ref: '#/components/schemas/Metrics'
      required:
        - answer
    Source:
      type: object
      properties:
        title:
          type: string
        url:
          type: string
          format: uri
        publisher:
          type: string
    SafetyInfo:
      type: object
      properties:
        confidence:
          type: string
          enum: [low, medium, high, unknown]
        advisories:
          type: array
          items:
            $ref: '#/components/schemas/Advisory'
        last_updated:
          type: string
          format: date-time
    Advisory:
      type: object
      properties:
        level:
          type: string
          enum: [info, advisory, boil, do-not-drink]
        title:
          type: string
        body:
          type: string
    Metrics:
      type: object
      properties:
        latency_ms:
          type: integer
        tokens_in:
          type: integer
        tokens_out:
          type: integer
YAML

cat > "$BACKEND_DIR/types.ts" << 'TS'
export interface QueryRequest {
  messages: Message[];
  location?: string | null;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface QueryResponse {
  answer: string;
  sources?: Source[];
  safety?: SafetyInfo;
  suggestions?: string[];
  metrics?: Metrics;
}

export interface Source {
  title: string;
  url: string;
  publisher: string;
}

export interface SafetyInfo {
  confidence?: 'low' | 'medium' | 'high' | 'unknown';
  advisories?: Advisory[];
  last_updated?: string; // ISO date-time
}

export interface Advisory {
  level: 'info' | 'advisory' | 'boil' | 'do-not-drink';
  title: string;
  body?: string;
}

export interface Metrics {
  latency_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
}
TS

cat > "$BACKEND_DIR/package.json" << 'JSON'
{
  "name": "h2obot-backend-mock",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch mock-server.js",
    "start": "node mock-server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2"
  }
}
JSON

cat > "$BACKEND_DIR/mock-server.js" << 'JS'
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8787;

// Demo knowledge
const NOW_ISO = () => new Date().toISOString();
const DEMO = {
  nyc: {
    answer: 'Yes — NYC tap water generally meets or exceeds federal/state standards. Use cold water and run the tap ~30 seconds if unused for hours. Older buildings may have lead; a certified lead-removing filter is prudent for infants and pregnant people.',
    sources: [
      { title: 'NYC 2024 Water Quality Report', url: 'https://www.nyc.gov/site/dep/water/drinking-water-quality-reports.page', publisher: 'NYC DEP' },
      { title: 'Lead in Drinking Water Basics', url: 'https://www.epa.gov/ground-water-and-drinking-water/lead-drinking-water-basic-information', publisher: 'US EPA' }
    ],
    safety: { confidence: 'high', advisories: [], last_updated: NOW_ISO() },
    suggestions: [
      'How do I get a free lead test kit in NYC?',
      'Are PFAS detected in my borough?'
    ],
  },
  flint: {
    answer: 'Caution. Flint has replaced many lead service lines and recent samples are often below action levels, but premise plumbing can still leach lead. Use a certified lead-removing filter and follow city notices.',
    sources: [
      { title: 'City of Flint Water Quality Updates', url: 'https://www.cityofflint.com/updates/water/', publisher: 'City of Flint' },
      { title: 'Lead and Copper Rule', url: 'https://www.epa.gov/dwreginfo/lead-and-copper-rule', publisher: 'US EPA' }
    ],
    safety: { confidence: 'medium', advisories: [{ level: 'advisory', title: 'Use certified lead-removing filter' }], last_updated: NOW_ISO() },
    suggestions: ['Where can I pick up replacement filter cartridges?']
  },
  jackson: {
    answer: 'Mixed. Jackson, MS has faced intermittent system issues and advisories. Check current notices. If none are active, properly treated water may be safe; consider a point-of-use filter and keep emergency water on hand.',
    sources: [
      { title: 'City of Jackson Water Updates', url: 'https://www.jacksonms.gov/', publisher: 'City of Jackson' },
      { title: 'CDC Boil Water Advisories', url: 'https://www.cdc.gov/healthywater/emergency/drinking/drinking-water-advisories.html', publisher: 'CDC' }
    ],
    safety: { confidence: 'low', advisories: [{ level: 'boil', title: 'Monitor boil-water notices' }], last_updated: NOW_ISO() },
    suggestions: ['Is there a boil-water notice today?']
  }
};

function pickDemo(payloadText = '') {
  const text = payloadText.toLowerCase();
  if (text.includes('new york') || text.includes('nyc')) return DEMO.nyc;
  if (text.includes('flint')) return DEMO.flint;
  if (text.includes('jackson')) return DEMO.jackson;
  return {
    answer: "I couldn't find specifics for that location in the demo. Try the nearest city/county and state.",
    sources: [{ title: 'Consumer Confidence Reports (CCR)', url: 'https://www.epa.gov/ccr', publisher: 'US EPA' }],
    safety: { confidence: 'unknown', advisories: [], last_updated: NOW_ISO() },
    suggestions: ['Where do I find my city\'s CCR?', 'How to test my tap for lead?']
  };
}

app.post('/api/h2obot/query', (req, res) => {
  const { messages = [], location = null } = req.body || {};
  const last = [...messages].reverse().find(m => m && m.role === 'user');
  const payload = `${location || ''} ${last?.content || ''}`;
  const data = pickDemo(payload);
  const metrics = { latency_ms: Math.floor(Math.random()*200)+200, tokens_in: 400, tokens_out: 180 };
  res.json({ ...data, metrics });
});

app.get('/api/h2obot/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const write = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  write({ type: 'start' });

  // Compose an answer based on query param hints if any
  const q = (req.query.q || '').toString();
  const data = pickDemo(q);

  // stream answer in chunks
  const chunks = data.answer.match(/.{1,60}(\s|$)/g) || [data.answer];
  let i = 0;
  const interval = setInterval(() => {
    if (i < chunks.length) {
      write({ type: 'delta', text: chunks[i] });
      i++;
    } else {
      write({ type: 'sources', sources: data.sources });
      write({ type: 'safety', safety: data.safety });
      write({ type: 'suggestions', suggestions: data.suggestions });
      write({ type: 'done' });
      clearInterval(interval);
      res.end();
    }
  }, 80);

  req.on('close', () => clearInterval(interval));
});

app.listen(PORT, () => {
  console.log(`H2obot mock backend listening on http://localhost:${PORT}`);
});
JS

###############################################################################
# Frontend: Vite + React app with H2obotApp wired for MOCK/JSON/SSE
###############################################################################
cat > "$FRONTEND_DIR/package.json" << 'JSON'
{
  "name": "h2obot-frontend",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.2"
  }
}
JSON

cat > "$FRONTEND_DIR/index.html" << 'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>H2obot</title>
    <script>
      // Set defaults for local testing: JSON mode against localhost backend
      window.H2OBOT_MODE = window.H2OBOT_MODE || 'JSON'; // 'MOCK' | 'JSON' | 'SSE'
      window.H2OBOT_API_BASE = window.H2OBOT_API_BASE || 'http://localhost:8787';
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
HTML

cat > "$FRONTEND_DIR/vite.config.js" << 'JS'
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: 'localhost' }
});
JS

cat > "$FRONTEND_DIR/src/main.jsx" << 'JS'
import React from 'react';
import { createRoot } from 'react-dom/client';
import H2obotApp from './h2obot-app.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(<H2obotApp />);
JS

cat > "$FRONTEND_DIR/src/style.css" << 'CSS'
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; }
/* Utility classes approximating Tailwind-like spacing for the demo */
.bg-gradient { background: linear-gradient(135deg, #eff6ff, #ffffff 40%, #eef2ff); }
.container { max-width: 56rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
.card { background: rgba(255,255,255,0.75); border: 1px solid #e5e7eb; border-radius: 1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); backdrop-filter: blur(6px); }
.btn { border-radius: 0.75rem; padding: 0.5rem 0.875rem; border: 1px solid #e5e7eb; background: white; cursor: pointer; }
.btn.primary { background: #0284c7; color: white; border-color: #0284c7; }
.btn.primary:hover { background: #0369a1; }
.input { border-radius: 0.75rem; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; width: 100%; }
.badge { display:inline-flex; align-items:center; gap:.375rem; border:1px solid #e5e7eb; border-radius:9999px; padding:.25rem .625rem; font-size:.75rem; color:#4b5563; background:rgba(255,255,255,.7); }
.bubble { border:1px solid #e5e7eb; border-radius:1rem; padding: .75rem 1rem; background:white; }
.bubble.user { background:#0284c7; color:#fff; border-top-right-radius:.25rem; }
.bubble.assistant { border-top-left-radius:.25rem; }
.thinking span { display:inline-block; animation: b 1s infinite; }
.thinking span:nth-child(1){ animation-delay:-.2s }
.thinking span:nth-child(3){ animation-delay:.2s }
@keyframes b { 0%,80%,100%{ transform: translateY(0) } 40%{ transform: translateY(-2px) } }
CSS

# React component (frontend wired for backend)
cat > "$FRONTEND_DIR/src/h2obot-app.jsx" << 'JS'
import React, { useEffect, useMemo, useRef, useState } from 'react';

const CONFIG = {
  MODE: (window?.H2OBOT_MODE ?? 'MOCK'), // 'MOCK' | 'JSON' | 'SSE'
  API_BASE: (window?.H2OBOT_API_BASE ?? ''),
  SESSION_ID: (() => {
    try { return (sessionStorage.getItem('h2obot_sid') || (() => { const x = Math.random().toString(36).slice(2); sessionStorage.setItem('h2obot_sid', x); return x; })()); } catch { return Math.random().toString(36).slice(2); }
  })(),
};

function toArray(x){ return Array.isArray(x)?x:[]; }
function isNonEmptyString(x){ return typeof x==='string' && x.trim(); }
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

async function postJSON(base, path, body){ const r = await fetch(`${base}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
function listenSSE(url, handlers){ const es = new EventSource(url); es.onmessage = (ev)=>{ try{ const d = JSON.parse(ev.data); const t = d?.type; if(t==='delta') handlers.onDelta?.(d.text); else if(t==='sources') handlers.onSources?.(d.sources); else if(t==='safety') handlers.onSafety?.(d.safety); else if(t==='suggestions') handlers.onSuggestions?.(d.suggestions); else if(t==='start') handlers.onStart?.(); else if(t==='done'){ handlers.onDone?.(); es.close(); } }catch{} }; es.onerror = ()=>{ handlers.onError?.(new Error('SSE error')); es.close(); }; return ()=>es.close(); }

async function runQuery(messages, location){
  const mode = CONFIG.MODE;
  if(mode==='MOCK') return { mode, data: await mockSearchAndSummarize({ messages, location }) };
  if(mode==='JSON') return { mode, data: await postJSON(CONFIG.API_BASE, '/api/h2obot/query', { messages, location }) };
  if(mode==='SSE') return { mode, streamUrl: `${CONFIG.API_BASE}/api/h2obot/stream?session=${encodeURIComponent(CONFIG.SESSION_ID)}` };
  return { mode:'MOCK', data: await mockSearchAndSummarize({ messages, location }) };
}

function Chip({ children }){ return <span className="badge">{children}</span>; }
function Thinking(){ return <span className="thinking"><span>•</span><span>•</span><span>•</span></span>; }

export default function H2obotApp(){
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [usingLocation, setUsingLocation] = useState(null);
  const [locationName, setLocationName] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [userMsgCount, setUserMsgCount] = useState(0);
  const MAX_USER_MESSAGES = 5;

  useEffect(()=>{ if(usingLocation===false){ setMessages([{ role:'assistant', content: "Okay — we won’t use your location. Ask me about water safety anywhere, or try one of these: \n\n• ‘Is tap water safe in New York City?’\n• ‘Are there PFAS advisories in Orange County, CA?’\n• ‘Lead levels in Flint, MI, 2025?’" }]); } }, [usingLocation]);

  async function tryGeolocateAndAsk(){
    if(!('geolocation' in navigator)){ alert('Geolocation unavailable. Type your location.'); setUsingLocation(true); return; }
    setLoading(true);
    try{
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{ enableHighAccuracy:true, timeout:8000 }));
      const { latitude, longitude } = pos.coords;
      const coarse = `your area (≈ ${latitude.toFixed(2)}, ${longitude.toFixed(2)})`;
      setLocationName(coarse);
      await askInitialQuestion(coarse);
    }catch{ setUsingLocation(true); }
    finally{ setLoading(false); }
  }

  async function askInitialQuestion(loc){
    const q = `Should I drink the water in ${loc}?`;
    const newMsgs = [{ role:'assistant', content: `Checking recent guidance for ${loc}…` }, { role:'user', content: q }];
    setMessages(newMsgs); setUserMsgCount(1);
    await submitToEngine(newMsgs, loc);
  }

  function applyAssistantPatch(patch){ setMessages(m=>{ const next=[...m]; let j=next.length-1; while(j>=0 && next[j].role!=='assistant') j--; if(j<0){ next.push({ role:'assistant', content:'', sources:[], safety:{}, suggestions:[] }); j=next.length-1; } next[j] = { ...next[j], ...patch, content: (patch.content!==undefined?patch.content:next[j].content) }; return next; }); }
  function appendDelta(text){ setMessages(m=>{ const n=[...m]; for(let i=n.length-1;i>=0;i--){ if(n[i].role==='assistant' && !n[i].done){ n[i] = { ...n[i], content: (n[i].content||'') + text }; break; } } return n; }); }

  async function submitToEngine(history, locOverride=null){
    setLoading(true); setStreaming(false);
    try{
      const { mode, data, streamUrl } = await runQuery(history, locOverride ?? locationName ?? null);
      if(mode==='MOCK' || mode==='JSON'){
        const ans = data?.answer || '(No answer)';
        applyAssistantPatch({});
        setMessages(m=>[...m, { role:'assistant', content: ans, sources: toArray(data?.sources), safety: data?.safety||{}, suggestions: toArray(data?.suggestions), done:true }]);
      } else if(mode==='SSE' && streamUrl){
        setStreaming(true); applyAssistantPatch({ content:'' });
        await new Promise((resolve,reject)=>{
          listenSSE(streamUrl, { onDelta: (t)=>appendDelta(t), onSources:(s)=>applyAssistantPatch({ sources:s }), onSafety:(s)=>applyAssistantPatch({ safety:s }), onSuggestions:(s)=>applyAssistantPatch({ suggestions:s }), onDone:()=>{ setStreaming(false); applyAssistantPatch({ done:true }); resolve(); }, onError:(e)=>{ setStreaming(false); applyAssistantPatch({ done:true }); reject(e); } });
        });
      }
    }catch(e){ setMessages(m=>[...m, { role:'assistant', content:'Sorry — I hit an issue fetching results. Try again.', error:true, done:true }]); }
    finally{ setLoading(false); }
  }

  async function onSend(e){ e?.preventDefault?.(); if(!input.trim()) return; if(userMsgCount>=MAX_USER_MESSAGES) return; const userMessage = { role:'user', content: input.trim() }; const next=[...messages, userMessage]; setMessages(next); setUserMsgCount(c=>c+1); setInput(''); const t = await runQuery(next, null); if(t.mode==='SSE' && t.streamUrl){ setLoading(true); setStreaming(true); applyAssistantPatch({ content:'' }); try{ await new Promise((resolve,reject)=>{ listenSSE(t.streamUrl, { onDelta:(txt)=>appendDelta(txt), onSources:(s)=>applyAssistantPatch({sources:s}), onSafety:(s)=>applyAssistantPatch({safety:s}), onSuggestions:(s)=>applyAssistantPatch({suggestions:s}), onDone:()=>{ setStreaming(false); applyAssistantPatch({done:true}); resolve(); }, onError:(err)=>{ setStreaming(false); applyAssistantPatch({done:true}); reject(err); } }); }); } catch { setMessages(m=>[...m, { role:'assistant', content:'Streaming error. Falling back to retry.', error:true, done:true }]); } finally { setLoading(false); } } else { await submitToEngine(next, null); } }

  const lastAssistant = useMemo(()=>{ for(let i=messages.length-1;i>=0;i--){ if(messages[i].role==='assistant') return messages[i]; } return null; }, [messages]);
  const lastUpdated = safeDate(lastAssistant?.safety?.last_updated);

  return (
    <div className="bg-gradient" style={{ minHeight:'100vh' }}>
      <div className="container">
        <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'.75rem' }}>
            <div style={{ fontWeight:600, fontSize:'1.25rem' }}>H2obot</div>
            <span className="badge">{CONFIG.MODE==='MOCK' ? 'Demo mode' : (CONFIG.MODE==='JSON' ? 'API: JSON' : 'API: streaming')}</span>
            <span className="badge">Authoritative sources</span>
          </div>
          <div style={{ display:'flex', gap:'.5rem' }}>
            {lastAssistant?.safety?.confidence && <span className="badge">Confidence: {lastAssistant.safety.confidence}</span>}
            {lastUpdated && <span className="badge">Updated: {lastUpdated.toLocaleString()}</span>}
          </div>
        </header>

        {usingLocation===null && (
          <div className="card" style={{ padding:'1rem', marginBottom:'1rem' }}>
            <h1 style={{ margin:'0 0 .25rem 0' }}>Should I drink the water where I am?</h1>
            <p style={{ marginTop:'.25rem', color:'#4b5563' }}>I’ll check trusted sources (EPA, CDC, local utilities) and explain what matters.</p>
            <div style={{ display:'flex', gap:'.5rem', marginTop:'.75rem' }}>
              <button className="btn primary" onClick={()=>{ setUsingLocation(true); tryGeolocateAndAsk(); }} disabled={loading}>Use my location</button>
              <button className="btn" onClick={()=>setUsingLocation(false)}>No thanks, I’ll ask manually</button>
            </div>
          </div>
        )}

        {usingLocation===true && messages.length===0 && (
          <div className="card" style={{ padding:'1rem', marginBottom:'1rem' }}>
            <strong>Type your location</strong>
            <form style={{ display:'flex', gap:'.5rem', marginTop:'.5rem' }} onSubmit={(e)=>{ e.preventDefault(); if(locationName.trim()) askInitialQuestion(locationName.trim()); }}>
              <input className="input" placeholder="e.g., New York, NY" value={locationName} onChange={e=>setLocationName(e.target.value)} />
              <button className="btn primary" type="submit">Ask</button>
            </form>
          </div>
        )}

        <div className="card" style={{ padding:'1rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #e5e7eb', paddingBottom:'.5rem', marginBottom:'.75rem', color:'#4b5563', fontSize:'.875rem' }}>
            <span className="badge">Messages left: {Math.max(0, MAX_USER_MESSAGES - userMsgCount)}</span>
            {(loading || streaming) && <span style={{ display:'inline-flex', alignItems:'center', gap:'.5rem' }}>Searching <Thinking /></span>}
          </div>

          <div style={{ maxHeight:'60vh', overflow:'auto', padding:'0 .25rem' }}>
            {messages.map((m,i)=> (
              <div key={i} style={{ display:'flex', justifyContent: m.role==='user'?'flex-end':'flex-start', marginBottom:'.5rem' }}>
                <div className={`bubble ${m.role}`}>
                  <div style={{ whiteSpace:'pre-wrap', lineHeight:1.5 }}>{m.content}</div>
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

          <form onSubmit={onSend} style={{ display:'flex', gap:'.5rem', borderTop:'1px solid #e5e7eb', paddingTop:'.5rem', marginTop:'.75rem' }}>
            <input className="input" disabled={loading||streaming||userMsgCount>=MAX_USER_MESSAGES} placeholder={messages.length? 'Ask a follow-up…' : 'Type a location or a water question…'} value={input} onChange={e=>setInput(e.target.value)} />
            <button className="btn primary" type="submit" disabled={loading||streaming||userMsgCount>=MAX_USER_MESSAGES}>Send</button>
          </form>
        </div>

        <p style={{ fontSize:'.75rem', color:'#6b7280', marginTop:'.75rem' }}><strong>Disclaimer:</strong> H2obot summarizes public guidance from authoritative sources but is not a substitute for official notices. Always follow directions from your local water utility and public health agencies.</p>
      </div>
    </div>
  );
}
JS

###############################################################################
# Install dependencies (frontend + backend)
###############################################################################
(
  cd "$BACKEND_DIR" && npm install
)
(
  cd "$FRONTEND_DIR" && npm install
)

cat > "$ROOT_DIR/README.md" << 'MD'
# H2obot — Local Dev

## Run

In one terminal:

```bash
npm run backend:dev
```

In another terminal:

```bash
npm run frontend:dev
```

Frontend runs at http://localhost:5173 and calls http://localhost:8787 by default.

## Switch transport modes

Open the browser devtools console and set:

```js
window.H2OBOT_MODE = 'MOCK'  // or 'JSON' | 'SSE'
window.location.reload()
```

To target a different API base:

```js
window.H2OBOT_API_BASE = 'http://localhost:8787'
window.location.reload()
```

## API contract

See `backend/openapi.yaml` and `backend/types.ts`. The mock server implements:
- `POST /api/h2obot/query` returning JSON
- `GET /api/h2obot/stream` sending SSE events (start/delta/sources/safety/suggestions/done)

MD

printf "\n✅ Project scaffolded in '%s'\n" "$ROOT_DIR"
printf "➡  Start backend:  cd %s && npm run backend:dev\n" "$ROOT_DIR"
printf "➡  Start frontend: cd %s && npm run frontend:dev\n\n" "$ROOT_DIR"
