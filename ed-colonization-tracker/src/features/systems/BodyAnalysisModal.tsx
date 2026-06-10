import type { SpanshDumpBody } from '@/services/spanshApi';
import {
  resolveBodyEconomies,
  detectStrongLinkConditions,
  STRONG_LINK_MODIFIERS,
  type Economy,
} from '@/data/bodyEconomies';
import { INSTALLATION_TYPES } from '@/data/installationTypes';

interface Props {
  body: SpanshDumpBody;
  systemName: string;
  onClose: () => void;
}

const ECONOMY_COLORS: Record<Economy, string> = {
  Agriculture: 'text-green-400',
  Extraction: 'text-orange-400',
  Refinery: 'text-amber-400',
  Industrial: 'text-cyan-400',
  HighTech: 'text-blue-400',
  Military: 'text-red-400',
  Tourism: 'text-pink-400',
  Terraforming: 'text-emerald-400',
  Contraband: 'text-purple-400',
};

export function BodyAnalysisModal({ body, systemName, onClose }: Props) {
  const { profile, modifiers, economies } = resolveBodyEconomies(body);
  const { terraformable, hasVolcanism } = detectStrongLinkConditions(body);

  // Strong-link bonuses that this body grants
  const applicableStrongLinkBonuses: { economy: Economy; reason: string; effect: '+0.4' | '-0.4' }[] = [];
  for (const mod of STRONG_LINK_MODIFIERS) {
    const subTypeLc = (body.subType || '').toLowerCase();
    const bodyMods = new Set(modifiers.map((m) => m.id));
    // Heuristic checks based on body characteristics
    const orbitingEarthlike = subTypeLc.includes('earth-like');
    const orbitingWaterWorld = subTypeLc.includes('water world');
    const orbitingAmmonia = subTypeLc.includes('ammonia');
    const isIcy = subTypeLc.includes('icy body');
    const hasOrganics = bodyMods.has('organics');
    const hasGeologicals = bodyMods.has('geologicals');

    if (mod.economy === 'Agriculture') {
      if (orbitingEarthlike) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'on/orbiting Earth-like', effect: '+0.4' });
      if (terraformable) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'terraformable body', effect: '+0.4' });
      if (hasOrganics) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'has organics', effect: '+0.4' });
      if (isIcy) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'icy body penalty', effect: '-0.4' });
    } else if (mod.economy === 'HighTech') {
      if (orbitingAmmonia) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'orbiting Ammonia world', effect: '+0.4' });
      if (orbitingEarthlike) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'on/orbiting Earth-like', effect: '+0.4' });
      if (orbitingWaterWorld) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'on/orbiting Water world', effect: '+0.4' });
      if (hasGeologicals) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'has geologicals', effect: '+0.4' });
      if (hasOrganics) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'has organics', effect: '+0.4' });
    } else if (mod.economy === 'Extraction') {
      if (hasVolcanism) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'has volcanism', effect: '+0.4' });
    } else if (mod.economy === 'Tourism') {
      if (orbitingAmmonia) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'orbiting Ammonia world', effect: '+0.4' });
      if (orbitingEarthlike) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'on/orbiting Earth-like', effect: '+0.4' });
      if (orbitingWaterWorld) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'on/orbiting Water world', effect: '+0.4' });
      if (hasGeologicals) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'has geologicals', effect: '+0.4' });
      if (hasOrganics) applicableStrongLinkBonuses.push({ economy: mod.economy, reason: 'has organics', effect: '+0.4' });
    }
  }

  // Highlighted "viable economies" — base + modifier-added
  const viableEconomies = economies;

  // Best port-type recommendation: pick installations whose name aligns with a viable economy
  // (matches by economy keyword in installation name — heuristic until economyBonuses
  // field is fully populated)
  const installationSuggestions = viableEconomies.map((econ) => {
    const econLc = econ.toLowerCase();
    const matches = INSTALLATION_TYPES.filter((t) => {
      const n = t.name.toLowerCase();
      // crude keyword match — refine when economyBonuses field is populated per type
      if (econ === 'Extraction') return n.includes('extraction') || n.includes('mining');
      if (econ === 'Industrial') return n.includes('industrial');
      if (econ === 'Refinery') return n.includes('refinery');
      if (econ === 'Agriculture') return n.includes('agriculture') || n.includes('space farm');
      if (econ === 'HighTech') return n.includes('high tech') || n.includes('scientific') || n.includes('research') || n.includes('medical');
      if (econ === 'Military') return n.includes('military') || n.includes('security');
      if (econ === 'Tourism') return n.includes('tourist') || n.includes('space bar');
      return n.includes(econLc);
    });
    return { economy: econ, installations: matches };
  }).filter((s) => s.installations.length > 0);

  // Stop event propagation on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div className="bg-card border border-border rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 my-auto">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <h2 className="text-xl font-bold text-foreground">{body.name}</h2>
            <p className="text-sm text-muted-foreground">{systemName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl leading-none">{'×'}</button>
        </div>

        {/* Body characteristics */}
        <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Body</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="bg-muted/40 px-2 py-0.5 rounded">{body.subType}</span>
            {profile ? (
              <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">→ {profile.label}</span>
            ) : (
              <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">unknown type — no analysis</span>
            )}
            {body.isLandable && <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">Landable</span>}
            {body.gravity != null && <span className="bg-muted/40 px-2 py-0.5 rounded">{body.gravity.toFixed(2)}g</span>}
            {body.atmosphereType && body.atmosphereType !== 'No atmosphere' && (
              <span className="bg-muted/40 px-2 py-0.5 rounded">{body.atmosphereType}</span>
            )}
          </div>

          {modifiers.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-1">Body modifiers detected:</div>
              <ul className="text-sm space-y-0.5">
                {modifiers.map((m) => (
                  <li key={m.id} className="ml-2">
                    {'•'} {m.label} <span className="text-muted-foreground">→ adds {m.addsEconomies.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{terraformable ? '✓ Terraformable' : '✗ Not terraformable'}</span>
            <span>{hasVolcanism ? '✓ Volcanism' : '✗ No volcanism'}</span>
            {Array.isArray(body.rings) && <span>{body.rings.length} ring{body.rings.length !== 1 ? 's' : ''}</span>}
          </div>
        </div>

        {/* Viable economies for colony-type port */}
        <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Base economies available to a colony-type port on/around this body</div>
          {profile ? (
            <div className="flex flex-wrap gap-2">
              {viableEconomies.map((e) => (
                <span key={e} className={`px-2 py-1 rounded text-sm font-medium bg-muted/40 ${ECONOMY_COLORS[e] || 'text-foreground'}`}>
                  {e}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No analysis — body type not in mapping table.</p>
          )}
          <p className="text-xs text-muted-foreground mt-2 italic">
            These apply to colony-type ports: Civilian Outpost, Commercial Outpost, Coriolis, Orbis, Ocellus, T3 Planetary Port. Specialized ports (Industrial / Scientific / Military / Asteroid Base) have fixed economy types and ignore body inheritance.
          </p>
        </div>

        {/* Strong-link bonuses */}
        {applicableStrongLinkBonuses.length > 0 && (
          <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Strong-link modifiers (apply to supporting facilities on/around this body)</div>
            <ul className="text-sm space-y-1">
              {applicableStrongLinkBonuses.map((b, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className={`font-mono text-xs ${b.effect === '+0.4' ? 'text-emerald-400' : 'text-red-400'}`}>{b.effect}</span>
                  <span className={`${ECONOMY_COLORS[b.economy]} font-medium`}>{b.economy}</span>
                  <span className="text-muted-foreground text-xs">— {b.reason}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-2 italic">
              Strong-link base strength: T1 0.4 / T2 0.8 / T3 1.2. Modifiers stack additively (min 0.1).
            </p>
          </div>
        )}

        {/* Installation suggestions per viable economy */}
        {installationSuggestions.length > 0 && (
          <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Installation types matching viable economies</div>
            <p className="text-xs text-muted-foreground mb-2 italic">
              Heuristic match by economy keyword in type name. Full economy-bonus mapping per type is a follow-up — for now, use this as a starting point.
            </p>
            <div className="space-y-2">
              {installationSuggestions.map((sg) => (
                <div key={sg.economy}>
                  <div className={`text-sm font-medium ${ECONOMY_COLORS[sg.economy]}`}>{sg.economy}</div>
                  <ul className="ml-4 text-sm">
                    {sg.installations.map((t) => (
                      <li key={t.id} className="text-foreground">
                        {'•'} {t.name} <span className="text-muted-foreground text-xs">— T{t.tier}, {t.location}{t.totalTonnage ? `, ~${t.totalTonnage.toLocaleString()}t` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 text-xs text-muted-foreground italic">
          Source: CMDR Mechan's Elite Dangerous Colonization Mega Guide v2.3.0 — see FAQ → "Credits & data sources" for full attribution.
        </div>
      </div>
    </div>
  );
}
