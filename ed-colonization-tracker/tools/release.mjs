#!/usr/bin/env node
/**
 * Publish a GitHub Release for the current package.json version.
 *
 * Tags the commit, creates the release using this version's CHANGELOG section as
 * the body, and uploads the built exe plus a SHA256SUMS.txt so a download can be
 * verified by hand. (The in-app updater is notice-only — it never installs.)
 *
 * The `gh` CLI isn't required — this talks to the REST API directly.
 *
 * Auth: set GITHUB_TOKEN in the environment, or put the token in a file named
 * `.release-token` next to package.json (gitignored). The token needs "Contents:
 * write" on this repo. The token is never printed or committed.
 *
 * Usage:
 *   node tools/release.mjs            # publish
 *   node tools/release.mjs --dry-run  # show what would happen, touch nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Repo not yet renamed on GitHub; update this when it is (GitHub redirects either way).
const REPO = 'ChITty98/EliteDanagerousColonyTracker';
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const DRY = process.argv.includes('--dry-run');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const EXE = path.join(ROOT, 'ed-colony-architect.exe');

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try { return fs.readFileSync(path.join(ROOT, '.release-token'), 'utf8').trim(); } catch {}
  console.error('No token. Set GITHUB_TOKEN or create .release-token (gitignored) with a');
  console.error('personal access token that has Contents: write on ' + REPO + '.');
  process.exit(1);
}

/** Pull the "## [x.y.z] — date" block for this version out of CHANGELOG.md. */
function changelogSection() {
  const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${VERSION}]`));
  if (start === -1) return `Release ${TAG}`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim() || `Release ${TAG}`;
}

async function gh(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ed-colony-release',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${opts.method || 'GET'} ${url.replace(/\?.*/, '')} → ${res.status} ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const main = async () => {
  if (!fs.existsSync(EXE)) {
    console.error(`Build first — ${EXE} not found. Run: node build-exe.mjs`);
    process.exit(1);
  }
  const exeStat = fs.statSync(EXE);
  const notes = changelogSection();

  // Warn (don't block) if the exe predates the last source change — an easy
  // mistake is publishing yesterday's binary with today's changelog.
  let dirty = '';
  try { dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim(); } catch {}

  console.log(`Release ${TAG}`);
  console.log(`  exe:   ${(exeStat.size / 1048576).toFixed(1)} MB, built ${exeStat.mtime.toISOString()}`);
  console.log(`  notes: ${notes.split('\n')[0].slice(0, 80)}…`);
  if (dirty) console.log(`  NOTE: working tree has uncommitted changes — the tag will point at HEAD.`);

  if (DRY) {
    console.log('\n--dry-run: nothing published.');
    console.log('\n--- release body ---');
    console.log(notes);
    return;
  }

  // Refuse to clobber an existing release for this tag.
  try {
    await gh(`${API}/repos/${REPO}/releases/tags/${TAG}`);
    console.error(`\nRelease ${TAG} already exists. Bump the version in package.json first.`);
    process.exit(1);
  } catch (e) {
    if (!/→ 404/.test(e.message)) throw e;
  }

  const sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  const release = await gh(`${API}/repos/${REPO}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: TAG,
      target_commitish: sha,
      name: TAG,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  });
  console.log(`  created release ${release.id}`);

  // SHA256SUMS.txt — the updater refuses to install on a hash mismatch.
  const sumsPath = path.join(ROOT, 'SHA256SUMS.txt');
  fs.writeFileSync(sumsPath, `${sha256(EXE)}  ed-colony-architect.exe\n`);

  for (const [file, type] of [[EXE, 'application/octet-stream'], [sumsPath, 'text/plain']]) {
    const name = path.basename(file);
    process.stdout.write(`  uploading ${name}…`);
    await gh(`${UPLOADS}/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': type, 'Content-Length': String(fs.statSync(file).size) },
      body: fs.readFileSync(file),
    });
    console.log(' done');
  }
  try { fs.unlinkSync(sumsPath); } catch {}

  console.log(`\nPublished: ${release.html_url}`);
  console.log('Clients will see the update within 6 hours, or immediately via Check now.');
};

main().catch((e) => { console.error('\nRelease failed:', e.message); process.exit(1); });
