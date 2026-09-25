#!/usr/bin/env node
// Every populated system in the galaxy, from the Spansh galaxy dump, as one slim JSONL — the same
// record shape the regional dumps use, so scripts/gen-populated-systems.mjs reads it unchanged.
//
//   node scripts/extract-populated-galaxy.mjs [--in E:/Spansh/galaxy.json.gz] [--out G:/Spansh/populated-galaxy.jsonl]
//
// One gunzip pass over the whole dump (~187 M systems; the regional indexer measured 25–32 min on
// this machine). Populated systems are a few tens of thousands, so the output is small whatever the
// region — which is why this is galaxy-wide rather than another sphere: the Inner Orion Spur, the
// Colonia arm and every colony bubble come out of the same pass. The Map layer itself stays bubble-gated:
// scripts/gen-populated-systems.mjs keeps only the systems inside the BUBBLES of
// server/radar/populatedStore.js, so nothing galaxy-wide reaches the app.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const input = arg('--in', 'E:/Spansh/galaxy.json.gz');
const output = arg('--out', 'G:/Spansh/populated-galaxy.jsonl');
if (!fs.existsSync(input)) { console.error(`input not found: ${input}`); process.exit(1); }
fs.mkdirSync(path.dirname(output), { recursive: true });

const out = fs.createWriteStream(output + '.part', { encoding: 'utf8' });
const t0 = Date.now();
let scanned = 0; let kept = 0; let malformed = 0; let carry = '';
const log = (msg) => console.error(`[populated] ${msg}`);

function handle(line) {
  scanned++;
  if (scanned % 5_000_000 === 0) log(`${scanned.toLocaleString()} scanned · ${kept.toLocaleString()} populated · ${Math.round((Date.now() - t0) / 1000)} s`);
  if (!line.includes('"population":') || line.includes('"population":0,') || line.includes('"population":0}')) return;
  // Cheap check before the expensive parse: a non-zero population digit.
  if (!/"population":[1-9]/.test(line)) return;
  let s;
  try { s = JSON.parse(line.replace(/^\s*\[?\s*/, '').replace(/,\s*$/, '').replace(/\]\s*$/, '')); } catch { malformed++; return; }
  const pop = Number(s.population);
  const c = s.coords || {};
  if (!(pop > 0) || !s.name || ![c.x, c.y, c.z].every(Number.isFinite)) return;
  const stars = Array.isArray(s.bodies) ? s.bodies.filter((b) => b && b.type === 'Star') : [];
  const main = stars.find((b) => b.mainStar) || stars[0] || null;
  out.write(JSON.stringify({
    id64: s.id64 ?? null, name: s.name, coords: { x: c.x, y: c.y, z: c.z },
    mainStar: main ? (main.subType || main.spectralClass || null) : null,
    population: pop, economy: s.primaryEconomy || null, secondEconomy: s.secondaryEconomy || null,
    allegiance: s.allegiance || null, government: s.government || null, security: s.security || null, date: s.date || null,
  }) + '\n');
  kept++;
}

const gunzip = zlib.createGunzip();
gunzip.on('data', (chunk) => {
  carry += chunk.toString('utf8');
  let i;
  while ((i = carry.indexOf('\n')) >= 0) { handle(carry.slice(0, i)); carry = carry.slice(i + 1); }
});
gunzip.on('end', () => {
  if (carry.trim()) handle(carry);
  out.end(() => {
    fs.renameSync(output + '.part', output);
    log(`DONE. ${scanned.toLocaleString()} scanned · ${kept.toLocaleString()} populated systems · ${malformed} malformed · ${Math.round((Date.now() - t0) / 1000)} s → ${output} (${(fs.statSync(output).size / 1048576).toFixed(1)} MB)`);
  });
});
gunzip.on('error', (e) => { log('gunzip error: ' + e.message); process.exit(1); });
fs.createReadStream(input).pipe(gunzip);
