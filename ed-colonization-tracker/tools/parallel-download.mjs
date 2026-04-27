#!/usr/bin/env node
/**
 * Parallel HTTP/HTTPS downloader using byte-range requests.
 *
 *   node tools/parallel-download.mjs \
 *       --url https://downloads.spansh.co.uk/galaxy.json.gz \
 *       --output E:/Spansh/galaxy.json.gz \
 *       [--connections 16]
 *
 * Opens N connections, each pulls a different range of the file. Writes
 * directly to offsets in the output. Resumable — re-run after interruption
 * and it'll skip chunks already downloaded (based on progress file).
 *
 * Requires the server to report a valid Content-Length and support
 * Accept-Ranges: bytes. HEAD request verifies both before starting.
 */

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const args = process.argv.slice(2);
function getArg(n, d = null) { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; }

const url = getArg('url');
const output = getArg('output');
const connections = parseInt(getArg('connections', '16'), 10);

if (!url || !output) {
  console.error('Usage: --url URL --output PATH [--connections N]');
  process.exit(1);
}

const progressFile = output + '.progress';

function head(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ method: 'HEAD', host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        head(res.headers.location).then(resolve, reject);
        return;
      }
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadChunk(url, start, end, fd, onProgress, label) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      host: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        'Range': `bytes=${start}-${end}`,
        'User-Agent': 'ed-colony-tracker/1.2 parallel-downloader',
      },
    }, (res) => {
      console.error(`[${label}] HTTP ${res.statusCode} range=${start}-${end} (${((end-start+1)/1024/1024).toFixed(1)} MB)`);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadChunk(res.headers.location, start, end, fd, onProgress, label).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${start}-${end}`));
        return;
      }
      let offset = start;
      res.on('data', (chunk) => {
        try {
          fs.writeSync(fd, chunk, 0, chunk.length, offset);
          offset += chunk.length;
          onProgress(chunk.length);
        } catch (e) {
          console.error(`[${label}] writeSync error at offset ${offset}: ${e.message}`);
          reject(e);
        }
      });
      res.on('end', () => resolve(offset - 1));
      res.on('error', (e) => { console.error(`[${label}] stream error: ${e.message}`); reject(e); });
    });
    req.on('error', (e) => { console.error(`[${label}] request error: ${e.message}`); reject(e); });
    req.setTimeout(120_000, () => { console.error(`[${label}] timeout`); req.destroy(new Error('timeout')); });
    req.end();
  });
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(progressFile, 'utf-8')); }
  catch { return null; }
}

function saveProgress(state) {
  fs.writeFileSync(progressFile, JSON.stringify(state));
}

(async () => {
  console.error(`[head] ${url}`);
  const h = await head(url);
  if (h.status !== 200) { console.error(`HEAD returned ${h.status}`); process.exit(1); }
  const total = parseInt(h.headers['content-length'], 10);
  if (!total) { console.error('No Content-Length'); process.exit(1); }
  if (h.headers['accept-ranges'] !== 'bytes') {
    console.error(`Server does not advertise Accept-Ranges: bytes (got "${h.headers['accept-ranges']}")`);
    console.error('Falling back to single connection would defeat the point. Aborting.');
    process.exit(1);
  }
  console.error(`[head] total=${(total / 1024 / 1024 / 1024).toFixed(2)} GB, ranges supported`);

  // Open or create the output file. If it exists and is the right size, and
  // progress file says done, bail early.
  const existing = fs.existsSync(output) ? fs.statSync(output).size : 0;
  if (existing === total) {
    console.error(`[ok] ${output} already complete (${total} bytes)`);
    try { fs.unlinkSync(progressFile); } catch {}
    return;
  }
  // Pre-allocate file to total size so parallel writes don't race on size.
  // On Windows, ftruncate on an append-opened fd returns EPERM, so we
  // create with write mode, seek, and write a single byte at the final offset.
  if (!fs.existsSync(output)) {
    const fd0 = fs.openSync(output, 'w');
    // Write a single zero byte at the last offset to force allocation
    fs.writeSync(fd0, Buffer.from([0]), 0, 1, total - 1);
    fs.closeSync(fd0);
  } else if (existing < total) {
    const fd0 = fs.openSync(output, 'r+');
    fs.writeSync(fd0, Buffer.from([0]), 0, 1, total - 1);
    fs.closeSync(fd0);
  }

  const fd = fs.openSync(output, 'r+');

  // Divide into chunks
  let chunks = [];
  const prior = loadProgress();
  if (prior && prior.total === total && prior.url === url && Array.isArray(prior.chunks)) {
    console.error(`[resume] ${prior.chunks.length} chunks tracked, ${prior.chunks.filter((c) => c.done).length} complete`);
    chunks = prior.chunks;
  } else {
    const chunkSize = Math.ceil(total / connections);
    for (let i = 0; i < connections; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, total - 1);
      chunks.push({ id: i, start, end, downloaded: 0, done: false });
    }
  }

  let totalDownloaded = chunks.reduce((a, c) => a + (c.done ? (c.end - c.start + 1) : 0), 0);
  const startedAt = Date.now();
  let lastLog = startedAt;
  let lastBytes = totalDownloaded;

  const state = { url, total, chunks };
  // Save progress frequently so kill-9 doesn't lose more than a second of work
  const saveTimer = setInterval(() => saveProgress(state), 1_000);
  saveProgress(state); // initial snapshot so the progress file exists before first data arrives

  async function runChunk(c, attempt = 1) {
    if (c.done) return;
    try {
      const rangeStart = c.start + c.downloaded;
      await downloadChunk(url, rangeStart, c.end, fd, (n) => {
        c.downloaded += n;
        totalDownloaded += n;
      }, `chunk ${c.id}`);
      c.done = true;
      console.error(`[chunk ${c.id}] done (${((c.end - c.start + 1) / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      if (attempt > 5) throw new Error(`chunk ${c.id} failed after 5 attempts: ${e.message}`);
      console.error(`[chunk ${c.id}] error (attempt ${attempt}): ${e.message}, retrying...`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return runChunk(c, attempt + 1);
    }
  }

  const progressTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - startedAt) / 1000;
    const windowElapsed = (now - lastLog) / 1000;
    const windowBytes = totalDownloaded - lastBytes;
    const windowRate = windowBytes / windowElapsed / 1024 / 1024;
    const avgRate = totalDownloaded / elapsed / 1024 / 1024;
    const pct = (totalDownloaded / total * 100).toFixed(1);
    const etaS = avgRate > 0 ? (total - totalDownloaded) / (avgRate * 1024 * 1024) : 0;
    const etaH = Math.floor(etaS / 3600);
    const etaM = Math.floor((etaS % 3600) / 60);
    console.error(`[progress] ${pct}% ${(totalDownloaded / 1024 / 1024 / 1024).toFixed(2)}/${(total / 1024 / 1024 / 1024).toFixed(2)} GB  | ${windowRate.toFixed(1)} MB/s now, ${avgRate.toFixed(1)} MB/s avg | ETA ${etaH}h${etaM}m`);
    lastLog = now;
    lastBytes = totalDownloaded;
  }, 10_000);

  await Promise.all(chunks.map((c) => runChunk(c)));

  clearInterval(saveTimer);
  clearInterval(progressTimer);
  saveProgress(state);
  fs.closeSync(fd);

  const finalSize = fs.statSync(output).size;
  if (finalSize !== total) {
    console.error(`[warn] final size ${finalSize} != expected ${total}`);
    process.exit(1);
  }
  try { fs.unlinkSync(progressFile); } catch {}
  const elapsed = (Date.now() - startedAt) / 1000;
  console.error(`[done] ${(total / 1024 / 1024 / 1024).toFixed(2)} GB in ${Math.floor(elapsed / 60)}m${Math.floor(elapsed % 60)}s (${(total / elapsed / 1024 / 1024).toFixed(1)} MB/s avg)`);
})().catch((e) => { console.error(e); process.exit(1); });
