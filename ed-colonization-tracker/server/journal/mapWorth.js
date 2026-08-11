/**
 * Is a scanned body worth DSS probes for CREDITS? Pure classifier over a raw
 * journal Scan event — shared by the overlay callout and the exploration
 * checklist. Reports qualities, never invented credit figures.
 */
/*
 * Tiers: 3 = ELW/water/ammonia (always pops). 2 = anything else with a terraform
 * state. Everything else: null. See CHANGELOG 1.35.0.
 *
 * (Original doc: Is this body worth spending probes on, for CREDITS (not colony value)?
 *
 * Tier 3 — Earth-like / water / ammonia worlds: rare and worth 3-4x an ordinary
 * body, so they always pop.
 * Tier 2 — anything else with a terraform state: mostly terraformable HMC. The
 * single biggest multiplier on an otherwise plain rock, but common enough that it
 * gets a quieter, shorter-lived callout so a 30-body system isn't a wall of text.
 *
 * Deliberately reports QUALITIES, never a credit figure: the real payout is
 * mass-dependent (roughly k + mass*k/66.25 with a per-class k) and the per-class
 * constants aren't verified here, so any number would be invented. See CHANGELOG 1.35.0.
 */
export function mapWorth(ev) {
  if (!ev || ev.StarType) return null;            // stars aren't mappable
  const cls = String(ev.PlanetClass || '');
  if (!cls) return null;
  const terraform = ev.TerraformState && !/^(none)?$/i.test(String(ev.TerraformState).trim());
  const reasons = [];
  let tier = 0;

  if (/earthlike|earth-like/i.test(cls)) { tier = 3; reasons.push('Earth-like world'); }
  else if (/water world/i.test(cls)) { tier = 3; reasons.push('Water world'); }
  else if (/ammonia world/i.test(cls)) { tier = 3; reasons.push('Ammonia world'); }
  else if (terraform) { tier = 2; reasons.push(cls); }

  if (!tier) return null;
  if (terraform && tier === 3) reasons.push('terraformable');
  if (ev.WasDiscovered === false) reasons.push('first discovery');
  // Already mapped kills the first-mapper bonus — say so rather than hide it.
  if (ev.WasMapped === true) reasons.push('already mapped');

  return { tier, stars: tier === 3 ? '★★★' : '★★', reasons };
}
