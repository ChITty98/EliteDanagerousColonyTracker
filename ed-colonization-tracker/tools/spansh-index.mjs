#!/usr/bin/env node
/**
 * Spansh galaxy-dump region indexer + query tool.
 *
 * Usage (single region):
 *   node tools/spansh-index.mjs build \
 *       --input E:/Spansh/galaxy.json.gz \
 *       --output E:/Spansh/region.jsonl \
 *       --cx 672.6 --cy 5.4 --cz 78.3 --radius 500
 *
 * Usage (multiple regions, single gunzip pass):
 *   node tools/spansh-index.mjs build \
 *       --input E:/Spansh/galaxy.json.gz \
 *       --regions E:/Spansh/regions.json
 *
 *   regions.json format:
 *     [
 *       {"name": "hip47126", "cx": 955.875, "cy": -13.71875, "cz": 108.59375, "radius": 200,
 *        "output": "E:/Spansh/region-hip47126.jsonl"},
 *       {"name": "col173-cluster", "cx": 910, "cy": -30, "cz": 105, "radius": 100,
 *        "output": "E:/Spansh/region-col173.jsonl"}
 *     ]
 *
 *   node tools/spansh-index.mjs sector \
 *       --region E:/Spansh/region.jsonl \
 *       --prefix "Col 173 Sector AX-J"
 *
 *   node tools/spansh-index.mjs atmospheric \
 *       --region E:/Spansh/region.jsonl \
 *       [--prefix "Antliae Sector"] \
 *       [--exclude-atmo helium,carbondioxide] \
 *       [--max-gravity 0.6] \
 *       [--min-oxygen 1]
 *
 *   node tools/spansh-index.mjs near \
 *       --region E:/Spansh/region.jsonl \
 *       --system "HIP 47126" \
 *       --radius 50 \
 *       [--filter atmospheric|ringed|rare-atmo|rare-star]
 *
 * Output per system (one JSON line, minimal fields — discards 95% of Spansh):
 *   {id64, name, coords, mainStar, bodies: [{name,type,subType,landable,atmo,gravity,em,rings,distLs,terraform,wasDiscovered,wasMapped,bioSignals,geoSignals}]}
 *
 * All distances in light-years. Gravity normalized to g (Spansh already reports g).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  scoreSystem,
  buildBodyString,
  filterQualifyingBodies,
  classifyStars,
} from '../server/journal/scorer.js';

const SELF_PATH = fileURLToPath(import.meta.url);

// ===== WORKER-THREAD MODE =====
// Worker receives large buffer chunks of newline-delimited JSON (each chunk
// is guaranteed to end at a \n boundary by the main thread). Worker splits
// the chunk, parses each line, filters by region, slims, scores, returns hits.
if (!isMainThread && workerData && workerData.mode === 'build-parser') {
  const regions = workerData.regions;
  // Fast-path: regex-extract coords without a full JSON.parse. Distance check
  // rejects ~99.999% of the galaxy for a 100 ly sphere, so skipping the heavy
  // JSON.parse on misses is a massive win.
  const COORD_RE = /"coords":\s*\{\s*"x":\s*(-?[\d.eE+-]+)\s*,\s*"y":\s*(-?[\d.eE+-]+)\s*,\s*"z":\s*(-?[\d.eE+-]+)/;

  parentPort.on('message', (chunk) => {
    if (chunk === null) { parentPort.close(); return; }
    const lines = chunk.split('\n');
    const hits = [];
    let scanned = 0;
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      if (raw.length === 0) continue;
      scanned++;
      let line = raw;
      if (line === '[' || line === ']') continue;
      if (line.endsWith(',')) line = line.slice(0, -1);

      // Fast coords extract
      const m = COORD_RE.exec(line);
      if (!m) continue;
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      const z = parseFloat(m[3]);

      // Cheap distance check against all regions before committing to parse
      const matched = [];
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        const d = Math.sqrt((x - r.cx) ** 2 + (y - r.cy) ** 2 + (z - r.cz) ** 2);
        if (d <= r.radius) matched.push(i);
      }
      if (matched.length === 0) continue;

      // Only now do the expensive JSON.parse + slim + score
      let sys;
      try { sys = JSON.parse(line); } catch { continue; }
      if (!sys || !sys.coords) continue;
      const slim = slimSystem(sys);
      const slimJson = JSON.stringify(slim) + '\n';
      for (const idx of matched) {
        hits.push(idx);
        hits.push(slimJson);
      }
    }
    parentPort.postMessage({ scanned, hits });
  });
}

const args = process.argv.slice(2);
const command = args[0];

function getArg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function getFlag(name) {
  return args.includes(`--${name}`);
}

function dist3d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Extract minimal body fields from Spansh's dump entry */
// 1 AU ≈ 499.0047837 light-seconds, speed of light = 299,792,458 m/s
const AU_TO_LS = 499.0047837;
const M_TO_LS = 1 / 299792458;
function slimBody(b) {
  if (!b) return null;
  const hasRings = Array.isArray(b.rings) && b.rings.length > 0;
  // Ring outer / inner radii in Ls (max outer, min inner — Spansh values in meters)
  let ringOuter = null;
  let ringInner = null;
  if (hasRings) {
    let maxOuter = 0;
    let minInner = Infinity;
    for (const r of b.rings) {
      if (typeof r.outerRadius === 'number' && r.outerRadius > maxOuter) maxOuter = r.outerRadius;
      if (typeof r.innerRadius === 'number' && r.innerRadius < minInner) minInner = r.innerRadius;
    }
    if (maxOuter > 0) ringOuter = Number((maxOuter * M_TO_LS).toFixed(4));
    if (minInner !== Infinity && minInner > 0) ringInner = Number((minInner * M_TO_LS).toFixed(4));
  }
  // Semi-major axis around parent, in Ls (Spansh gives AU)
  const sma = typeof b.semiMajorAxis === 'number' ? Number((b.semiMajorAxis * AU_TO_LS).toFixed(4)) : null;
  // Body radius in Ls (Spansh gives km). Lets us compute actual apparent angular size
  // of a parent from a moon: 2 * atan(parent.radiusLs / body.sma).
  const KM_TO_LS = 1 / 299792.458;
  const radiusLs = typeof b.radius === 'number' ? Number((b.radius * KM_TO_LS).toFixed(4)) : null;
  const atmo = (b.atmosphereType || '').trim();
  return {
    name: b.name,
    type: b.type, // "Planet" | "Star" | "Barycentre"
    subType: b.subType,
    landable: !!b.isLandable,
    atmo: atmo || null,
    gravity: typeof b.gravity === 'number' ? Number(b.gravity.toFixed(3)) : null, // Spansh gives g
    em: typeof b.earthMasses === 'number' ? Number(b.earthMasses.toFixed(3)) : null,
    rings: hasRings,
    ringOuter,  // Ls, outer radius of widest ring (null if not ringed or unknown)
    ringInner,  // Ls, inner radius of innermost ring (null if not ringed or unknown)
    sma,        // Ls, semi-major axis around parent body (null if not present, e.g. main star)
    radiusLs,   // Ls, body radius — for computing apparent size from moons
    orbInc: typeof b.orbitalInclination === 'number' ? Number(b.orbitalInclination.toFixed(2)) : null,  // degrees, inclination of orbit relative to parent's equator/ring plane
    distLs: typeof b.distanceToArrival === 'number' ? Math.round(b.distanceToArrival) : null,
    terraform: b.terraformingState && b.terraformingState !== 'Not terraformable' ? b.terraformingState : null,
    wasDiscovered: b.wasDiscovered === true,
    wasMapped: b.wasMapped === true,
    bioSignals: b.signals && b.signals.signals && b.signals.signals.$SAA_SignalType_Biological ? b.signals.signals.$SAA_SignalType_Biological : null,
    geoSignals: b.signals && b.signals.signals && b.signals.signals.$SAA_SignalType_Geological ? b.signals.signals.$SAA_SignalType_Geological : null,
  };
}

/** Extract minimal system fields + pre-computed score */
function slimSystem(sys) {
  const coords = sys.coords || {};
  const rawBodies = sys.bodies || [];
  const mainStar = rawBodies.find((b) => b.type === 'Star' && b.mainStar);

  // Score against the raw Spansh body shape (same scorer the app uses).
  // Guard each call — some Spansh entries have weird shapes that trip the scorer.
  let score = null;
  let bodyString = null;
  try {
    score = scoreSystem(rawBodies);
    bodyString = buildBodyString(filterQualifyingBodies(rawBodies), classifyStars(rawBodies));
  } catch {
    // Skip scoring on malformed system — keep the entry for the region index but
    // flag score as null so upsert-state doesn't promote it to scoutedSystems.
  }

  return {
    id64: sys.id64,
    name: sys.name,
    coords: { x: coords.x, y: coords.y, z: coords.z },
    mainStar: mainStar ? mainStar.subType : null,
    population: sys.population || 0,
    economy: sys.primaryEconomy || sys.economy || null,
    secondEconomy: sys.secondaryEconomy || null,
    score,
    bodyString,
    bodyCount: rawBodies.length,
    bodies: rawBodies.map(slimBody).filter(Boolean),
  };
}

// ===== GZIP MEMBER DETECTION (for parallel decode) =====

/**
 * Scan a gzip file for independent member start offsets.
 *
 * A gzip member starts with: 1f 8b 08 <flags> <mtime:4> <xfl> <os>
 * We validate candidates by requiring the 10th byte (OS field) to be one of
 * the common values: 0x00 (FAT), 0x03 (Unix), 0x0a (TOPS-20), 0xff (unknown).
 * That plus the 3-byte magic nearly eliminates false positives.
 *
 * Returns array of byte offsets, always including 0 as the first.
 * Memory: stores all offsets in RAM — for a 100 GB file with ~1300 members
 * per 200MB (from empirical scan), we'd expect ~650K members × 8 bytes = 5 MB.
 */
async function findGzipMemberOffsets(filePath, onProgress) {
  const fd = fs.openSync(filePath, 'r');
  const totalSize = fs.statSync(filePath).size;
  const BUF = 4 * 1024 * 1024; // 4 MB chunks
  const buf = Buffer.alloc(BUF);
  const offsets = [];
  let pos = 0;
  // Overlap between chunks so a 10-byte header straddling a boundary isn't missed
  const OVERLAP = 16;
  let lastLog = Date.now();

  while (pos < totalSize) {
    const n = fs.readSync(fd, buf, 0, Math.min(BUF, totalSize - pos), pos);
    if (n === 0) break;
    const scanEnd = n - 10; // need at least 10 bytes for header
    for (let i = 0; i < scanEnd; i++) {
      if (buf[i] !== 0x1f || buf[i + 1] !== 0x8b || buf[i + 2] !== 0x08) continue;
      const os9 = buf[i + 9];
      // OS field whitelist — real gzip headers almost always have one of these
      if (os9 !== 0x00 && os9 !== 0x03 && os9 !== 0x0a && os9 !== 0xff) continue;
      offsets.push(pos + i);
    }
    // Advance, leaving overlap so headers at boundaries aren't missed
    pos += Math.max(1, n - OVERLAP);
    const now = Date.now();
    if (now - lastLog > 2000 && onProgress) {
      onProgress(pos, totalSize, offsets.length);
      lastLog = now;
    }
  }
  fs.closeSync(fd);
  // De-duplicate and sort (in case overlap caused a rare double-detection)
  const uniq = Array.from(new Set(offsets)).sort((a, b) => a - b);
  return uniq;
}

// ===== BUILD =====

/** Parse region config from --regions FILE or single-region --output/--cx/... args */
function parseRegionsConfig() {
  const regionsPath = getArg('regions');
  if (regionsPath) {
    const raw = JSON.parse(fs.readFileSync(regionsPath, 'utf-8'));
    if (!Array.isArray(raw)) throw new Error('regions file must be a JSON array');
    return raw.map((r) => {
      if ([r.cx, r.cy, r.cz, r.radius].some((v) => typeof v !== 'number') || typeof r.output !== 'string') {
        throw new Error('each region needs {name, cx, cy, cz, radius, output}');
      }
      return { name: r.name || r.output, cx: r.cx, cy: r.cy, cz: r.cz, radius: r.radius, output: r.output };
    });
  }
  const output = getArg('output');
  const cx = parseFloat(getArg('cx'));
  const cy = parseFloat(getArg('cy'));
  const cz = parseFloat(getArg('cz'));
  const radius = parseFloat(getArg('radius'));
  if (!output || [cx, cy, cz, radius].some(Number.isNaN)) {
    throw new Error('build needs either --regions FILE or all of --output --cx --cy --cz --radius');
  }
  return [{ name: 'single', cx, cy, cz, radius, output }];
}

/**
 * Core per-line processor — consumes a readline stream of JSONL systems,
 * filters by region membership, writes slim+scored entries to per-region
 * write streams. Returns {scanned, totalKept, perRegionKept}.
 *
 * Streams are created by the caller (so cmdBuild vs cmdBuildWorker can target
 * final output paths vs per-worker temp paths independently).
 */
async function processSystemStream(rl, regions, streams, options = {}) {
  const logPrefix = options.logPrefix || '[build]';
  const logEvery = options.logEvery || 10_000;
  let scanned = 0;
  let totalKept = 0;
  const startedAt = Date.now();
  let lastLog = startedAt;

  for await (const rawLine of rl) {
    scanned++;
    let line = rawLine;
    if (line.length === 0) continue;
    if (line === '[' || line === ']') continue;
    if (line.endsWith(',')) line = line.slice(0, -1);

    let sys;
    try { sys = JSON.parse(line); } catch { continue; }
    if (!sys || !sys.coords) continue;

    const hits = [];
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const d = Math.sqrt((sys.coords.x - r.cx) ** 2 + (sys.coords.y - r.cy) ** 2 + (sys.coords.z - r.cz) ** 2);
      if (d <= r.radius) hits.push(i);
    }
    if (hits.length > 0) {
      const slim = slimSystem(sys);
      const slimJson = JSON.stringify(slim) + '\n';
      for (const i of hits) {
        streams[i].stream.write(slimJson);
        streams[i].kept++;
      }
      totalKept++;
    }

    const now = Date.now();
    if (now - lastLog > logEvery) {
      lastLog = now;
      const elapsed = (now - startedAt) / 1000;
      const rate = (scanned / elapsed).toFixed(0);
      const perRegion = streams.map((s, i) => `${regions[i].name}=${s.kept}`).join(' ');
      console.error(`${logPrefix} ${scanned.toLocaleString()} scanned (${rate}/s) [${perRegion}]`);
    }
  }
  return { scanned, totalKept, startedAt };
}

async function cmdBuild() {
  const input = getArg('input');
  if (!input) { console.error('build requires --input'); process.exit(1); }

  let regions;
  try { regions = parseRegionsConfig(); } catch (e) { console.error(e.message); process.exit(1); }

  const workers = parseInt(getArg('workers', '1'), 10);
  if (workers > 1) return cmdBuildParallel(input, regions, workers);

  // Single-thread fast path — regex coord extract, squared-distance (no sqrt),
  // manual line split (no readline overhead), full JSON.parse only on hits
  return cmdBuildSingleFast(input, regions);
}

const COORD_RE = /"coords":\s*\{\s*"x":\s*(-?[\d.eE+-]+)\s*,\s*"y":\s*(-?[\d.eE+-]+)\s*,\s*"z":\s*(-?[\d.eE+-]+)/;

async function cmdBuildSingleFast(input, regions) {
  console.error(`[fast] input=${input}`);
  const streams = regions.map((r) => {
    console.error(`[fast] region "${r.name}" → ${r.output}  center=(${r.cx}, ${r.cy}, ${r.cz}) radius=${r.radius}ly`);
    // Pre-compute squared radius for comparison without sqrt
    r._r2 = r.radius * r.radius;
    return { stream: fs.createWriteStream(r.output), kept: 0 };
  });

  const readStream = fs.createReadStream(input);
  const gunzip = zlib.createGunzip();
  const decoded = readStream.pipe(gunzip);

  let tail = '';
  let scanned = 0;
  const startedAt = Date.now();
  let lastLog = startedAt;

  function processLine(line) {
    if (line.length === 0) return;
    scanned++;
    if (line === '[' || line === ']') return;
    // Strip trailing comma (Spansh dumps are wrapped as one big JSON array)
    if (line.charCodeAt(line.length - 1) === 44) line = line.slice(0, -1);

    const m = COORD_RE.exec(line);
    if (!m) return;
    const x = +m[1]; // unary + ~= parseFloat but faster
    const y = +m[2];
    const z = +m[3];

    // Collect region hits using squared distance (skip sqrt)
    let matched = null;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const dx = x - r.cx, dy = y - r.cy, dz = z - r.cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r._r2) {
        if (matched === null) matched = [i];
        else matched.push(i);
      }
    }
    if (matched === null) return;

    // Slow path — full parse + slim + score
    let sys;
    try { sys = JSON.parse(line); } catch { return; }
    if (!sys || !sys.coords) return;
    const slim = slimSystem(sys);
    const slimJson = JSON.stringify(slim) + '\n';
    for (let k = 0; k < matched.length; k++) {
      const idx = matched[k];
      streams[idx].stream.write(slimJson);
      streams[idx].kept++;
    }
  }

  for await (const buf of decoded) {
    const text = tail ? tail + buf.toString('utf8') : buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) { tail = text; continue; }
    tail = text.slice(lastNl + 1);

    // Split [0..lastNl+1) into lines WITHOUT allocating a huge array via split()
    let start = 0;
    let end;
    while ((end = text.indexOf('\n', start)) >= 0 && end <= lastNl) {
      processLine(text.slice(start, end));
      start = end + 1;
    }

    const now = Date.now();
    if (now - lastLog > 10_000) {
      const elapsed = (now - startedAt) / 1000;
      const rate = (scanned / elapsed).toFixed(0);
      const perRegion = streams.map((s, i) => `${regions[i].name}=${s.kept}`).join(' ');
      console.error(`[fast] ${scanned.toLocaleString()} processed (${rate}/s) [${perRegion}]`);
      lastLog = now;
    }
  }
  // Final tail
  if (tail) processLine(tail);

  await Promise.all(streams.map((s) => new Promise((res) => s.stream.end(res))));
  const elapsed = (Date.now() - startedAt) / 1000;
  console.error(`[fast] DONE. ${scanned.toLocaleString()} scanned in ${elapsed.toFixed(1)}s (${(scanned / elapsed).toFixed(0)}/s avg)`);
  for (let i = 0; i < regions.length; i++) {
    const size = fs.existsSync(regions[i].output) ? fs.statSync(regions[i].output).size : 0;
    console.error(`[fast]   "${regions[i].name}": ${streams[i].kept.toLocaleString()} systems → ${regions[i].output} (${(size/1024/1024).toFixed(1)} MB)`);
  }
}

// ===== HYBRID PARALLEL BUILD =====
// Single-threaded gunzip (unavoidable — can't reliably split a concatenated
// gzip file without false positives eating reliability). N worker threads do
// the JSON.parse + region filter + score compute. Based on benchmarks, this
// is the real bottleneck — parse+score ran at ~half native gunzip speed on
// one core, so parallelizing it gets us to ~gunzip max (2–3× overall).

async function cmdBuildParallel(input, regions, workerCount) {
  console.error(`[hybrid] input=${input}`);
  console.error(`[hybrid] workers=${workerCount}`);
  for (const r of regions) {
    console.error(`[hybrid] region "${r.name}" → ${r.output}  center=(${r.cx}, ${r.cy}, ${r.cz}) radius=${r.radius}ly`);
  }

  // Per-region output streams (parent owns writes — workers just return hits)
  const streams = regions.map((r) => ({ stream: fs.createWriteStream(r.output), kept: 0 }));

  // Spawn worker threads
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    const w = new Worker(SELF_PATH, {
      workerData: { mode: 'build-parser', regions: regions.map((r) => ({
        name: r.name, cx: r.cx, cy: r.cy, cz: r.cz, radius: r.radius,
      })) },
    });
    workers.push({ worker: w, id: i, pending: 0, done: false });
  }

  // Handle results from workers. `hits` is a flat array [regionIdx, json, ...]
  // to minimize cloning overhead (strings already, no nested objects).
  let totalScanned = 0;
  let totalKept = 0;
  for (const w of workers) {
    w.worker.on('message', (msg) => {
      totalScanned += msg.scanned;
      w.pending -= msg.scanned;
      for (let k = 0; k < msg.hits.length; k += 2) {
        const idx = msg.hits[k];
        const json = msg.hits[k + 1];
        streams[idx].stream.write(json);
        streams[idx].kept++;
      }
      totalKept += msg.hits.length / 2;
    });
    w.worker.on('error', (e) => { console.error(`[hybrid] worker ${w.id} error:`, e); });
  }

  // Feed buffer chunks (not individual lines) to workers. Main thread only
  // gunzips + UTF-8-decodes + finds \n boundaries — no readline overhead.
  // Each dispatch is a string containing many complete lines terminated by \n.
  // Workers split + parse + score in parallel.
  const TARGET_CHUNK_BYTES = 2 * 1024 * 1024; // ~2 MB per message ≈ ~400 systems
  const MAX_IN_FLIGHT_BYTES = 16 * 1024 * 1024; // worker queue cap

  const readStream = fs.createReadStream(input);
  const gunzip = zlib.createGunzip();
  const decoded = readStream.pipe(gunzip);

  const startedAt = Date.now();
  let lastLog = startedAt;
  let roundRobin = 0;
  // Pending buffers (array) + total length — defer concat until dispatch
  /** @type {Buffer[]} */
  let pendingBufs = [];
  let pendingLen = 0;

  function flushChunk(chunkStr, estimatedSystems) {
    const w = workers[roundRobin];
    roundRobin = (roundRobin + 1) % workerCount;
    w.pending += estimatedSystems;
    w.worker.postMessage(chunkStr);
  }

  async function waitForBackpressure() {
    while (workers.every((w) => w.pending >= 2000)) {
      await new Promise((r) => setImmediate(r));
    }
  }

  for await (const buf of decoded) {
    pendingBufs.push(buf);
    pendingLen += buf.length;
    if (pendingLen < TARGET_CHUNK_BYTES) continue;

    // Concat all pending buffers into one, find last \n, split off the prefix
    const combined = pendingBufs.length === 1 ? pendingBufs[0] : Buffer.concat(pendingBufs, pendingLen);
    const lastNl = combined.lastIndexOf(0x0A);
    if (lastNl < 0) {
      // No newline yet — keep accumulating
      pendingBufs = [combined];
      pendingLen = combined.length;
      continue;
    }
    const prefix = combined.subarray(0, lastNl + 1);
    const tail = combined.subarray(lastNl + 1);
    pendingBufs = tail.length > 0 ? [Buffer.from(tail)] : [];
    pendingLen = tail.length;

    const chunkStr = prefix.toString('utf8');
    // Rough estimate: ~5 KB per Spansh system
    const est = Math.max(1, Math.floor(prefix.length / 5000));
    flushChunk(chunkStr, est);

    const now = Date.now();
    if (now - lastLog > 10_000) {
      lastLog = now;
      const elapsed = (now - startedAt) / 1000;
      const rate = (totalScanned / elapsed).toFixed(0);
      const perRegion = streams.map((s, i) => `${regions[i].name}=${s.kept}`).join(' ');
      console.error(`[hybrid] ${totalScanned.toLocaleString()} processed (${rate}/s) in-flight ${workers.map((w) => w.pending).join(',')} [${perRegion}]`);
    }
    await waitForBackpressure();
  }

  // Flush any remaining bytes
  if (pendingLen > 0) {
    const combined = pendingBufs.length === 1 ? pendingBufs[0] : Buffer.concat(pendingBufs, pendingLen);
    const chunkStr = combined.toString('utf8');
    flushChunk(chunkStr, Math.max(1, Math.floor(combined.length / 5000)));
  }

  // Wait for all in-flight to complete
  while (workers.some((w) => w.pending > 0)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  for (const w of workers) w.worker.postMessage(null);
  await Promise.all(workers.map((w) => w.worker.terminate()));

  // Flush output streams
  await Promise.all(streams.map((s) => new Promise((res) => s.stream.end(res))));

  const elapsed = (Date.now() - startedAt) / 1000;
  console.error(`[hybrid] DONE. ${totalScanned.toLocaleString()} systems scanned in ${elapsed.toFixed(1)}s`);
  for (let i = 0; i < regions.length; i++) {
    const size = fs.existsSync(regions[i].output) ? fs.statSync(regions[i].output).size : 0;
    console.error(`[hybrid]   "${regions[i].name}": ${streams[i].kept.toLocaleString()} systems → ${regions[i].output} (${(size/1024/1024).toFixed(1)} MB)`);
  }
}

// ===== READ INDEX =====

async function* loadRegion(regionPath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(regionPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    try { yield JSON.parse(line); } catch { /* skip */ }
  }
}

// ===== SECTOR SCAN =====

async function cmdSector() {
  const region = getArg('region');
  const prefix = getArg('prefix');
  if (!region || !prefix) {
    console.error('sector requires --region and --prefix');
    process.exit(1);
  }
  const atmoExclude = (getArg('exclude-atmo', '') || '').toLowerCase().split(',').filter(Boolean);
  const interesting = [];
  for await (const sys of loadRegion(region)) {
    if (!sys.name.startsWith(prefix)) continue;
    const atmoLandables = sys.bodies.filter(
      (b) => b.landable && b.atmo
            && !/^Icy/i.test(b.subType || '')
            && !/Rocky ice/i.test(b.subType || '')
            && !atmoExclude.some((a) => (b.atmo || '').toLowerCase().includes(a)),
    );
    const oxy = atmoLandables.filter((b) => /oxygen/i.test(b.atmo)).length;
    const rareAtmo = atmoLandables.filter((b) => /oxygen|nitrogen|methane|neon|argon/i.test(b.atmo)).length;
    const ringedLandable = sys.bodies.filter((b) => b.landable && b.rings).length;
    interesting.push({
      name: sys.name,
      id64: sys.id64,
      mainStar: sys.mainStar,
      bodyCount: sys.bodies.length,
      atmoLandables: atmoLandables.length,
      oxygenLandables: oxy,
      rareAtmoLandables: rareAtmo,
      ringedLandables: ringedLandable,
      highlights: atmoLandables.slice(0, 8).map((b) => `${b.name.split(' ').slice(-1)[0]}:${b.atmo}`).join(', '),
    });
  }
  // Sort: systems with rare atmospheres first, then by atmoLandable count
  interesting.sort((a, b) => b.rareAtmoLandables - a.rareAtmoLandables || b.atmoLandables - a.atmoLandables);
  console.log(`# ${interesting.length} systems in sector "${prefix}"`);
  console.log('name\tatmoLand\toxy\trareAtmo\tringedLand\tmainStar\thighlights');
  for (const r of interesting) {
    console.log([
      r.name, r.atmoLandables, r.oxygenLandables, r.rareAtmoLandables, r.ringedLandables, r.mainStar || '-', r.highlights,
    ].join('\t'));
  }
}

// ===== ATMOSPHERIC QUERY =====

async function cmdAtmospheric() {
  const region = getArg('region');
  const prefix = getArg('prefix'); // optional sector
  const atmoExclude = (getArg('exclude-atmo', 'helium') || '').toLowerCase().split(',').filter(Boolean);
  const maxGravity = parseFloat(getArg('max-gravity', 'NaN'));
  const minOxygen = parseInt(getArg('min-oxygen', '0'), 10);
  if (!region) { console.error('atmospheric requires --region'); process.exit(1); }

  const rows = [];
  for await (const sys of loadRegion(region)) {
    if (prefix && !sys.name.startsWith(prefix)) continue;
    for (const b of sys.bodies) {
      if (!b.landable || !b.atmo) continue;
      if (/^Icy/i.test(b.subType || '')) continue;
      if (/Rocky ice/i.test(b.subType || '')) continue;
      if (atmoExclude.some((a) => (b.atmo || '').toLowerCase().includes(a))) continue;
      if (!Number.isNaN(maxGravity) && b.gravity != null && b.gravity > maxGravity) continue;
      rows.push({ system: sys.name, body: b.name, subType: b.subType, atmo: b.atmo, g: b.gravity, em: b.em });
    }
  }
  // Min-oxygen filter is per-system
  if (minOxygen > 0) {
    const bySystem = new Map();
    for (const r of rows) {
      if (!bySystem.has(r.system)) bySystem.set(r.system, []);
      bySystem.get(r.system).push(r);
    }
    const keep = new Set();
    for (const [sys, list] of bySystem) {
      const oxy = list.filter((r) => /oxygen/i.test(r.atmo)).length;
      if (oxy >= minOxygen) keep.add(sys);
    }
    for (let i = rows.length - 1; i >= 0; i--) if (!keep.has(rows[i].system)) rows.splice(i, 1);
  }
  console.log(`# ${rows.length} atmospheric landables${prefix ? ` in "${prefix}"` : ''}`);
  // Group by atmosphere for a breakdown at the top
  const byAtmo = {};
  for (const r of rows) byAtmo[r.atmo] = (byAtmo[r.atmo] || 0) + 1;
  console.log('# By atmosphere:');
  for (const [a, n] of Object.entries(byAtmo).sort((a, b) => b[1] - a[1])) console.log('#   ' + n.toString().padStart(5) + '  ' + a);
  console.log('atmo\tsubType\tg\tem\tbody');
  rows.sort((a, b) => a.atmo.localeCompare(b.atmo) || a.system.localeCompare(b.system));
  for (const r of rows) {
    console.log([r.atmo, r.subType, r.g != null ? r.g.toFixed(2) : '-', r.em != null ? r.em.toFixed(2) : '-', r.body].join('\t'));
  }
}

// ===== NEAR QUERY =====

async function cmdNear() {
  const region = getArg('region');
  const systemName = getArg('system');
  const radius = parseFloat(getArg('radius', '50'));
  const filter = getArg('filter', 'atmospheric');
  if (!region || !systemName) { console.error('near requires --region and --system'); process.exit(1); }

  // First pass: find origin coords
  let origin = null;
  for await (const sys of loadRegion(region)) {
    if (sys.name.toLowerCase() === systemName.toLowerCase()) { origin = sys.coords; break; }
  }
  if (!origin) { console.error(`origin system "${systemName}" not in region index`); process.exit(1); }
  console.error(`[near] origin ${systemName} at (${origin.x}, ${origin.y}, ${origin.z}), radius ${radius}ly, filter ${filter}`);

  const rows = [];
  for await (const sys of loadRegion(region)) {
    const d = dist3d(sys.coords, origin);
    if (d > radius) continue;
    let match = null;
    if (filter === 'atmospheric') {
      const atmoLand = sys.bodies.filter((b) => b.landable && b.atmo && !/^Icy|Rocky ice/i.test(b.subType || '') && !/helium/i.test(b.atmo || ''));
      if (atmoLand.length === 0) continue;
      match = { atmoLand, highlights: atmoLand.map((b) => `${b.atmo}`).join(',') };
    } else if (filter === 'ringed') {
      const rl = sys.bodies.filter((b) => b.landable && b.rings);
      if (rl.length === 0) continue;
      match = { count: rl.length, highlights: rl.map((b) => b.name.split(' ').slice(-1)[0]).slice(0, 5).join(',') };
    } else if (filter === 'rare-atmo') {
      const rare = sys.bodies.filter((b) => b.landable && b.atmo && /oxygen|nitrogen|methane|neon|argon/i.test(b.atmo || ''));
      if (rare.length === 0) continue;
      match = { count: rare.length, highlights: rare.map((b) => b.atmo).join(',') };
    } else if (filter === 'rare-star') {
      const rare = sys.bodies.filter((b) => b.type === 'Star' && /Neutron|Black Hole|Wolf-Rayet|White Dwarf/i.test(b.subType || ''));
      if (rare.length === 0) continue;
      match = { count: rare.length, highlights: rare.map((b) => b.subType).join(',') };
    } else {
      console.error(`unknown filter "${filter}"`);
      process.exit(1);
    }
    rows.push({ dist: d, sys, match });
  }
  rows.sort((a, b) => a.dist - b.dist);
  console.log(`# ${rows.length} matches within ${radius}ly of ${systemName}`);
  console.log('dist_ly\tsystem\tmainStar\tmatch');
  for (const r of rows) {
    console.log([r.dist.toFixed(1), r.sys.name, r.sys.mainStar || '-', r.match.highlights].join('\t'));
  }
}

// ===== UPSERT-STATE =====

/**
 * Bulk-populate colony-data.json with scoutedSystems + knownSystems from the
 * region index. Safe merge rules:
 *   - scoutedSystems: overwrite existing `fromJournal: false` entries (bulk
 *     Spansh re-imports are safe) but NEVER touch `fromJournal: true`
 *     (personal journal scoring wins). New entries added unconditionally.
 *   - knownSystems: fill in coords / population / economy only if the existing
 *     entry is missing them. NEVER overwrite visitCount / lastSeen / name case.
 *
 * --min-score gates which systems get promoted to scoutedSystems. --state is
 * the colony-data.json path.
 */
async function cmdUpsertState() {
  const region = getArg('region');
  const statePath = getArg('state');
  const minScore = parseFloat(getArg('min-score', '40'));
  const dryRun = getFlag('dry-run');
  if (!region || !statePath) { console.error('upsert-state requires --region and --state'); process.exit(1); }
  console.error(`[upsert] region=${region}`);
  console.error(`[upsert] state=${statePath}`);
  console.error(`[upsert] min-score=${minScore}  dry-run=${dryRun}`);

  // Backup the state file before mutating it. Safety net in case anything
  // goes wrong with the merge — user can restore from colony-data.json.bak.
  if (!dryRun) {
    const backupPath = statePath + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(statePath, backupPath);
    console.error(`[upsert] backup → ${backupPath}`);
  }

  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const scouted = state.scoutedSystems && typeof state.scoutedSystems === 'object' ? state.scoutedSystems : {};
  const known = state.knownSystems && typeof state.knownSystems === 'object' ? state.knownSystems : {};

  let promoted = 0;
  let skippedLowScore = 0;
  let skippedNoScore = 0;
  let skippedJournalPrior = 0;
  let knownAdded = 0;
  let knownPatched = 0;
  const nowIso = new Date().toISOString();

  for await (const sys of loadRegion(region)) {
    // Skip if score is missing / below threshold
    if (!sys.score || typeof sys.score.total !== 'number') { skippedNoScore++; continue; }
    if (sys.score.total < minScore) { skippedLowScore++; continue; }

    // Scouted upsert — guard against overwriting personal journal scoring
    const existingScouted = scouted[String(sys.id64)];
    if (existingScouted && existingScouted.fromJournal === true) {
      skippedJournalPrior++;
    } else {
      scouted[String(sys.id64)] = {
        id64: sys.id64,
        name: sys.name,
        score: sys.score,
        bodyString: sys.bodyString || '',
        scoutedAt: nowIso,
        spanshBodyCount: sys.bodyCount,
        fromJournal: false,
        fssAllBodiesFound: true, // Spansh has the full picture
      };
      promoted++;
    }

    // KnownSystems upsert — by lowercase name
    const nameKey = sys.name.toLowerCase();
    const existingKnown = known[nameKey];
    if (!existingKnown) {
      known[nameKey] = {
        systemName: sys.name,
        systemAddress: sys.id64,
        coordinates: sys.coords,
        population: sys.population || 0,
        economy: sys.economy || 'Unknown',
        economyLocalised: sys.economy || 'Unknown',
        secondEconomy: sys.secondEconomy || undefined,
        visitCount: 0,
        lastSeen: null,
      };
      knownAdded++;
    } else {
      // Patch missing fields only — leave visit count / lastSeen alone
      let patched = false;
      if (!existingKnown.coordinates && sys.coords) { existingKnown.coordinates = sys.coords; patched = true; }
      if (!existingKnown.systemAddress && sys.id64) { existingKnown.systemAddress = sys.id64; patched = true; }
      if ((!existingKnown.population || existingKnown.population === 0) && sys.population) {
        existingKnown.population = sys.population; patched = true;
      }
      if ((!existingKnown.economy || existingKnown.economy === 'Unknown') && sys.economy) {
        existingKnown.economy = sys.economy; existingKnown.economyLocalised = sys.economy; patched = true;
      }
      if (patched) knownPatched++;
    }
  }

  console.error(`[upsert] scoutedSystems: +${promoted} promoted, ${skippedJournalPrior} kept (journal-sourced), ${skippedLowScore} below threshold, ${skippedNoScore} missing score`);
  console.error(`[upsert] knownSystems:   +${knownAdded} new, ${knownPatched} patched`);

  if (dryRun) {
    console.error('[upsert] --dry-run — no write');
    return;
  }

  state.scoutedSystems = scouted;
  state.knownSystems = known;
  const json = JSON.stringify(state);
  // Size-check guard — if new file is smaller than old by >30%, bail
  const oldSize = fs.statSync(statePath).size;
  if (json.length < oldSize * 0.7) {
    console.error(`[upsert] ABORT — new size ${json.length} is <70% of old ${oldSize}. Not writing.`);
    process.exit(1);
  }
  fs.writeFileSync(statePath, json);
  console.error(`[upsert] wrote ${statePath} (${(json.length / 1024 / 1024).toFixed(1)} MB, was ${(oldSize / 1024 / 1024).toFixed(1)} MB)`);
  console.error('[upsert] restart the server (or hit POST /api/state to trigger state_updated) to have clients rehydrate');
}

// ===== MAIN =====

// Only dispatch CLI commands on the main thread. Worker threads take a
// different path at the top of this file (see isMainThread guard).
if (isMainThread) {
  (async () => {
    switch (command) {
      case 'build': await cmdBuild(); break;
      case 'sector': await cmdSector(); break;
      case 'atmospheric': await cmdAtmospheric(); break;
      case 'near': await cmdNear(); break;
      case 'upsert-state': await cmdUpsertState(); break;
      default:
        console.error('Commands: build [--workers N] | sector | atmospheric | near | upsert-state');
        console.error('See file header for usage examples.');
        process.exit(1);
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
