/**
 * Journal "fun facts" for the carrier-dock overlay.
 *
 * Pulls from the persisted Statistics snapshot (state.journalStats) plus
 * already-persisted colony data (sessions / projects). Picking uses a
 * shuffle-bag: every available fact is shown exactly once, in random order,
 * before any repeats — so docking the carrier repeatedly during a haul keeps
 * surfacing fresh lines instead of cycling the same few.
 */

const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
const fmtT = (n) => `${fmtN(Math.round(n || 0))} t`;
function fmtCr(n) {
  n = Number(n || 0);
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} trillion CR`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B CR`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M CR`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K CR`;
  return `${fmtN(n)} CR`;
}
function fmtPop(n) {
  n = Number(n || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B residents`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M residents`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K residents`;
  return `${fmtN(n)} residents`;
}

/**
 * Build the full candidate fact pool from current state. Each fact has a stable
 * `key` (used by the shuffle-bag so number changes don't reset the cycle) and
 * the rendered `text`. Every entry guards on its source data, so absent stats
 * simply don't appear.
 * @returns {{key:string, text:string}[]}
 */
export function buildJournalFacts(state) {
  const facts = [];
  const push = (key, text) => { if (text) facts.push({ key, text }); };
  const stats = (state && state.journalStats && state.journalStats.statistics) || null;
  const g = (group) => (stats && stats[group]) || {};

  // ===== Hauling / colonisation (from persisted sessions + projects) =====
  const sessions = (state && state.sessions) || [];
  const projects = (state && state.projects) || [];
  const nameById = {};
  for (const p of projects) for (const c of (p.commodities || [])) if (c && c.commodityId && c.name) nameById[c.commodityId] = c.name;

  let deliveredT = 0, biggest = 0, sessCount = 0;
  const haulByCommodity = {};
  for (const s of sessions) {
    if (!s || !s.endSnapshot) continue;
    const start = s.startSnapshot || {};
    let t = 0;
    for (const id of Object.keys(s.endSnapshot)) {
      const delta = (s.endSnapshot[id] || 0) - (start[id] || 0);
      if (delta > 0) { t += delta; haulByCommodity[id] = (haulByCommodity[id] || 0) + delta; }
    }
    if (t > 0) { deliveredT += t; sessCount++; if (t > biggest) biggest = t; }
  }
  if (deliveredT > 0) push('delivered', `\u{1F4E6} ${fmtT(deliveredT)} delivered to your colonies over ${fmtN(sessCount)} hauling sessions`);
  if (biggest > 0) push('bestSession', `\u{1F4AA} Best hauling session: ${fmtT(biggest)} delivered`);
  if (sessCount > 0 && deliveredT > 0) push('avgSession', `\u{1F4CA} ~${fmtT(Math.round(deliveredT / sessCount))} per hauling session on average`);
  let topCom = null, topComT = 0;
  for (const id of Object.keys(haulByCommodity)) if (haulByCommodity[id] > topComT) { topComT = haulByCommodity[id]; topCom = id; }
  if (topCom) push('mostHauled', `\u{1F69B} Most-hauled to colonies: ${nameById[topCom] || topCom} (${fmtT(topComT)})`);

  const completed = projects.filter((p) => p && p.status === 'completed');
  const inProgress = projects.filter((p) => p && p.status === 'active').length;
  if (completed.length > 0) push('builds', `\u{1F3D7}️ ${fmtN(completed.length)} construction projects completed${inProgress ? ` (${fmtN(inProgress)} in progress)` : ''}`);
  const bySys = {};
  for (const p of completed) { if (p.systemName) bySys[p.systemName] = (bySys[p.systemName] || 0) + 1; }
  let topSys = null, topSysN = 0;
  for (const sys of Object.keys(bySys)) if (bySys[sys] > topSysN) { topSysN = bySys[sys]; topSys = sys; }
  if (topSys && topSysN >= 2) push('biggestColony', `\u{1F3D9}️ Your biggest colony: ${topSys} (${fmtN(topSysN)} builds)`);

  // ===== Trade / carrier / mining (Statistics) =====
  const trade = g('Trading'), fc = g('FLEETCARRIER'), mine = g('Mining');
  if (trade.Resources_Traded) push('traded', `\u{1FA99} ${fmtT(trade.Resources_Traded)} traded across ${fmtN(trade.Markets_Traded_With || 0)} markets`);
  if (trade.Market_Profits) push('marketProfit', `\u{1F4B9} ${fmtCr(trade.Market_Profits)} in lifetime trade profit`);
  if (trade.Highest_Single_Transaction) push('bestTrade', `\u{1F911} Biggest single trade: ${fmtCr(trade.Highest_Single_Transaction)}`);
  if (fc.FLEETCARRIER_EXPORT_TOTAL) push('fcExports', `\u{1F6A2} Your carrier has moved ${fmtT(fc.FLEETCARRIER_EXPORT_TOTAL)} of exports`);
  if (fc.FLEETCARRIER_TRADEPROFIT_TOTAL) push('fcTradeProfit', `\u{1F4B5} Carrier trade profit: ${fmtCr(fc.FLEETCARRIER_TRADEPROFIT_TOTAL)}`);
  if (fc.FLEETCARRIER_TOTAL_JUMPS) push('fcJumps', `\u{1F6F0}️ Carrier jumps: ${fmtN(fc.FLEETCARRIER_TOTAL_JUMPS)} · ${fmtN(Math.round(fc.FLEETCARRIER_DISTANCE_TRAVELLED || 0))} ly`);
  if (mine.Mining_Profits) push('miningProfit', `\u{1F48E} ${fmtCr(mine.Mining_Profits)} earned mining`);
  if (mine.Quantity_Mined) push('mined', `⛏ ${fmtT(mine.Quantity_Mined)} of ore mined`);

  // ===== Exploration / exobiology =====
  const e = g('Exploration'), exo = g('Exobiology');
  if (e.Total_Hyperspace_Jumps) push('jumps', `\u{1F6F8} ${fmtN(e.Total_Hyperspace_Jumps)} jumps · ${fmtN(Math.round(e.Total_Hyperspace_Distance || 0))} ly flown`);
  if (e.Planets_Scanned_To_Level_3) push('mapped', `\u{1F52D} ${fmtN(e.Planets_Scanned_To_Level_3)} bodies mapped · ${fmtN(e.Systems_Visited || 0)} systems visited`);
  if (e.First_Footfalls) push('footfalls', `\u{1F463} First footfall on ${fmtN(e.First_Footfalls)} worlds`);
  if (e.Planet_Footfalls) push('planetFootfalls', `\u{1F97E} ${fmtN(e.Planet_Footfalls)} planet landings logged`);
  if (e.Exploration_Profits) push('exploProfit', `\u{1F5FA}️ ${fmtCr(e.Exploration_Profits)} from exploration data`);
  if (e.Greatest_Distance_From_Start) push('farthest', `\u{1F30C} Farthest from start: ${fmtN(Math.round(e.Greatest_Distance_From_Start))} ly`);
  if (e.Efficient_Scans) push('efficientScans', `\u{1F3AF} ${fmtN(e.Efficient_Scans)} efficient surface scans`);
  if (e.Settlements_Visited) push('settlements', `\u{1F3D8}️ ${fmtN(e.Settlements_Visited)} settlements visited`);
  if (e.Time_Played) push('timePlayed', `⏱️ ${fmtN(Math.round(e.Time_Played / 86400))} days logged in the black`);
  if (exo.Organic_Species_Encountered) push('exobio', `\u{1F9EC} ${fmtN(exo.Organic_Species_Encountered)} organic species sampled`);
  if (exo.Organic_Data_Profits) push('exobioProfit', `\u{1F331} ${fmtCr(exo.Organic_Data_Profits)} from exobiology`);
  if (exo.Organic_Variant_Encountered) push('variants', `\u{1F33F} ${fmtN(exo.Organic_Variant_Encountered)} organic variants logged`);

  // ===== Wealth / fleet / combat / misc =====
  const bank = g('Bank_Account'), combat = g('Combat'), crime = g('Crime'), smug = g('Smuggling'), pax = g('Passengers'), mat = g('Material_Trader_Stats');
  if (bank.Current_Wealth) push('wealth', `\u{1F4B0} Net worth: ${fmtCr(bank.Current_Wealth)}`);
  if (bank.Owned_Ship_Count) push('ships', `\u{1F680} ${fmtN(bank.Owned_Ship_Count)} ships in your fleet`);
  if (combat.Bounties_Claimed) push('bounties', `\u{1F694} ${fmtN(combat.Bounties_Claimed)} bounties claimed`);
  if (combat.Bounty_Hunting_Profit) push('bountyProfit', `\u{1F480} ${fmtCr(combat.Bounty_Hunting_Profit)} in bounty rewards`);
  if (combat.Assassinations) push('assassinations', `\u{1F5E1}️ ${fmtN(combat.Assassinations)} assassination contracts`);
  if (mat.Materials_Traded) push('materials', `\u{1F9F0} ${fmtN(mat.Materials_Traded)} materials traded`);
  if (pax.Passengers_Missions_Delivered) push('passengers', `\u{1F465} ${fmtN(pax.Passengers_Missions_Delivered)} passengers ferried`);
  if (smug.Black_Markets_Traded_With) push('blackMarkets', `\u{1F3F4} ${fmtN(smug.Black_Markets_Traded_With)} black markets dealt with`);
  if (crime.Total_Murders) push('murders', `\u{1F608} ${fmtN(crime.Total_Murders)} murders on the record — best not to ask`);

  // ===== Squadron (from the Statistics event's Squadron group) =====
  const sq = g('Squadron');
  if (sq.Squadron_Leaderboard_colonisation_contribution_highestcontribution)
    push('squadColony', `\u{1F3D7}️ Top squadron colonisation contribution: ${fmtN(sq.Squadron_Leaderboard_colonisation_contribution_highestcontribution)}`);
  if (sq.Squadron_Bank_Credits_Deposited)
    push('squadBank', `\u{1F3E6} ${fmtCr(sq.Squadron_Bank_Credits_Deposited)} deposited to your squadron bank`);
  if (sq.Squadron_Bank_Commodities_Deposited_Num)
    push('squadCommod', `\u{1F4E6} ${fmtN(sq.Squadron_Bank_Commodities_Deposited_Num)} commodities donated to your squadron`);
  if (sq.Squadron_Bank_Ships_Deposited_Num)
    push('squadShips', `\u{1F6A2} ${fmtN(sq.Squadron_Bank_Ships_Deposited_Num)} ships donated to your squadron`);

  // Squadron name + ship usage (from the Sync-All journal scan, persisted as journalScan)
  const scan = (state && state.journalScan) || null;
  if (scan && scan.squadron && scan.squadron.name) push('squadName', `\u{1F3F4} Flying with ${scan.squadron.name}`);
  if (scan && scan.shipUsage && scan.shipUsage.top) {
    const tp = scan.shipUsage.top;
    push('workhorse', `\u{1F680} Your workhorse: ${tp.friendly || tp.type} (${fmtN(tp.hours)}h across ${fmtN(tp.sessions)} sessions)`);
  }

  // ===== Domain superlatives (your colonisation empire) =====
  const scout = (state && state.scoutedSystems) || {};
  const known = (state && state.knownSystems) || {};
  const popOv = (state && state.populationOverrides) || {};
  const manual = (state && state.manualColonizedSystems) || [];
  const domainNames = [...new Set([...projects.map((p) => p.systemName), ...manual].filter(Boolean))];
  const nameToId = {};
  for (const k of Object.keys(scout)) if (scout[k] && scout[k].name) nameToId[scout[k].name.toLowerCase()] = k;
  for (const p of projects) if (p.systemName && p.systemAddress) nameToId[p.systemName.toLowerCase()] = String(p.systemAddress);

  // Most populated colony
  let popName = null, popVal = 0;
  for (const name of domainNames) {
    const k = name.toLowerCase();
    let pop = (popOv[k] && typeof popOv[k].population === 'number') ? popOv[k].population : null;
    if (pop == null && known[k] && typeof known[k].population === 'number') pop = known[k].population;
    if (pop && pop > popVal) { popVal = pop; popName = name; }
  }
  if (popName) push('mostPopulated', `\u{1F3D9}️ Most populated colony: ${popName} (${fmtPop(popVal)})`);

  // Total cargo ordered across every build
  let ordered = 0;
  for (const p of projects) for (const c of (p.commodities || [])) ordered += c.requiredQuantity || 0;
  if (ordered > 0) push('ordered', `\u{1F4D0} ${fmtT(ordered)} of cargo ordered across all your builds`);

  // Empire span + body extremes (from cached bodies)
  const coordOf = (name) => { const id = nameToId[name.toLowerCase()]; if (id && scout[id] && scout[id].coordinates) return scout[id].coordinates; const e = known[name.toLowerCase()]; return (e && e.coordinates) || null; };
  const pts = domainNames.map(coordOf).filter(Boolean);
  let span = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j];
    const dd = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
    if (dd > span) span = dd;
  }
  if (span > 1) push('empireSpan', `\u{1F4CF} Your colonies span ${fmtN(Math.round(span))} ly end to end`);

  let hot = null, cold = null, farBody = 0, planetCount = 0, icyCount = 0;
  const ICY = /icy|rocky ice/i;
  for (const name of domainNames) {
    const id = nameToId[name.toLowerCase()];
    const bodies = id && scout[id] && scout[id].cachedBodies ? scout[id].cachedBodies : [];
    for (const b of bodies) {
      if (b.type !== 'Planet') continue;
      planetCount++;
      if (ICY.test(b.subType || '')) icyCount++;
      if (typeof b.surfaceTemperature === 'number') {
        if (hot == null || b.surfaceTemperature > hot) hot = b.surfaceTemperature;
        if (cold == null || b.surfaceTemperature < cold) cold = b.surfaceTemperature;
      }
      if (typeof b.distanceToArrival === 'number' && b.distanceToArrival > farBody) farBody = b.distanceToArrival;
    }
  }
  if (hot != null && cold != null && hot > cold) push('tempRange', `\u{1F321}️ Your colonised worlds run ${fmtN(Math.round(cold))} K to ${fmtN(Math.round(hot))} K`);
  if (farBody > 1000) push('farBody', `\u{1F30C} Your most remote colony body sits ${fmtN(Math.round(farBody))} Ls from its star`);
  if (planetCount > 0 && icyCount > 0) push('iceBalls', `\u{1F9CA} ${Math.round((icyCount / planetCount) * 100)}% of your colonised planets are ice balls`);

  return facts;
}

// Shuffle-bag state (module-level; the server process is long-running). `bag`
// holds the fact KEYS still to be dealt this cycle. Keys (not text) so updating
// numbers between picks doesn't disturb the rotation.
let bag = [];
let lastKey = null;

/**
 * Pick the next fact, dealing each available fact once before any repeats.
 * @returns {string|null}
 */
export function pickJournalFact(state) {
  const facts = buildJournalFacts(state);
  if (facts.length === 0) return null;
  const byKey = new Map(facts.map((f) => [f.key, f.text]));

  // Drop dealt-but-now-gone keys; refill + shuffle when the bag empties.
  bag = bag.filter((k) => byKey.has(k));
  if (bag.length === 0) {
    bag = facts.map((f) => f.key);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    // Don't let a fresh cycle open with the same fact we just showed.
    if (bag.length > 1 && bag[bag.length - 1] === lastKey) {
      const tmp = bag[bag.length - 1]; bag[bag.length - 1] = bag[0]; bag[0] = tmp;
    }
  }
  const key = bag.pop();
  lastKey = key;
  return byKey.get(key);
}
