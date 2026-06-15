import { useEffect, useMemo, useState, startTransition, type ReactNode } from "react";
import type { Stats, ResolvedInventory, PriceStatus, PriceProgress, BuyOrderUpdate } from "../../../shared/types";
import { formatPriceRefreshMessage } from "../lib/formatPriceRefreshMessage";
import { reportIpcError } from "../lib/reportError";
import { TbhContext } from "./tbhContext";

function mergeBuyOrders(inv: ResolvedInventory, update: BuyOrderUpdate): ResolvedInventory {
  if (update.entries.length === 0) return inv;
  const byHash = new Map(update.entries.map((e) => [e.marketHashName, e]));
  const rows = inv.rows.map((row) => {
    if (!row.marketHashName) return row;
    const e = byHash.get(row.marketHashName);
    if (!e) return row;
    return {
      ...row,
      buyOrderPrice: e.highestBuyOrder,
      buyOrderPriceRaw: e.rawHighestBuyOrder,
      buyOrderChecked: true,
    };
  });
  return { ...inv, rows };
}

export function TbhProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [inventory, setInventory] = useState<ResolvedInventory | null>(null);
  const [priceStatus, setPriceStatus] = useState<PriceStatus | null>(null);
  const [priceProgress, setPriceProgress] = useState<PriceProgress | null>(null);
  const [lastPriceRefreshMessage, setLastPriceRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    function applyBuyOrders(update: BuyOrderUpdate): void {
      setInventory((prev) => (prev ? mergeBuyOrders(prev, update) : prev));
    }

    void Promise.all([
      window.tbh.getStats(),
      window.tbh.getInventory(),
      window.tbh.pricesStatus(),
      window.tbh.getBuyOrders(),
    ])
      .then(([s, inv, ps, buyOrderUpdate]) => {
        if (!mounted) return;
        if (s) setStats(s);
        if (inv) setInventory(mergeBuyOrders(inv, buyOrderUpdate));
        setPriceStatus(ps);
      })
      .catch(reportIpcError);

    const offBuyOrders = window.tbh.onBuyOrders((update) => {
      if (mounted) applyBuyOrders(update);
    });
    const offStats = window.tbh.onStats((s) => setStats(s));
    const offInventory = window.tbh.onInventory((inv) => setInventory(inv));
    const offPriceStatus = window.tbh.onPriceStatus((ps) => {
      if (mounted) {
        setPriceStatus(ps);
        if (ps.freshCount === 0) {
          setLastPriceRefreshMessage(null);
        }
      }
    });
    const offProgress = window.tbh.onPricesProgress((p) => {
      if (p.finished) {
        startTransition(() => setPriceProgress(null));
        void window.tbh
          .pricesStatus()
          .then((ps) => {
            if (!mounted) return;
            setPriceStatus(ps);
            if (p.result) {
              setLastPriceRefreshMessage(
                formatPriceRefreshMessage({ ok: true, ...p.result, ownedTargets: ps.ownedTargets }),
              );
            }
          })
          .catch(reportIpcError);
        return;
      }
      startTransition(() => setPriceProgress(p));
      void window.tbh
        .pricesStatus()
        .then((ps) => {
          if (mounted) setPriceStatus(ps);
        })
        .catch(reportIpcError);
    });

    return () => {
      mounted = false;
      offBuyOrders();
      offStats();
      offInventory();
      offPriceStatus();
      offProgress();
    };
  }, []);

  const value = useMemo(
    () => ({
      stats,
      inventory,
      priceStatus,
      priceProgress,
      lastPriceRefreshMessage,
      setPriceStatus,
      clearPriceProgress: () => setPriceProgress(null),
      clearLastPriceRefreshMessage: () => setLastPriceRefreshMessage(null),
    }),
    [stats, inventory, priceStatus, priceProgress, lastPriceRefreshMessage],
  );

  return <TbhContext.Provider value={value}>{children}</TbhContext.Provider>;
}
