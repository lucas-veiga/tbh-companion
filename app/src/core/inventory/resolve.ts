import type { GameItem } from "../gamedata";
import { marketHashCandidates } from "../marketName";
import { pickMarketUnit } from "../steamPrice";
import type {
  InventorySnapshot,
  InventoryItemInstance,
  ItemLocation,
  ResolvedInventory,
  ResolvedInventoryRow,
  InventoryComposition,
  InventoryPriceInfo,
} from "../../../shared/types";

export interface PriceLookup {
  (marketHashName: string): InventoryPriceInfo | undefined;
}

export interface ResolveInventoryOptions {
  /** Omit rows from the inventory table and composition (e.g. stage boxes). */
  excludeItemKey?: (itemKey: number) => boolean;
}

const EMPTY_UNIT = { unit: null, raw: null, source: null } as const;

type MarketUnit = ReturnType<typeof pickMarketUnit>;

interface MarketResolution {
  hash: string | null;
  unit: MarketUnit;
  priceChecked: boolean;
}

interface PriceProbe {
  hash: string;
  price: InventoryPriceInfo;
}

const NO_MARKET: MarketResolution = { hash: null, unit: EMPTY_UNIT, priceChecked: false };

function emptyComposition(): InventoryComposition {
  return {
    total: 0,
    byGrade: {},
    byType: {},
    tradableCount: 0,
    unknownCount: 0,
    chaoticCount: 0,
    inUseCount: 0,
    priceableCount: 0,
    valuedTotal: 0,
    currency: null,
  };
}

function resolveMarketHashAndPrice(
  catalogItem: GameItem,
  priceLookup?: PriceLookup,
): MarketResolution {
  const candidates = marketHashCandidates(catalogItem);
  if (candidates.length === 0) return NO_MARKET;

  const probes: PriceProbe[] = candidates
    .map((candidateHash) => ({ hash: candidateHash, price: priceLookup?.(candidateHash) }))
    .filter((probe): probe is PriceProbe => probe.price !== undefined);

  const pricedProbe = probes.find((probe) => pickMarketUnit(probe.price).unit != null);
  if (pricedProbe) {
    return {
      hash: pricedProbe.hash,
      unit: pickMarketUnit(pricedProbe.price),
      priceChecked: true,
    };
  }

  const firstHash = candidates[0];
  const firstProbe = probes.find((probe) => probe.hash === firstHash);
  return {
    hash: firstHash,
    unit: firstProbe ? pickMarketUnit(firstProbe.price) : EMPTY_UNIT,
    priceChecked: probes.length > 0,
  };
}

function createResolvedRow(
  itemKey: number,
  catalogItem: GameItem | undefined,
  market: MarketResolution,
): ResolvedInventoryRow {
  return {
    itemKey,
    name: catalogItem?.name ?? `Unknown #${itemKey}`,
    grade: catalogItem?.grade ?? "UNKNOWN",
    type: catalogItem?.type ?? "UNKNOWN",
    level: catalogItem?.level ?? null,
    marketTradable: catalogItem?.marketTradable ?? false,
    marketHashName: market.hash,
    count: 0,
    inUseCount: 0,
    inventoryCount: 0,
    stashCount: 0,
    tradingCount: 0,
    chaoticCount: 0,
    known: Boolean(catalogItem),
    priceRaw: market.unit.raw,
    unitPrice: market.unit.unit,
    priceSource: market.unit.source,
    priceChecked: market.priceChecked,
    value: null,
    buyOrderPrice: null,
    buyOrderPriceRaw: null,
    buyOrderChecked: false,
  };
}

function locationCountKey(
  location: ItemLocation,
): "inventoryCount" | "stashCount" | "tradingCount" | null {
  if (location === "inventory") return "inventoryCount";
  if (location === "stash") return "stashCount";
  if (location === "trading") return "tradingCount";
  return null;
}

function applyInstance(row: ResolvedInventoryRow, instance: InventoryItemInstance): void {
  row.count++;
  if (instance.inUse) row.inUseCount++;
  if (instance.isChaotic) row.chaoticCount++;
  const countKey = locationCountKey(instance.location);
  if (countKey) row[countKey]++;
}

function clearRowPricing(row: ResolvedInventoryRow): void {
  row.priceRaw = null;
  row.unitPrice = null;
  row.priceSource = null;
  row.priceChecked = false;
  row.value = null;
}

function accumulateCompositionRow(
  composition: InventoryComposition,
  row: ResolvedInventoryRow,
): void {
  composition.inUseCount += row.inUseCount;
  composition.total += row.count;
  composition.byGrade[row.grade] = (composition.byGrade[row.grade] ?? 0) + row.count;
  composition.byType[row.type] = (composition.byType[row.type] ?? 0) + row.count;
  if (row.marketTradable) composition.tradableCount += row.count;
  if (!row.known) composition.unknownCount += row.count;
  composition.chaoticCount += row.chaoticCount;

  if (!row.marketHashName) {
    clearRowPricing(row);
    return;
  }

  composition.priceableCount += row.count;
  if (row.unitPrice === null) return;

  row.value = row.unitPrice * row.count;
  composition.valuedTotal += row.value;
}

function finalizeRows(rows: ResolvedInventoryRow[]): InventoryComposition {
  const composition = emptyComposition();
  rows.forEach((row) => accumulateCompositionRow(composition, row));
  return composition;
}

function ensureRow(
  rowsByItemKey: Map<number, ResolvedInventoryRow>,
  itemKey: number,
  catalogItem: GameItem | undefined,
  priceLookup?: PriceLookup,
): ResolvedInventoryRow {
  const existing = rowsByItemKey.get(itemKey);
  if (existing) return existing;

  const market = catalogItem ? resolveMarketHashAndPrice(catalogItem, priceLookup) : NO_MARKET;
  const row = createResolvedRow(itemKey, catalogItem, market);
  rowsByItemKey.set(itemKey, row);
  return row;
}

function accumulateInstances(
  rowsByItemKey: Map<number, ResolvedInventoryRow>,
  items: InventoryItemInstance[],
  lookup: (itemKey: number) => GameItem | undefined,
  priceLookup: PriceLookup | undefined,
  excludeItemKey?: (itemKey: number) => boolean,
): void {
  items.forEach((instance) => {
    if (excludeItemKey?.(instance.itemKey)) return;
    const row = ensureRow(rowsByItemKey, instance.itemKey, lookup(instance.itemKey), priceLookup);
    applyInstance(row, instance);
  });
}

function mergeMaterialStacks(
  rowsByItemKey: Map<number, ResolvedInventoryRow>,
  stacks: Map<number, number>,
  lookup: (itemKey: number) => GameItem | undefined,
  priceLookup: PriceLookup | undefined,
  excludeItemKey?: (itemKey: number) => boolean,
): void {
  stacks.forEach((stackQty, itemKey) => {
    if (excludeItemKey?.(itemKey)) return;

    const catalogItem = lookup(itemKey);
    if (!catalogItem) return;

    const row = rowsByItemKey.has(itemKey)
      ? rowsByItemKey.get(itemKey)!
      : ensureRow(rowsByItemKey, itemKey, catalogItem, priceLookup);
    if (row.type !== "MATERIAL" || stackQty <= row.count) return;

    row.count = stackQty;
    row.inventoryCount = stackQty;
  });
}

export function resolveInventory(
  snapshot: InventorySnapshot,
  lookup: (itemKey: number) => GameItem | undefined,
  gameDataLoaded: boolean,
  priceLookup?: PriceLookup,
  options?: ResolveInventoryOptions,
): ResolvedInventory {
  const excludeItemKey = options?.excludeItemKey;
  const rowsByItemKey = new Map<number, ResolvedInventoryRow>();

  accumulateInstances(rowsByItemKey, snapshot.items, lookup, priceLookup, excludeItemKey);

  if (snapshot.materialStacks) {
    mergeMaterialStacks(
      rowsByItemKey,
      snapshot.materialStacks,
      lookup,
      priceLookup,
      excludeItemKey,
    );
  }

  const rows = [...rowsByItemKey.values()];
  const composition = finalizeRows(rows);

  return {
    rows,
    composition,
    chests: snapshot.chests,
    saveMtime: snapshot.saveMtime,
    gameDataLoaded,
    currency: null,
  };
}

export function ownedMarketNames(
  snapshot: InventorySnapshot,
  lookup: (itemKey: number) => GameItem | undefined,
  excludeItemKey?: (itemKey: number) => boolean,
): string[] {
  const names = new Set<string>();
  const seenItemKeys = new Set<number>();

  snapshot.items.forEach((instance) => {
    if (excludeItemKey?.(instance.itemKey)) return;
    if (seenItemKeys.has(instance.itemKey)) return;
    seenItemKeys.add(instance.itemKey);

    const catalogItem = lookup(instance.itemKey);
    if (!catalogItem) return;

    marketHashCandidates(catalogItem).forEach((marketHash) => names.add(marketHash));
  });

  return [...names];
}
