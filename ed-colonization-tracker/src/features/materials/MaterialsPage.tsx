import { useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import {
  MATERIALS,
  MATERIAL_BY_ID,
  tradeYieldPerSource,
  CROSS_LINE_TRADE,
  type MaterialDefinition,
  type MaterialCategory,
} from '@/data/engineeringMaterials';
import { BLUEPRINTS, computeGradeCapacity } from '@/data/blueprints';

type Tab = 'inventory' | 'trade' | 'engineering';

export function MaterialsPage() {
  const inv = useAppStore((s) => s.materialInventory);
  const [tab, setTab] = useState<Tab>('inventory');

  if (!inv) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">{'\u{1F6E0}\u{FE0F}'}</p>
        <h2 className="text-xl font-bold text-foreground mb-2">No material inventory yet</h2>
        <p className="text-muted-foreground mb-4">
          Run <strong>Sync All from Journal</strong> on the Dashboard to scan your engineering material inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Engineering Materials</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Last updated {new Date(inv.updatedAt).toLocaleString()}
          {inv.baselineFrom && <span> &middot; baseline from {inv.baselineFrom}</span>}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(['inventory', 'trade', 'engineering'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'inventory' && 'Inventory'}
            {t === 'trade' && 'Trade Planner'}
            {t === 'engineering' && 'Engineering Capacity'}
          </button>
        ))}
      </div>

      {tab === 'inventory' && <InventoryTab />}
      {tab === 'trade' && <TradeTab />}
      {tab === 'engineering' && <EngineeringTab />}
    </div>
  );
}

// ===== Inventory tab =====

function InventoryTab() {
  const inv = useAppStore((s) => s.materialInventory)!;
  const sections: { category: MaterialCategory; label: string; data: Record<string, number> }[] = [
    { category: 'raw', label: 'Raw', data: inv.raw },
    { category: 'manufactured', label: 'Manufactured', data: inv.manufactured },
    { category: 'encoded', label: 'Encoded', data: inv.encoded },
  ];
  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <CategorySection key={s.category} category={s.category} label={s.label} data={s.data} />
      ))}
    </div>
  );
}

function CategorySection({ category, label, data }: { category: MaterialCategory; label: string; data: Record<string, number> }) {
  // Group by line, then by grade.
  const byLine = useMemo(() => {
    const groups: Record<string, MaterialDefinition[]> = {};
    for (const m of MATERIALS) {
      if (m.category !== category) continue;
      if (!groups[m.line]) groups[m.line] = [];
      groups[m.line].push(m);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => a.grade - b.grade);
    }
    return groups;
  }, [category]);

  const total = Object.entries(data).reduce((s, [, c]) => s + (c || 0), 0);
  const typeCount = Object.values(data).filter((c) => c > 0).length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-bold text-foreground">{label}</h2>
        <div className="text-xs text-muted-foreground">
          {typeCount} types &middot; {total.toLocaleString()} total
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(byLine).map(([line, mats]) => (
          <LineGroup key={line} line={line} mats={mats} data={data} />
        ))}
      </div>
    </div>
  );
}

function LineGroup({ line, mats, data }: { line: string; mats: MaterialDefinition[]; data: Record<string, number> }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{line}</div>
      <div className="space-y-1">
        {mats.map((m) => {
          const count = data[m.id] || 0;
          const pct = (count / m.cap) * 100;
          const capped = count >= m.cap;
          const empty = count === 0;
          return (
            <div key={m.id} className={`flex items-center gap-2 text-sm ${empty ? 'opacity-40' : ''}`}>
              <span className="text-xs text-muted-foreground w-5">G{m.grade}</span>
              <span className="flex-1 truncate">{m.displayName}</span>
              <span className={`tabular-nums ${capped ? 'text-amber-400 font-bold' : 'text-foreground'}`}>
                {count}
                <span className="text-muted-foreground/50 text-xs"> / {m.cap}</span>
                {capped && <span className="ml-1">{'★'}</span>}
              </span>
              <div className="w-16 h-1.5 bg-muted/30 rounded overflow-hidden">
                <div
                  className={`h-full ${capped ? 'bg-amber-400' : 'bg-primary'}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Trade Planner tab =====

function TradeTab() {
  const inv = useAppStore((s) => s.materialInventory)!;
  const [targetId, setTargetId] = useState('mechanicalcomponents');
  const target = MATERIAL_BY_ID.get(targetId);

  const candidates = useMemo(() => {
    if (!target) return [];
    const stockOf = (m: MaterialDefinition) => (inv as Record<string, Record<string, number>>)[m.category][m.id] || 0;
    const out: {
      mat: MaterialDefinition;
      count: number;
      sameLine: boolean;
      ratio: string;
      totalYield: number;
      yieldPerSource: number;
    }[] = [];
    for (const m of MATERIALS) {
      if (m.id === target.id) continue;
      if (m.category !== target.category) continue;
      if (m.line === 'special') continue; // Guardian/Thargoid not in standard ladder
      const count = stockOf(m);
      if (count <= 0) continue;
      const sameLine = m.line === target.line;
      const yieldPer = tradeYieldPerSource(m.grade, target.grade, sameLine);
      if (yieldPer <= 0) continue;
      let ratioStr: string;
      let totalYield: number;
      if (sameLine) {
        if (m.grade < target.grade) {
          const need = Math.pow(6, target.grade - m.grade);
          ratioStr = `${need}:1`;
          totalYield = Math.floor(count / need);
        } else {
          const factor = Math.pow(3, m.grade - target.grade);
          ratioStr = `1:${factor}`;
          totalYield = count * factor;
        }
      } else {
        const entry = CROSS_LINE_TRADE[m.grade]?.[target.grade];
        if (!entry) continue;
        ratioStr = `${entry[0]}:${entry[1]}`;
        totalYield = Math.floor(count / entry[0]) * entry[1];
      }
      out.push({ mat: m, count, sameLine, ratio: ratioStr, totalYield, yieldPerSource: yieldPer });
    }
    out.sort((a, b) => {
      if (a.sameLine !== b.sameLine) return a.sameLine ? -1 : 1;
      if (a.yieldPerSource !== b.yieldPerSource) return b.yieldPerSource - a.yieldPerSource;
      return b.totalYield - a.totalYield;
    });
    return out;
  }, [inv, target]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <label className="block text-sm font-medium mb-2">Target material</label>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm"
        >
          {(['raw', 'manufactured', 'encoded'] as MaterialCategory[]).map((cat) => (
            <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
              {MATERIALS.filter((m) => m.category === cat && m.line !== 'special').map((m) => (
                <option key={m.id} value={m.id}>
                  G{m.grade} &mdash; {m.displayName} ({m.line})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {target && (
          <div className="mt-2 text-xs text-muted-foreground">
            Currently {(inv as Record<string, Record<string, number>>)[target.category][target.id] || 0} / {target.cap} in stock.
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Line</th>
              <th className="text-center px-3 py-2">Stock</th>
              <th className="text-center px-3 py-2">Same line</th>
              <th className="text-center px-3 py-2">Ratio</th>
              <th className="text-right px-3 py-2">Total yield</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted-foreground py-8">
                  No tradeable materials in stock for this target.
                </td>
              </tr>
            )}
            {candidates.map((c, i) => {
              const prev = candidates[i - 1];
              const showDivider = prev && prev.sameLine && !c.sameLine;
              return (
                <Fragment2 key={c.mat.id}>
                  {showDivider && (
                    <tr>
                      <td colSpan={6} className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/20 italic">
                        {'─'.repeat(3)} cross-line below (6× penalty per grade) {'─'.repeat(3)}
                      </td>
                    </tr>
                  )}
                  <tr className={`border-t border-border/30 ${c.sameLine ? '' : 'opacity-60'}`}>
                    <td className="px-3 py-2">
                      <div className="text-foreground">{c.mat.displayName}</div>
                      <div className="text-xs text-muted-foreground">G{c.mat.grade}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.mat.line}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{c.count}</td>
                    <td className="px-3 py-2 text-center">
                      {c.sameLine ? (
                        <span className="text-emerald-400">{'✓'}</span>
                      ) : (
                        <span className="text-muted-foreground">{'✕'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">{c.ratio}</td>
                    <td className="px-3 py-2 text-right font-bold text-foreground tabular-nums">
                      {c.totalYield.toLocaleString()}
                    </td>
                  </tr>
                </Fragment2>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Stable Fragment with key for the trade table
function Fragment2(props: { children: React.ReactNode }) {
  return <>{props.children}</>;
}

// ===== Engineering Capacity tab =====

function EngineeringTab() {
  const inv = useAppStore((s) => s.materialInventory)!;
  const [blueprintId, setBlueprintId] = useState(BLUEPRINTS[0].id);
  const [shipCount, setShipCount] = useState(2);
  const [rollsPerShip, setRollsPerShip] = useState(25);
  const [unlockRollsPerStage, setUnlockRollsPerStage] = useState(5);
  const blueprint = BLUEPRINTS.find((b) => b.id === blueprintId);

  if (!blueprint) return null;

  const grades = ([1, 2, 3, 4, 5] as const).map((g) =>
    computeGradeCapacity(blueprint, g, inv),
  );

  // Total mat budget for "N ships, R rolls each at G5, U unlock rolls per G1-G4 stage"
  const requiredMats = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const grade of [1, 2, 3, 4] as const) {
      const recipe = blueprint.grades.find((g) => g.grade === grade);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        totals[ing.materialId] = (totals[ing.materialId] || 0) + ing.count * unlockRollsPerStage * shipCount;
      }
    }
    const g5 = blueprint.grades.find((g) => g.grade === 5);
    if (g5) {
      for (const ing of g5.ingredients) {
        totals[ing.materialId] = (totals[ing.materialId] || 0) + ing.count * rollsPerShip * shipCount;
      }
    }
    return totals;
  }, [blueprint, shipCount, rollsPerShip, unlockRollsPerStage]);

  const stockOf = (id: string): number => {
    const m = MATERIALS.find((x) => x.id === id);
    if (!m) return 0;
    return (inv as Record<string, Record<string, number>>)[m.category][id] || 0;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-2">Blueprint</label>
          <select
            value={blueprintId}
            onChange={(e) => setBlueprintId(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm"
          >
            {BLUEPRINTS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} &mdash; {b.module}
              </option>
            ))}
          </select>
          {!blueprint.verified && (
            <div className="mt-1 text-xs text-amber-400">
              {'⚠️'} Recipe not yet verified in-game; spot-check before large rolls.
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Ships</label>
            <input
              type="number"
              min={1}
              value={shipCount}
              onChange={(e) => setShipCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">G5 rolls / ship</label>
            <input
              type="number"
              min={1}
              value={rollsPerShip}
              onChange={(e) => setRollsPerShip(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Unlock rolls / stage</label>
            <input
              type="number"
              min={1}
              value={unlockRollsPerStage}
              onChange={(e) => setUnlockRollsPerStage(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Per-grade capacity */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-bold mb-3">Capacity per grade</h3>
        <div className="space-y-3">
          {grades.map((g) => g && (
            <div key={g.grade} className="border-l-2 border-primary/50 pl-3">
              <div className="flex items-baseline justify-between">
                <div className="font-medium">Grade {g.grade}</div>
                <div className={`text-sm ${g.maxRolls === 0 ? 'text-red-400' : 'text-foreground'}`}>
                  {g.maxRolls.toLocaleString()} rolls available
                </div>
              </div>
              <div className="mt-1 text-xs space-y-0.5">
                {g.ingredients.map((i) => (
                  <div key={i.materialId} className={`flex gap-2 ${i.bottleneck ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    <span className="w-4">{i.bottleneck ? '★' : ' '}</span>
                    <span className="flex-1">{i.material?.displayName || i.materialId}</span>
                    <span className="tabular-nums">
                      need {i.required}, have {i.available} &rarr; {i.maxRolls} rolls
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total material budget for the configured plan */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-bold mb-2">
          Total material budget &mdash; {shipCount} ship{shipCount > 1 ? 's' : ''} max engineered
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Assumes {unlockRollsPerStage} rolls per G1-G4 unlock stage and {rollsPerShip} G5 rolls per ship for a near-max outcome.
        </p>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left pb-1">Material</th>
              <th className="text-right pb-1">Need</th>
              <th className="text-right pb-1">Have</th>
              <th className="text-right pb-1">Gap</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(requiredMats).map(([id, needed]) => {
              const have = stockOf(id);
              const gap = needed - have;
              const m = MATERIALS.find((x) => x.id === id);
              return (
                <tr key={id} className="border-t border-border/30">
                  <td className="py-1.5">
                    <span className="text-xs text-muted-foreground mr-1">G{m?.grade ?? '?'}</span>
                    {m?.displayName || id}
                  </td>
                  <td className="text-right tabular-nums">{needed}</td>
                  <td className="text-right tabular-nums">{have}</td>
                  <td className={`text-right tabular-nums font-bold ${gap > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {gap > 0 ? `-${gap}` : `+${-gap}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
