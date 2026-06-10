#!/usr/bin/env node
/**
 * Merge multiple region JSONL files into one master, deduplicated by id64.
 *
 * Grows a custom "area of operations" colonization-search dataset: each new
 * bubble extracted from the galaxy dump (tools/spansh-index.mjs build) gets
 * folded in here, with overlapping systems collapsed to a single copy.
 *
 * The first file contributes all its systems; later files contribute only
 * systems whose id64 hasn't already been seen. Inputs are never modified.
 *
 * Usage:
 *   node tools/merge-regions.mjs --output E:/Spansh/region-ao-master.jsonl \
 *       E:/Spansh/region-col173-axj-d9-52-700.jsonl \
 *       E:/Spansh/region-praea-euq-at-u-d2-47-500.jsonl
 *
 * To grow it later, just include the existing master as the first input:
 *   node tools/merge-regions.mjs --output master.jsonl master.jsonl new-bubble.jsonl
 */

import fs from 'node:fs';
import { once } from 'node:events';

const args = process.argv.slice(2);
function getArg(name, fb = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fb;
}

const output = getArg('output');
const inputs = args.filter((a) => !a.startsWith('--') && a !== output);

if (!output || inputs.length === 0) {
  console.error('Usage: node tools/merge-regions.mjs --output OUT.jsonl IN1.jsonl [IN2.jsonl ...]');
  process.exit(1);
}
for (const f of inputs) {
  if (!fs.existsSync(f)) { console.error(`input not found: ${f}`); process.exit(1); }
}

const ID_RE = /"id64":(\d+)/;
const seen = new Set();
const out = fs.createWriteStream(output);

let grandRead = 0, grandWritten = 0;

async function processFile(path) {
  let read = 0, added = 0, dup = 0, bad = 0;

  async function handleLine(line) {
    if (!line) return;
    read++;
    const m = ID_RE.exec(line);
    if (!m) { bad++; return; }
    // BigInt (a value), NOT m[1] (a V8 sliced-string that retains its parent
    // chunk and would pin the whole input file in memory).
    const id = BigInt(m[1]);
    if (seen.has(id)) { dup++; return; }
    seen.add(id);
    added++;
    if (!out.write(line + '\n')) await once(out, 'drain');
  }

  // Iterate raw chunks (bounded by the stream highWaterMark) and split lines
  // ourselves. for-await pauses the source while we await drain, so memory
  // stays bounded regardless of file size.
  let tail = '';
  const stream = fs.createReadStream(path, { encoding: 'utf8' });
  for await (const chunk of stream) {
    const text = tail + chunk;
    let start = 0, nl;
    while ((nl = text.indexOf('\n', start)) !== -1) {
      await handleLine(text.slice(start, nl));
      start = nl + 1;
    }
    tail = text.slice(start);
  }
  if (tail) await handleLine(tail);

  console.error(`  ${path}`);
  console.error(`    read ${read.toLocaleString()}, added ${added.toLocaleString()}, duplicate ${dup.toLocaleString()}${bad ? `, no-id64 ${bad}` : ''}`);
  grandRead += read; grandWritten += added;
}

(async () => {
  console.error(`Merging ${inputs.length} file(s) -> ${output}`);
  for (const f of inputs) await processFile(f);
  await new Promise((res) => out.end(res));
  const size = fs.statSync(output).size;
  console.error(`DONE.`);
  console.error(`  total read:    ${grandRead.toLocaleString()}`);
  console.error(`  unique written:${grandWritten.toLocaleString()}`);
  console.error(`  duplicates:    ${(grandRead - grandWritten).toLocaleString()}`);
  console.error(`  output:        ${output} (${(size / 1024 / 1024).toFixed(1)} MB)`);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
