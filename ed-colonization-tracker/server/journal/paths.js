/**
 * Journal directory resolution.
 *
 * Priority:
 *   1. Explicit override passed in (e.g. from settings.journalDirOverride)
 *   2. ED_JOURNAL_DIR env var
 *   3. %USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous (Windows default)
 *   4. $HOME/Saved Games/... (fallback for non-Windows — rare for ED)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_JOURNAL_SUBPATH = path.join('Saved Games', 'Frontier Developments', 'Elite Dangerous');

/**
 * @param {string|null|undefined} override
 * @returns {string}
 */
export function resolveJournalDir(override) {
  if (override && typeof override === 'string' && override.trim()) {
    return path.resolve(override.trim());
  }
  if (process.env.ED_JOURNAL_DIR && process.env.ED_JOURNAL_DIR.trim()) {
    return path.resolve(process.env.ED_JOURNAL_DIR.trim());
  }
  const home = process.env.USERPROFILE || os.homedir();
  return path.join(home, DEFAULT_JOURNAL_SUBPATH);
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
export function journalDirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List Journal.*.log files in the directory, sorted oldest→newest by mtime.
 * Returns [] if the directory doesn't exist or has no journals.
 *
 * @param {string} dir
 * @returns {{name: string, fullPath: string, mtimeMs: number, size: number}[]}
 */
export function listJournalFiles(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!/^Journal\..+\.log$/i.test(e.name)) continue;
      const fullPath = path.join(dir, e.name);
      try {
        const st = fs.statSync(fullPath);
        out.push({ name: e.name, fullPath, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* skip */ }
    }
    out.sort((a, b) => a.mtimeMs - b.mtimeMs);
    return out;
  } catch {
    return [];
  }
}

/**
 * Get the newest Journal.*.log file, or null if none.
 *
 * @param {string} dir
 */
export function getLatestJournalFile(dir) {
  const files = listJournalFiles(dir);
  return files.length > 0 ? files[files.length - 1] : null;
}
