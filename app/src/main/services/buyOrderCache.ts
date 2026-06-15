import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CachedBuyOrder {
  highestBuyOrder: number | null;
  rawHighestBuyOrder: string | null;
  fetchedUtc: string;
}

export interface BuyOrderCache {
  currency: string;
  entries: Record<string, CachedBuyOrder>;
}

export function buyOrderCachePath(currency: string): string {
  const file = `buy_orders.${currency.toUpperCase()}.json`;
  try {
    return join(app.getPath("userData"), file);
  } catch {
    return join(process.cwd(), file);
  }
}

export function loadBuyOrderCache(currency: string): BuyOrderCache {
  const path = buyOrderCachePath(currency);
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
      const c = JSON.parse(raw) as BuyOrderCache;
      if (c && typeof c.entries === "object") return c;
    } catch {
      // fall through
    }
  }
  return { currency: currency.toUpperCase(), entries: {} };
}

export function persistBuyOrderCache(cache: BuyOrderCache): void {
  const path = buyOrderCachePath(cache.currency);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}
