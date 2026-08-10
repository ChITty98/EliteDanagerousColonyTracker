/**
 * Self-update: check GitHub Releases, download the new exe, swap it in, relaunch.
 *
 * Why a helper script: Windows will not let a running process overwrite its own
 * .exe, so the swap has to happen after we exit. We write a tiny .bat that waits
 * for this PID to disappear, renames the current exe to .bak, moves the new one
 * into place, relaunches it, then deletes itself.
 *
 * Safety: the previous exe is always kept as a .bak, so a failed swap is undone by
 * renaming one file. The download is size- and (when SHA256SUMS.txt is published)
 * hash-verified before anything is touched. Data is untouched throughout — it lives
 * outside the exe folder now (see dataDir.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const REPO = 'ChITty98/EliteDanagerousColonyTracker';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const MIN_PLAUSIBLE_BYTES = 40 * 1024 * 1024; // a real build is ~96 MB
const UA = 'ED-Colony-Tracker-Updater';

let ctx = { currentVersion: '0.0.0', exePath: null, dataDir: null, isSea: false, broadcast: null };
let status = {
  current: null,
  latest: null,
  updateAvailable: false,
  releaseUrl: null,
  publishedAt: null,
  notes: null,
  assetUrl: null,
  assetSize: null,
  assetName: null,
  lastChecked: null,
  lastError: null,
  downloaded: null,   // path to a verified, ready-to-apply exe
  downloading: false,
};

/** "v1.32.0-b0810.2233" → [1,32,0]; unparseable → [0,0,0]. */
function semver(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

function isNewer(a, b) {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return true;
    if (x[i] < y[i]) return false;
  }
  return false;
}

export function initUpdater({ currentVersion, exePath, dataDir, isSea, broadcast }) {
  ctx = { currentVersion, exePath, dataDir, isSea, broadcast };
  status.current = currentVersion;
  if (!isSea) return; // dev runs don't self-update
  // Boot check is best-effort and must never block or crash startup.
  checkForUpdate().catch(() => {});
  const timer = setInterval(() => { checkForUpdate().catch(() => {}); }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

export function getUpdateStatus() {
  return { ...status, canSelfUpdate: !!ctx.isSea };
}

export async function checkForUpdate() {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const rel = await res.json();
    const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    status.latest = rel.tag_name || rel.name || null;
    status.releaseUrl = rel.html_url || null;
    status.publishedAt = rel.published_at || null;
    status.notes = rel.body || null;
    status.assetUrl = asset ? asset.browser_download_url : null;
    status.assetSize = asset ? asset.size : null;
    status.assetName = asset ? asset.name : null;
    status.updateAvailable = !!status.latest && isNewer(status.latest, ctx.currentVersion);
    status.lastChecked = new Date().toISOString();
    status.lastError = null;
    if (status.updateAvailable && ctx.broadcast) {
      ctx.broadcast({ type: 'update_available', latest: status.latest, current: ctx.currentVersion });
    }
  } catch (e) {
    status.lastError = e.message;
    status.lastChecked = new Date().toISOString();
  }
  return getUpdateStatus();
}

/** Published SHA256SUMS.txt (if any) → { filename: hash }. */
async function fetchChecksums(releaseAssets) {
  const sums = (releaseAssets || []).find((a) => /SHA256SUMS/i.test(a.name));
  if (!sums) return null;
  try {
    const res = await fetch(sums.browser_download_url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const txt = await res.text();
    const map = {};
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
      if (m) map[m[2].trim()] = m[1].toLowerCase();
    }
    return map;
  } catch { return null; }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

export async function downloadUpdate() {
  if (!ctx.isSea) throw new Error('Self-update only works from the packaged .exe');
  if (status.downloading) throw new Error('A download is already running');
  if (!status.assetUrl) {
    await checkForUpdate();
    if (!status.assetUrl) throw new Error('No .exe asset found on the latest release');
  }
  status.downloading = true;
  const dir = path.join(ctx.dataDir, 'updates');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, status.assetName || `ed-colony-tracker-${status.latest}.exe`);
  const tmp = `${dest}.part`;
  try {
    const res = await fetch(status.assetUrl, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || status.assetSize || 0;
    let seen = 0;
    let lastPct = -1;
    const out = fs.createWriteStream(tmp);
    for await (const chunk of res.body) {
      out.write(chunk);
      seen += chunk.length;
      const pct = total ? Math.floor((seen / total) * 100) : 0;
      if (pct !== lastPct && pct % 5 === 0 && ctx.broadcast) {
        lastPct = pct;
        ctx.broadcast({ type: 'update_progress', percent: pct, received: seen, total });
      }
    }
    await new Promise((r, j) => { out.end(); out.on('finish', r); out.on('error', j); });

    const size = fs.statSync(tmp).size;
    if (size < MIN_PLAUSIBLE_BYTES) throw new Error(`Downloaded file is implausibly small (${size} bytes)`);
    if (total && size !== total) throw new Error(`Size mismatch: expected ${total}, got ${size}`);

    // Hash-verify when the release publishes checksums.
    try {
      const res2 = await fetch(RELEASES_API, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
      if (res2.ok) {
        const rel = await res2.json();
        const sums = await fetchChecksums(rel.assets);
        const want = sums && status.assetName ? sums[status.assetName] : null;
        if (want) {
          const got = await sha256File(tmp);
          if (got !== want) throw new Error('SHA-256 mismatch — refusing to install');
        }
      }
    } catch (e) {
      if (/SHA-256 mismatch/.test(e.message)) throw e; // a real mismatch is fatal
      // otherwise: checksums unavailable, size checks stand
    }

    fs.renameSync(tmp, dest);
    status.downloaded = dest;
    status.downloading = false;
    if (ctx.broadcast) ctx.broadcast({ type: 'update_ready', version: status.latest, path: dest });
    return { ok: true, path: dest, size };
  } catch (e) {
    status.downloading = false;
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

/**
 * Swap in the downloaded exe and relaunch. Returns after scheduling the helper;
 * the caller should respond to the client and then exit the process.
 */
export function applyUpdate() {
  if (!ctx.isSea) throw new Error('Self-update only works from the packaged .exe');
  if (!status.downloaded || !fs.existsSync(status.downloaded)) {
    throw new Error('No verified download is ready — download the update first');
  }
  if (process.platform !== 'win32') throw new Error('Automatic swap is implemented for Windows only');

  const exe = ctx.exePath;
  const bak = `${exe}.bak`;
  const script = path.join(ctx.dataDir, 'apply-update.bat');
  const log = path.join(ctx.dataDir, 'apply-update.log');

  // Waits for this PID to exit, keeps the old exe as .bak, moves the new one in,
  // relaunches, then deletes itself. Every step is logged for post-mortems.
  const bat = [
    '@echo off',
    'setlocal',
    `echo [%DATE% %TIME%] applying update > "${log}"`,
    ':waitloop',
    'timeout /t 1 /nobreak >nul',
    `tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul`,
    'if not errorlevel 1 goto waitloop',
    `echo [%DATE% %TIME%] process ${process.pid} exited >> "${log}"`,
    `if exist "${bak}" del /f /q "${bak}" >> "${log}" 2>&1`,
    `move /y "${exe}" "${bak}" >> "${log}" 2>&1`,
    'if errorlevel 1 (',
    `  echo [%DATE% %TIME%] FAILED to move old exe aside - aborting, original untouched >> "${log}"`,
    '  goto done',
    ')',
    `move /y "${status.downloaded}" "${exe}" >> "${log}" 2>&1`,
    'if errorlevel 1 (',
    `  echo [%DATE% %TIME%] FAILED to move new exe in - restoring previous version >> "${log}"`,
    `  move /y "${bak}" "${exe}" >> "${log}" 2>&1`,
    ')',
    `echo [%DATE% %TIME%] relaunching >> "${log}"`,
    `start "" "${exe}"`,
    ':done',
    `del /f /q "%~f0"`,
  ].join('\r\n');

  fs.writeFileSync(script, bat);
  const child = spawn('cmd.exe', ['/c', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return { ok: true, script, backup: bak };
}
