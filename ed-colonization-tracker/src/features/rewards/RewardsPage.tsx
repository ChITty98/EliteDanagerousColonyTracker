/**
 * Reward info — the three facts a mission board will not tell you.
 *
 *   1. IS IT WORTH MORE?   what it actually sells for, against the credits you give up
 *   2. IS IT UNLOCK RELATED?  an engineer or tech-broker gate, and whether yours is already done
 *   3. IS IT A COLONISATION COMMODITY?  does it appear in build requirements at all
 *
 * Plus, for materials only, the one number that decides those: how full you are, since
 * materials cannot be bought at any price and overflow is simply lost.
 *
 * This page states facts and stops. It does NOT render a verdict — the trade-off between
 * cash, cargo space and a hauling loop is the commander's call and changes by the hour.
 *
 * The trap it exists to close: a board shows three options at "about 50M" where one is real
 * money, one is ~158k of sellable dead content, and one swaps 4.8M of credits for a material.
 * They look identical on the board.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppStore } from '@/store';
import { MATERIALS, findMaterial } from '@/data/engineeringMaterials';
import type { MaterialDefinition } from '@/data/engineeringMaterials';
import { REWARD_INTEL, findRewardIntel } from '@/data/rewardIntel';
import { acquisitionFor } from '@/data/materialSources';
import { findCommodityPrice, COMMODITY_PRICES } from '@/data/commodityPrices';
import type { RewardIntel } from '@/data/rewardIntel';

const cr = (n: number) => Math.round(n).toLocaleString();

/** "Water Purifiers" and the journal's "waterpurifiers" have to meet somewhere. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** One labelled fact. Deliberately plain — the page reports, it does not advise. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 items-baseline">
      <dt className="text-muted-foreground w-52 shrink-0">{label}</dt>
      <dd className="text-foreground flex-1 min-w-[12rem]">{children}</dd>
    </div>
  );
}

export function RewardsPage() {
  const inv = useAppStore((s) => s.materialInventory);
  const engineers = useAppStore((s) => s.engineers);
  const projects = useAppStore((s) => s.projects);

  const [query, setQuery] = useState('');
  const [qty, setQty] = useState<number>(0);

  // Every material AND every commodity, by proper name. Without the commodities here you could
  // type a real reward name and get no suggestion at all, which reads as unsupported even though
  // the lookup underneath would have answered fine.
  const options = useMemo(() => {
    const mats = MATERIALS.map((m) => ({ label: m.displayName, kind: 'material' as const }));
    const coms = COMMODITY_PRICES.map((c) => ({ label: c.name, kind: 'commodity' as const }));
    return [...coms, ...mats].sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [query, options]);

  const mat: MaterialDefinition | undefined = findMaterial(query.trim());
  const intel: RewardIntel | undefined = findRewardIntel(query.trim());

  const held = useMemo(() => {
    if (!mat || !inv) return 0;
    const bucket = (inv as unknown as Record<string, Record<string, number>>)[mat.category] || {};
    return bucket[mat.id] ?? 0;
  }, [mat, inv]);

  // "Is it a colonisation commodity?" is answered from your OWN build history rather than a
  // static list — if it has ever appeared in a build requirement, it is one, and the tonnage
  // says how much it actually matters to you.
  const colonisation = useMemo(() => {
    const key = norm(query.trim());
    if (!key) return null;
    let tons = 0; let builds = 0; let outstanding = 0;
    for (const p of projects || []) {
      for (const c of p.commodities || []) {
        if (norm(c.commodityId || c.name || '') !== key) continue;
        tons += c.requiredQuantity || 0;
        builds += 1;
        if (p.status !== 'completed' && p.status !== 'abandoned') {
          outstanding += Math.max(0, (c.requiredQuantity || 0) - (c.providedQuantity || 0));
        }
      }
    }
    return builds ? { tons, builds, outstanding } : null;
  }, [query, projects]);

  // A handful of materials are unlock-gated too (Sensor Fragments and friends), so the
  // question gets asked of both kinds.
  const matGate = useMemo(
    () => (mat ? REWARD_INTEL.find((r) => norm(r.name) === norm(mat.displayName) && r.gate) : undefined),
    [mat],
  );


  // Local catalogue only. No network call anywhere on this page: a standalone exe must be able
  // to answer "what is this worth" without a third party being reachable.
  const localPrice = useMemo(() => findCommodityPrice(query.trim()), [query]);
  const knownCommodity = localPrice != null;
  // A price of 0 means RECOGNISED BUT UNPRICED, not free. The 2026-09-02 surface-mining
  // commodities (Helium, Olivine, Ruby, …) are in the dataset by name so a lookup does not read
  // as "not found", but no price source carries them yet. Testing `!= null` here would print
  // "0 cr/t average" and compute a 0-credit sale total, which is worse than saying nothing.
  const avgSell = localPrice && localPrice.avgSell > 0 ? localPrice.avgSell : null;
  const maxSell = localPrice && localPrice.maxSell > 0 ? localPrice.maxSell : null;
  const unpricedCommodity = localPrice != null && !(localPrice.avgSell > 0);

  // --- Material verdict: room or no room. Nothing else matters. ---
  const headroom = mat ? mat.cap - held : 0;
  const wasted = mat && qty > 0 ? Math.max(0, qty - headroom) : 0;

  // --- Commodity verdict: does the cash actually improve? ---
  const saleLow = avgSell != null && qty > 0 ? avgSell * qty : null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reward Info</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mission board offering you a thing instead of credits? Look it up before you press the button.
        </p>
      </div>

      {/* --- lookup --- */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tellurium, Nanobreakers, Modular Terminals…"
          className="w-full bg-background border border-border rounded px-3 py-2 text-foreground"
        />
        {matches.length > 0 && query.trim().toLowerCase() !== (mat?.displayName ?? intel?.name ?? '').toLowerCase() && (
          <div className="flex flex-wrap gap-2">
            {matches.map((m) => (
              <button
                key={m.label}
                onClick={() => setQuery(m.label)}
                className="px-2.5 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/60"
              >
                {m.label}
                <span className="ml-1.5 opacity-50">{m.kind === 'material' ? 'mat' : 'cargo'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            Units offered
            <input
              type="number" min={0} value={qty || ''}
              onChange={(e) => setQty(Number(e.target.value) || 0)}
              className="w-24 bg-background border border-border rounded px-2 py-1 text-foreground"
            />
          </label>
        </div>
      </div>

      {/* --- MATERIAL: room or not --- */}
      {mat && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-foreground">{mat.displayName}</h2>
            <span className="text-xs text-muted-foreground font-mono">
              {mat.category} · G{mat.grade} · {mat.line}
            </span>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold text-foreground tabular-nums">{held}</span>
              <span className="text-muted-foreground">/ {mat.cap} held</span>
              <span className="text-sm text-muted-foreground">· room for {headroom}</span>
            </div>
            <div className="mt-2 h-2 rounded bg-background overflow-hidden">
              <div
                className={`h-full ${held / mat.cap > 0.9 ? 'bg-amber-500' : 'bg-primary'}`}
                style={{ width: `${Math.min(100, (held / mat.cap) * 100)}%` }}
              />
            </div>
          </div>

          {qty > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Taking {qty} → <span className="text-foreground font-semibold">{Math.min(mat.cap, held + qty)} / {mat.cap}</span>
              {wasted > 0 && <span className="text-amber-500"> · {wasted} would overflow and be lost</span>}
            </p>
          )}

          {/* Grade and headroom. That is the entire question for a material — they cannot be
              bought at any price, so the only thing that can stop you taking one is space. */}
          <div className={`mt-4 rounded p-3 border ${headroom <= 0 ? 'border-red-500/50 bg-red-500/10' : 'border-emerald-500/50 bg-emerald-500/10'}`}>
            <span className="text-lg font-bold text-foreground">Grade {mat.grade}</span>
            <span className="text-muted-foreground"> · {held}/{mat.cap} · </span>
            <span className={headroom <= 0 ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold'}>
              {headroom <= 0 ? 'NO SPACE' : `room for ${headroom}`}
            </span>
            {wasted > 0 && <span className="text-amber-500"> · {wasted} of {qty} would overflow</span>}
          </div>
          {/* How hard is it to replace? Grade says the tier; this says where it comes from. */}
          {(() => {
            const acq = acquisitionFor(mat);
            return (
              <dl className="mt-3 space-y-1.5 text-sm">
                <Fact label="Rarity">
                  <span className={mat.grade >= 4 ? 'text-amber-400 font-semibold' : ''}>{acq.rarity}</span>
                  <span className="text-muted-foreground"> · grade {mat.grade} of {mat.category === 'raw' ? 4 : 5}</span>
                </Fact>
                <Fact label="Where to get more">
                  <span className="text-muted-foreground">{acq.method}</span>
                </Fact>
                {acq.hotspot && (
                  <Fact label="Known spot">
                    <span className="text-foreground">{acq.hotspot.body}</span>
                    {acq.hotspot.lat != null && (
                      <span className="text-muted-foreground tabular-nums">
                        {' '}· {acq.hotspot.lat.toFixed(3)}, {acq.hotspot.lon?.toFixed(3)}
                      </span>
                    )}
                    {acq.hotspot.note && <div className="text-xs text-muted-foreground">{acq.hotspot.note}</div>}
                  </Fact>
                )}
              </dl>
            );
          })()}
          {matGate && (
            <p className="mt-2 text-xs text-muted-foreground">
              Also an unlock item: {matGate.gate?.what || matGate.gate?.who}
              {matGate.gate?.qty ? ` · needs ${matGate.gate.qty}` : ''}
            </p>
          )}
        </div>
      )}

      {/* --- COMMODITY: does the cash actually improve --- */}
      {!mat && (intel?.kind === 'commodity' || knownCommodity || colonisation) && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-foreground">{intel?.name || query.trim()}</h2>
            <span className="text-xs text-muted-foreground font-mono">
              cargo{intel ? ` · ${intel.source === 'mission' ? 'mission reward only' : intel.source}` : ''}
            </span>
          </div>

          <dl className="mt-4 space-y-1.5 text-sm">
            {/* 1 — is it worth more? */}
            <Fact label="Worth more?">
              {unpricedCommodity && (
                <span className="text-amber-300">
                  Recognised, but no price data yet — this is one of the 2026-09-02 surface-mining
                  commodities and no market source carries it. A figure will appear once one trades it.
                </span>
              )}
              {avgSell != null && (
                <>
                  <span className="tabular-nums">{cr(avgSell)}</span> cr/t average
                  {maxSell != null && <span className="text-muted-foreground"> (max {cr(maxSell)})</span>}
                  {qty > 0 && saleLow != null && (
                    <div className="text-muted-foreground">
                      {/* Total expected sale price — the commander does the comparison against
                          whatever cash the board is offering; the page just supplies the number. */}
                      {qty} units ≈ <span className="text-foreground font-semibold tabular-nums">{cr(saleLow)}</span> CR total
                      <span className="text-muted-foreground/70"> · {qty}t of hold</span>
                    </div>
                  )}
                </>
              )}
            </Fact>

            {/* 2 — is it unlock related? */}
            <Fact label="Unlock related?">
              {intel?.dead ? (
                <span className="text-amber-500">No — dead content since {intel.dead.since}</span>
              ) : intel?.gate ? (
                <>
                  {intel.gate.what || intel.gate.who}
                  {intel.gate.qty > 0 && <span className="text-muted-foreground"> · needs {intel.gate.qty}</span>}
                  {intel.gate.type === 'engineer' && engineers?.[intel.gate.who] && (
                    <span className={engineers[intel.gate.who].progress === 'Unlocked' ? 'text-emerald-400' : 'text-amber-400'}>
                      {' '}· you are {engineers[intel.gate.who].progress}
                    </span>
                  )}
                </>
              ) : (
                // The intel list covers EVERY tech broker recipe and every commodity engineer
                // unlock, so absence is a real answer rather than a gap.
                <span className="text-muted-foreground">
                  No — not a tech broker recipe and not an engineer unlock
                </span>
              )}
            </Fact>

            {/* 3 — is it a colonisation commodity? */}
            <Fact label="Colonisation commodity?">
              {colonisation
                ? <span className="text-emerald-400">
                    Yes — {cr(colonisation.tons)} t across {colonisation.builds} of your builds
                    {colonisation.outstanding > 0 && (
                      <span className="text-foreground"> · {colonisation.outstanding} outstanding now</span>
                    )}
                  </span>
                : <span className="text-muted-foreground">Not seen in any of your build requirements</span>}
            </Fact>

            {intel?.source === 'mission' && (
              <Fact label="Obtainable?">
                <span className="text-muted-foreground">Mission reward only — cannot be bought anywhere</span>
              </Fact>
            )}
            {intel?.source === 'salvage' && (
              <Fact label="Obtainable?">
                <span className="text-muted-foreground">Salvage — signal sources and wrecks, plus mission rewards</span>
              </Fact>
            )}
          </dl>

          {intel?.dead && <p className="mt-3 text-xs text-muted-foreground">{intel.dead.note}</p>}
          {intel?.note && !intel.dead && <p className="mt-3 text-xs text-muted-foreground">{intel.note}</p>}
          {!intel && knownCommodity && (
            <p className="mt-3 text-xs text-muted-foreground">
              Plain trade cargo — nothing in the galaxy needs it for an unlock, so its only value is
              the sale price above.
            </p>
          )}

        </div>
      )}

      {/* Only a genuine miss. Ardent knowing the name is enough to render the commodity card, so
          this must not fire on the fallback path — it did, and "Personal Weapons" read as
          unsupported while its price was sitting right above it. */}
      {query.trim() && !mat && !intel && !knownCommodity && (
        <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted-foreground">
          Nothing found for “{query.trim()}”. It is not a ship-engineering material and no market
          data came back — check the spelling as the board writes it.
        </div>
      )}
    </div>
  );
}
