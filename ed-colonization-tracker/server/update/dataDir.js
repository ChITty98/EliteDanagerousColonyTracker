/**
 * Where the app's data lives.
 *
 * Historically every data file sat next to the .exe (APP_DIR = dirname(execPath)).
 * That coupled a commander's entire history to the exe's location, so "updating"
 * meant replacing the exe IN PLACE or silently starting from an empty app — the
 * single biggest source of update pain.
 *
 * Data now lives in a stable per-user folder (%LOCALAPPDATA%\ED Colony Tracker on
 * Windows, ~/.local/share/ed-colony-tracker elsewhere), so the exe is disposable:
 * drop a new one anywhere and the data is still there.
 *
 * Migration is COPY-ONLY and fail-safe: originals are never deleted, and any error
 * aborts back to the old location rather than risking a half-moved state.
 *
 * Dev runs (node server.mjs / server-bundled.cjs) are untouched — they keep using
 * the source folder so the repo workflow and gitignore rules still apply.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Files copied on migration. Explicit, so nothing unexpected is hoovered up. */
const DATA_FILES = [
  'colony-data.json',
  'colony-token.txt',
  'colony-gallery.json',
  'journal-stats.json',
  'chain-watch.json',
  'mining-annotations.json',
  'mining-log.jsonl',
  'mining-rings.json',
  'mining-trophies.json',
  'copilot-captures.jsonl',
  'copilot-memory.json',
];

/** Directories copied on migration (recursively). */
const DATA_DIRS = ['colony-images', 'copilot-characters', 'backups'];

const MARKER = 'DATA-MOVED.txt';

function defaultDataRoot() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'ED Colony Tracker');
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'ed-colony-tracker');
}

function copyFileVerified(src, dest) {
  fs.copyFileSync(src, dest);
  const a = fs.statSync(src).size;
  const b = fs.statSync(dest).size;
  if (a !== b) throw new Error(`size mismatch copying ${path.basename(src)} (${a} → ${b})`);
  return a;
}

function copyDirVerified(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = copyDirVerified(s, d);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      bytes += copyFileVerified(s, d);
      files++;
    }
  }
  return { files, bytes };
}

/** True when this folder holds a real install worth migrating. */
function hasData(dir) {
  if (!dir) return false;
  for (const f of DATA_FILES) {
    try { if (fs.statSync(path.join(dir, f)).size > 0) return true; } catch { /* absent */ }
  }
  for (const d of DATA_DIRS) {
    try { if (fs.readdirSync(path.join(dir, d)).length > 0) return true; } catch { /* absent */ }
  }
  return false;
}

/**
 * Decide the data directory, migrating a legacy exe-adjacent install if needed.
 * Returns { dir, migrated, from, files, bytes, reason }.
 */
export function resolveDataDir({ isSea, exeDir, sourceDir, log = console.log }) {
  // Dev / .bat runs keep the source folder — unchanged behaviour.
  if (!isSea) return { dir: sourceDir, migrated: false, reason: 'dev' };

  // Explicit override wins (useful for portable installs on a stick).
  if (process.env.ED_COLONY_DATA_DIR) {
    const forced = process.env.ED_COLONY_DATA_DIR;
    try { fs.mkdirSync(forced, { recursive: true }); } catch { /* surfaces below */ }
    return { dir: forced, migrated: false, reason: 'env-override' };
  }

  const target = defaultDataRoot();

  // Already living in the new home.
  if (hasData(target)) return { dir: target, migrated: false, reason: 'existing' };

  // Nothing beside the exe either → fresh install, start in the new home.
  if (!hasData(exeDir)) {
    try {
      fs.mkdirSync(target, { recursive: true });
      return { dir: target, migrated: false, reason: 'fresh' };
    } catch (e) {
      log(`[Data] Could not create ${target} (${e.message}); staying beside the exe.`);
      return { dir: exeDir, migrated: false, reason: 'mkdir-failed' };
    }
  }

  // Legacy install beside the exe → copy it across. Any failure aborts to the old
  // location; originals are never touched, so the worst case is "nothing changed".
  try {
    fs.mkdirSync(target, { recursive: true });
    let files = 0;
    let bytes = 0;
    for (const f of DATA_FILES) {
      const src = path.join(exeDir, f);
      if (!fs.existsSync(src)) continue;
      bytes += copyFileVerified(src, path.join(target, f));
      files++;
    }
    for (const d of DATA_DIRS) {
      const src = path.join(exeDir, d);
      if (!fs.existsSync(src)) continue;
      const sub = copyDirVerified(src, path.join(target, d));
      files += sub.files;
      bytes += sub.bytes;
    }
    try {
      fs.writeFileSync(
        path.join(exeDir, MARKER),
        [
          'ED Colony Tracker data has MOVED.',
          '',
          `New location: ${target}`,
          `Copied on:    ${new Date().toISOString()}`,
          `Copied:       ${files} file(s), ${(bytes / 1048576).toFixed(1)} MB`,
          '',
          'The files in this folder are the ORIGINALS and were left untouched as a',
          'backup. The app no longer reads them. Once you are satisfied everything',
          'came across, they are safe to delete.',
          '',
          'Because data now lives outside this folder, you can replace the .exe with',
          'a newer one — anywhere on disk — without losing anything.',
          '',
        ].join('\n'),
      );
    } catch { /* marker is a courtesy, not a requirement */ }
    log(`[Data] Migrated ${files} file(s), ${(bytes / 1048576).toFixed(1)} MB → ${target}`);
    log('[Data] Originals left in place beside the exe (see DATA-MOVED.txt).');
    return { dir: target, migrated: true, from: exeDir, files, bytes, reason: 'migrated' };
  } catch (e) {
    log(`[Data] Migration FAILED (${e.message}) — continuing with data beside the exe. Nothing was lost.`);
    return { dir: exeDir, migrated: false, reason: 'migration-failed' };
  }
}

export const DATA_MANIFEST = { files: DATA_FILES, dirs: DATA_DIRS };
