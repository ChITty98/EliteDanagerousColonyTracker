/**
 * Port of parseJournalLines from src/services/journalReader.ts.
 *
 * Takes an array of raw journal lines (JSONL text split on \n) and returns
 * an object with one array per supported event type. The returned shape
 * MUST match the browser's parseJournalLines return shape exactly — every
 * extractor and processor downstream destructures the same keys.
 *
 * Malformed JSON lines are skipped silently; the game sometimes writes
 * partially-flushed lines that we'll pick up on the next poll.
 */

/**
 * @param {string[]} lines
 * @returns {object}
 */
export function parseJournalLines(lines) {
  const depotEvents = [];
  const dockedEvents = [];
  const locationEvents = [];
  const cargoEvents = [];
  const cargoTransferEvents = [];
  const fsdJumpEvents = [];
  const fssSignalEvents = [];
  const supercruiseEntryEvents = [];
  const supercruiseDestDropEvents = [];
  // Colonisation lifecycle
  const systemClaimEvents = [];
  const beaconPlacedEvents = [];
  const contributionEvents = [];
  const factionContributionEvents = [];
  // Fleet Carrier
  const carrierJumpEvents = [];
  const carrierJumpRequestEvents = [];
  const carrierJumpCancelledEvents = [];
  const carrierStatsEvents = [];
  const carrierDepositFuelEvents = [];
  // Exploration
  const fssDiscoveryScanEvents = [];
  const fssBodySignalsEvents = [];
  const fssAllBodiesFoundEvents = [];
  const scanEvents = [];
  const saaScanCompleteEvents = [];
  // Ship
  const loadoutEvents = [];
  const shipyardSwapEvents = [];
  // Market
  const marketBuyEvents = [];
  const marketSellEvents = [];
  // Planetary landings
  const touchdownEvents = [];
  const liftoffEvents = [];
  // Chat
  const sendTextEvents = [];
  // Combat
  const bountyEvents = [];
  const factionKillBondEvents = [];
  const diedEvents = [];
  const interdictedEvents = [];
  // Exploration payouts
  const sellExplorationDataEvents = [];
  const multiSellExplorationDataEvents = [];
  // Missions
  const missionCompletedEvents = [];
  // Statistics (game-generated lifetime stats)
  const statisticsEvents = [];
  // Codex entries (brain trees & other notable POIs)
  const codexEntryEvents = [];
  // Galaxy-map targeting
  const fsdTargetEvents = [];
  const navRouteEvents = [];
  const navRouteClearEvents = [];
  const dockingGrantedEvents = [];
  const supercruiseExitEvents = [];
  const receiveTextEvents = [];
  const undockedEvents = [];
  // Materials (engineering inventory deltas)
  const materialsEvents = [];          // Materials (full snapshot)
  const materialCollectedEvents = [];
  const materialDiscardedEvents = [];
  const engineerCraftEvents = [];
  const synthesisEvents = [];
  const technologyBrokerEvents = [];
  const materialTradeEvents = [];
  const scientificResearchEvents = [];
  const engineerContributionEvents = [];

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }
    switch (event.event) {
      case 'ColonisationConstructionDepot': depotEvents.push(event); break;
      case 'ColonisationSystemClaim': systemClaimEvents.push(event); break;
      case 'ColonisationBeaconPlaced': beaconPlacedEvents.push(event); break;
      // Frontier's journal actually writes `ColonisationBeaconDeployed`, not Placed.
      // Old parser had only `Placed`; we accept both now but the game only emits Deployed.
      case 'ColonisationBeaconDeployed': beaconPlacedEvents.push(event); break;
      case 'ColonisationContribution': contributionEvents.push(event); break;
      case 'ColonisationFactionContribution': factionContributionEvents.push(event); break;
      case 'Docked': dockedEvents.push(event); break;
      case 'Location': locationEvents.push(event); break;
      case 'Cargo': cargoEvents.push(event); break;
      case 'CargoTransfer': cargoTransferEvents.push(event); break;
      case 'FSDJump': fsdJumpEvents.push(event); break;
      case 'FSSSignalDiscovered': fssSignalEvents.push(event); break;
      case 'FSSDiscoveryScan': fssDiscoveryScanEvents.push(event); break;
      case 'FSSBodySignals': fssBodySignalsEvents.push(event); break;
      case 'FSSAllBodiesFound': fssAllBodiesFoundEvents.push(event); break;
      case 'Scan': scanEvents.push(event); break;
      case 'SAAScanComplete': saaScanCompleteEvents.push(event); break;
      case 'Loadout': loadoutEvents.push(event); break;
      case 'ShipyardSwap': shipyardSwapEvents.push(event); break;
      case 'SupercruiseEntry': supercruiseEntryEvents.push(event); break;
      case 'SupercruiseDestinationDrop': supercruiseDestDropEvents.push(event); break;
      case 'CarrierJump': carrierJumpEvents.push(event); break;
      case 'CarrierJumpRequest': carrierJumpRequestEvents.push(event); break;
      case 'CarrierJumpCancelled': carrierJumpCancelledEvents.push(event); break;
      case 'CarrierStats': carrierStatsEvents.push(event); break;
      case 'CarrierDepositFuel': carrierDepositFuelEvents.push(event); break;
      case 'MarketBuy': marketBuyEvents.push(event); break;
      case 'MarketSell': marketSellEvents.push(event); break;
      case 'Touchdown': touchdownEvents.push(event); break;
      case 'Liftoff': liftoffEvents.push(event); break;
      case 'SendText': sendTextEvents.push(event); break;
      case 'Bounty': bountyEvents.push(event); break;
      case 'FactionKillBond': factionKillBondEvents.push(event); break;
      case 'Died': diedEvents.push(event); break;
      case 'Interdicted': interdictedEvents.push(event); break;
      case 'SellExplorationData': sellExplorationDataEvents.push(event); break;
      case 'MultiSellExplorationData': multiSellExplorationDataEvents.push(event); break;
      case 'MissionCompleted': missionCompletedEvents.push(event); break;
      case 'Statistics': statisticsEvents.push(event); break;
      case 'CodexEntry': codexEntryEvents.push(event); break;
      case 'FSDTarget': fsdTargetEvents.push(event); break;
      case 'NavRoute': navRouteEvents.push(event); break;
      case 'NavRouteClear': navRouteClearEvents.push(event); break;
      case 'DockingGranted': dockingGrantedEvents.push(event); break;
      case 'SupercruiseExit': supercruiseExitEvents.push(event); break;
      case 'ReceiveText': receiveTextEvents.push(event); break;
      case 'Undocked': undockedEvents.push(event); break;
      case 'Materials': materialsEvents.push(event); break;
      case 'MaterialCollected': materialCollectedEvents.push(event); break;
      case 'MaterialDiscarded': materialDiscardedEvents.push(event); break;
      case 'EngineerCraft':
      case 'EngineerLegacyConvert': engineerCraftEvents.push(event); break;
      case 'Synthesis': synthesisEvents.push(event); break;
      case 'TechnologyBroker': technologyBrokerEvents.push(event); break;
      case 'MaterialTrade': materialTradeEvents.push(event); break;
      case 'ScientificResearch': scientificResearchEvents.push(event); break;
      case 'EngineerContribution': engineerContributionEvents.push(event); break;
      default: break;
    }
  }

  return {
    depotEvents,
    dockedEvents,
    locationEvents,
    cargoEvents,
    cargoTransferEvents,
    fsdJumpEvents,
    fssSignalEvents,
    supercruiseEntryEvents,
    supercruiseDestDropEvents,
    systemClaimEvents,
    beaconPlacedEvents,
    contributionEvents,
    factionContributionEvents,
    carrierJumpEvents,
    carrierJumpRequestEvents,
    carrierJumpCancelledEvents,
    carrierStatsEvents,
    carrierDepositFuelEvents,
    fssDiscoveryScanEvents,
    fssBodySignalsEvents,
    fssAllBodiesFoundEvents,
    scanEvents,
    saaScanCompleteEvents,
    loadoutEvents,
    shipyardSwapEvents,
    marketBuyEvents,
    marketSellEvents,
    touchdownEvents,
    liftoffEvents,
    sendTextEvents,
    bountyEvents,
    factionKillBondEvents,
    diedEvents,
    interdictedEvents,
    sellExplorationDataEvents,
    multiSellExplorationDataEvents,
    missionCompletedEvents,
    statisticsEvents,
    codexEntryEvents,
    fsdTargetEvents,
    navRouteEvents,
    navRouteClearEvents,
    dockingGrantedEvents,
    supercruiseExitEvents,
    receiveTextEvents,
    undockedEvents,
    materialsEvents,
    materialCollectedEvents,
    materialDiscardedEvents,
    engineerCraftEvents,
    synthesisEvents,
    technologyBrokerEvents,
    materialTradeEvents,
    scientificResearchEvents,
    engineerContributionEvents,
  };
}

