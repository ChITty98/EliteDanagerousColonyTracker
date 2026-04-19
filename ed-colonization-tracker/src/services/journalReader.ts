import { findCommodityByJournalName, findCommodityByDisplayName } from '@/data/commodities';
import type { ProjectCommodity, KnownSystem, KnownStation, StationEconomy, MarketSnapshot, MarketItem, FSSSignal, FleetCarrierInfo, PersistedMarketSnapshot, PersistedMarketCommodity, BodyVisit } from '@/store/types';

// ===== Journal Event Interfaces =====

// Galaxy-map targeting events
export interface FSDTargetEvent {
  timestamp: string;
  event: 'FSDTarget';
  Name: string;
  SystemAddress: number;
  StarClass?: string;
  RemainingJumpsInRoute?: number;
}

export interface NavRouteEvent {
  timestamp: string;
  event: 'NavRoute';
  // Just a signal; full route is in NavRoute.json
}

export interface NavRouteClearEvent {
  timestamp: string;
  event: 'NavRouteClear';
}

export interface DockingGrantedEvent {
  timestamp: string;
  event: 'DockingGranted';
  MarketID: number;
  StationName: string;
  StationType?: string;
  LandingPad: number;
}

export interface SupercruiseExitEvent {
  timestamp: string;
  event: 'SupercruiseExit';
  StarSystem: string;
  SystemAddress: number;
  Body: string;
  BodyID: number;
  BodyType: string; // "Station", "Planet", "Star", "PlanetaryRing", "StellarRing", etc.
  Taxi?: boolean;
  Multicrew?: boolean;
}

export interface UndockedEvent {
  timestamp: string;
  event: 'Undocked';
  StationName: string;
  StationType?: string;
  MarketID?: number;
}

export interface ReceiveTextEvent {
  timestamp: string;
  event: 'ReceiveText';
  From: string;
  From_Localised?: string;
  Message: string;
  Message_Localised?: string;
  Channel: string; // "npc" | "player" | "local" | "voicechat" | "wing" | "starsystem" | "squadron"
}

export interface JournalResourceRequired {
  Name: string;
  Name_Localised?: string;
  RequiredAmount: number;
  ProvidedAmount: number;
  Payment: number;
}

interface JournalStationEconomy {
  Name: string;
  Name_Localised?: string;
  Proportion: number;
}

interface ColonisationConstructionDepotEvent {
  timestamp: string;
  event: 'ColonisationConstructionDepot';
  MarketID: number;
  ConstructionProgress: number;
  ConstructionComplete: boolean;
  ConstructionFailed: boolean;
  ResourcesRequired: JournalResourceRequired[];
}

interface DockedEvent {
  timestamp: string;
  event: 'Docked';
  StationName: string;
  StationType: string;
  StarSystem: string;
  SystemAddress: number;
  MarketID: number;
  Body?: string;
  BodyID?: number;
  BodyType?: string;
  DistFromStarLS?: number;
  LandingPads?: { Small: number; Medium: number; Large: number };
  StationEconomies?: JournalStationEconomy[];
  StationEconomy?: string;
  StationEconomy_Localised?: string;
  StationServices?: string[];
  StationFaction?: { Name: string; FactionState?: string };
}

interface LocationEvent {
  timestamp: string;
  event: 'Location';
  StationName?: string;
  StationType?: string;
  StarSystem: string;
  SystemAddress: number;
  MarketID?: number;
  Docked: boolean;
  Body?: string;
  BodyType?: string;
  Population?: number;
  SystemEconomy?: string;
  SystemEconomy_Localised?: string;
  SystemSecondEconomy?: string;
  SystemSecondEconomy_Localised?: string;
  StarPos?: [number, number, number];
  DistFromStarLS?: number;
  LandingPads?: { Small: number; Medium: number; Large: number };
  StationEconomies?: JournalStationEconomy[];
  StationServices?: string[];
  StationFaction?: { Name: string };
}

interface FSDJumpEvent {
  timestamp: string;
  event: 'FSDJump';
  StarSystem: string;
  SystemAddress: number;
  StarPos: [number, number, number];
  Population?: number;
  SystemEconomy?: string;
  SystemEconomy_Localised?: string;
  SystemSecondEconomy?: string;
  SystemSecondEconomy_Localised?: string;
}

interface FSSSignalDiscoveredEvent {
  timestamp: string;
  event: 'FSSSignalDiscovered';
  SystemAddress: number;
  SignalName: string;
  SignalName_Localised?: string;
  SignalType?: string;
  IsStation?: boolean;
}

interface SupercruiseEntryEvent {
  timestamp: string;
  event: 'SupercruiseEntry';
  StarSystem: string;
  SystemAddress: number;
}

interface SupercruiseDestDropEvent {
  timestamp: string;
  event: 'SupercruiseDestinationDrop';
  Type: string;
  Type_Localised?: string;
  Threat: number;
  MarketID?: number;
}

// --- Colonisation lifecycle events ---

interface ColonisationSystemClaimEvent {
  timestamp: string;
  event: 'ColonisationSystemClaim';
  StarSystem: string;
  SystemAddress: number;
  MarketID?: number;
}

interface ColonisationBeaconPlacedEvent {
  timestamp: string;
  event: 'ColonisationBeaconPlaced';
  StarSystem: string;
  SystemAddress: number;
  MarketID?: number;
  FacilityType?: string;
}

interface ColonisationContributionEvent {
  timestamp: string;
  event: 'ColonisationContribution';
  StarSystem?: string;
  SystemAddress?: number;
  MarketID: number;
  Contributions?: { Name: string; Name_Localised?: string; Amount: number }[];
  Commodities?: { Name: string; Name_Localised?: string; Count: number }[]; // legacy fallback
  Contribution?: number;
}

interface ColonisationFactionContributionEvent {
  timestamp: string;
  event: 'ColonisationFactionContribution';
  StarSystem?: string;
  SystemAddress?: number;
  MarketID?: number;
  Commodities?: { Name: string; Name_Localised?: string; Count: number }[];
  Contribution?: number;
}

// --- Fleet Carrier events ---

interface CarrierJumpEvent {
  timestamp: string;
  event: 'CarrierJump';
  StarSystem: string;
  SystemAddress: number;
  MarketID: number;
  Body?: string;
  StationName?: string;
}

interface CarrierJumpRequestEvent {
  timestamp: string;
  event: 'CarrierJumpRequest';
  CarrierID: number;
  SystemName: string;
  SystemAddress: number;
  Body?: string;
  DepartureTime: string; // ISO timestamp of when the jump will happen
}

interface CarrierJumpCancelledEvent {
  timestamp: string;
  event: 'CarrierJumpCancelled';
  CarrierID: number;
}

interface CarrierStatsEvent {
  timestamp: string;
  event: 'CarrierStats';
  CarrierID: number;
  Callsign: string;
  Name: string;
  FuelLevel?: number;
  JumpRangeCurr?: number;
  JumpRangeMax?: number;
  SpaceUsage?: { TotalCapacity: number; Cargo: number; FreeSpace: number };
}

interface CarrierDepositFuelEvent {
  timestamp: string;
  event: 'CarrierDepositFuel';
  MarketID: number;
  Amount: number;
  Total: number;
}

// --- Exploration events (for future scouting) ---

interface FSSBodySignalsEvent {
  timestamp: string;
  event: 'FSSBodySignals';
  BodyName: string;
  BodyID: number;
  SystemAddress: number;
  Signals: { Type: string; Type_Localised?: string; Count: number }[];
}

interface FSSDiscoveryScanEvent {
  timestamp: string;
  event: 'FSSDiscoveryScan';
  SystemAddress: number;
  SystemName?: string;
  BodyCount: number;
  NonBodyCount?: number;
}

interface ScanEvent {
  timestamp: string;
  event: 'Scan';
  ScanType: string;
  StarSystem?: string;
  SystemAddress?: number;
  BodyName: string;
  BodyID: number;
  DistanceFromArrivalLS: number;
  StarType?: string;
  Subclass?: number;
  StellarMass?: number;
  AbsoluteMagnitude?: number; // Lower = brighter. Sun ≈ 4.83, supergiants can be < -8
  Luminosity?: string; // Yerkes luminosity class: "Ia" to "VII"
  Age_MY?: number; // Age in millions of years
  PlanetClass?: string;
  MassEM?: number;
  Landable?: boolean;
  Atmosphere?: string;
  AtmosphereType?: string;
  Volcanism?: string;
  SurfaceGravity?: number;
  SurfaceTemperature?: number;
  SurfacePressure?: number;
  Radius?: number;
  TerraformState?: string;
  Composition?: Record<string, number>;
  Rings?: { Name: string; RingClass: string; MassMT: number; InnerRad: number; OuterRad: number }[];
  ReserveLevel?: string;
  OrbitalPeriod?: number;
  SemiMajorAxis?: number;
  Parents?: Record<string, number>[];
  WasDiscovered?: boolean;
  WasMapped?: boolean;
  WasFootfalled?: boolean;
}

interface SAAScanCompleteEvent {
  timestamp: string;
  event: 'SAAScanComplete';
  SystemAddress?: number;
  BodyName: string;
  BodyID: number;
  ProbesUsed: number;
  EfficiencyTarget: number;
}

interface FSSAllBodiesFoundEvent {
  timestamp: string;
  event: 'FSSAllBodiesFound';
  SystemAddress: number;
  SystemName?: string;
  Count: number;
}

// Loadout event — fires on login and after ship swap; contains cargo capacity
interface LoadoutEvent {
  timestamp: string;
  event: 'Loadout';
  Ship: string;
  ShipID?: number;
  ShipName?: string;
  ShipIdent?: string;
  CargoCapacity?: number;
}

// ShipyardSwap — fires when changing active ship at a shipyard
interface ShipyardSwapEvent {
  timestamp: string;
  event: 'ShipyardSwap';
  ShipType: string;
  ShipID: number;
  StoreOldShip?: string;
  StoreShipID?: number;
  MarketID?: number;
}

// --- Cargo/Market events ---

interface MarketBuyEvent {
  timestamp: string;
  event: 'MarketBuy';
  MarketID: number;
  Type: string;
  Type_Localised?: string;
  Count: number;
  BuyPrice: number;
  TotalCost: number;
}

interface MarketSellEvent {
  timestamp: string;
  event: 'MarketSell';
  MarketID: number;
  Type: string;
  Type_Localised?: string;
  Count: number;
  SellPrice: number;
  TotalSale: number;
}

interface CargoItem {
  Name: string;
  Name_Localised?: string;
  Count: number;
  Stolen: number;
}

interface CargoEvent {
  timestamp: string;
  event: 'Cargo';
  Vessel: 'Ship' | 'SRV';
  Count: number;
  Inventory?: CargoItem[];
}

interface CargoTransferItem {
  Name: string;
  Name_Localised?: string;
  Count: number;
  Direction: 'toship' | 'tocarrier' | 'tosrv';
}

interface CargoTransferEvent {
  timestamp: string;
  event: 'CargoTransfer';
  Transfers: CargoTransferItem[];
}

// Market.json structure
interface MarketJsonData {
  timestamp: string;
  MarketID: number;
  StationName: string;
  StationType?: string;
  StarSystem?: string;
  Items?: MarketJsonItem[];
}

interface MarketJsonItem {
  id: number;
  Name: string;
  Name_Localised?: string;
  Category: string;
  Category_Localised?: string;
  BuyPrice: number;
  SellPrice: number;
  MeanPrice: number;
  StockBracket: number;
  DemandBracket: number;
  Stock: number;
  Demand: number;
  Consumer: boolean;
  Producer: boolean;
  Rare: boolean;
}

// ===== Public Interfaces =====

export interface DiscoveredDepot {
  marketId: number;
  timestamp: string;
  constructionProgress: number;
  isComplete: boolean;
  isFailed: boolean;
  commodities: ProjectCommodity[];
  systemName?: string;
  systemAddress?: number;
  stationName?: string;
  stationType?: string;
}

export interface ShipCargo {
  timestamp: string;
  items: { commodityId: string; name: string; count: number }[];
}

export interface CarrierCargoEstimate {
  /** Cargo items on this carrier */
  items: { commodityId: string; name: string; count: number }[];
  /** Timestamp of earliest data point */
  earliestTransfer: string;
  /** Timestamp of latest data point */
  latestTransfer: string;
  /** True if from CargoTransfer accumulation (estimate). False if from Market.json (accurate). */
  isEstimate: boolean;
  /** Which carrier this is from */
  carrierCallsign?: string;
}

export interface MultiCarrierCargo {
  myCarrier: CarrierCargoEstimate | null;
  squadronCarriers: { callsign: string; cargo: CarrierCargoEstimate }[];
}

export interface ContributionEvent {
  timestamp: string;
  marketId: number;
  systemName?: string;
  commodities: { name: string; count: number }[];
  totalContribution?: number;
}

export interface ColonisationTimelineEvent {
  type: 'claim' | 'beacon' | 'contribution' | 'depot_update' | 'completed' | 'failed';
  timestamp: string;
  marketId: number;
  systemName?: string;
  data?: Record<string, unknown>;
}

export interface KnowledgeBaseResult {
  systems: KnownSystem[];
  stations: KnownStation[];
  systemAddressMap: Record<number, string>;
  fssSignals: FSSSignal[];
  fleetCarriers: FleetCarrierInfo[];
  /** System names where the commander has made a colonisation claim */
  claimedSystems: string[];
  /** Per-body landing visit data from Touchdown events */
  bodyVisits: BodyVisit[];
}

interface StationInfo {
  systemName: string;
  systemAddress?: number;
  stationName: string;
  stationType: string;
  timestamp: string;
}

// ===== File System Access API =====

let journalDirHandle: FileSystemDirectoryHandle | null = null;

export async function selectJournalFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await window.showDirectoryPicker({
      id: 'ed-journal-folder',
      mode: 'read',
      startIn: 'documents',
    });
    journalDirHandle = handle;
    return handle;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return null;
    }
    throw e;
  }
}

export function getJournalFolderHandle(): FileSystemDirectoryHandle | null {
  return journalDirHandle;
}

export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const permission = await handle.queryPermission({ mode: 'read' });
  if (permission !== 'granted') {
    const requested = await handle.requestPermission({ mode: 'read' });
    if (requested !== 'granted') {
      throw new Error('Permission to read journal folder was denied');
    }
  }
}

async function getJournalFileHandles(
  handle: FileSystemDirectoryHandle
): Promise<{ name: string; handle: FileSystemFileHandle }[]> {
  const journalFiles: { name: string; handle: FileSystemFileHandle; lastModified: number }[] = [];
  for await (const [name, entryHandle] of handle.entries()) {
    if (entryHandle.kind === 'file' && name.startsWith('Journal.') && name.endsWith('.log')) {
      const fh = entryHandle as FileSystemFileHandle;
      const f = await fh.getFile();
      journalFiles.push({ name, handle: fh, lastModified: f.lastModified });
    }
  }
  // Sort by modification time so latest data naturally overwrites older entries
  // (name-based sort breaks when old-format YYMMDD and new-format YYYY-MM-DD coexist)
  journalFiles.sort((a, b) => a.lastModified - b.lastModified);
  return journalFiles;
}

// ===== Planetary Landing Events =====

interface TouchdownEvent {
  timestamp: string;
  event: 'Touchdown';
  StarSystem: string;
  SystemAddress: number;
  Body: string;
  BodyID: number;
  Latitude: number;
  Longitude: number;
  PlayerControlled?: boolean;
  NearestDestination?: string;
  FirstFootFall?: boolean;
}

interface LiftoffEvent {
  timestamp: string;
  event: 'Liftoff';
  StarSystem: string;
  SystemAddress: number;
  Body: string;
  BodyID: number;
  PlayerControlled?: boolean;
}

// --- Combat events (for journal history stats) ---

interface BountyEvent {
  timestamp: string;
  event: 'Bounty';
  Rewards?: { Faction: string; Reward: number }[];
  TotalReward: number;
  VictimFaction?: string;
  Target?: string;
}

interface FactionKillBondEvent {
  timestamp: string;
  event: 'FactionKillBond';
  Reward: number;
  AwardingFaction?: string;
  VictimFaction?: string;
}

interface DiedEvent {
  timestamp: string;
  event: 'Died';
  KillerName?: string;
  KillerShip?: string;
  KillerRank?: string;
  Killers?: { Name: string; Ship: string; Rank: string }[];
}

interface InterdictedEvent {
  timestamp: string;
  event: 'Interdicted';
  Submitted: boolean;
  Interdictor?: string;
  IsPlayer: boolean;
}

// --- Exploration payout events ---

interface SellExplorationDataEvent {
  timestamp: string;
  event: 'SellExplorationData';
  Systems?: string[];
  Discovered?: string[];
  BaseValue: number;
  Bonus: number;
  TotalEarnings: number;
}

interface MultiSellExplorationDataEvent {
  timestamp: string;
  event: 'MultiSellExplorationData';
  Discovered?: { SystemName: string; NumBodies: number }[];
  BaseValue: number;
  Bonus: number;
  TotalEarnings: number;
}

// --- Mission events ---

interface MissionCompletedEvent {
  timestamp: string;
  event: 'MissionCompleted';
  Name: string;
  Faction?: string;
  Reward?: number;
  Commodity?: string;
  Count?: number;
}

// --- Statistics event (written at game start) ---

interface StatisticsEvent {
  timestamp: string;
  event: 'Statistics';
  Bank_Account?: { Current_Wealth: number; Spent_On_Ships: number; Spent_On_Outfitting: number; Spent_On_Insurance: number };
  Combat?: { Bounties_Claimed: number; Bounty_Hunting_Profit: number; Combat_Bonds: number; Combat_Bond_Profits: number; Assassinations: number; Assassination_Profits: number };
  Crime?: { Fines: number; Total_Fines: number; Bounties_Received: number; Total_Bounties: number };
  Smuggling?: { Black_Markets_Traded_With: number; Black_Markets_Profits: number; Resources_Smuggled: number };
  Trading?: { Markets_Traded_With: number; Market_Profits: number; Resources_Traded: number; Average_Profit: number };
  Mining?: { Mining_Profits: number; Quantity_Mined: number; Materials_Collected: number };
  Exploration?: { Systems_Visited: number; Exploration_Profits: number; Planets_Scanned_To_Level_2: number; Planets_Scanned_To_Level_3: number; Highest_Payout: number; Total_Hyperspace_Distance: number; Total_Hyperspace_Jumps: number; Greatest_Distance_From_Start: number; Time_Played: number; Efficient_Scans: number };
  Passengers?: { Passengers_Missions_Accepted: number; Passengers_Missions_Delivered: number };
  Search_And_Rescue?: { SearchRescue_Traded: number; SearchRescue_Profit: number; SearchRescue_Count: number };
  Crafting?: { Count_Of_Used_Engineers: number; Recipes_Generated: number; Recipes_Generated_Rank_1: number; Recipes_Generated_Rank_2: number; Recipes_Generated_Rank_3: number; Recipes_Generated_Rank_4: number; Recipes_Generated_Rank_5: number };
  Multicrew?: { Multicrew_Time_Total: number; Multicrew_Gunner_Time_Total: number; Multicrew_Fighter_Time_Total: number; Multicrew_Credits_Total: number; Multicrew_Fines_Total: number };
}

// ===== Parsing =====

export function parseJournalLines(lines: string[]) {
  const depotEvents: ColonisationConstructionDepotEvent[] = [];
  const dockedEvents: DockedEvent[] = [];
  const locationEvents: LocationEvent[] = [];
  const cargoEvents: CargoEvent[] = [];
  const cargoTransferEvents: CargoTransferEvent[] = [];
  const fsdJumpEvents: FSDJumpEvent[] = [];
  const fssSignalEvents: FSSSignalDiscoveredEvent[] = [];
  const supercruiseEntryEvents: SupercruiseEntryEvent[] = [];
  const supercruiseDestDropEvents: SupercruiseDestDropEvent[] = [];
  // Colonisation lifecycle
  const systemClaimEvents: ColonisationSystemClaimEvent[] = [];
  const beaconPlacedEvents: ColonisationBeaconPlacedEvent[] = [];
  const contributionEvents: ColonisationContributionEvent[] = [];
  const factionContributionEvents: ColonisationFactionContributionEvent[] = [];
  // Fleet Carrier
  const carrierJumpEvents: CarrierJumpEvent[] = [];
  const carrierJumpRequestEvents: CarrierJumpRequestEvent[] = [];
  const carrierJumpCancelledEvents: CarrierJumpCancelledEvent[] = [];
  const carrierStatsEvents: CarrierStatsEvent[] = [];
  const carrierDepositFuelEvents: CarrierDepositFuelEvent[] = [];
  // Exploration
  const fssDiscoveryScanEvents: FSSDiscoveryScanEvent[] = [];
  const fssBodySignalsEvents: FSSBodySignalsEvent[] = [];
  const fssAllBodiesFoundEvents: FSSAllBodiesFoundEvent[] = [];
  const scanEvents: ScanEvent[] = [];
  const saaScanCompleteEvents: SAAScanCompleteEvent[] = [];
  // Ship
  const loadoutEvents: LoadoutEvent[] = [];
  const shipyardSwapEvents: ShipyardSwapEvent[] = [];
  // Market
  const marketBuyEvents: MarketBuyEvent[] = [];
  const marketSellEvents: MarketSellEvent[] = [];
  // Planetary landings
  const touchdownEvents: TouchdownEvent[] = [];
  const liftoffEvents: LiftoffEvent[] = [];
  // Chat
  const sendTextEvents: { timestamp: string; event: 'SendText'; Message: string }[] = [];
  // Combat
  const bountyEvents: BountyEvent[] = [];
  const factionKillBondEvents: FactionKillBondEvent[] = [];
  const diedEvents: DiedEvent[] = [];
  const interdictedEvents: InterdictedEvent[] = [];
  // Exploration payouts
  const sellExplorationDataEvents: SellExplorationDataEvent[] = [];
  const multiSellExplorationDataEvents: MultiSellExplorationDataEvent[] = [];
  // Missions
  const missionCompletedEvents: MissionCompletedEvent[] = [];
  // Statistics (game-generated lifetime stats)
  const statisticsEvents: StatisticsEvent[] = [];
  // Galaxy-map targeting
  const fsdTargetEvents: FSDTargetEvent[] = [];
  const navRouteEvents: NavRouteEvent[] = [];
  const navRouteClearEvents: NavRouteClearEvent[] = [];
  const dockingGrantedEvents: DockingGrantedEvent[] = [];
  const supercruiseExitEvents: SupercruiseExitEvent[] = [];
  const receiveTextEvents: ReceiveTextEvent[] = [];
  const undockedEvents: UndockedEvent[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      switch (event.event) {
        case 'ColonisationConstructionDepot':
          depotEvents.push(event as ColonisationConstructionDepotEvent);
          break;
        case 'ColonisationSystemClaim':
          systemClaimEvents.push(event as ColonisationSystemClaimEvent);
          break;
        case 'ColonisationBeaconPlaced':
          beaconPlacedEvents.push(event as ColonisationBeaconPlacedEvent);
          break;
        case 'ColonisationContribution':
          contributionEvents.push(event as ColonisationContributionEvent);
          break;
        case 'ColonisationFactionContribution':
          factionContributionEvents.push(event as ColonisationFactionContributionEvent);
          break;
        case 'Docked':
          dockedEvents.push(event as DockedEvent);
          break;
        case 'Location':
          locationEvents.push(event as LocationEvent);
          break;
        case 'Cargo':
          cargoEvents.push(event as CargoEvent);
          break;
        case 'CargoTransfer':
          cargoTransferEvents.push(event as CargoTransferEvent);
          break;
        case 'FSDJump':
          fsdJumpEvents.push(event as FSDJumpEvent);
          break;
        case 'FSSSignalDiscovered':
          fssSignalEvents.push(event as FSSSignalDiscoveredEvent);
          break;
        case 'FSSDiscoveryScan':
          fssDiscoveryScanEvents.push(event as FSSDiscoveryScanEvent);
          break;
        case 'FSSBodySignals':
          fssBodySignalsEvents.push(event as FSSBodySignalsEvent);
          break;
        case 'FSSAllBodiesFound':
          fssAllBodiesFoundEvents.push(event as FSSAllBodiesFoundEvent);
          break;
        case 'Scan':
          scanEvents.push(event as ScanEvent);
          break;
        case 'SAAScanComplete':
          saaScanCompleteEvents.push(event as SAAScanCompleteEvent);
          break;
        // Loadout fires on login and after ship swap — tracks cargo capacity
        case 'Loadout':
          loadoutEvents.push(event as LoadoutEvent);
          break;
        // ShipyardSwap fires when changing active ship at a shipyard
        case 'ShipyardSwap':
          shipyardSwapEvents.push(event as ShipyardSwapEvent);
          break;
        case 'SupercruiseEntry':
          supercruiseEntryEvents.push(event as SupercruiseEntryEvent);
          break;
        case 'SupercruiseDestinationDrop':
          supercruiseDestDropEvents.push(event as SupercruiseDestDropEvent);
          break;
        case 'CarrierJump':
          carrierJumpEvents.push(event as CarrierJumpEvent);
          break;
        case 'CarrierJumpRequest':
          carrierJumpRequestEvents.push(event as CarrierJumpRequestEvent);
          break;
        case 'CarrierJumpCancelled':
          carrierJumpCancelledEvents.push(event as CarrierJumpCancelledEvent);
          break;
        case 'CarrierStats':
          carrierStatsEvents.push(event as CarrierStatsEvent);
          break;
        case 'CarrierDepositFuel':
          carrierDepositFuelEvents.push(event as CarrierDepositFuelEvent);
          break;
        case 'MarketBuy':
          marketBuyEvents.push(event as MarketBuyEvent);
          break;
        case 'MarketSell':
          marketSellEvents.push(event as MarketSellEvent);
          break;
        case 'Touchdown':
          touchdownEvents.push(event as TouchdownEvent);
          break;
        case 'Liftoff':
          liftoffEvents.push(event as LiftoffEvent);
          break;
        case 'SendText':
          sendTextEvents.push(event);
          break;
        case 'Bounty':
          bountyEvents.push(event as BountyEvent);
          break;
        case 'FactionKillBond':
          factionKillBondEvents.push(event as FactionKillBondEvent);
          break;
        case 'Died':
          diedEvents.push(event as DiedEvent);
          break;
        case 'Interdicted':
          interdictedEvents.push(event as InterdictedEvent);
          break;
        case 'SellExplorationData':
          sellExplorationDataEvents.push(event as SellExplorationDataEvent);
          break;
        case 'MultiSellExplorationData':
          multiSellExplorationDataEvents.push(event as MultiSellExplorationDataEvent);
          break;
        case 'MissionCompleted':
          missionCompletedEvents.push(event as MissionCompletedEvent);
          break;
        case 'Statistics':
          statisticsEvents.push(event as StatisticsEvent);
          break;
        case 'FSDTarget':
          fsdTargetEvents.push(event as FSDTargetEvent);
          break;
        case 'NavRoute':
          navRouteEvents.push(event as NavRouteEvent);
          break;
        case 'NavRouteClear':
          navRouteClearEvents.push(event as NavRouteClearEvent);
          break;
        case 'DockingGranted':
          dockingGrantedEvents.push(event as DockingGrantedEvent);
          break;
        case 'SupercruiseExit':
          supercruiseExitEvents.push(event as SupercruiseExitEvent);
          break;
        case 'ReceiveText':
          receiveTextEvents.push(event as ReceiveTextEvent);
          break;
        case 'Undocked':
          undockedEvents.push(event as UndockedEvent);
          break;
      }
    } catch {
      // Skip malformed lines
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
    // New events
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
    fsdTargetEvents,
    navRouteEvents,
    navRouteClearEvents,
    dockingGrantedEvents,
    supercruiseExitEvents,
    receiveTextEvents,
    undockedEvents,
  };
}

// ===== Fleet Carrier Helpers =====

/** Fleet Carrier MarketIDs are >= 3700000000 */
export function isFleetCarrierMarketId(marketId: number): boolean {
  return marketId >= 3700000000;
}

/** Fleet Carrier callsigns match pattern XXX-XXX */
const FC_CALLSIGN_REGEX = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
export function isFleetCarrierCallsign(name: string): boolean {
  return FC_CALLSIGN_REGEX.test(name);
}

/** Check if a station is a Fleet Carrier by type or market ID */
export function isFleetCarrier(stationType?: string, marketId?: number): boolean {
  if (stationType === 'FleetCarrier') return true;
  // If we know the station type and it's not a FC, trust that over market ID range
  if (stationType && stationType !== 'FleetCarrier') return false;
  if (marketId && isFleetCarrierMarketId(marketId)) return true;
  return false;
}

/**
 * Ephemeral dock = not a "place you visit" in the narrative sense:
 *  - Fleet carriers (mobile)
 *  - Trailblazer ships (NPC colonization helpers)
 *  - Colonisation ships ($EXT_PANEL_ColonisationShip; prefix or "Colonisation Ship" in name)
 *  - Construction sites (replaced by the finished station once built)
 * Excluded from dock dossiers, most-visited stats, and rank computation.
 */
export function isEphemeralStation(stationName?: string, stationType?: string, marketId?: number): boolean {
  if (isFleetCarrier(stationType, marketId)) return true;
  if (!stationName) return false;
  if (/^Trailblazer /i.test(stationName)) return true;
  if (/Colonisation Ship/i.test(stationName)) return true;
  if (/\$EXT_PANEL_ColonisationShip/i.test(stationName)) return true;
  if (/Construction Site/i.test(stationName)) return true;
  return false;
}

/** Classify a fleet carrier as mine, squadron, or other */
export function classifyFleetCarrier(
  stationName: string,
  marketId: number,
  myCallsign: string,
  myMarketId: number | null,
  squadronCallsigns: string[]
): FleetCarrierInfo['ownership'] {
  if (myCallsign && stationName === myCallsign) return 'mine';
  if (myMarketId && marketId === myMarketId) return 'mine';
  if (squadronCallsigns.some((cs) => cs === stationName)) return 'squadron';
  return 'other';
}

// ===== Construction / Colonisation Ship Detection =====

/** Check if a station name indicates it's still under construction */
export function isConstructionStationName(stationName: string): boolean {
  return /construction/i.test(stationName);
}

/** Check if a station name/type is a colonisation ship (temporary during colonization) */
export function isColonisationShip(stationName: string, stationType?: string): boolean {
  if (stationType === 'ColonisationShip') return true;
  return /\$EXT_PANEL_ColonisationShip/i.test(stationName) || /colonisation\s*ship/i.test(stationName);
}

// ===== Station Info Map (for depot enrichment) =====

function buildStationInfoMap(
  dockedEvents: DockedEvent[],
  locationEvents: LocationEvent[]
): Map<number, StationInfo> {
  const map = new Map<number, StationInfo>();

  for (const ev of locationEvents) {
    if (ev.MarketID && ev.Docked && ev.StationName) {
      const existing = map.get(ev.MarketID);
      if (!existing || ev.timestamp > existing.timestamp) {
        map.set(ev.MarketID, {
          systemName: ev.StarSystem,
          systemAddress: ev.SystemAddress,
          stationName: ev.StationName,
          stationType: ev.StationType || '',
          timestamp: ev.timestamp,
        });
      }
    }
  }

  for (const ev of dockedEvents) {
    const existing = map.get(ev.MarketID);
    if (!existing || ev.timestamp > existing.timestamp) {
      map.set(ev.MarketID, {
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        stationName: ev.StationName,
        stationType: ev.StationType,
        timestamp: ev.timestamp,
      });
    }
  }

  return map;
}

// ===== Commodity Conversion =====

export function resourceToCommodity(r: JournalResourceRequired): ProjectCommodity {
  const known = findCommodityByJournalName(r.Name);
  const rawName = r.Name || 'unknown';
  return {
    commodityId: known?.id || rawName.replace(/[$;_name]/g, '').toLowerCase(),
    name: r.Name_Localised || rawName.replace(/[$;]/g, ''),
    requiredQuantity: r.RequiredAmount,
    providedQuantity: r.ProvidedAmount,
  };
}

// ===== Knowledge Base Extraction =====

/**
 * Extract a full knowledge base from all parsed journal events.
 * This builds KnownSystem, KnownStation, systemAddress mappings,
 * FSS signals, and fleet carrier identifications.
 */
export function extractKnowledgeBaseFromEvents(parsed: {
  dockedEvents: DockedEvent[];
  locationEvents: LocationEvent[];
  fsdJumpEvents: FSDJumpEvent[];
  fssSignalEvents: FSSSignalDiscoveredEvent[];
  supercruiseEntryEvents: SupercruiseEntryEvent[];
  systemClaimEvents?: ColonisationSystemClaimEvent[];
  touchdownEvents?: TouchdownEvent[];
}, settings: { myFleetCarrier: string; myFleetCarrierMarketId: number | null; squadronCarrierCallsigns: string[] }): KnowledgeBaseResult {
  const systemsMap = new Map<string, KnownSystem>(); // keyed by lowercase system name
  const stationsMap = new Map<number, KnownStation>(); // keyed by marketId
  const addressMap: Record<number, string> = {};
  const fssSignals: FSSSignal[] = [];
  const fcMap = new Map<string, FleetCarrierInfo>(); // keyed by callsign

  // --- Count visits: FSDJump per system, Docked per station ---
  const systemVisitCounts = new Map<string, number>(); // keyed by lowercase system name
  for (const ev of parsed.fsdJumpEvents) {
    const key = ev.StarSystem.toLowerCase();
    systemVisitCounts.set(key, (systemVisitCounts.get(key) || 0) + 1);
  }
  const stationVisitCounts = new Map<number, number>(); // keyed by marketId
  for (const ev of parsed.dockedEvents) {
    stationVisitCounts.set(ev.MarketID, (stationVisitCounts.get(ev.MarketID) || 0) + 1);
  }

  // --- Process FSDJump events (system info + coordinates) ---
  for (const ev of parsed.fsdJumpEvents) {
    const key = ev.StarSystem.toLowerCase();
    addressMap[ev.SystemAddress] = ev.StarSystem;

    const existing = systemsMap.get(key);
    if (!existing || ev.timestamp > existing.lastSeen) {
      systemsMap.set(key, {
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        population: ev.Population ?? existing?.population ?? 0,
        economy: ev.SystemEconomy_Localised || ev.SystemEconomy || existing?.economy || 'Unknown',
        economyLocalised: ev.SystemEconomy_Localised || ev.SystemEconomy || existing?.economyLocalised || 'Unknown',
        secondEconomy: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || existing?.secondEconomy,
        secondEconomyLocalised: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || existing?.secondEconomyLocalised,
        coordinates: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : existing?.coordinates,
        visitCount: systemVisitCounts.get(key),
        lastSeen: ev.timestamp,
      });
    }
  }

  // --- Process Location events (system info, may include station if docked) ---
  for (const ev of parsed.locationEvents) {
    const key = ev.StarSystem.toLowerCase();
    addressMap[ev.SystemAddress] = ev.StarSystem;

    const existing = systemsMap.get(key);
    if (!existing || ev.timestamp > existing.lastSeen) {
      systemsMap.set(key, {
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        population: ev.Population ?? existing?.population ?? 0,
        economy: ev.SystemEconomy_Localised || ev.SystemEconomy || existing?.economy || 'Unknown',
        economyLocalised: ev.SystemEconomy_Localised || ev.SystemEconomy || existing?.economyLocalised || 'Unknown',
        secondEconomy: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || existing?.secondEconomy,
        secondEconomyLocalised: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || existing?.secondEconomyLocalised,
        coordinates: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : existing?.coordinates,
        visitCount: existing?.visitCount ?? systemVisitCounts.get(key),
        lastSeen: ev.timestamp,
      });
    }

    // If docked at a station, record station info
    if (ev.Docked && ev.MarketID && ev.StationName && ev.StationType) {
      const economies: StationEconomy[] = (ev.StationEconomies || []).map((e) => ({
        name: e.Name,
        nameLocalised: e.Name_Localised || e.Name,
        proportion: e.Proportion,
      }));

      const existingSt = stationsMap.get(ev.MarketID);
      if (!existingSt || ev.timestamp > existingSt.lastSeen) {
        stationsMap.set(ev.MarketID, {
          stationName: ev.StationName,
          stationType: ev.StationType,
          marketId: ev.MarketID,
          systemName: ev.StarSystem,
          systemAddress: ev.SystemAddress,
          body: ev.Body,
          bodyType: ev.BodyType,
          distFromStarLS: ev.DistFromStarLS ?? null,
          landingPads: ev.LandingPads ? { small: ev.LandingPads.Small, medium: ev.LandingPads.Medium, large: ev.LandingPads.Large } : null,
          economies,
          services: ev.StationServices || [],
          faction: ev.StationFaction?.Name,
          visitCount: existingSt?.visitCount ?? stationVisitCounts.get(ev.MarketID),
          lastSeen: ev.timestamp,
        });
      }

      // FC detection from Location
      if (isFleetCarrier(ev.StationType, ev.MarketID) && isFleetCarrierCallsign(ev.StationName)) {
        const ownership = classifyFleetCarrier(ev.StationName, ev.MarketID, settings.myFleetCarrier, settings.myFleetCarrierMarketId, settings.squadronCarrierCallsigns);
        fcMap.set(ev.StationName, { callsign: ev.StationName, marketId: ev.MarketID, ownership });
      }
    }
  }

  // --- Process Docked events (station details) ---
  for (const ev of parsed.dockedEvents) {
    addressMap[ev.SystemAddress] = ev.StarSystem;

    const economies: StationEconomy[] = (ev.StationEconomies || []).map((e) => ({
      name: e.Name,
      nameLocalised: e.Name_Localised || e.Name,
      proportion: e.Proportion,
    }));

    const existingSt = stationsMap.get(ev.MarketID);
    if (!existingSt || ev.timestamp > existingSt.lastSeen) {
      stationsMap.set(ev.MarketID, {
        stationName: ev.StationName,
        stationType: ev.StationType,
        marketId: ev.MarketID,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        body: ev.Body,
        bodyType: ev.BodyType,
        distFromStarLS: ev.DistFromStarLS ?? null,
        landingPads: ev.LandingPads ? { small: ev.LandingPads.Small, medium: ev.LandingPads.Medium, large: ev.LandingPads.Large } : null,
        economies,
        services: ev.StationServices || [],
        faction: ev.StationFaction?.Name,
        visitCount: stationVisitCounts.get(ev.MarketID),
        lastSeen: ev.timestamp,
      });
    }

    // Update address map from Docked but do NOT create system entries —
    // FSDJump/Location events handle system creation with full data (coordinates, population, economy).
    // Creating bare entries from Docked was clobbering coordinates when events landed in separate batches.

    // FC detection from Docked
    if (isFleetCarrier(ev.StationType, ev.MarketID) && isFleetCarrierCallsign(ev.StationName)) {
      const ownership = classifyFleetCarrier(ev.StationName, ev.MarketID, settings.myFleetCarrier, settings.myFleetCarrierMarketId, settings.squadronCarrierCallsigns);
      fcMap.set(ev.StationName, { callsign: ev.StationName, marketId: ev.MarketID, ownership });
    }
  }

  // --- Process SupercruiseEntry events (address mapping only) ---
  for (const ev of parsed.supercruiseEntryEvents) {
    addressMap[ev.SystemAddress] = ev.StarSystem;
  }

  // --- Process FSSSignalDiscovered events ---
  for (const ev of parsed.fssSignalEvents) {
    fssSignals.push({
      signalName: ev.SignalName_Localised || ev.SignalName,
      signalType: ev.SignalType || '',
      isStation: ev.IsStation ?? false,
      systemAddress: ev.SystemAddress,
      timestamp: ev.timestamp,
    });
  }

  // --- Process Touchdown events → body visits ---
  const bodyVisitsMap = new Map<string, BodyVisit>(); // keyed by "systemAddress|bodyName"
  for (const ev of (parsed.touchdownEvents || [])) {
    // Skip ship-recall landings (not player-controlled)
    if (ev.PlayerControlled === false) continue;
    const key = `${ev.SystemAddress}|${ev.Body}`;
    const existing = bodyVisitsMap.get(key);
    if (existing) {
      existing.landingCount += 1;
      if (ev.timestamp > existing.lastLanded) {
        existing.lastLanded = ev.timestamp;
        existing.lastCoords = { lat: ev.Latitude, lon: ev.Longitude };
      }
    } else {
      bodyVisitsMap.set(key, {
        bodyName: ev.Body,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        landingCount: 1,
        lastLanded: ev.timestamp,
        lastCoords: { lat: ev.Latitude, lon: ev.Longitude },
      });
    }
  }

  return {
    systems: Array.from(systemsMap.values()),
    stations: Array.from(stationsMap.values()),
    systemAddressMap: addressMap,
    fssSignals,
    fleetCarriers: Array.from(fcMap.values()),
    claimedSystems: [...new Set((parsed.systemClaimEvents || []).map((e) => e.StarSystem))],
    bodyVisits: Array.from(bodyVisitsMap.values()),
  };
}

/**
 * Read all journal files and extract the full knowledge base.
 */
export async function extractKnowledgeBase(
  settings: { myFleetCarrier: string; myFleetCarrierMarketId: number | null; squadronCarrierCallsigns: string[] },
  dirHandle?: FileSystemDirectoryHandle
): Promise<KnowledgeBaseResult> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) {
    throw new Error('No journal folder selected');
  }

  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);

  const allDocked: DockedEvent[] = [];
  const allLocation: LocationEvent[] = [];
  const allFSDJump: FSDJumpEvent[] = [];
  const allFSSSignal: FSSSignalDiscoveredEvent[] = [];
  const allSupercruiseEntry: SupercruiseEntryEvent[] = [];
  const allSystemClaims: ColonisationSystemClaimEvent[] = [];
  const allTouchdown: TouchdownEvent[] = [];

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const result = parseJournalLines(lines);
    allDocked.push(...result.dockedEvents);
    allLocation.push(...result.locationEvents);
    allFSDJump.push(...result.fsdJumpEvents);
    allFSSSignal.push(...result.fssSignalEvents);
    allSupercruiseEntry.push(...result.supercruiseEntryEvents);
    allSystemClaims.push(...result.systemClaimEvents);
    allTouchdown.push(...result.touchdownEvents);
  }

  return extractKnowledgeBaseFromEvents({
    dockedEvents: allDocked,
    locationEvents: allLocation,
    fsdJumpEvents: allFSDJump,
    fssSignalEvents: allFSSSignal,
    supercruiseEntryEvents: allSupercruiseEntry,
    systemClaimEvents: allSystemClaims,
    touchdownEvents: allTouchdown,
  }, settings);
}

// ===== Market.json Reading =====

/**
 * Read Market.json from the journal folder.
 * This file is updated when docking at a station with a market.
 */
export async function readMarketJson(
  dirHandle?: FileSystemDirectoryHandle
): Promise<MarketSnapshot | null> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) return null;

  try {
    await ensurePermission(handle);
    const fileHandle = await handle.getFileHandle('Market.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data: MarketJsonData = JSON.parse(text);

    if (!data.Items || data.Items.length === 0) return null;

    const items: MarketItem[] = data.Items.filter((item) => item.Name).map((item) => ({
      name: item.Name,
      nameLocalised: item.Name_Localised,
      buyPrice: item.BuyPrice,
      sellPrice: item.SellPrice,
      stock: item.Stock,
      demand: item.Demand,
      category: item.Category_Localised || item.Category || '',
    }));

    return {
      marketId: data.MarketID,
      stationName: data.StationName,
      systemName: data.StarSystem,
      items,
      timestamp: data.timestamp,
    };
  } catch {
    // Market.json may not exist or may be empty
    return null;
  }
}

/**
 * Read NavRoute.json — the full plotted route list. Fires whenever the
 * in-game route plotter completes or updates.
 */
export interface NavRouteStop {
  StarSystem: string;
  SystemAddress: number;
  StarPos: [number, number, number];
  StarClass: string;
}

export async function readNavRouteJson(
  dirHandle?: FileSystemDirectoryHandle,
): Promise<{ timestamp: string; route: NavRouteStop[] } | null> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) return null;
  try {
    await ensurePermission(handle);
    const fileHandle = await handle.getFileHandle('NavRoute.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data: { timestamp: string; event: string; Route?: NavRouteStop[] } = JSON.parse(text);
    if (!data.Route || data.Route.length === 0) return null;
    return { timestamp: data.timestamp, route: data.Route };
  } catch {
    return null;
  }
}

/**
 * Read Market.json and build a PersistedMarketSnapshot with colonisation-relevant commodities.
 * Also uses the latest Docked event to get station metadata (type, pads).
 * Returns the snapshot and station name, or null if Market.json is unavailable.
 */
export async function readMarketSnapshot(
  dirHandle?: FileSystemDirectoryHandle,
): Promise<PersistedMarketSnapshot | null> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) return null;

  const market = await readMarketJson(handle);
  if (!market || !market.items || market.items.length === 0) return null;

  // Find colonisation-relevant commodities actually for sale (stock > 0 and buyPrice > 0)
  const commodities: PersistedMarketCommodity[] = [];
  for (const item of market.items) {
    if (item.stock <= 0 || item.buyPrice <= 0) continue;
    const def = findCommodityByDisplayName(item.nameLocalised || item.name)
      ?? findCommodityByDisplayName(item.name)
      ?? findCommodityByJournalName(`$${(item.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
    if (!def) continue;
    commodities.push({
      commodityId: def.id,
      name: def.name,
      buyPrice: item.buyPrice,
      stock: item.stock,
    });
  }

  // Get station metadata from the latest Docked event matching this MarketID
  let stationType = '';
  let isPlanetary = false;
  let hasLargePads = false;
  const systemName = market.systemName || '';

  try {
    const journalFiles = await getJournalFileHandles(handle);
    // Read the most recent journal files (last 3) for the Docked event
    const recentFiles = journalFiles.slice(-3);
    for (const jf of recentFiles) {
      const file = await jf.handle.getFile();
      const text = await file.text();
      const lines = text.split('\n');
      const { dockedEvents } = parseJournalLines(lines);
      for (const ev of dockedEvents) {
        if (ev.MarketID === market.marketId) {
          stationType = ev.StationType || '';
          isPlanetary = PLANETARY_STATION_TYPES.has(stationType);
          hasLargePads = ev.LandingPads
            ? (ev.LandingPads.Large ?? 0) > 0
            : inferHasLargePads(stationType);
        }
      }
    }
  } catch {
    // If we can't read journal files, proceed with what we have
  }

  // If we have a station type but couldn't determine pads, infer from type
  if (!hasLargePads && stationType) {
    hasLargePads = inferHasLargePads(stationType);
  }

  return {
    marketId: market.marketId,
    stationName: market.stationName,
    systemName,
    stationType,
    isPlanetary,
    hasLargePads,
    commodities,
    updatedAt: market.timestamp || new Date().toISOString(),
  };
}

// ===== Original Scanning Functions =====

/**
 * Read all journal files and extract ColonisationConstructionDepot events.
 * Returns the latest event per MarketID, enriched with system/station names.
 */
export async function scanJournalFiles(
  dirHandle?: FileSystemDirectoryHandle
): Promise<DiscoveredDepot[]> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) {
    throw new Error('No journal folder selected');
  }

  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);

  const allDepotEvents: ColonisationConstructionDepotEvent[] = [];
  const allDockedEvents: DockedEvent[] = [];
  const allLocationEvents: LocationEvent[] = [];

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const { depotEvents, dockedEvents, locationEvents } = parseJournalLines(lines);
    allDepotEvents.push(...depotEvents);
    allDockedEvents.push(...dockedEvents);
    allLocationEvents.push(...locationEvents);
  }

  const stationMap = buildStationInfoMap(allDockedEvents, allLocationEvents);

  // Group depot events by MarketID, keep latest
  const latestByMarketId = new Map<number, ColonisationConstructionDepotEvent>();
  for (const depot of allDepotEvents) {
    const existing = latestByMarketId.get(depot.MarketID);
    if (!existing || depot.timestamp > existing.timestamp) {
      latestByMarketId.set(depot.MarketID, depot);
    }
  }

  return Array.from(latestByMarketId.values()).map((depot) => {
    const stationInfo = stationMap.get(depot.MarketID);
    return {
      marketId: depot.MarketID,
      timestamp: depot.timestamp,
      constructionProgress: depot.ConstructionProgress,
      isComplete: depot.ConstructionComplete,
      isFailed: depot.ConstructionFailed,
      commodities: depot.ResourcesRequired.map(resourceToCommodity),
      systemName: stationInfo?.systemName,
      systemAddress: stationInfo?.systemAddress,
      stationName: stationInfo?.stationName,
      stationType: stationInfo?.stationType,
    };
  });
}

/**
 * Scan for a specific MarketID and return the latest depot data
 */
export async function scanForMarketId(
  marketId: number,
  dirHandle?: FileSystemDirectoryHandle
): Promise<DiscoveredDepot | null> {
  const depots = await scanJournalFiles(dirHandle);
  return depots.find((d) => d.marketId === marketId) || null;
}

// ===== Visited Market Discovery =====

export interface CommodityPriceInfo {
  buyPrice: number;
  lastSeen: string; // ISO timestamp
}

export interface VisitedMarket {
  marketId: number;
  stationName: string;
  systemName: string;
  stationType: string;
  isPlanetary: boolean;
  hasLargePads: boolean;
  commodities: string[]; // commodity IDs (colonisation-relevant only)
  /** Per-commodity buy price from most recent MarketBuy event */
  commodityPrices: Record<string, CommodityPriceInfo>;
  lastVisited: string;   // ISO timestamp
}

const PLANETARY_STATION_TYPES = new Set([
  'CraterOutpost', 'CraterPort', 'OnFootSettlement', 'SurfaceStation',
  'PlanetaryOutpost', 'PlanetaryPort', 'SurfaceOutpost',
  'PlanetaryConstructionDepot', 'SurfaceConstructionDepot',
]);

/**
 * Scan journal files to discover stations where the user has bought colonisation commodities.
 * Cross-references Docked events (station metadata) with MarketBuy events (what was purchased).
 */
export async function scanForVisitedMarkets(
  dirHandle?: FileSystemDirectoryHandle,
): Promise<VisitedMarket[]> {
  const handle = dirHandle ?? getJournalFolderHandle();
  if (!handle) return [];

  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);

  const allDockedEvents: DockedEvent[] = [];
  const allMarketBuyEvents: MarketBuyEvent[] = [];

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const { dockedEvents, marketBuyEvents } = parseJournalLines(lines);
    allDockedEvents.push(...dockedEvents);
    allMarketBuyEvents.push(...marketBuyEvents);
  }

  // Build station metadata map from Docked events (latest per marketId)
  const stationMap = new Map<number, DockedEvent>();
  for (const ev of allDockedEvents) {
    const existing = stationMap.get(ev.MarketID);
    if (!existing || ev.timestamp > existing.timestamp) {
      stationMap.set(ev.MarketID, ev);
    }
  }

  // Build commodity map per marketId from MarketBuy events
  const commodityMap = new Map<number, { commodities: Set<string>; lastBuy: string; prices: Record<string, CommodityPriceInfo> }>();
  for (const buy of allMarketBuyEvents) {
    // Match journal commodity name to our colonisation commodity list
    // Journal Type field can be either "$cmmcomposite_name;" (journal name) or "CMM Composite" (display name).
    // When it's a display name, strip spaces before building journal-style key (e.g. "CMM Composite" → "$cmmcomposite_name;")
    const journalName = buy.Type.startsWith('$')
      ? buy.Type.toLowerCase()
      : `$${buy.Type.replace(/\s+/g, '').toLowerCase()}_name;`;
    const def = findCommodityByJournalName(journalName) ?? findCommodityByDisplayName(buy.Type);
    if (!def) continue; // Not a colonisation commodity

    let entry = commodityMap.get(buy.MarketID);
    if (!entry) {
      entry = { commodities: new Set(), lastBuy: buy.timestamp, prices: {} };
      commodityMap.set(buy.MarketID, entry);
    }
    entry.commodities.add(def.id);
    if (buy.timestamp > entry.lastBuy) entry.lastBuy = buy.timestamp;

    // Track most recent price per commodity
    const existing = entry.prices[def.id];
    if (!existing || buy.timestamp > existing.lastSeen) {
      entry.prices[def.id] = { buyPrice: buy.BuyPrice, lastSeen: buy.timestamp };
    }
  }

  // Also read Market.json for the currently docked station — this has the FULL commodity list
  // (not just what was bought). Market.json is overwritten each time you dock.
  try {
    const market = await readMarketJson(handle);
    if (market && market.items) {
      const station = stationMap.get(market.marketId);
      for (const item of market.items) {
        if (item.Stock <= 0 || item.buyPrice <= 0) continue; // Only include items actually for sale
        // Match to colonisation commodity by display name or journal-style name
        const def = findCommodityByDisplayName(item.nameLocalised || item.name)
          ?? findCommodityByDisplayName(item.name)
          ?? findCommodityByJournalName(`$${(item.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
        if (!def) continue;

        let entry = commodityMap.get(market.marketId);
        if (!entry) {
          entry = { commodities: new Set(), lastBuy: market.timestamp, prices: {} };
          commodityMap.set(market.marketId, entry);
        }
        entry.commodities.add(def.id);
        // Use Market.json price if we don't have a MarketBuy price
        if (!entry.prices[def.id]) {
          entry.prices[def.id] = { buyPrice: item.buyPrice, lastSeen: market.timestamp };
        }
      }
      // Ensure the station metadata exists (Market.json has station info too)
      if (!stationMap.has(market.marketId) && market.stationName && market.systemName) {
        stationMap.set(market.marketId, {
          timestamp: market.timestamp,
          event: 'Docked',
          StationName: market.stationName,
          StarSystem: market.systemName,
          StationType: station?.StationType || '',
          MarketID: market.marketId,
          Docked: true,
          LandingPads: station?.LandingPads,
        } as DockedEvent);
      }
    }
  } catch {
    // Market.json may not exist or be unreadable — continue without it
  }

  // Combine: include stations where we bought colonisation commodities or found them in Market.json
  const results: VisitedMarket[] = [];
  for (const [marketId, buyData] of commodityMap) {
    const station = stationMap.get(marketId);
    if (!station) continue;

    results.push({
      marketId,
      stationName: station.StationName,
      systemName: station.StarSystem,
      stationType: station.StationType,
      isPlanetary: PLANETARY_STATION_TYPES.has(station.StationType),
      hasLargePads: station.LandingPads
        ? (station.LandingPads.Large ?? 0) > 0
        : inferHasLargePads(station.StationType),
      commodities: [...buyData.commodities],
      commodityPrices: buyData.prices,
      lastVisited: buyData.lastBuy,
    });
  }

  return results.sort((a, b) => b.lastVisited.localeCompare(a.lastVisited));
}

/** Infer large pad availability from station type when journal LandingPads data is missing */
function inferHasLargePads(stationType: string): boolean {
  // Station types known to have large pads
  const LARGE_PAD_TYPES = new Set([
    'Coriolis', 'Orbis', 'Ocellus', 'StationDodec', 'AsteroidBase',
    'CraterPort', 'PlanetaryPort', 'SurfaceStation',
    'FleetCarrier', 'MegaShip',
  ]);
  if (LARGE_PAD_TYPES.has(stationType)) return true;
  // Outposts and settlements are medium-only
  return false;
}

/**
 * Scan all journal files and build a colonisation timeline with contribution events.
 * Returns timeline events sorted by timestamp for use in timeline visualisation.
 */
export async function scanForTimeline(
  dirHandle?: FileSystemDirectoryHandle
): Promise<ColonisationTimelineEvent[]> {
  const handle = dirHandle || savedDirHandle;
  if (!handle) return [];

  const journalFiles = await getJournalFiles(handle);
  const allLines: string[] = [];

  for (const entry of journalFiles) {
    const file = await entry.handle.getFile();
    const text = await file.text();
    allLines.push(...text.split('\n'));
  }

  const parsed = parseJournalLines(allLines);
  const timeline: ColonisationTimelineEvent[] = [];

  // Build location context for enriching events with system names
  const marketToSystem = new Map<number, string>();
  for (const d of parsed.dockedEvents) {
    marketToSystem.set(d.MarketID, d.StarSystem);
  }
  for (const l of parsed.locationEvents) {
    if (l.MarketID) marketToSystem.set(l.MarketID, l.StarSystem);
  }

  // System claims
  for (const e of parsed.systemClaimEvents) {
    timeline.push({
      type: 'claim',
      timestamp: e.timestamp,
      marketId: e.MarketID || 0,
      systemName: e.StarSystem,
    });
  }

  // Beacon placements
  for (const e of parsed.beaconPlacedEvents) {
    timeline.push({
      type: 'beacon',
      timestamp: e.timestamp,
      marketId: e.MarketID || 0,
      systemName: e.StarSystem,
      data: e.FacilityType ? { facilityType: e.FacilityType } : undefined,
    });
  }

  // Contributions (the backbone of the timeline)
  for (const e of parsed.contributionEvents) {
    timeline.push({
      type: 'contribution',
      timestamp: e.timestamp,
      marketId: e.MarketID,
      systemName: e.StarSystem || marketToSystem.get(e.MarketID),
      data: {
        commodities: (e.Commodities || []).map(c => ({ name: c.Name, count: c.Count })),
        totalContribution: e.Contribution,
      },
    });
  }

  // Depot updates (progress snapshots)
  for (const e of parsed.depotEvents) {
    timeline.push({
      type: e.ConstructionComplete ? 'completed' : e.ConstructionFailed ? 'failed' : 'depot_update',
      timestamp: e.timestamp,
      marketId: e.MarketID,
      systemName: marketToSystem.get(e.MarketID),
      data: {
        progress: e.ConstructionProgress,
        isComplete: e.ConstructionComplete,
        isFailed: e.ConstructionFailed,
      },
    });
  }

  // Sort by timestamp
  timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return timeline;
}

/**
 * Read the current ship cargo from journal files.
 */
export async function readShipCargo(
  dirHandle?: FileSystemDirectoryHandle
): Promise<ShipCargo | null> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) {
    throw new Error('No journal folder selected');
  }

  await ensurePermission(handle);

  // First try reading Cargo.json
  try {
    const cargoFileHandle = await handle.getFileHandle('Cargo.json');
    const cargoFile = await cargoFileHandle.getFile();
    const text = await cargoFile.text();
    const data = JSON.parse(text) as CargoEvent;
    if (data.Vessel === 'Ship' && data.Inventory) {
      return {
        timestamp: data.timestamp,
        items: data.Inventory.map((item) => {
          const known = findCommodityByJournalName(`$${item.Name.toLowerCase()}_name;`);
          return {
            commodityId: known?.id || item.Name.toLowerCase(),
            name: item.Name_Localised || known?.name || item.Name,
            count: item.Count,
          };
        }),
      };
    }
  } catch {
    // Cargo.json might not exist
  }

  // Fallback: scan journal files for latest Cargo event
  const journalFiles = await getJournalFileHandles(handle);
  let latestCargo: CargoEvent | null = null;

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const { cargoEvents } = parseJournalLines(lines);

    for (const ce of cargoEvents) {
      if (ce.Vessel === 'Ship' && ce.Inventory) {
        if (!latestCargo || ce.timestamp > latestCargo.timestamp) {
          latestCargo = ce;
        }
      }
    }

    if (latestCargo) break;
  }

  if (!latestCargo || !latestCargo.Inventory) return null;

  return {
    timestamp: latestCargo.timestamp,
    items: latestCargo.Inventory.map((item) => {
      const known = findCommodityByJournalName(`$${item.Name.toLowerCase()}_name;`);
      return {
        commodityId: known?.id || item.Name.toLowerCase(),
        name: item.Name_Localised || known?.name || item.Name,
        count: item.Count,
      };
    }),
  };
}

/**
 * Read Fleet Carrier cargo separated by carrier (my FC vs squadron).
 *
 * Primary method: read Market.json when docked at a FC.
 * Fallback: accumulate CargoTransfer events per-carrier by tracking
 * which FC the user was docked at for each transfer.
 */
export async function estimateCarrierCargo(
  dirHandle?: FileSystemDirectoryHandle,
  fcMarketId?: number | null,
  fcCallsign?: string,
  squadronCallsigns?: string[],
  persistedCargo?: Record<string, { callsign: string; items: { commodityId: string; name: string; count: number }[]; isEstimate: boolean; updatedAt: string }>,
): Promise<MultiCarrierCargo> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) {
    throw new Error('No journal folder selected');
  }

  await ensurePermission(handle);
  const result: MultiCarrierCargo = { myCarrier: null, squadronCarriers: [] };
  const sqCallsigns = squadronCallsigns || [];

  // --- Primary: Try Market.json if it's from a FC ---
  try {
    const market = await readMarketJson(handle);
    if (market && isFleetCarrierMarketId(market.marketId)) {
      const isMyFC =
        (fcMarketId && market.marketId === fcMarketId) ||
        (fcCallsign && market.stationName === fcCallsign);
      const isSquadronFC = !isMyFC && sqCallsigns.some((cs) => cs === market.stationName);

      if ((isMyFC || isSquadronFC) && market.items.length > 0) {
        const items = market.items
          .filter((item) => item.stock > 0 && item.name)
          .map((item) => {
            const known = findCommodityByJournalName(item.name);
            return {
              commodityId: known?.id || item.name.toLowerCase(),
              name: item.nameLocalised || known?.name || item.name,
              count: item.stock,
            };
          });

        if (items.length > 0) {
          const cargoEst: CarrierCargoEstimate = {
            items,
            earliestTransfer: market.timestamp,
            latestTransfer: market.timestamp,
            isEstimate: false,
            carrierCallsign: market.stationName,
          };

          if (isMyFC) {
            result.myCarrier = cargoEst;
          } else {
            result.squadronCarriers.push({ callsign: market.stationName, cargo: cargoEst });
          }
        }
      }
    }
  } catch {
    // Market.json not available
  }

  // --- Persisted data fallback: if Market.json didn't give us FC data, use persisted cargo ---
  // This prevents losing accurate data when the player docks at a non-FC station
  if (persistedCargo) {
    if (!result.myCarrier && fcCallsign && persistedCargo[fcCallsign]) {
      const p = persistedCargo[fcCallsign];
      result.myCarrier = {
        items: p.items,
        earliestTransfer: p.updatedAt,
        latestTransfer: p.updatedAt,
        isEstimate: p.isEstimate,
        carrierCallsign: p.callsign,
      };
    }
    for (const cs of sqCallsigns) {
      if (persistedCargo[cs] && !result.squadronCarriers.some((sc) => sc.callsign === cs)) {
        const p = persistedCargo[cs];
        result.squadronCarriers.push({
          callsign: cs,
          cargo: {
            items: p.items,
            earliestTransfer: p.updatedAt,
            latestTransfer: p.updatedAt,
            isEstimate: p.isEstimate,
            carrierCallsign: cs,
          },
        });
      }
    }
    // If we filled everything from persisted data, skip the expensive journal scan
    if (result.myCarrier || !fcCallsign) {
      return result;
    }
  }

  // --- Fallback: Accumulate CargoTransfer events per-carrier ---
  // Build a timeline of Docked + CargoTransfer events to know which FC each transfer belongs to
  const journalFiles = await getJournalFileHandles(handle);

  // We need both Docked and CargoTransfer events in chronological order
  const timeline: { timestamp: string; type: 'docked'; station: string; stationType: string; marketId: number }[]
    | { timestamp: string; type: 'transfer'; transfers: CargoTransferItem[] }[] = [];

  interface TimelineEvent {
    timestamp: string;
    type: 'docked' | 'transfer';
    station?: string;
    stationType?: string;
    marketId?: number;
    transfers?: CargoTransferItem[];
  }

  const allEvents: TimelineEvent[] = [];

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const parsed = parseJournalLines(lines);

    for (const ev of parsed.dockedEvents) {
      allEvents.push({
        timestamp: ev.timestamp,
        type: 'docked',
        station: ev.StationName,
        stationType: ev.StationType,
        marketId: ev.MarketID,
      });
    }
    for (const ev of parsed.locationEvents) {
      if (ev.Docked && ev.MarketID && ev.StationName) {
        allEvents.push({
          timestamp: ev.timestamp,
          type: 'docked',
          station: ev.StationName,
          stationType: ev.StationType || '',
          marketId: ev.MarketID,
        });
      }
    }
    for (const ev of parsed.cargoTransferEvents) {
      allEvents.push({
        timestamp: ev.timestamp,
        type: 'transfer',
        transfers: ev.Transfers,
      });
    }
  }

  allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Track cargo per carrier callsign
  const perCarrier = new Map<string, Map<string, { name: string; count: number }>>();
  const carrierTimestamps = new Map<string, { earliest: string; latest: string }>();
  let currentStation = '';
  let currentStationType = '';
  let currentMarketId = 0;

  for (const ev of allEvents) {
    if (ev.type === 'docked') {
      currentStation = ev.station || '';
      currentStationType = ev.stationType || '';
      currentMarketId = ev.marketId || 0;
    } else if (ev.type === 'transfer' && ev.transfers) {
      // Only attribute to FC if currently docked at a FC
      if (!isFleetCarrier(currentStationType, currentMarketId)) continue;
      if (!isFleetCarrierCallsign(currentStation)) continue;

      if (!perCarrier.has(currentStation)) {
        perCarrier.set(currentStation, new Map());
      }
      const cargo = perCarrier.get(currentStation)!;

      for (const item of ev.transfers) {
        if (!item.Name) continue;
        const known = findCommodityByJournalName(`$${item.Name.toLowerCase()}_name;`);
        const id = known?.id || item.Name.toLowerCase();
        const displayName = item.Name_Localised || known?.name || item.Name;
        const current = cargo.get(id) || { name: displayName, count: 0 };

        if (item.Direction === 'tocarrier') {
          current.count += item.Count;
        } else if (item.Direction === 'toship') {
          current.count -= item.Count;
        }
        current.count = Math.max(0, current.count);
        cargo.set(id, current);
      }

      // Track timestamps
      const ts = carrierTimestamps.get(currentStation) || { earliest: ev.timestamp, latest: ev.timestamp };
      if (ev.timestamp < ts.earliest) ts.earliest = ev.timestamp;
      if (ev.timestamp > ts.latest) ts.latest = ev.timestamp;
      carrierTimestamps.set(currentStation, ts);
    }
  }

  // Build results from per-carrier data (only for carriers not already populated from Market.json)
  for (const [callsign, cargo] of perCarrier) {
    const items = Array.from(cargo.entries())
      .filter(([, v]) => v.count > 0)
      .map(([commodityId, v]) => ({ commodityId, name: v.name, count: v.count }));

    if (items.length === 0) continue;

    const ts = carrierTimestamps.get(callsign)!;
    const isMyFC = callsign === fcCallsign || (fcMarketId && currentMarketId === fcMarketId);
    const isSquadron = sqCallsigns.includes(callsign);

    const cargoEst: CarrierCargoEstimate = {
      items,
      earliestTransfer: ts.earliest,
      latestTransfer: ts.latest,
      isEstimate: true,
      carrierCallsign: callsign,
    };

    if (isMyFC && !result.myCarrier) {
      result.myCarrier = cargoEst;
    } else if (isSquadron && !result.squadronCarriers.some((sc) => sc.callsign === callsign)) {
      result.squadronCarriers.push({ callsign, cargo: cargoEst });
    }
  }

  return result;
}

// ===== Journal-based Exploration Data (for non-Spansh systems) =====

export interface JournalExplorationSystem {
  systemAddress: number;
  systemName: string;
  coordinates: { x: number; y: number; z: number } | null;
  bodyCount: number; // from FSSDiscoveryScan
  fssAllBodiesFound: boolean; // true if FSSAllBodiesFound event confirmed all bodies detected
  scannedBodies: JournalScannedBody[];
  lastSeen: string;
}

export interface JournalScannedBody {
  bodyId: number;
  bodyName: string;
  type: 'Star' | 'Planet';
  subType: string;
  distanceToArrival: number;
  // Star fields
  starType?: string;
  stellarMass?: number;
  absoluteMagnitude?: number; // lower = brighter (Sun ≈ 4.83)
  luminosityClass?: string; // Yerkes: Ia, Ib, II, III, IV, V, VI, VII
  ageMy?: number; // age in millions of years
  // Planet fields
  isLandable?: boolean;
  earthMasses?: number;
  gravity?: number; // m/s^2 from journal, needs /9.81 for g
  atmosphereType?: string;
  volcanism?: string;
  surfaceTemperature?: number;
  terraformState?: string;
  surfacePressure?: number; // Pascals
  radius?: number; // metres
  semiMajorAxis?: number; // metres — orbital distance to parent
  rings?: { name: string; ringClass: string; outerRad?: number; massKG?: number }[];
  parents?: Record<string, number>[];
  wasDiscovered?: boolean;
  wasMapped?: boolean;
  bioSignals?: number; // count of biological signals from FSSBodySignals
  geoSignals?: number; // count of geological signals from FSSBodySignals
}

/**
 * Convert journal Scan events into SpanshDumpBody-compatible objects
 * so the existing scoring pipeline can process them.
 */
export function journalBodiesToSpanshFormat(bodies: JournalScannedBody[], systemName: string): import('@/services/spanshApi').SpanshDumpBody[] {
  return bodies.map((b) => ({
    bodyId: b.bodyId,
    id64: 0, // not available from journal
    name: b.bodyName,
    type: b.type,
    subType: b.subType || (b.type === 'Star' ? (b.starType ? mapStarType(b.starType) : 'Unknown Star') : 'Unknown Planet'),
    distanceToArrival: b.distanceToArrival,
    // Star fields
    mainStar: b.type === 'Star' && b.distanceToArrival === 0,
    spectralClass: b.starType,
    solarMasses: b.stellarMass,
    // Planet fields
    isLandable: b.isLandable,
    earthMasses: b.earthMasses,
    gravity: b.gravity != null ? b.gravity / 9.81 : undefined, // journal gives m/s², scorer expects g
    atmosphereType: b.atmosphereType || null,
    volcanismType: b.volcanism,
    terraformingState: b.terraformState,
    surfaceTemperature: b.surfaceTemperature,
    rings: b.rings?.map((r) => ({
      name: r.name,
      type: r.ringClass,
    })),
    parents: b.parents,
  }));
}

/**
 * Map Elite Dangerous journal StarType codes to full Spansh-style names.
 * Journal uses short codes (e.g. "N" for Neutron Star) while the scorer
 * expects full names (e.g. "Neutron Star") for pattern matching.
 */
const STAR_TYPE_MAP: Record<string, string> = {
  // Main sequence
  O: 'O (Blue-White) Star', B: 'B (Blue-White) Star', A: 'A (Blue-White) Star',
  F: 'F (White) Star', G: 'G (White-Yellow) Star', K: 'K (Yellow-Orange) Star',
  M: 'M (Red dwarf) Star', L: 'L (Brown dwarf) Star', T: 'T (Brown dwarf) Star',
  Y: 'Y (Brown dwarf) Star',
  // Proto stars
  TTS: 'T Tauri Star', AeBe: 'Herbig Ae/Be Star',
  // Wolf-Rayet
  W: 'Wolf-Rayet Star', WN: 'Wolf-Rayet N Star', WNC: 'Wolf-Rayet NC Star',
  WC: 'Wolf-Rayet C Star', WO: 'Wolf-Rayet O Star',
  // Carbon stars
  CS: 'CS Star', C: 'C Star', CN: 'CN Star', CJ: 'CJ Star', CH: 'CH Star',
  CHd: 'CHd Star', MS: 'MS-type Star', S: 'S-type Star',
  // White dwarfs
  D: 'D (White Dwarf) Star', DA: 'DA (White Dwarf) Star', DAB: 'DAB (White Dwarf) Star',
  DAO: 'DAO (White Dwarf) Star', DAZ: 'DAZ (White Dwarf) Star', DAV: 'DAV (White Dwarf) Star',
  DB: 'DB (White Dwarf) Star', DBZ: 'DBZ (White Dwarf) Star', DBV: 'DBV (White Dwarf) Star',
  DO: 'DO (White Dwarf) Star', DOV: 'DOV (White Dwarf) Star', DQ: 'DQ (White Dwarf) Star',
  DC: 'DC (White Dwarf) Star', DCV: 'DCV (White Dwarf) Star', DX: 'DX (White Dwarf) Star',
  // Compact objects
  N: 'Neutron Star', H: 'Black Hole', SupermassiveBlackHole: 'Supermassive Black Hole',
  // Giants / supergiants
  A_BlueWhiteSuperGiant: 'A (Blue-White super giant) Star',
  F_WhiteSuperGiant: 'F (White super giant) Star',
  M_RedSuperGiant: 'M (Red super giant) Star',
  M_RedGiant: 'M (Red giant) Star',
  K_OrangeGiant: 'K (Orange giant) Star',
  // Exotic
  X: 'Exotic Star', RoguePlanet: 'Rogue Planet',
  Nebula: 'Nebula', StellarRemnantNebula: 'Stellar Remnant Nebula',
};

export function mapStarType(journalCode: string): string {
  return STAR_TYPE_MAP[journalCode] || journalCode;
}

/**
 * Extract exploration data from journal files: FSSDiscoveryScan (honk) + Scan (body details).
 * Returns a map of systemAddress → exploration data.
 */
/**
 * Aggregate dock history from every Journal.*.log file: per MarketID counts
 * and faction/state transition timelines. Used to retroactively populate
 * the station dossier (firstDocked / dockedCount / factionHistory / stateHistory)
 * when the user runs "Sync All".
 *
 * Fleet carriers are excluded (they aren't "places" in the dossier sense).
 */
export interface DockHistoryEntry {
  marketId: number;
  stationName: string;
  systemName: string;
  systemAddress: number;
  firstDocked: string;
  lastDocked: string;
  dockedCount: number;
  currentFaction: string | null;
  currentFactionState: string | null;
  factionHistory: { name: string; changedAt: string }[];
  stateHistory: { state: string; changedAt: string }[];
}

export interface TravelStat {
  avgSeconds: number;         // trimmed mean
  recentAvgSeconds: number;    // last 10 trips, trimmed
  tripCount: number;           // post-trim
  lastTripAt: string;          // ISO timestamp
}

/**
 * Walk every journal file and build a matrix of station-pair travel times,
 * segmented by the ship in use at trip time. Only counts "sourcing-relevant"
 * trips — where the dock window at the from-station included a MarketBuy,
 * CargoTransfer, or ColonisationContribution event (i.e. you actually loaded
 * or delivered cargo, not just passed through for a mission).
 *
 * Key format: `${fromMarketId}:${toMarketId}:${shipId}` → TravelStat.
 * Outlier filter: after collecting durations for a pair, trim anything > 2×
 * the median so AFK outliers don't skew the average.
 */
export async function extractStationTravelTimes(
  dirHandle?: FileSystemDirectoryHandle,
): Promise<Record<string, TravelStat>> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) throw new Error('No journal folder selected');
  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);

  // Collected trip durations by pair+ship
  type TripList = { durations: number[]; lastTripAt: string; pair: string };
  const trips = new Map<string, TripList>();

  let activeShipId: number | null = null;
  let currentDock: null | {
    stationName: string;
    marketId: number;
    dockedAt: string;
    sourcingSeen: boolean;
  } = null;

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      switch (ev.event) {
        case 'Loadout':
        case 'ShipyardSwap':
          if (ev.ShipID != null) activeShipId = ev.ShipID;
          break;
        case 'Docked':
          currentDock = {
            stationName: ev.StationName,
            marketId: ev.MarketID,
            dockedAt: ev.timestamp,
            sourcingSeen: false,
          };
          break;
        case 'MarketBuy':
        case 'CargoTransfer':
        case 'ColonisationContribution':
        case 'ColonisationFactionContribution':
          if (currentDock) currentDock.sourcingSeen = true;
          break;
        case 'Undocked': {
          if (!currentDock) break;
          // Keep a pending "from" reference for pairing with next Docked
          (extractStationTravelTimes as unknown as { _pendingUndock?: typeof currentDock & { shipId: number | null; undockedAt: string } })._pendingUndock = {
            ...currentDock,
            shipId: activeShipId,
            undockedAt: ev.timestamp,
          };
          currentDock = null;
          break;
        }
        case 'FSDJump':
        case 'CarrierJump':
          // FSDJump rules out an A→B station pair; discard the pending undock
          (extractStationTravelTimes as unknown as { _pendingUndock?: unknown })._pendingUndock = null;
          break;
      }
      // After switch: if we just saw a Docked AND have a pending undock, pair them
      if (ev.event === 'Docked' && currentDock) {
        const holder = (extractStationTravelTimes as unknown as { _pendingUndock?: {
          marketId: number; shipId: number | null; undockedAt: string; sourcingSeen: boolean;
        } })._pendingUndock;
        if (holder && holder.shipId != null && holder.sourcingSeen && currentDock.marketId && holder.marketId) {
          const dt = (new Date(ev.timestamp).getTime() - new Date(holder.undockedAt).getTime()) / 1000;
          if (dt > 0 && dt < 3 * 3600) {
            const key = `${holder.marketId}:${currentDock.marketId}:${holder.shipId}`;
            const existing = trips.get(key) ?? { durations: [], lastTripAt: ev.timestamp, pair: key };
            existing.durations.push(dt);
            if (ev.timestamp > existing.lastTripAt) existing.lastTripAt = ev.timestamp;
            trips.set(key, existing);
          }
        }
        (extractStationTravelTimes as unknown as { _pendingUndock?: unknown })._pendingUndock = null;
      }
    }
  }

  // Aggregate with outlier trim (drop > 2× median)
  const out: Record<string, TravelStat> = {};
  for (const [key, list] of trips) {
    if (list.durations.length === 0) continue;
    const sorted = [...list.durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const cap = median * 2;
    const trimmed = list.durations.filter((d) => d <= cap);
    if (trimmed.length === 0) continue;
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    // Recent = last 10 trips in chronological order, trimmed the same way
    const recent = trimmed.slice(-10);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    out[key] = {
      avgSeconds: avg,
      recentAvgSeconds: recentAvg,
      tripCount: trimmed.length,
      lastTripAt: list.lastTripAt,
    };
  }
  // Clean up static holder
  (extractStationTravelTimes as unknown as { _pendingUndock?: unknown })._pendingUndock = undefined;
  return out;
}

/**
 * Read the newest journal file and find the most recent position event
 * (FSDJump, CarrierJump, or Location). Used by System View's "Check journal
 * now" button to recover from a stuck state when the live watcher didn't
 * process a jump event.
 */
export async function fetchLatestPositionFromJournal(
  dirHandle?: FileSystemDirectoryHandle,
): Promise<{ systemName: string; systemAddress: number; coordinates: { x: number; y: number; z: number } | null } | null> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) throw new Error('No journal folder selected');
  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);
  if (journalFiles.length === 0) return null;
  // Walk newest-first; break at first match so we always get the latest
  for (let i = journalFiles.length - 1; i >= 0; i--) {
    const file = await journalFiles[i].handle.getFile();
    const text = await file.text();
    const parsed = parseJournalLines(text.split('\n'));
    // Collect all position events with timestamps
    const candidates: { ts: string; systemName: string; systemAddress: number; coords: { x: number; y: number; z: number } | null }[] = [];
    for (const ev of parsed.fsdJumpEvents) {
      candidates.push({
        ts: ev.timestamp, systemName: ev.StarSystem, systemAddress: ev.SystemAddress,
        coords: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : null,
      });
    }
    for (const ev of parsed.locationEvents) {
      if (!ev.StarSystem || !ev.SystemAddress) continue;
      candidates.push({
        ts: ev.timestamp, systemName: ev.StarSystem, systemAddress: ev.SystemAddress,
        coords: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : null,
      });
    }
    for (const ev of parsed.carrierJumpEvents) {
      if (!ev.StarSystem || !ev.SystemAddress) continue;
      candidates.push({
        ts: ev.timestamp, systemName: ev.StarSystem, systemAddress: ev.SystemAddress,
        coords: null, // CarrierJump has no StarPos
      });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.ts.localeCompare(a.ts));
      const latest = candidates[0];
      return { systemName: latest.systemName, systemAddress: latest.systemAddress, coordinates: latest.coords };
    }
  }
  return null;
}

export async function extractDockHistory(
  dirHandle?: FileSystemDirectoryHandle
): Promise<Map<number, DockHistoryEntry>> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) throw new Error('No journal folder selected');
  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);

  const out = new Map<number, DockHistoryEntry>();

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const parsed = parseJournalLines(lines);

    for (const ev of parsed.dockedEvents) {
      if (!ev.MarketID) continue;
      // Skip ephemeral stations (FCs, Trailblazer NPCs, colonisation ships,
      // construction sites) — they're not "places" for the dossier.
      if (isEphemeralStation(ev.StationName, ev.StationType, ev.MarketID)) continue;

      const faction = ev.StationFaction?.Name;
      const state = ev.StationFaction?.FactionState;
      const existing = out.get(ev.MarketID);

      if (!existing) {
        out.set(ev.MarketID, {
          marketId: ev.MarketID,
          stationName: ev.StationName,
          systemName: ev.StarSystem,
          systemAddress: ev.SystemAddress,
          firstDocked: ev.timestamp,
          lastDocked: ev.timestamp,
          dockedCount: 1,
          currentFaction: faction ?? null,
          currentFactionState: state ?? null,
          factionHistory: [],
          stateHistory: [],
        });
        continue;
      }

      existing.dockedCount += 1;
      if (ev.timestamp > existing.lastDocked) {
        existing.lastDocked = ev.timestamp;
        // Prefer the newest StationName — handles renames and lifecycle
        // (construction depot → colonisation ship → completed station).
        // Skip obvious construction-site placeholders so the live name wins.
        if (ev.StationName && !/\$EXT_PANEL_ColonisationShip|Construction Site/i.test(ev.StationName)) {
          existing.stationName = ev.StationName;
        }
      }
      if (ev.timestamp < existing.firstDocked) existing.firstDocked = ev.timestamp;

      // Faction transition
      if (faction && existing.currentFaction && faction !== existing.currentFaction) {
        existing.factionHistory.push({ name: existing.currentFaction, changedAt: ev.timestamp });
        if (existing.factionHistory.length > 5) existing.factionHistory.shift();
      }
      if (faction) existing.currentFaction = faction;

      // State transition
      if (state && existing.currentFactionState && state !== existing.currentFactionState) {
        existing.stateHistory.push({ state, changedAt: ev.timestamp });
        if (existing.stateHistory.length > 10) existing.stateHistory.shift();
      }
      if (state) existing.currentFactionState = state;
    }
  }

  return out;
}

export async function extractExplorationData(
  dirHandle?: FileSystemDirectoryHandle
): Promise<Map<number, JournalExplorationSystem>> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) {
    throw new Error('No journal folder selected');
  }

  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);

  // We also need FSDJump for coordinates + system name mapping
  const systemMap = new Map<number, JournalExplorationSystem>();
  const addressToName = new Map<number, string>();
  const addressToCoords = new Map<number, { x: number; y: number; z: number }>();

  for (const jf of journalFiles) {
    const file = await jf.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const parsed = parseJournalLines(lines);

    // Build address→name & address→coords from FSDJump + Location
    for (const ev of parsed.fsdJumpEvents) {
      addressToName.set(ev.SystemAddress, ev.StarSystem);
      if (ev.StarPos) {
        addressToCoords.set(ev.SystemAddress, { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] });
      }
    }
    for (const ev of parsed.locationEvents) {
      addressToName.set(ev.SystemAddress, ev.StarSystem);
      if (ev.StarPos) {
        addressToCoords.set(ev.SystemAddress, { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] });
      }
    }

    // Process FSSDiscoveryScan (honk) — gives body count per system
    for (const ev of parsed.fssDiscoveryScanEvents) {
      const name = ev.SystemName || addressToName.get(ev.SystemAddress) || `Unknown (${ev.SystemAddress})`;
      const existing = systemMap.get(ev.SystemAddress);
      if (!existing) {
        systemMap.set(ev.SystemAddress, {
          systemAddress: ev.SystemAddress,
          systemName: name,
          coordinates: addressToCoords.get(ev.SystemAddress) || null,
          bodyCount: ev.BodyCount,
          fssAllBodiesFound: false,
          scannedBodies: [],
          lastSeen: ev.timestamp,
        });
      } else {
        existing.bodyCount = ev.BodyCount;
        if (ev.timestamp > existing.lastSeen) existing.lastSeen = ev.timestamp;
        if (!existing.systemName.startsWith('Unknown')) existing.systemName = name;
      }
    }

    // Process FSSAllBodiesFound — confirms all bodies in system have been detected
    for (const ev of parsed.fssAllBodiesFoundEvents) {
      const existing = systemMap.get(ev.SystemAddress);
      if (existing) {
        existing.fssAllBodiesFound = true;
        if (ev.timestamp > existing.lastSeen) existing.lastSeen = ev.timestamp;
      } else {
        const name = ev.SystemName || addressToName.get(ev.SystemAddress) || `Unknown (${ev.SystemAddress})`;
        systemMap.set(ev.SystemAddress, {
          systemAddress: ev.SystemAddress,
          systemName: name,
          coordinates: addressToCoords.get(ev.SystemAddress) || null,
          bodyCount: ev.Count || 0,
          fssAllBodiesFound: true,
          scannedBodies: [],
          lastSeen: ev.timestamp,
        });
      }
    }

    // Process Scan events — individual body details
    for (const ev of parsed.scanEvents) {
      const addr = ev.SystemAddress;
      if (!addr) continue;

      const name = ev.StarSystem || addressToName.get(addr) || `Unknown (${addr})`;

      if (!systemMap.has(addr)) {
        systemMap.set(addr, {
          systemAddress: addr,
          systemName: name,
          coordinates: addressToCoords.get(addr) || null,
          bodyCount: 0,
          fssAllBodiesFound: false,
          scannedBodies: [],
          lastSeen: ev.timestamp,
        });
      }

      const sys = systemMap.get(addr)!;
      if (ev.timestamp > sys.lastSeen) sys.lastSeen = ev.timestamp;

      // Skip non-body scans: belt clusters, ring scans, barycentres
      if (ev.PlanetClass === 'Belt Cluster') continue;
      if (!ev.PlanetClass && !ev.StarType) continue; // ring scans & barycentres have neither

      // Deduplicate by bodyId OR bodyName (bodyName is the true unique key within a system)
      const existingIdx = sys.scannedBodies.findIndex((b) => b.bodyId === ev.BodyID || b.bodyName === ev.BodyName);
      const body: JournalScannedBody = {
        bodyId: ev.BodyID,
        bodyName: ev.BodyName,
        type: ev.StarType ? 'Star' : 'Planet',
        subType: ev.PlanetClass || (ev.StarType ? mapStarType(ev.StarType) : 'Unknown'),
        distanceToArrival: ev.DistanceFromArrivalLS,
        starType: ev.StarType,
        stellarMass: ev.StellarMass,
        absoluteMagnitude: ev.AbsoluteMagnitude,
        luminosityClass: ev.Luminosity,
        ageMy: ev.Age_MY,
        isLandable: ev.Landable,
        earthMasses: ev.MassEM,
        gravity: ev.SurfaceGravity,
        atmosphereType: ev.AtmosphereType || ev.Atmosphere,
        volcanism: ev.Volcanism,
        surfaceTemperature: ev.SurfaceTemperature,
        surfacePressure: ev.SurfacePressure,
        radius: ev.Radius,
        semiMajorAxis: ev.SemiMajorAxis,
        terraformState: ev.TerraformState,
        rings: ev.Rings?.map((r) => ({ name: r.Name, ringClass: r.RingClass, outerRad: r.OuterRad, massKG: r.MassMT })),
        parents: ev.Parents,
        wasDiscovered: ev.WasDiscovered,
        wasMapped: ev.WasMapped,
      };

      if (existingIdx >= 0) {
        sys.scannedBodies[existingIdx] = body; // overwrite with newer data
      } else {
        sys.scannedBodies.push(body);
      }
    }
  }

  // Backfill coordinates and names
  for (const [addr, sys] of systemMap) {
    if (!sys.coordinates) {
      sys.coordinates = addressToCoords.get(addr) || null;
    }
    if (sys.systemName.startsWith('Unknown')) {
      const name = addressToName.get(addr);
      if (name) sys.systemName = name;
    }
  }

  return systemMap;
}

// ===== Session Summary — Recent Contributions =====

export interface RecentContributionSummary {
  marketId: number;
  systemName: string | undefined;
  /** Individual commodity deliveries aggregated across trips */
  commodities: { name: string; count: number }[];
  /** Total tons delivered to this depot */
  totalTons: number;
  /** Number of delivery trips (contribution events) */
  tripCount: number;
  /** Latest construction progress 0-1, or null if no depot snapshot */
  latestProgress: number | null;
  /** Whether construction completed */
  isComplete: boolean;
  firstTimestamp: string;
  lastTimestamp: string;
}

/**
 * Scan journal files for colonisation contributions since a given timestamp.
 * Returns aggregated summaries grouped by MarketID (depot).
 * Used for the "session summary" modal on dashboard launch.
 */
export async function scanRecentContributions(
  dirHandle?: FileSystemDirectoryHandle,
  sinceTimestamp?: string,
): Promise<RecentContributionSummary[]> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) return [];

  try {
    await ensurePermission(handle);
  } catch {
    return []; // silent fail if permission denied
  }

  const journalFiles = await getJournalFileHandles(handle);
  const allLines: string[] = [];

  // Optimization: only read recent journal files if sinceTimestamp is provided
  const since = sinceTimestamp || '1970-01-01T00:00:00Z';
  for (const entry of journalFiles) {
    // Journal filenames are like Journal.2026-03-14T120000.01.log
    // We can extract date from filename to skip old files
    const dateMatch = entry.name.match(/Journal\.(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const fileDate = dateMatch[1]; // e.g. "2026-03-14"
      const sinceDate = since.slice(0, 10); // e.g. "2026-03-14"
      // Skip files from before the day before our cutoff (allow 1-day margin for timezone)
      if (fileDate < sinceDate.replace(/-(\d{2})$/, (_, d) => `-${String(Math.max(1, Number(d) - 1)).padStart(2, '0')}`)) {
        continue;
      }
    }
    const file = await entry.handle.getFile();
    const text = await file.text();
    allLines.push(...text.split('\n'));
  }

  const parsed = parseJournalLines(allLines);

  // Build location context
  const marketToSystem = new Map<number, string>();
  for (const d of parsed.dockedEvents) {
    marketToSystem.set(d.MarketID, d.StarSystem);
  }
  for (const l of parsed.locationEvents) {
    if (l.MarketID) marketToSystem.set(l.MarketID, l.StarSystem);
  }

  // Filter contributions after sinceTimestamp
  const recentContributions = parsed.contributionEvents.filter(
    (e) => e.timestamp > since,
  );

  if (recentContributions.length === 0) return [];

  // Group by MarketID
  const byMarket = new Map<number, typeof recentContributions>();
  for (const e of recentContributions) {
    const list = byMarket.get(e.MarketID) ?? [];
    list.push(e);
    byMarket.set(e.MarketID, list);
  }

  // Collect ALL depot events per market (sorted by timestamp) for delta calculation.
  // ConstructionDepot events contain the full ResourcesRequired snapshot after each
  // contribution — diffing consecutive snapshots gives us per-delivery tonnage.
  const depotsByMarket = new Map<number, ColonisationConstructionDepotEvent[]>();
  for (const e of parsed.depotEvents) {
    const list = depotsByMarket.get(e.MarketID) ?? [];
    list.push(e);
    depotsByMarket.set(e.MarketID, list);
  }
  // Sort each market's depot events by timestamp
  for (const list of depotsByMarket.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // Find latest depot events per market for progress info
  const latestDepot = new Map<number, { progress: number; isComplete: boolean }>();
  for (const e of parsed.depotEvents) {
    if (e.timestamp > since) {
      latestDepot.set(e.MarketID, {
        progress: e.ConstructionProgress,
        isComplete: e.ConstructionComplete,
      });
    }
  }

  // Build summaries
  const summaries: RecentContributionSummary[] = [];
  for (const [marketId, events] of byMarket) {
    // Aggregate commodities from contribution events (if available)
    const comMap = new Map<string, number>();
    for (const e of events) {
      for (const c of e.Commodities || []) {
        const name = c.Name_Localised || c.Name;
        comMap.set(name, (comMap.get(name) ?? 0) + c.Count);
      }
    }

    // Use Contribution field (authoritative trip total) when available,
    // fall back to summing Commodities breakdown
    const contributionTotal = events.reduce((sum, e) => sum + (e.Contribution || 0), 0);
    const commodityTotal = [...comMap.values()].reduce((sum, c) => sum + c, 0);
    let totalTons = contributionTotal > 0 ? contributionTotal : commodityTotal;

    // If contribution events don't carry tonnage data (game may omit Commodities/Contribution),
    // compute tons from ConstructionDepot snapshot deltas instead.
    // Each delivery triggers a depot event with updated ProvidedAmount values — the difference
    // between the last depot before our session and the latest depot gives us total tons.
    if (totalTons === 0) {
      const depots = depotsByMarket.get(marketId) || [];
      if (depots.length > 0) {
        // Find the last depot event BEFORE the session window (baseline)
        const depotsBefore = depots.filter((d) => d.timestamp <= since);
        const depotsAfter = depots.filter((d) => d.timestamp > since);

        if (depotsAfter.length > 0) {
          const latestAfter = depotsAfter[depotsAfter.length - 1];
          const baseline = depotsBefore.length > 0 ? depotsBefore[depotsBefore.length - 1] : null;

          // Build provided-amount maps
          const afterProvided = new Map<string, number>();
          for (const r of latestAfter.ResourcesRequired) {
            const name = r.Name_Localised || r.Name;
            afterProvided.set(name, r.ProvidedAmount);
          }

          if (baseline) {
            const beforeProvided = new Map<string, number>();
            for (const r of baseline.ResourcesRequired) {
              const name = r.Name_Localised || r.Name;
              beforeProvided.set(name, r.ProvidedAmount);
            }
            for (const [name, afterAmt] of afterProvided) {
              const delta = afterAmt - (beforeProvided.get(name) ?? 0);
              if (delta > 0) {
                comMap.set(name, (comMap.get(name) ?? 0) + delta);
                totalTons += delta;
              }
            }
          } else {
            // No baseline — use total provided amounts as best effort
            // (this happens for first-ever session with this depot)
            for (const [name, amt] of afterProvided) {
              if (amt > 0) {
                comMap.set(name, (comMap.get(name) ?? 0) + amt);
                totalTons += amt;
              }
            }
          }
        }
      }
    }

    const commodities = [...comMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const timestamps = events.map((e) => e.timestamp).sort();
    const depot = latestDepot.get(marketId);

    summaries.push({
      marketId,
      systemName: events[0].StarSystem || marketToSystem.get(marketId),
      commodities,
      totalTons,
      tripCount: events.length,
      latestProgress: depot?.progress ?? null,
      isComplete: depot?.isComplete ?? false,
      firstTimestamp: timestamps[0],
      lastTimestamp: timestamps[timestamps.length - 1],
    });
  }

  return summaries.sort((a, b) => b.totalTons - a.totalTons);
}

// ===== Session Stats — Enriched Journey Data =====

export interface SessionStats {
  /** Total distance travelled in light-years (sum of FSDJump distances) */
  distanceTravelledLY: number;
  /** Number of unique systems visited */
  systemsVisited: number;
  /** List of unique system names visited */
  systemNames: string[];
  /** Number of unique stations docked at */
  stationsDocked: number;
  /** Total tons bought at markets */
  tonsBought: number;
  /** Total tons sold at markets */
  tonsSold: number;
  /** Total credits spent buying */
  creditsSpent: number;
  /** Total credits earned selling */
  creditsEarned: number;
  /** Number of FSD jumps */
  jumpCount: number;
  /** Number of docking events */
  dockingCount: number;
  /** Number of bodies scanned (Scan events) */
  bodiesScanned: number;
  /** Number of honks (FSSDiscoveryScan) */
  systemsHonked: number;
  /** Time span: first event → last event */
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

/**
 * Scan journal files for enriched session stats since a given timestamp.
 * Extracts distance travelled, systems visited, stations docked, tonnage, etc.
 */
export async function scanSessionStats(
  dirHandle?: FileSystemDirectoryHandle,
  sinceTimestamp?: string,
): Promise<SessionStats> {
  const empty: SessionStats = {
    distanceTravelledLY: 0,
    systemsVisited: 0,
    systemNames: [],
    stationsDocked: 0,
    tonsBought: 0,
    tonsSold: 0,
    creditsSpent: 0,
    creditsEarned: 0,
    jumpCount: 0,
    dockingCount: 0,
    bodiesScanned: 0,
    systemsHonked: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  };

  const handle = dirHandle || journalDirHandle;
  if (!handle) return empty;

  try {
    await ensurePermission(handle);
  } catch {
    return empty;
  }

  const journalFiles = await getJournalFileHandles(handle);
  const allLines: string[] = [];
  const since = sinceTimestamp || '1970-01-01T00:00:00Z';

  for (const entry of journalFiles) {
    const dateMatch = entry.name.match(/Journal\.(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const fileDate = dateMatch[1];
      const sinceDate = since.slice(0, 10);
      if (fileDate < sinceDate.replace(/-(\d{2})$/, (_, d) => `-${String(Math.max(1, Number(d) - 1)).padStart(2, '0')}`)) {
        continue;
      }
    }
    const file = await entry.handle.getFile();
    const text = await file.text();
    allLines.push(...text.split('\n'));
  }

  const parsed = parseJournalLines(allLines);

  // Filter events after sinceTimestamp
  const recentJumps = parsed.fsdJumpEvents.filter((e) => e.timestamp > since);
  const recentDocked = parsed.dockedEvents.filter((e) => e.timestamp > since);
  const recentBuys = parsed.marketBuyEvents.filter((e) => e.timestamp > since);
  const recentSells = parsed.marketSellEvents.filter((e) => e.timestamp > since);
  const recentScans = parsed.scanEvents.filter((e) => e.timestamp > since);
  const recentHonks = parsed.fssDiscoveryScanEvents.filter((e) => e.timestamp > since);

  // Calculate distance: sum of distances between consecutive jumps
  let totalDistance = 0;
  // Sort jumps by timestamp
  const sortedJumps = [...recentJumps].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Also include any jump right before the session for distance from first in-session jump
  const preSessionJumps = parsed.fsdJumpEvents
    .filter((e) => e.timestamp <= since)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const lastPreSessionJump = preSessionJumps[preSessionJumps.length - 1];

  const allJumpsForDistance = lastPreSessionJump
    ? [lastPreSessionJump, ...sortedJumps]
    : sortedJumps;

  for (let i = 1; i < allJumpsForDistance.length; i++) {
    const prev = allJumpsForDistance[i - 1].StarPos;
    const curr = allJumpsForDistance[i].StarPos;
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const dz = curr[2] - prev[2];
    totalDistance += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Unique systems
  const uniqueSystems = new Set(recentJumps.map((e) => e.StarSystem));
  // Unique stations
  const uniqueStations = new Set(recentDocked.map((e) => `${e.StarSystem}:${e.StationName}`));

  // Tonnage and credits
  const tonsBought = recentBuys.reduce((sum, e) => sum + e.Count, 0);
  const tonsSold = recentSells.reduce((sum, e) => sum + e.Count, 0);
  const creditsSpent = recentBuys.reduce((sum, e) => sum + e.TotalCost, 0);
  const creditsEarned = recentSells.reduce((sum, e) => sum + e.TotalSale, 0);

  // Timestamps
  const allTimestamps = [
    ...recentJumps.map((e) => e.timestamp),
    ...recentDocked.map((e) => e.timestamp),
    ...recentBuys.map((e) => e.timestamp),
    ...recentSells.map((e) => e.timestamp),
  ].sort();

  return {
    distanceTravelledLY: Math.round(totalDistance * 10) / 10,
    systemsVisited: uniqueSystems.size,
    systemNames: [...uniqueSystems],
    stationsDocked: uniqueStations.size,
    tonsBought,
    tonsSold,
    creditsSpent,
    creditsEarned,
    jumpCount: recentJumps.length,
    dockingCount: recentDocked.length,
    bodiesScanned: recentScans.length,
    systemsHonked: recentHonks.length,
    firstTimestamp: allTimestamps[0] ?? null,
    lastTimestamp: allTimestamps[allTimestamps.length - 1] ?? null,
  };
}

// ===== Cargo Capacity from Loadout =====

/**
 * Extract the most recent cargo capacity from Loadout events in journal files.
 * Loadout fires on login and after ship swap — CargoCapacity reflects current ship.
 */
export async function extractLatestCargoCapacity(
  dirHandle?: FileSystemDirectoryHandle,
): Promise<{ cargoCapacity: number; shipName: string; timestamp: string } | null> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) return null;

  await ensurePermission(handle);
  const journalFiles = await getJournalFileHandles(handle);

  let latest: { cargoCapacity: number; shipName: string; timestamp: string } | null = null;

  // Process newest files first for efficiency
  for (let i = journalFiles.length - 1; i >= 0; i--) {
    const file = await journalFiles[i].handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const parsed = parseJournalLines(lines);

    for (const ev of parsed.loadoutEvents) {
      if (ev.CargoCapacity != null && (!latest || ev.timestamp > latest.timestamp)) {
        latest = {
          cargoCapacity: ev.CargoCapacity,
          shipName: ev.ShipName || ev.Ship || 'Unknown',
          timestamp: ev.timestamp,
        };
      }
    }

    // If we found a loadout in the most recent file, that's authoritative
    if (latest) break;
  }

  return latest;
}

// ===== Journal History — Lifetime Stats =====

export interface JournalHistoryStats {
  // Meta
  firstEventDate: string | null;
  lastEventDate: string | null;
  journalFileCount: number;

  // Travel
  totalJumps: number;
  totalDistanceLY: number;
  uniqueSystemsVisited: number;
  uniqueStationsDocked: number;
  topSystems: { name: string; visits: number; lastVisited: string }[];
  /** All system visits — full dataset for search/filter */
  allSystemVisits: { name: string; visits: number; firstVisited: string; lastVisited: string }[];
  /** Top stations by dock count (per system:station composite) */
  topStations: { name: string; systemName: string; visits: number; firstVisited: string; lastVisited: string }[];
  /** All station visits — full dataset for search/filter */
  allStationVisits: { name: string; systemName: string; visits: number; firstVisited: string; lastVisited: string }[];

  // Exploration
  bodiesScanned: number;
  bodiesDiscovered: number; // WasDiscovered === false
  surfaceMapped: number; // SAAScanComplete
  efficientMaps: number; // ProbesUsed <= EfficiencyTarget
  systemsHonked: number;
  earthlikesFound: number;
  earthlikesDiscovered: number; // WasDiscovered === false
  waterWorldsFound: number;
  waterWorldsDiscovered: number;
  ammoniaWorldsFound: number;
  ammoniaWorldsDiscovered: number;
  landablesFound: number;
  explorationEarnings: number;
  totalLandings: number; // All player-controlled Touchdown events
  firstFootfalls: number; // Touchdown with FirstFootFall === true
  firstFootfallLocations: { body: string; system: string; timestamp: string }[];

  // Combat
  bountiesCollected: number;
  bountyEarnings: number;
  combatBonds: number;
  combatBondEarnings: number;
  deaths: number;
  interdictions: number;
  interdictionEscapes: number;

  // Trade
  tonsBought: number;
  tonsSold: number;
  creditsSpent: number;
  creditsEarned: number;
  topCommoditiesBought: { name: string; tons: number }[];
  topCommoditiesSold: { name: string; tons: number }[];

  // Missions
  missionsCompleted: number;
  missionEarnings: number;

  // Colonization
  contributionsMade: number;
  systemsClaimed: number;

  // Farthest from Sol (computed from FSDJump StarPos)
  farthestFromSolLY: number;
  farthestSystemName: string | null;

  // Game-provided lifetime stats (from Statistics event)
  gameStats: {
    timePlayed?: number;
    currentWealth?: number;
    greatestDistance?: number;
    enginesUsed?: number;
  } | null;
}

/**
 * Resolve a commodity name to its proper display name.
 * Journal events use internal names like "steel" or "$steel_name;" — this
 * looks up the canonical display name from our commodity definitions.
 */
function resolveCommodityDisplayName(localised: string | undefined, raw: string): string {
  // Try Type_Localised first (already human-readable if present)
  if (localised) {
    const byDisplay = findCommodityByDisplayName(localised);
    if (byDisplay) return byDisplay.name;
    // Capitalise properly if not in our DB
    return localised;
  }
  // Try journal-token format ($steel_name;)
  const byJournal = findCommodityByJournalName(raw);
  if (byJournal) return byJournal.name;
  // Try as bare internal name (e.g. "steel" → "$steel_name;")
  const asToken = `$${raw.toLowerCase()}_name;`;
  const byToken = findCommodityByJournalName(asToken);
  if (byToken) return byToken.name;
  // Try display name match on raw
  const byRawDisplay = findCommodityByDisplayName(raw);
  if (byRawDisplay) return byRawDisplay.name;
  // Last resort — title-case the raw name
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
}

export async function scanJournalHistory(
  dirHandle?: FileSystemDirectoryHandle,
  onProgress?: (pct: number, phase: string) => void,
): Promise<JournalHistoryStats> {
  const handle = dirHandle || journalDirHandle;
  if (!handle) throw new Error('No journal directory available');

  try {
    await ensurePermission(handle);
  } catch {
    throw new Error('Permission denied to journal directory');
  }

  const journalFiles = await getJournalFileHandles(handle);
  const totalFiles = journalFiles.length;

  // Aggregation state
  const systemVisits = new Map<string, number>();
  const systemFirstVisited = new Map<string, string>();
  const systemLastVisited = new Map<string, string>();
  const stationSet = new Set<string>();
  // Per-station visit tracking — keyed by "system:station" to disambiguate
  const stationVisits = new Map<string, number>();
  const stationSystems = new Map<string, string>(); // key → system name
  const stationFirstSeen = new Map<string, string>();
  const stationLastSeen = new Map<string, string>();
  const commoditiesBought = new Map<string, number>();
  const commoditiesSold = new Map<string, number>();
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  let totalJumps = 0;
  let totalDistanceLY = 0;
  let bodiesScanned = 0;
  let bodiesDiscovered = 0;
  let surfaceMapped = 0;
  let efficientMaps = 0;
  let systemsHonked = 0;
  let earthlikes = 0;
  let earthlikesDiscovered = 0;
  let waterWorlds = 0;
  let waterWorldsDiscovered = 0;
  let ammoniaWorlds = 0;
  let ammoniaWorldsDiscovered = 0;
  let landables = 0;
  let explorationEarnings = 0;
  let totalLandings = 0;
  let firstFootfalls = 0;
  const firstFootfallLocations: { body: string; system: string; timestamp: string }[] = [];
  let bountiesCollected = 0;
  let bountyEarnings = 0;
  let combatBonds = 0;
  let combatBondEarnings = 0;
  let deaths = 0;
  let interdictions = 0;
  let interdictionEscapes = 0;
  let tonsBought = 0;
  let tonsSold = 0;
  let creditsSpent = 0;
  let creditsEarned = 0;
  let missionsCompleted = 0;
  let missionEarnings = 0;
  let contributionsMade = 0;
  const claimedSystems = new Set<string>();
  let latestStats: StatisticsEvent | null = null;

  let prevJumpPos: [number, number, number] | null = null;
  let farthestFromSol = 0;
  let farthestSystemName: string | null = null;

  // Process files in batches to avoid blocking the UI
  for (let i = 0; i < totalFiles; i++) {
    if (onProgress && i % 5 === 0) {
      onProgress(Math.round((i / totalFiles) * 100), `Reading journal ${i + 1} of ${totalFiles}...`);
      // Yield to UI thread
      await new Promise((r) => setTimeout(r, 0));
    }

    const entry = journalFiles[i];
    const file = await entry.handle.getFile();
    const text = await file.text();
    const lines = text.split('\n');
    const parsed = parseJournalLines(lines);

    // Track timestamps
    for (const e of parsed.fsdJumpEvents) {
      if (!firstTimestamp || e.timestamp < firstTimestamp) firstTimestamp = e.timestamp;
      if (!lastTimestamp || e.timestamp > lastTimestamp) lastTimestamp = e.timestamp;
    }
    for (const e of parsed.dockedEvents) {
      if (!firstTimestamp || e.timestamp < firstTimestamp) firstTimestamp = e.timestamp;
      if (!lastTimestamp || e.timestamp > lastTimestamp) lastTimestamp = e.timestamp;
    }

    // Travel
    for (const e of parsed.fsdJumpEvents) {
      totalJumps++;
      const sys = e.StarSystem;
      systemVisits.set(sys, (systemVisits.get(sys) ?? 0) + 1);
      const prevFirst = systemFirstVisited.get(sys);
      if (!prevFirst || e.timestamp < prevFirst) systemFirstVisited.set(sys, e.timestamp);
      const prevLast = systemLastVisited.get(sys);
      if (!prevLast || e.timestamp > prevLast) systemLastVisited.set(sys, e.timestamp);

      if (e.StarPos) {
        const pos: [number, number, number] = [e.StarPos[0], e.StarPos[1], e.StarPos[2]];
        if (prevJumpPos) {
          const dx = pos[0] - prevJumpPos[0];
          const dy = pos[1] - prevJumpPos[1];
          const dz = pos[2] - prevJumpPos[2];
          totalDistanceLY += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        prevJumpPos = pos;
        // Track farthest point from Sol (0,0,0)
        const distFromSol = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
        if (distFromSol > farthestFromSol) {
          farthestFromSol = distFromSol;
          farthestSystemName = sys;
        }
      }
    }

    // Docking — skip ephemeral stations (FCs, Trailblazers, construction sites)
    for (const e of parsed.dockedEvents) {
      if (isEphemeralStation(e.StationName, e.StationType, e.MarketID)) continue;
      const key = `${e.StarSystem}:${e.StationName}`;
      stationSet.add(key);
      stationVisits.set(key, (stationVisits.get(key) ?? 0) + 1);
      stationSystems.set(key, e.StarSystem);
      if (!stationFirstSeen.has(key) || e.timestamp < stationFirstSeen.get(key)!) {
        stationFirstSeen.set(key, e.timestamp);
      }
      if (!stationLastSeen.has(key) || e.timestamp > stationLastSeen.get(key)!) {
        stationLastSeen.set(key, e.timestamp);
      }
    }

    // Exploration
    for (const e of parsed.scanEvents) {
      bodiesScanned++;
      if (e.WasDiscovered === false) bodiesDiscovered++;
      if (e.PlanetClass === 'Earthlike body') {
        earthlikes++;
        if (e.WasDiscovered === false) earthlikesDiscovered++;
      }
      if (e.PlanetClass === 'Water world') {
        waterWorlds++;
        if (e.WasDiscovered === false) waterWorldsDiscovered++;
      }
      if (e.PlanetClass === 'Ammonia world') {
        ammoniaWorlds++;
        if (e.WasDiscovered === false) ammoniaWorldsDiscovered++;
      }
      if (e.Landable) landables++;
    }
    for (const e of parsed.saaScanCompleteEvents) {
      surfaceMapped++;
      if (e.ProbesUsed <= e.EfficiencyTarget) efficientMaps++;
    }
    systemsHonked += parsed.fssDiscoveryScanEvents.length;

    for (const e of parsed.touchdownEvents) {
      if (e.PlayerControlled !== false) {
        totalLandings++;
        if (e.FirstFootFall === true) {
          firstFootfalls++;
          firstFootfallLocations.push({
            body: e.Body,
            system: e.StarSystem,
            timestamp: e.timestamp,
          });
        }
      }
    }

    for (const e of parsed.sellExplorationDataEvents) {
      explorationEarnings += e.TotalEarnings || 0;
    }
    for (const e of parsed.multiSellExplorationDataEvents) {
      explorationEarnings += e.TotalEarnings || 0;
    }

    // Combat
    for (const e of parsed.bountyEvents) {
      bountiesCollected++;
      bountyEarnings += e.TotalReward || 0;
    }
    for (const e of parsed.factionKillBondEvents) {
      combatBonds++;
      combatBondEarnings += e.Reward || 0;
    }
    deaths += parsed.diedEvents.length;
    for (const e of parsed.interdictedEvents) {
      interdictions++;
      if (!e.Submitted) interdictionEscapes++;
    }

    // Trade — resolve commodity names to proper display names
    for (const e of parsed.marketBuyEvents) {
      tonsBought += e.Count;
      creditsSpent += e.TotalCost;
      const name = resolveCommodityDisplayName(e.Type_Localised, e.Type);
      commoditiesBought.set(name, (commoditiesBought.get(name) ?? 0) + e.Count);
    }
    for (const e of parsed.marketSellEvents) {
      tonsSold += e.Count;
      creditsEarned += e.TotalSale;
      const name = resolveCommodityDisplayName(e.Type_Localised, e.Type);
      commoditiesSold.set(name, (commoditiesSold.get(name) ?? 0) + e.Count);
    }

    // Missions
    for (const e of parsed.missionCompletedEvents) {
      missionsCompleted++;
      missionEarnings += e.Reward || 0;
    }

    // Colonization
    contributionsMade += parsed.contributionEvents.length;
    // Count unique systems claimed from both SystemClaim and BeaconPlaced events
    for (const e of parsed.systemClaimEvents) {
      if (e.StarSystem) claimedSystems.add(e.StarSystem);
    }
    for (const e of parsed.beaconPlacedEvents) {
      if (e.StarSystem) claimedSystems.add(e.StarSystem);
    }

    // Statistics (use the latest one)
    for (const e of parsed.statisticsEvents) {
      if (!latestStats || e.timestamp > latestStats.timestamp) {
        latestStats = e;
      }
    }
  }

  onProgress?.(100, 'Done');

  // Build top lists
  const allSystemVisits = [...systemVisits.entries()]
    .map(([name, visits]) => ({
      name,
      visits,
      firstVisited: systemFirstVisited.get(name) || '',
      lastVisited: systemLastVisited.get(name) || '',
    }))
    .sort((a, b) => b.visits - a.visits);

  const topSystems = allSystemVisits.slice(0, 20);

  const allStationVisits = [...stationVisits.entries()]
    .map(([key, visits]) => {
      const stationName = key.substring(key.indexOf(':') + 1);
      return {
        name: stationName,
        systemName: stationSystems.get(key) ?? '',
        visits,
        firstVisited: stationFirstSeen.get(key) ?? '',
        lastVisited: stationLastSeen.get(key) ?? '',
      };
    })
    .sort((a, b) => b.visits - a.visits);
  const topStations = allStationVisits.slice(0, 20);

  const topCommoditiesBought = [...commoditiesBought.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, tons]) => ({ name, tons }));

  const topCommoditiesSold = [...commoditiesSold.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, tons]) => ({ name, tons }));

  return {
    firstEventDate: firstTimestamp,
    lastEventDate: lastTimestamp,
    journalFileCount: totalFiles,
    totalJumps,
    totalDistanceLY: Math.round(totalDistanceLY),
    uniqueSystemsVisited: systemVisits.size,
    uniqueStationsDocked: stationSet.size,
    topSystems,
    allSystemVisits,
    topStations,
    allStationVisits,
    bodiesScanned,
    bodiesDiscovered,
    surfaceMapped,
    efficientMaps,
    systemsHonked,
    earthlikesFound: earthlikes,
    earthlikesDiscovered,
    waterWorldsFound: waterWorlds,
    waterWorldsDiscovered,
    ammoniaWorldsFound: ammoniaWorlds,
    ammoniaWorldsDiscovered,
    landablesFound: landables,
    explorationEarnings,
    totalLandings,
    firstFootfalls,
    firstFootfallLocations: firstFootfallLocations.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    bountiesCollected,
    bountyEarnings,
    combatBonds,
    combatBondEarnings,
    deaths,
    interdictions,
    interdictionEscapes,
    tonsBought,
    tonsSold,
    creditsSpent,
    creditsEarned,
    topCommoditiesBought,
    topCommoditiesSold,
    missionsCompleted,
    missionEarnings,
    contributionsMade,
    systemsClaimed: claimedSystems.size,
    farthestFromSolLY: Math.round(farthestFromSol),
    farthestSystemName,
    gameStats: latestStats ? {
      timePlayed: latestStats.Exploration?.Time_Played,
      currentWealth: latestStats.Bank_Account?.Current_Wealth,
      greatestDistance: latestStats.Exploration?.Greatest_Distance_From_Start,
      enginesUsed: latestStats.Crafting?.Count_Of_Used_Engineers,
    } : null,
  };
}
