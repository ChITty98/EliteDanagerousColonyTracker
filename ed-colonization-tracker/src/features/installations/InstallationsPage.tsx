/**
 * Installations (1.60.28) — every site across the commander's colonies in one sortable, filterable
 * table: estimated population (the measured-additions split of each system's latest reading, the
 * floors holding every figure), the market's economies as the journal last recorded them at dock,
 * Raven Colonial's tech / wealth / development effects, opening and dock dates. The rows come from
 * src/lib/installationRows.ts; this file is the view.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { StationTypeIcon } from '@/components/StationTypeIcon';
import { formatEstimatedPopulation, agoLabel } from '@/lib/populationEstimate';
import { formatPopulation } from '@/features/dashboard/tierUtils';
import {
  buildInstallationRows, summarizeInstallationRows, GROUP_ORDER, GROUP_LABELS,
  type InstallationRow, type SiteGroup,
} from '@/lib/installationRows';

type SortKey = 'site' | 'system' | 'type' | 'pop' | 'share' | 'economy' | 'tech' | 'wealth' | 'dev' | 'opened' | 'lastDock' | 'docks';
type SortDir = 'asc' | 'desc';
type Align = 'left' | 'right' | 'center';

const DESC_FIRST = new Set<SortKey>(['pop', 'share', 'economy', 'tech', 'wealth', 'dev', 'opened', 'lastDock', 'docks']);
const ALIGN: Record<Align, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };
const SELECT = 'bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
const fmtPct = (share: number | null) => (share == null ? '—' : `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`);
const fmtEffect = (n: number | null) => (n == null ? '—' : String(n));
const economyOf = (row: InstallationRow, name: string) => row.economies.find((e) => e.name === name)?.proportion ?? null;

function popTitle(r: InstallationRow): string {
  const parts: string[] = [];
  if (r.basis) parts.push(r.basis);
  if (r.held && r.estimate != null) parts.push(`held at ${formatEstimatedPopulation(r.estimate)}${r.heldAt ? ` since ${fmtDate(r.heldAt)}` : ''} — a site's figure never goes down`);
  parts.push(r.systemPopulation > 0 ? `system ${formatPopulation(r.systemPopulation)}` : 'no population reading for this system yet — the journal read 0 at your last visit, or no visit is recorded');
  return parts.join(' · ');
}

export function InstallationsPage() {
  const knownStations = useAppStore((s) => s.knownStations);
  const projects = useAppStore((s) => s.projects);
  const manualColonizedSystems = useAppStore((s) => s.manualColonizedSystems);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const populationOverrides = useAppStore((s) => s.populationOverrides);
  const fssSignals = useAppStore((s) => s.fssSignals);
  const floors = useAppStore((s) => s.facilityPopulationFloor);
  const manualInstallations = useAppStore((s) => s.manualInstallations);
  const hiddenInstallations = useAppStore((s) => s.hiddenInstallations);

  const rows = useMemo(
    () => buildInstallationRows({ knownStations, projects, manualColonizedSystems, knownSystems, populationOverrides, fssSignals, floors, manualInstallations, hiddenInstallations }),
    [knownStations, projects, manualColonizedSystems, knownSystems, populationOverrides, fssSignals, floors, manualInstallations, hiddenInstallations],
  );
  const summary = useMemo(() => summarizeInstallationRows(rows), [rows]);

  const [search, setSearch] = useState('');
  const [systemFilter, setSystemFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState<'' | SiteGroup>('');
  const [economyFilter, setEconomyFilter] = useState('');
  const [marketOnly, setMarketOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('pop');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const systems = useMemo(() => [...new Set(rows.map((r) => r.systemName))].sort((a, b) => a.localeCompare(b)), [rows]);
  const economies = useMemo(() => [...new Set(rows.flatMap((r) => r.economies.map((e) => e.name)))].sort((a, b) => a.localeCompare(b)), [rows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(DESC_FIRST.has(key) ? 'desc' : 'asc');
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (systemFilter && r.systemName !== systemFilter) return false;
      if (groupFilter && r.group !== groupFilter) return false;
      if (economyFilter && (economyOf(r, economyFilter) ?? 0) <= 0) return false;
      if (marketOnly && !r.hasMarket) return false;
      if (q && !`${r.siteName} ${r.systemName} ${r.typeLabel} ${r.body ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    // Missing values sink to the bottom whichever way the column is sorted.
    const num = (a: number | null, b: number | null) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a - b) * dir);
    const str = (a: string, b: string) => a.localeCompare(b) * dir;
    const time = (a: string | null, b: string | null) => num(a ? Date.parse(a) : null, b ? Date.parse(b) : null);
    const eco = (r: InstallationRow) => (economyFilter ? economyOf(r, economyFilter) : r.economies[0]?.proportion ?? null);
    list.sort((a, b) => {
      let c = 0;
      switch (sortKey) {
        case 'site': c = str(a.siteName, b.siteName); break;
        case 'system': c = str(a.systemName, b.systemName); break;
        case 'type': c = str(a.typeLabel, b.typeLabel); break;
        case 'pop': c = num(a.estimate, b.estimate); break;
        case 'share': c = num(a.share, b.share); break;
        case 'economy': c = num(eco(a), eco(b)); break;
        case 'tech': c = num(a.tech, b.tech); break;
        case 'wealth': c = num(a.wealth, b.wealth); break;
        case 'dev': c = num(a.dev, b.dev); break;
        case 'opened': c = time(a.openedAt, b.openedAt); break;
        case 'lastDock': c = time(a.lastDocked, b.lastDocked); break;
        case 'docks': c = num(a.dockedCount, b.dockedCount); break;
      }
      return c || a.siteName.localeCompare(b.siteName);
    });
    return list;
  }, [rows, search, systemFilter, groupFilter, economyFilter, marketOnly, sortKey, sortDir]);

  const SortHeader = ({ label, sortId, align = 'left', title }: { label: string; sortId: SortKey; align?: Align; title?: string }) => (
    <th
      className={`${ALIGN[align]} px-3 py-2 cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap`}
      onClick={() => toggleSort(sortId)}
      title={title}
    >
      {label} {sortKey === sortId ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: 'Sites', value: String(summary.sites) },
    { label: 'Colonies', value: String(summary.systems) },
    { label: 'Est. population', value: formatEstimatedPopulation(summary.population), hint: "The sum of every site's estimate" },
    ...GROUP_ORDER.filter((g) => g !== 'unknown' || summary.byGroup[g] > 0).map((g) => ({ label: GROUP_LABELS[g], value: String(summary.byGroup[g]) })),
  ];

  const economyCell = (r: InstallationRow) => {
    if (economyFilter) {
      const p = economyOf(r, economyFilter);
      return p == null ? '—' : p.toFixed(2);
    }
    const top = r.economies[0];
    return top ? <>{top.name} <span className="text-muted-foreground">{top.proportion.toFixed(2)}</span></> : '—';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Installations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every site across your colonies. Population is the measured-additions split of each system's latest reading;
          economies are the market as the journal last recorded it; tech, wealth and development come from Raven
          Colonial's build table. A site inside its first days is marked growing.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-6 text-sm text-muted-foreground">
          No colony sites yet. Projects, and systems marked as colonized on the Dashboard, appear here once the journal has seen their stations.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className="bg-card border border-border rounded-lg px-4 py-3" title={t.hint}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
                <div className="text-xl font-bold text-foreground tabular-nums">{t.value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sites, systems, types..."
              className={`${SELECT} w-60 placeholder:text-muted-foreground/60`}
            />
            <select value={systemFilter} onChange={(e) => setSystemFilter(e.target.value)} className={SELECT}>
              <option value="">All systems</option>
              {systems.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value as '' | SiteGroup)} className={SELECT}>
              <option value="">All kinds</option>
              {GROUP_ORDER.map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
            </select>
            <select
              value={economyFilter}
              onChange={(e) => { setEconomyFilter(e.target.value); if (e.target.value) { setSortKey('economy'); setSortDir('desc'); } }}
              className={SELECT}
              title="Only the sites whose market carries this economy, ranked by its strength"
            >
              <option value="">Any economy</option>
              {economies.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={marketOnly} onChange={(e) => setMarketOnly(e.target.checked)} />
              With a market
            </label>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">{visible.length} of {rows.length} sites</span>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <SortHeader label="Site" sortId="site" />
                  <SortHeader label="System" sortId="system" />
                  <SortHeader label="Type" sortId="type" />
                  <SortHeader label="Est. pop" sortId="pop" align="right" title="The measured-additions split of the system's latest population reading; a floor holds every figure from going down" />
                  <SortHeader label="Share" sortId="share" align="right" title="Of the system's population" />
                  <SortHeader label={economyFilter || 'Economy'} sortId="economy" align="right" title={economyFilter ? `${economyFilter} strength at this market, as the journal last recorded it` : "The market's strongest economy and its strength, as the journal last recorded it"} />
                  <SortHeader label="Tech" sortId="tech" align="right" title="Raven Colonial: the type's technology-level effect" />
                  <SortHeader label="Wealth" sortId="wealth" align="right" title="Raven Colonial: the type's wealth effect" />
                  <SortHeader label="Dev" sortId="dev" align="right" title="Raven Colonial: the type's development-level effect" />
                  <SortHeader label="Opened" sortId="opened" align="right" title="Project completion, else your first dock" />
                  <SortHeader label="Last dock" sortId="lastDock" align="right" />
                  <SortHeader label="Docks" sortId="docks" align="center" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.key} className="border-t border-border/50 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <StationTypeIcon stationType={r.stationType || 'Unknown'} />
                        <Link to={`/systems/${encodeURIComponent(r.systemName)}`} className="font-medium text-foreground hover:text-primary">{r.siteName}</Link>
                      </div>
                      {r.body && <div className="text-xs text-muted-foreground ml-6">{r.body}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link to={`/systems/${encodeURIComponent(r.systemName)}`} className="text-muted-foreground hover:text-primary">{r.systemName}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap" title={r.ravenName ? `Raven Colonial: ${r.ravenName}` : undefined}>
                      {r.typeLabel}
                      {r.typeInferred && <span className="ml-1 text-xs text-muted-foreground/70" title="Named from the market's economy — the journal writes every orbital outpost as 'Outpost'. Set the type on the system page to pin it.">(by economy)</span>}
                      {r.typeUnknown && <span className="ml-1 text-xs text-amber-400" title="Nothing recorded what was built here. Set the type on the system page.">type?</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title={popTitle(r)}>
                      {r.estimate == null ? '—' : (
                        <>
                          {formatEstimatedPopulation(r.estimate)}
                          {r.held && <span className="ml-1 text-xs text-primary/80">{'◆'}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtPct(r.share)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title={r.economies.length ? r.economies.map((e) => `${e.name} ${e.proportion.toFixed(2)}`).join(' · ') : 'No market recorded'}>
                      {economyCell(r)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtEffect(r.tech)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtEffect(r.wealth)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtEffect(r.dev)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap" title={r.openedSource === 'project' ? 'Project completed' : r.openedSource === 'dock' ? 'Your first dock here' : undefined}>
                      {fmtDate(r.openedAt)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap" title={r.lastDocked ? new Date(r.lastDocked).toLocaleString() : undefined}>
                      {agoLabel(r.lastDocked) ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{r.dockedCount || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && (
              <div className="px-4 py-6 text-sm text-muted-foreground">Nothing matches these filters.</div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Rows come from your dock dossier, completed projects, manual installations and FSS signals; carriers,
            construction sites and colonisation ships never count, and a renamed station is one row. {'◆'} marks a
            figure held by its floor. Installations and hubs carry no population.
          </p>
        </>
      )}
    </div>
  );
}
