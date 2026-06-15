import { currencyCode, parseMoney } from "../../core/steamPrice";

const APP_ID = 3678970;

/** Extract item_nameid from Steam Market listing page HTML. Exported for testing. */
export function parseItemNameId(html: string): number | null {
  const match = /Market_LoadOrderSpread\(\s*(\d+)\s*\)/.exec(html);
  return match ? Number(match[1]) : null;
}

/** Parse itemordershistogram JSON response. Exported for testing. */
export function parseHistogramResponse(data: { success?: number; highest_buy_order?: string }): {
  highestBuyOrder: number | null;
  rawHighestBuyOrder: string | null;
} {
  if (!data.success) return { highestBuyOrder: null, rawHighestBuyOrder: null };
  const raw = data.highest_buy_order ?? null;
  return { highestBuyOrder: parseMoney(raw), rawHighestBuyOrder: raw };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchItemNameId(
  marketHashName: string,
  appId = APP_ID,
  fetchFn: FetchFn = fetch,
): Promise<{ ok: boolean; status: number; itemNameId: number | null }> {
  const url = `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(marketHashName)}`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, status: 0, itemNameId: null };
  }
  if (res.status === 429) return { ok: false, status: 429, itemNameId: null };
  if (!res.ok) return { ok: false, status: res.status, itemNameId: null };
  const html = await res.text();
  return { ok: true, status: res.status, itemNameId: parseItemNameId(html) };
}

export async function fetchHighestBuyOrder(
  itemNameId: number,
  currency: string,
): Promise<{
  ok: boolean;
  status: number;
  highestBuyOrder: number | null;
  rawHighestBuyOrder: string | null;
}> {
  const code = currencyCode(currency);
  const url =
    `https://steamcommunity.com/market/itemordershistogram` +
    `?country=US&language=english&currency=${code}&item_nameid=${itemNameId}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (TBH Companion)" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, status: 0, highestBuyOrder: null, rawHighestBuyOrder: null };
  }
  if (res.status === 429)
    return { ok: false, status: 429, highestBuyOrder: null, rawHighestBuyOrder: null };
  if (!res.ok)
    return { ok: false, status: res.status, highestBuyOrder: null, rawHighestBuyOrder: null };
  const data = (await res.json()) as { success?: number; highest_buy_order?: string };
  return { ok: true, status: res.status, ...parseHistogramResponse(data) };
}
