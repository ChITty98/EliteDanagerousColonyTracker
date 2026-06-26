/**
 * Production buffs by economy + body/system condition, per Raven Colonial's
 * colonisation economy model (extracted to src/data/ravenBodyBuffs.json — this
 * encodes the same ±0.4 rules so they can be evaluated against a body).
 *
 * Only body-derivable buffs (type, bio/geo signals, volcanism) are computed
 * here; reserve-level buffs apply when a reserveLevel is supplied.
 */
import type { WikiEconomy } from '@/data/wikiCommoditySupplyDemand';

export interface BuffBody {
  subType?: string;
  signals?: { genuses?: unknown[]; signals?: Record<string, number> };
  volcanismType?: string | null;
}

export interface BodyBuff {
  modifier: number;
  reasons: string[];
}

function hasBio(b: BuffBody): boolean {
  const s = b.signals?.signals ?? {};
  for (const k in s) if (/biolog/i.test(k) && s[k] > 0) return true;
  return (b.signals?.genuses?.length ?? 0) > 0;
}
function hasGeo(b: BuffBody): boolean {
  const s = b.signals?.signals ?? {};
  for (const k in s) if (/geolog/i.test(k) && s[k] > 0) return true;
  return false;
}
function hasVolcanism(b: BuffBody): boolean {
  const v = (b.volcanismType ?? '').trim();
  return !!v && !/^no volcanism$/i.test(v);
}
function bodyType(b: BuffBody): 'ELW' | 'WW' | 'AW' | 'ICY' | null {
  const s = (b.subType ?? '').toLowerCase();
  if (s.includes('earth-like') || s.includes('earthlike')) return 'ELW';
  if (s.includes('water world')) return 'WW';
  if (s.includes('ammonia world')) return 'AW';
  if (/icy|rocky ice/.test(s)) return 'ICY';
  return null;
}

const HIGH_RESERVE = ['major', 'pristine'];
const LOW_RESERVE = ['depleted', 'low'];

/** Net production buff for an economy on a body (Raven's ±0.4 conditions). */
export function bodyBuffForEconomy(
  economy: WikiEconomy,
  body: BuffBody,
  opts: { reserveLevel?: string } = {},
): BodyBuff {
  const reasons: string[] = [];
  let modifier = 0;
  const t = bodyType(body);
  const res = (opts.reserveLevel ?? '').toLowerCase();
  const add = (m: number, why: string) => {
    modifier += m;
    reasons.push(`${m > 0 ? '+' : ''}${m.toFixed(1)} ${why}`);
  };

  switch (economy) {
    case 'Agriculture':
      if (t === 'ELW' || t === 'WW') add(0.4, `${t} body`);
      else if (hasBio(body)) add(0.4, 'bio signals');
      if (t === 'ICY') add(-0.4, 'icy body');
      break;
    case 'HighTech':
    case 'Tourism':
      if (t === 'AW' || t === 'ELW' || t === 'WW') add(0.4, `${t} body`);
      if (hasBio(body)) add(0.4, 'bio signals');
      if (hasGeo(body)) add(0.4, 'geo signals');
      break;
    case 'Extraction':
      if (HIGH_RESERVE.includes(res)) add(0.4, `${res} reserves`);
      else if (LOW_RESERVE.includes(res)) add(-0.4, `${res} reserves`);
      if (hasVolcanism(body)) add(0.4, 'volcanism');
      break;
    case 'Refinery':
    case 'Industrial':
      if (HIGH_RESERVE.includes(res)) add(0.4, `${res} reserves`);
      else if (LOW_RESERVE.includes(res)) add(-0.4, `${res} reserves`);
      break;
    default:
      break;
  }
  return { modifier, reasons };
}

/** Best (highest) buff across a set of producing economies for a body. */
export function bestBodyBuff(
  economies: WikiEconomy[],
  body: BuffBody,
  opts?: { reserveLevel?: string },
): BodyBuff {
  let best: BodyBuff | null = null;
  for (const e of economies) {
    const b = bodyBuffForEconomy(e, body, opts);
    if (!best || b.modifier > best.modifier) best = b;
  }
  return best ?? { modifier: 0, reasons: [] };
}
