/**
 * Update NOTICE — read-only. Asks GitHub which release is current and reports it so
 * the UI can show a banner and a download link. It never downloads, writes, swaps or
 * deletes anything; the worst it can do is report nothing.
 *
 * A v1.33.0 build also downloaded the new .exe and swapped it in via a helper .bat.
 * That was withdrawn: review found the accompanying data migration could silently
 * orphan an install, and the swap's PID-wait was never verified. Updating is manual —
 * download the release and replace the .exe in its existing folder (data lives beside
 * it). If self-swap is revisited, the PID wait needs a real test on non-English
 * Windows, and it must not be paired with a data move.
 */

// The repo has not been renamed on GitHub yet. GitHub redirects renamed repos
// (including via the API), so this keeps working either way — but update it once
// the rename happens rather than relying on the redirect forever.
const REPO = 'ChITty98/EliteDanagerousColonyTracker';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const UA = 'ED-Colony-Architect-Updater';

let ctx = { currentVersion: '0.0.0', isSea: false, broadcast: null };
let status = {
  current: null,
  latest: null,
  updateAvailable: false,
  releaseUrl: null,
  publishedAt: null,
  notes: null,
  assetUrl: null,      // reported so the UI can link straight at the .exe
  assetSize: null,
  assetName: null,
  lastChecked: null,
  lastError: null,
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

export function initUpdater({ currentVersion, isSea, broadcast }) {
  ctx = { currentVersion, isSea, broadcast };
  status.current = currentVersion;
  if (!isSea) return; // dev runs don't check
  // Boot check is best-effort and must never block or crash startup.
  checkForUpdate().catch(() => {});
  const timer = setInterval(() => { checkForUpdate().catch(() => {}); }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

export function getUpdateStatus() {
  return { ...status };
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
