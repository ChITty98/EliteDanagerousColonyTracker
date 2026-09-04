// server/ai/copilotTrivia.js
//
// Tycho's trivia game — multiple-choice, hosted by Tycho. Two kinds of question:
//   1. PERSONAL — computed from the commander's OWN data (most-docked station, largest
//      colony, …). Right answer AND distractors are pulled from real data. ANTI-INVENTION:
//      a generator returns null when the data can't truthfully answer it.
//   2. ASTRONOMY — a curated bank of REAL space science (Tycho's teacher domain).
// buildTriviaRound() mixes them into a shuffled round. See [[reference_tars_persona_spec]].

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
function pickN(arr, n) { return shuffle(arr).slice(0, n); }

// correct + distractors → shuffled options + the index of the correct one.
function mc(id, text, correct, distractors, fact) {
  if (correct == null || !Array.isArray(distractors) || distractors.length < 1) return null;
  const uniq = [...new Set(distractors.map(String))].filter((d) => d !== String(correct)).slice(0, 3);
  if (uniq.length < 2) return null; // need at least 3 options total
  const opts = shuffle([String(correct), ...uniq]);
  return { id, text, options: opts, correctIndex: opts.indexOf(String(correct)), fact };
}

// ---- PERSONAL: helpers ----
// Real, named NPC stations only — drop the raw colonisation/panel tokens, rescue ships,
// construction sites, and fleet carriers (callsigns) so trivia options read cleanly.
function isRealStation(s) {
  const n = String(s.stationName || '');
  if (!n || n.startsWith('$')) return false;
  if (/FleetCarrier/i.test(String(s.stationType || ''))) return false;
  if (/Rescue Ship|Colonisation Ship|Construction Site/i.test(n)) return false;
  return true;
}
// Only stations the commander would GENUINELY recognise — the top decile of THEIR OWN docking
// distribution (90th percentile of visit counts, floored at 5), not anywhere they passed a handful
// of times. The median is ~1 dock/station, so a flat "3+" lets in dozens of near-strangers; this
// keeps the real regulars (~the 25-30 most-docked) so a referenced station is one they actually
// know. Falls back to a gentle 3 only when the data is too sparse to take a percentile.
function stationsOf(state) {
  const ks = state && state.knownStations;
  if (!ks || typeof ks !== 'object') return [];
  const all = Object.values(ks).filter((s) => s && s.stationName && isRealStation(s));
  const v = (s) => s.visitCount || s.dockedCount || 0;
  const counts = all.map(v).filter((x) => x > 0).sort((a, b) => a - b);
  const threshold = counts.length < 8 ? 3 : Math.max(5, counts[Math.floor(counts.length * 0.9)]);
  return all.filter((s) => v(s) >= threshold);
}
function popOf(state, systemName) {
  const key = String(systemName || '').toLowerCase();
  const sys = state.knownSystems && state.knownSystems[key];
  if (sys && typeof sys.population === 'number' && sys.population > 0) return sys.population;
  const ov = state.populationOverrides && state.populationOverrides[key];
  if (ov && typeof ov.population === 'number' && ov.population > 0) return ov.population;
  return 0;
}
const visits = (s) => s.visitCount || s.dockedCount || 0;

// ---- PERSONAL generators (each returns a question or null) ----
const GENERATORS = [
  function mostVisited(state) {
    const ss = stationsOf(state).filter((s) => visits(s) > 0);
    if (ss.length < 4) return null;
    const sorted = ss.slice().sort((a, b) => visits(b) - visits(a));
    const top = sorted[0];
    return mc('most-visited', 'Which station have you docked at the most?', top.stationName,
      pickN(sorted.slice(1), 3).map((s) => s.stationName), `${top.stationName} — ${visits(top)} dockings.`);
  },
  function furthest(state) {
    const ss = stationsOf(state).filter((s) => typeof s.distFromStarLS === 'number' && s.distFromStarLS > 0);
    if (ss.length < 4) return null;
    const sorted = ss.slice().sort((a, b) => b.distFromStarLS - a.distFromStarLS);
    const top = sorted[0];
    return mc('furthest', 'Which station you know sits FURTHEST from its star?', top.stationName,
      pickN(sorted.slice(1), 3).map((s) => s.stationName), `${top.stationName} — ${Math.round(top.distFromStarLS).toLocaleString()} Ls out.`);
  },
  function mostPads(state) {
    const ss = stationsOf(state).filter((s) => s.landingPads && typeof s.landingPads.large === 'number' && s.landingPads.large > 0);
    if (ss.length < 4) return null;
    const sorted = ss.slice().sort((a, b) => b.landingPads.large - a.landingPads.large);
    const top = sorted[0];
    return mc('most-pads', 'Which station you know has the most LARGE landing pads?', top.stationName,
      pickN(sorted.slice(1), 3).map((s) => s.stationName), `${top.stationName} — ${top.landingPads.large} large pads.`);
  },
  function oldest(state) {
    const ss = stationsOf(state).filter((s) => s.firstDocked && !Number.isNaN(Date.parse(s.firstDocked)));
    if (ss.length < 4) return null;
    const sorted = ss.slice().sort((a, b) => Date.parse(a.firstDocked) - Date.parse(b.firstDocked));
    const top = sorted[0];
    return mc('oldest', 'Which of these have you been docking at the LONGEST?', top.stationName,
      pickN(sorted.slice(1), 3).map((s) => s.stationName), `${top.stationName} — since ${new Date(top.firstDocked).getFullYear()}.`);
  },
  function richestColony(state) {
    const cols = (Array.isArray(state.manualColonizedSystems) ? state.manualColonizedSystems : [])
      .map((n) => ({ name: n, pop: popOf(state, n) })).filter((c) => c.pop > 0);
    if (cols.length < 4) return null;
    const sorted = cols.slice().sort((a, b) => b.pop - a.pop);
    const top = sorted[0];
    return mc('richest-colony', 'Which of YOUR colonies has the largest population?', top.name,
      pickN(sorted.slice(1), 3).map((c) => c.name), `${top.name} — population ${top.pop.toLocaleString()}.`);
  },
  function busiestSystem(state) {
    const byS = {};
    for (const s of stationsOf(state)) { const k = s.systemName || '?'; byS[k] = (byS[k] || 0) + 1; }
    const arr = Object.entries(byS).map(([name, n]) => ({ name, n })).filter((x) => x.name !== '?');
    if (arr.length < 4) return null;
    const sorted = arr.sort((a, b) => b.n - a.n);
    const top = sorted[0];
    if (top.n < 2) return null;
    return mc('busiest-system', 'In which system do you know the most stations?', top.name,
      pickN(sorted.slice(1), 3).map((x) => x.name), `${top.name} — ${top.n} stations on file.`);
  },
  function colonyCount(state) {
    const n = (Array.isArray(state.manualColonizedSystems) ? state.manualColonizedSystems : []).length;
    if (n < 5) return null;
    return mc('colony-count', 'How many systems have you colonised?', n, [n + 3, Math.max(1, n - 4), n + 8],
      `${n} systems carry your colonies.`);
  },
];

// ---- ASTRONOMY bank (real science) ----
const ASTRO = [
  { id: 'a-dense', text: 'Which is denser — a neutron star or a white dwarf?', correct: 'Neutron star', distractors: ['White dwarf', 'They are equal', 'A red giant'], fact: 'A sugar-cube of neutron-star matter would weigh about a billion tonnes.' },
  { id: 'a-common', text: 'What is the most common type of star in the galaxy?', correct: 'Red dwarf (M-type)', distractors: ['Sun-like (G-type)', 'Blue giant (O-type)', 'White dwarf'], fact: 'Most of the galaxy orbits a small, cool red dwarf.' },
  { id: 'a-long', text: 'Which star burns for the LONGEST?', correct: 'A red dwarf', distractors: ['A blue supergiant', 'A Sun-like star', 'A neutron star'], fact: 'Red dwarfs can burn for trillions of years — longer than the universe is old.' },
  { id: 'a-escape', text: "What cannot escape from beyond a black hole's event horizon?", correct: 'Light', distractors: ['Only matter', 'Only radio', 'Everything but light'], fact: 'Past the event horizon, not even light is fast enough to leave.' },
  { id: 'a-hot', text: 'Which star class is the HOTTEST?', correct: 'O-type', distractors: ['M-type', 'G-type', 'K-type'], fact: 'O-type stars blaze blue-white at tens of thousands of degrees.' },
  { id: 'a-rare', text: 'Which is RAREST to find?', correct: 'An Earth-like world', distractors: ['A High Metal Content world', 'An icy body', 'A rocky body'], fact: 'Earth-likes are vanishingly rare — most landables are High Metal Content.' },
  { id: 'a-oxygen', text: 'A free-oxygen atmosphere usually means…', correct: 'Something is replenishing it', distractors: ['The world is dead', 'It is very cold', 'It is a gas giant'], fact: 'Oxygen is so reactive it scrubs itself out unless something keeps making it.' },
  { id: 'a-spin', text: 'How fast can a neutron star spin?', correct: 'Hundreds of times a second', distractors: ['Once a day', 'Once a year', 'It does not spin'], fact: 'The fastest known pulsars spin over 700 times a second.' },
  { id: 'a-big', text: 'Which is physically LARGEST?', correct: 'A red giant', distractors: ['A white dwarf', 'A neutron star', 'A black hole'], fact: 'A red giant can swell larger than the orbit of Mars.' },
  { id: 'a-light', text: 'The starlight hitting your canopy left that star…', correct: 'Years ago, or longer', distractors: ['An instant ago', 'One second ago', 'It is live'], fact: 'You never see a star as it is now — only as its light left it.' },
];
function astroQuestion(used) {
  const pool = ASTRO.filter((q) => !used.has(q.id));
  if (!pool.length) return null;
  const q = pickN(pool, 1)[0];
  return mc(q.id, q.text, q.correct, q.distractors, q.fact);
}

/** A trivia round of `n` questions — a mix of personal-data + astronomy, no repeats. */
export function buildTriviaRound(state, n = 6) {
  const out = [];
  const used = new Set();
  const personal = GENERATORS.map((g) => { try { return g(state || {}); } catch { return null; } }).filter(Boolean);
  for (const q of shuffle(personal)) { if (out.length >= Math.ceil(n / 2)) break; out.push(q); used.add(q.id); }
  while (out.length < n) { const a = astroQuestion(used); if (!a) break; out.push(a); used.add(a.id); }
  for (const q of personal) { if (out.length >= n) break; if (!used.has(q.id)) { out.push(q); used.add(q.id); } }
  return shuffle(out).slice(0, n);
}
