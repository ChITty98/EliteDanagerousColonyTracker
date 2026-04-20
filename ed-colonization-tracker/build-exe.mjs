#!/usr/bin/env node
/**
 * Build script: bundles server.mjs + dist/ into a single server-bundled.cjs
 * via esbuild, then wraps that as a SEA .exe (and emits a .bat fallback).
 *
 * Why esbuild: the previous approach line-array-mirrored server.mjs into a
 * string template. Every server change had to be hand-copied. That's
 * unsustainable as the server grows (journal reader port adds thousands of
 * lines). esbuild follows require/import graph automatically so adding new
 * modules under `server/journal/*.js` just works.
 *
 * Usage:  node build-exe.mjs
 * Output: ed-colony-tracker.bat + server-bundled.cjs (always)
 *         ed-colony-tracker.exe (if SEA succeeds)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const ENTRY = path.join(__dirname, 'server.mjs');
const OUT_CJS = path.join(__dirname, 'server-bundled.cjs');

// Auto-incrementing build number from timestamp (MMDD.HHmm)
const now = new Date();
const BUILD_ID = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '.' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
const VERSION = `v1.2.0-b${BUILD_ID}`;

// Step 1: Build the Vite project
console.log('Building Vite project...');
execSync('npx vite build', { cwd: __dirname, stdio: 'inherit' });

// Step 2: Read all dist files into a base64 map to embed in the bundle
console.log('Embedding dist/ files...');
function readDirRecursive(dir, base) {
  base = base || '';
  const entries = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = base ? base + '/' + entry.name : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(entries, readDirRecursive(fullPath, relPath));
    } else {
      entries['/' + relPath] = fs.readFileSync(fullPath).toString('base64');
    }
  }
  return entries;
}

const files = readDirRecursive(DIST);
console.log('  Embedded ' + Object.keys(files).length + ' files');

// Step 3: esbuild bundle server.mjs → server-bundled.cjs
// The dist file map and app version are injected as globalThis properties
// via esbuild's `define`. server.mjs reads them with a fallback so dev
// (node server.mjs) still works against disk + hardcoded version.
console.log('Bundling server with esbuild...');
await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: OUT_CJS,
  logLevel: 'info',
  // Node builtins don't need to be bundled
  external: [],
  // Inject build-time values as globalThis properties. esbuild replaces
  // `globalThis.__DIST_FILES__` / `globalThis.__APP_VERSION__` references
  // with these literals at bundle time.
  define: {
    'globalThis.__DIST_FILES__': JSON.stringify(files),
    'globalThis.__APP_VERSION__': JSON.stringify(VERSION),
    // Replace `import.meta.url` with a file:// URL pointing at the bundled
    // cjs, so fileURLToPath(import.meta.url) resolves to the bundle's own
    // path. path.dirname of that is the app folder (dev mode) or, in SEA,
    // gets overridden by the IS_SEA branch in server.mjs.
    'import.meta.url': JSON.stringify(
      'file:///' + OUT_CJS.replace(/\\/g, '/'),
    ),
  },
  banner: {
    js: '/* ED Colony Tracker ' + VERSION + ' — bundled via esbuild */',
  },
});

const bundleSize = fs.statSync(OUT_CJS).size;
console.log('  Wrote ' + OUT_CJS + ' (' + (bundleSize / 1024).toFixed(0) + 'KB)');

// Step 4: Create .bat launcher (always works, no dependencies)
const batContent = '@echo off\r\ntitle ED Colony Tracker\r\necho Starting ED Colony Tracker...\r\nnode "%~dp0server-bundled.cjs"\r\npause\r\n';
const batPath = path.join(__dirname, 'ed-colony-tracker.bat');
fs.writeFileSync(batPath, batContent);
console.log('Wrote ' + batPath);

// Step 5: Attempt SEA exe build
console.log('');
console.log('Attempting SEA exe build...');

const SEA_CONFIG = path.join(__dirname, 'sea-config.json');
const SEA_BLOB = path.join(__dirname, 'sea-prep.blob');
const EXE_PATH = path.join(__dirname, 'ed-colony-tracker.exe');

let seaSuccess = false;
try {
  fs.writeFileSync(SEA_CONFIG, JSON.stringify({
    main: OUT_CJS,
    output: SEA_BLOB,
    disableExperimentalSEAWarning: true,
  }));

  execSync('node --experimental-sea-config "' + SEA_CONFIG + '"', {
    cwd: __dirname,
    stdio: 'inherit',
  });

  // Copy node.exe
  fs.copyFileSync(process.execPath, EXE_PATH);

  // Inject blob
  execSync('npx --yes postject "' + EXE_PATH + '" NODE_SEA_BLOB "' + SEA_BLOB + '" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', {
    cwd: __dirname,
    stdio: 'inherit',
  });

  seaSuccess = true;
  console.log('Created ' + EXE_PATH);
} catch (e) {
  console.log('SEA exe build failed (this is OK). Use the .bat launcher instead.');
  console.log('  Error:', e && e.message);
  try { fs.unlinkSync(EXE_PATH); } catch {}
}

// Cleanup
try { fs.unlinkSync(SEA_CONFIG); } catch {}
try { fs.unlinkSync(SEA_BLOB); } catch {}

console.log('');
console.log('Done!');
if (seaSuccess) {
  console.log('  Run ed-colony-tracker.exe to start (standalone, no Node needed)');
} else {
  console.log('  Run ed-colony-tracker.bat to start (requires Node.js installed)');
  console.log('  Or:  node server-bundled.cjs');
}
console.log('');
