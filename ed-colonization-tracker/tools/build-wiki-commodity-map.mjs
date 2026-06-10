#!/usr/bin/env node
/**
 * Build a typed commodity supply/demand map from the Elite Dangerous Fandom wiki.
 *
 * Sources:
 *   - https://elite-dangerous.fandom.com/wiki/Commodities  (category list)
 *   - https://elite-dangerous.fandom.com/wiki/Commodities/Supply_and_Demand  (S/D matrix)
 *
 * Output:
 *   src/data/wikiCommoditySupplyDemand.ts
 *
 * Also reconciles wiki names against src/data/commodities.ts and writes a log of
 * unmatched entries (both directions) to stderr — same pattern that surfaced the
 * agri-medicines / agriculturalmedicines mismatch.
 *
 * Usage:
 *   node tools/build-wiki-commodity-map.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTFILE = path.join(ROOT, 'src', 'data', 'wikiCommoditySupplyDemand.ts');
const COMMODITIES_TS = path.join(ROOT, 'src', 'data', 'commodities.ts');

const UA = 'Mozilla/5.0 (ed-colonization-tracker; commodity-map-builder)';

// Column order in the Supply & Demand table — must match the wiki page exactly.
// EX RE AG IN HT TF TO ML SE
const ECONOMY_COLUMNS = [
  'Extraction',
  'Refinery',
  'Agriculture',
  'Industrial',
  'HighTech',
  'Terraforming',
  'Tourism',
  'Military',
  'Service',
];

function fetchWikitext(pageName) {
  const url = `https://elite-dangerous.fandom.com/api.php?action=parse&page=${encodeURIComponent(pageName)}&format=json&prop=wikitext`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${pageName}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(body);
          const text = json?.parse?.wikitext?.['*'];
          if (!text) reject(new Error(`No wikitext for ${pageName}`));
          else resolve(text);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// --- Parse Commodities category list -----------------------------------------
//
// Wikitext format:
//   ===Chemicals===
//   ;[[Agronomic Treatment]]
//   ;[[Explosives]]
//   ...
//
// Returns { categories: [{ name, description, commodities: [name, ...] }, ...] }

function parseCommoditiesList(wikitext) {
  // Cut to the "Commodities by type" section
  const start = wikitext.indexOf('==Commodities by type==');
  if (start < 0) throw new Error('Could not find "Commodities by type" section');
  // End of section: next level-2 header (exactly `==Foo==`, not `===Foo===`).
  // Match a newline followed by `==` followed by a non-`=` character.
  const tail = wikitext.slice(start + 25);
  const endMatch = tail.match(/\n==[^=]/);
  const section = endMatch ? wikitext.slice(start, start + 25 + endMatch.index) : wikitext.slice(start);

  const categories = [];
  let current = null;

  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    const catMatch = line.match(/^===([^=]+)===$/);
    if (catMatch) {
      if (current) categories.push(current);
      current = { name: catMatch[1].trim(), description: '', commodities: [] };
      continue;
    }
    if (!current) continue;
    // Wikitext "definition list" item: `;[[Name]]` or `; [[Name|Display]]`
    const itemMatch = line.match(/^;\s*\[\[([^\]]+)\]\]/);
    if (itemMatch) {
      const raw = itemMatch[1];
      // [[Onionhead|Onionhead Gamma Strain]] → "Onionhead Gamma Strain"
      const name = raw.includes('|') ? raw.split('|')[1].trim() : raw.trim();
      current.commodities.push(name);
      continue;
    }
    // Plain prose lines become the description (first one only)
    if (line && !line.startsWith(';') && !line.startsWith('=') && !current.description) {
      current.description = line;
    }
  }
  if (current) categories.push(current);
  return categories;
}

// --- Parse Supply & Demand table ---------------------------------------------
//
// Each row looks like:
//   |-
//   ! [[Commodity Name]]
//   | Category
//   | <span style="color:#FFCC00">S</span>          ← EX column
//   | <span style="color:#6699FF">D</span>          ← RE column
//   |                                                ← AG column (empty)
//   ...
//
// Cells: S = supply (produced), D = demand (consumed), empty = no role.
// Returns Map<commodityName, { category, suppliedBy: string[], demandedBy: string[] }>

function parseSupplyDemand(wikitext) {
  // Locate the main table (after "{| class=\"wikitable sortable")
  const tableStart = wikitext.indexOf('{| class="wikitable sortable');
  if (tableStart < 0) throw new Error('Could not find main S/D table');
  // Table ends at the first stand-alone "|}" after that
  const afterStart = wikitext.slice(tableStart);
  const tableEndRel = afterStart.indexOf('\n|}');
  const table = tableEndRel > 0 ? afterStart.slice(0, tableEndRel) : afterStart;

  // Split into rows on "|-" markers (each row starts after one)
  const rowChunks = table.split(/\n\|-\s*\n/);
  // First chunk is the header — skip
  const rows = rowChunks.slice(1);

  const out = new Map();

  for (const chunk of rows) {
    // Lines: first is "! [[Name]]", then up to 10 "| cell" lines (category + 9 economies)
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const headerLine = lines.find((l) => l.startsWith('!'));
    if (!headerLine) continue;
    const nameMatch = headerLine.match(/!\s*\[\[([^\]]+)\]\]/);
    if (!nameMatch) continue;
    const raw = nameMatch[1];
    const name = raw.includes('|') ? raw.split('|')[1].trim() : raw.trim();

    // Cells in order: category, EX, RE, AG, IN, HT, TF, TO, ML, SE
    const cellLines = [];
    for (const l of lines) {
      if (l.startsWith('!')) continue;
      if (!l.startsWith('|')) continue;
      cellLines.push(l);
    }
    if (cellLines.length < 1) continue;
    const category = cellLines[0].replace(/^\|\s*/, '').trim();

    const suppliedBy = [];
    const demandedBy = [];
    for (let i = 0; i < ECONOMY_COLUMNS.length; i++) {
      const cell = cellLines[1 + i] || '';
      // Look at the cell body (everything after the leading "|")
      const body = cell.replace(/^\|\s*/, '');
      // Detect S or D — wiki uses <span style="color:#FFCC00">S</span> for supply
      // and <span style="color:#6699FF">D</span> for demand. Sometimes plain "S"/"D".
      const stripped = body.replace(/<[^>]+>/g, '').trim();
      if (stripped === 'S') suppliedBy.push(ECONOMY_COLUMNS[i]);
      else if (stripped === 'D') demandedBy.push(ECONOMY_COLUMNS[i]);
      // Empty = no role; nothing to do
    }

    if (!out.has(name)) {
      out.set(name, { category, suppliedBy, demandedBy });
    }
  }

  return out;
}

// --- Reconciliation -----------------------------------------------------------

function loadLocalCommodities() {
  const text = fs.readFileSync(COMMODITIES_TS, 'utf8');
  const map = new Map(); // displayName -> { id, journalName }
  // Match { id: "foo", journalName: "$bar;", name: "Display Name", ... }
  const rx = /id:\s*"([^"]+)",\s*journalName:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    map.set(m[3], { id: m[1], journalName: m[2] });
  }
  return map;
}

function normalizeName(s) {
  // Collapse whitespace, lowercase, strip non-alphanumerics — for fuzzy match
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// --- Output -----------------------------------------------------------------

function emitTs(supplyDemandMap, categoriesList) {
  const lines = [];
  lines.push('/**');
  lines.push(' * AUTO-GENERATED by tools/build-wiki-commodity-map.mjs — do not edit by hand.');
  lines.push(' *');
  lines.push(' * Source: Elite Dangerous Fandom wiki — Commodities & Commodities/Supply_and_Demand.');
  lines.push(' *');
  lines.push(' * Each entry maps a commodity display name (wiki canonical) to:');
  lines.push(' *   - category: the wiki category heading (Foods, Machinery, etc.)');
  lines.push(' *   - suppliedBy: economies whose stations PRODUCE this commodity (S marks)');
  lines.push(' *   - demandedBy: economies whose stations CONSUME this commodity (D marks)');
  lines.push(' *');
  lines.push(` * Generated: ${new Date().toISOString()}`);
  lines.push(' */');
  lines.push('');
  lines.push("export type WikiEconomy =");
  lines.push("  | 'Extraction'");
  lines.push("  | 'Refinery'");
  lines.push("  | 'Agriculture'");
  lines.push("  | 'Industrial'");
  lines.push("  | 'HighTech'");
  lines.push("  | 'Terraforming'");
  lines.push("  | 'Tourism'");
  lines.push("  | 'Military'");
  lines.push("  | 'Service';");
  lines.push('');
  lines.push('export interface WikiCommodityEntry {');
  lines.push('  category: string;');
  lines.push('  suppliedBy: WikiEconomy[];');
  lines.push('  demandedBy: WikiEconomy[];');
  lines.push('}');
  lines.push('');
  lines.push('export const WIKI_COMMODITIES: Record<string, WikiCommodityEntry> = {');

  // Sort by category, then by name within
  const entries = [...supplyDemandMap.entries()].sort((a, b) => {
    if (a[1].category !== b[1].category) return a[1].category.localeCompare(b[1].category);
    return a[0].localeCompare(b[0]);
  });

  let lastCategory = '';
  for (const [name, entry] of entries) {
    if (entry.category !== lastCategory) {
      lines.push('');
      lines.push(`  // === ${entry.category} ===`);
      lastCategory = entry.category;
    }
    const supplied = entry.suppliedBy.map((e) => `'${e}'`).join(', ');
    const demanded = entry.demandedBy.map((e) => `'${e}'`).join(', ');
    const safeName = name.replace(/'/g, "\\'");
    lines.push(`  '${safeName}': { category: '${entry.category}', suppliedBy: [${supplied}], demandedBy: [${demanded}] },`);
  }
  lines.push('};');
  lines.push('');

  // Also emit category list (for grouping the dropdown UI)
  lines.push('export const WIKI_CATEGORIES: { name: string; description: string }[] = [');
  for (const cat of categoriesList) {
    const desc = cat.description.replace(/'/g, "\\'").replace(/\n/g, ' ');
    lines.push(`  { name: '${cat.name.replace(/'/g, "\\'")}', description: '${desc}' },`);
  }
  lines.push('];');
  lines.push('');

  return lines.join('\n');
}

// --- Main --------------------------------------------------------------------

async function main() {
  process.stderr.write('Fetching wiki: Commodities ...\n');
  const commoditiesWt = await fetchWikitext('Commodities');
  process.stderr.write('Fetching wiki: Commodities/Supply_and_Demand ...\n');
  const sdWt = await fetchWikitext('Commodities/Supply_and_Demand');

  const categories = parseCommoditiesList(commoditiesWt);
  const sdMap = parseSupplyDemand(sdWt);

  process.stderr.write(`Parsed ${categories.length} categories, ${sdMap.size} S/D table rows\n`);

  // Reconcile
  const local = loadLocalCommodities();
  process.stderr.write(`Local commodities.ts has ${local.size} entries\n`);

  const wikiAllNames = new Set();
  for (const cat of categories) for (const n of cat.commodities) wikiAllNames.add(n);
  for (const n of sdMap.keys()) wikiAllNames.add(n);

  const wikiNormalized = new Map();
  for (const n of wikiAllNames) wikiNormalized.set(normalizeName(n), n);

  const localNormalized = new Map();
  for (const [name] of local) localNormalized.set(normalizeName(name), name);

  const localOnly = [];
  for (const [, localName] of localNormalized) {
    if (!wikiNormalized.has(normalizeName(localName))) {
      localOnly.push(localName);
    }
  }
  process.stderr.write(`\nLocal commodities NOT found in wiki (${localOnly.length}):\n`);
  for (const n of localOnly) process.stderr.write(`  - ${n}\n`);

  // Don't bother dumping wiki-only — too many (illegal salvage, etc.).
  // Only flag the ones likely to be construction-relevant: anything in
  // Machinery, Industrial Materials, Metals, Technology, Chemicals, Medicines.
  const constructionCats = new Set([
    'Chemicals', 'Industrial Materials', 'Machinery', 'Medicines',
    'Metals', 'Minerals', 'Technology',
  ]);
  const wikiConstruction = [];
  for (const [name, entry] of sdMap) {
    if (!constructionCats.has(entry.category)) continue;
    if (!localNormalized.has(normalizeName(name))) wikiConstruction.push({ name, category: entry.category });
  }
  process.stderr.write(`\nConstruction-relevant wiki commodities NOT in local commodities.ts (${wikiConstruction.length}):\n`);
  for (const { name, category } of wikiConstruction) process.stderr.write(`  - ${name} [${category}]\n`);

  // Write output
  const ts = emitTs(sdMap, categories);
  fs.writeFileSync(OUTFILE, ts, 'utf8');
  process.stderr.write(`\nWrote ${OUTFILE} (${ts.length} bytes)\n`);
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
