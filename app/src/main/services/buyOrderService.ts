import type { BuyOrderEntry, BuyOrderUpdate } from "../../../shared/types";
import { IPC } from "../../../shared/ipc";
import { broadcast } from "./broadcast";
import { loadItemNameIds, saveItemNameIds } from "./itemNameIdCache";
import { fetchItemNameId, fetchHighestBuyOrder } from "./buyOrderApi";
import { loadBuyOrderCache, persistBuyOrderCache, type BuyOrderCache } from "./buyOrderCache";
import { FRESH_TTL_MS } from "./steamMarketConstants";
import { createLogger } from "../log";

const log = createLogger("buyOrders");
const DEFAULT_DELAY_MS = 1500;
const MAX_DELAY_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

async function sleepInterruptible(ms: number, isCancelled: () => boolean): Promise<void> {
  const step = 100;
  let remaining = ms;
  while (remaining > 0 && !isCancelled()) {
    await sleep(Math.min(step, remaining));
    remaining -= step;
  }
}

export class BuyOrderService {
  private currency: string;
  private cache: BuyOrderCache;
  private itemNameIds: Record<string, number>;
  private running = false;
  private cancelled = false;

  constructor(currency: string) {
    this.currency = currency.toUpperCase();
    this.cache = loadBuyOrderCache(this.currency);
    this.itemNameIds = loadItemNameIds();
  }

  setCurrency(currency: string): void {
    const next = currency.toUpperCase();
    if (next === this.currency) return;
    this.currency = next;
    this.cache = loadBuyOrderCache(next);
  }

  cancel(): void {
    this.cancelled = true;
  }

  isBuyOrderFresh(name: string, now = Date.now()): boolean {
    const entry = this.cache.entries[name];
    if (!entry) return false;
    return now - Date.parse(entry.fetchedUtc) < FRESH_TTL_MS;
  }

  getCurrentState(): BuyOrderUpdate {
    return {
      currency: this.currency,
      entries: Object.entries(this.cache.entries).map(([name, e]) => ({
        marketHashName: name,
        highestBuyOrder: e.highestBuyOrder,
        rawHighestBuyOrder: e.rawHighestBuyOrder,
        fetchedUtc: e.fetchedUtc,
      })),
    };
  }

  async queue(marketHashNames: string[]): Promise<void> {
    if (this.running) return;

    const now = Date.now();
    const stale = marketHashNames.filter((name) => !this.isBuyOrderFresh(name, now));
    if (stale.length === 0) return;

    this.running = true;
    this.cancelled = false;
    log.info(`BuyOrders: fetching ${stale.length} items for ${this.currency}`);

    let delayMs = DEFAULT_DELAY_MS;
    let i = 0;

    try {
      while (i < stale.length) {
        if (this.cancelled) break;
        const name = stale[i];

        // Step 1: get item_nameid (cached or fetch listing page)
        let nameId = this.itemNameIds[name];
        if (nameId === undefined) {
          const r = await fetchItemNameId(name);
          if (this.cancelled) break;

          if (r.status === 429) {
            delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
            log.warn(`Rate-limited (listing) ${name}, backoff=${Math.round(delayMs / 1000)}s`);
            await sleepInterruptible(delayMs, () => this.cancelled);
            continue;
          }
          if (!r.ok || r.itemNameId === null) {
            log.warn(`Could not get item_nameid for "${name}" (status=${r.status})`);
            await sleepInterruptible(DEFAULT_DELAY_MS, () => this.cancelled);
            i++;
            continue;
          }
          nameId = r.itemNameId;
          this.itemNameIds[name] = nameId;
          saveItemNameIds(this.itemNameIds);

          await sleepInterruptible(DEFAULT_DELAY_MS, () => this.cancelled);
          if (this.cancelled) break;
        }

        // Step 2: fetch histogram
        const r = await fetchHighestBuyOrder(nameId, this.currency);
        if (this.cancelled) break;

        if (r.status === 429) {
          delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
          log.warn(`Rate-limited (histogram) ${name}, backoff=${Math.round(delayMs / 1000)}s`);
          await sleepInterruptible(delayMs, () => this.cancelled);
          continue;
        }

        delayMs = DEFAULT_DELAY_MS;
        const fetchedUtc = new Date().toISOString();
        this.cache.entries[name] = {
          highestBuyOrder: r.highestBuyOrder,
          rawHighestBuyOrder: r.rawHighestBuyOrder,
          fetchedUtc,
        };
        persistBuyOrderCache(this.cache);

        const entry: BuyOrderEntry = {
          marketHashName: name,
          highestBuyOrder: r.highestBuyOrder,
          rawHighestBuyOrder: r.rawHighestBuyOrder,
          fetchedUtc,
        };
        broadcast(IPC.BUY_ORDERS, {
          entries: [entry],
          currency: this.currency,
        } satisfies BuyOrderUpdate);
        log.info(`BuyOrders: priced ${name} → ${r.rawHighestBuyOrder ?? "no orders"}`);

        await sleepInterruptible(delayMs, () => this.cancelled);
        i++;
      }
    } finally {
      this.running = false;
    }
  }
}
