#!/usr/bin/env node
// tools/copilot-opinion-review.mjs — the station-opinion REVIEW RUN (1.61.0).
//
// Before opinions speak in game: generate a take from each persona for the stations you dock at most,
// through the same fact sheet, prompt and checks the co-pilot uses, and write them to a sheet you can
// rate. Uses the real Anthropic API (anthropic-key.txt beside the app), so it costs real credits —
// counted into copilot-spend.json like any other call.
//
// SAFE BY CONSTRUCTION: colony-data.json and copilot-memory.json are read once and COPIED; every write
// the opinion code makes goes to the copy in a temp folder. Refuses to run while the exe is running (the
// exe owns the spend ledger then).
//
// Usage: node tools/copilot-opinion-review.mjs [--stations 10] [--personas wash,tars,k2] [--out <dir>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Math.max(1, Number(arg('stations', 10)) || 10);
const PERSONAS = String(arg('personas', 'wash,tars,k2')).split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg('out', fs.mkdtempSync(path.join(os.tmpdir(), 'opinion-review-'))));

if (process.platform === 'win32') {
  try {
    const t = execSync('tasklist /FI "IMAGENAME eq ed-colony-architect.exe"', { encoding: 'utf8' });
    if (/ed-colony-architect\.exe/i.test(t)) { console.error('ed-colony-architect.exe is running — close it first (it owns the spend ledger).'); process.exit(1); }
  } catch { /* tasklist unavailable — carry on */ }
}

const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { initCopilotMemory } = await mod('server/ai/copilotMemory.js');
const { initCopilotApi, apiReady, spendThisMonth } = await mod('server/ai/copilotApi.js');
const { initCopilotOpinions, runOpinion, _resetOpinionTimers } = await mod('server/ai/copilotOpinions.js');
const { buildStationDossier } = await mod('server/ai/copilotDossier.js');

// Copies, never the live files.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opinion-review-work-'));
const stateRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'colony-data.json'), 'utf8'));
const state = stateRaw.state || stateRaw;
const memCopy = path.join(work, 'copilot-memory.json');
try { fs.copyFileSync(path.join(ROOT, 'copilot-memory.json'), memCopy); } catch { fs.writeFileSync(memCopy, '{}'); }
const memory = JSON.parse(fs.readFileSync(memCopy, 'utf8'));
for (const p of PERSONAS) if (memory.opinions && memory.opinions[p]) memory.opinions[p] = {}; // review = first takes
fs.writeFileSync(memCopy, JSON.stringify(memory));
initCopilotMemory(memCopy);
initCopilotApi({ keyFile: path.join(ROOT, 'anthropic-key.txt'), spendFile: path.join(ROOT, 'copilot-spend.json') });
initCopilotOpinions({ captureFile: path.join(ROOT, 'copilot-captures.jsonl') });

const settings = { ...(state.settings || {}), copilotBackend: 'api' };
if (!apiReady(settings)) { console.error('API not ready — is anthropic-key.txt beside the app, and is this month under the cap?'); process.exit(1); }

const stations = Object.values(state.knownStations || {})
  .filter((s) => s && s.marketId != null && s.stationName && !/fleetcarrier|construction/i.test(String(s.stationType || '')) && !/construction site|colonisationship|\$/i.test(s.stationName))
  .sort((a, b) => (b.dockedCount || b.visitCount || 0) - (a.dockedCount || a.visitCount || 0))
  .slice(0, N);

const rows = [];
const before = spendThisMonth().usd;
for (const persona of PERSONAS) {
  const recentLines = [];
  for (const st of stations) {
    _resetOpinionTimers();
    const ev = { event: 'DockingGranted', StationName: st.stationName, StationType: st.stationType, MarketID: st.marketId, timestamp: new Date().toISOString() };
    const pstate = { ...state, settings: { ...settings, copilotPersonality: persona } };
    const dossier = buildStationDossier({ ev, state: pstate, persona, memory: JSON.parse(fs.readFileSync(memCopy, 'utf8')), nearby: null });
    const beat = { key: 'station-opinion', opinion: { ev, dossier, stored: null, changed: [], hauling: false } };
    const heard = [];
    const log = [];
    const origLog = console.log;
    console.log = (...a) => { log.push(a.join(' ')); };
    let line = null;
    try { line = await runOpinion(beat, pstate, pstate.settings, { broadcastEvent: (e) => heard.push(e), captureLine: () => null }, { recentLines }); }
    finally { console.log = origLog; }
    if (line) { recentLines.push(line); while (recentLines.length > 8) recentLines.shift(); }
    const said = log.find((l) => l.includes('opinion of')) || '';
    const rejected = log.filter((l) => l.includes('rejected')).map((l) => l.replace(/^\[Copilot\] /, ''));
    rows.push({ persona, station: st.stationName, system: st.systemName, line, rejected, said });
    origLog(`${persona.padEnd(4)} ${st.stationName.padEnd(32)} ${line ? line : `— silent (${rejected.join(' | ') || said})`}`);
  }
}
const spent = spendThisMonth().usd - before;

const NAME = { wash: 'Wren', tars: 'Tycho', k2: 'K2' };
const md = [
  `# Station opinion review — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  `${stations.length} stations × ${PERSONAS.length} personas · model ${settings.copilotApiModel || 'claude-opus-5-5'} · spent $${spent.toFixed(4)}`,
  '',
  '| Persona | Station | Take | Checks |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${NAME[r.persona] || r.persona} | ${r.station} (${r.system}) | ${r.line ? r.line.replace(/\|/g, '/') : '*silent*'} | ${r.rejected.length ? r.rejected.join('; ').replace(/\|/g, '/') : 'passed first time'} |`),
  '',
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'opinion-review.md'), md.join('\n'));
fs.writeFileSync(path.join(OUT, 'opinion-review.json'), JSON.stringify({ at: new Date().toISOString(), spentUsd: spent, rows }, null, 2));
console.log(`\nWrote ${path.join(OUT, 'opinion-review.md')} · spent $${spent.toFixed(4)} · live files untouched (memory copy in ${work})`);
