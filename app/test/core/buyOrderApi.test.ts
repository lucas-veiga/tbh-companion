import { describe, it, expect } from "vitest";
import { parseItemNameId, parseHistogramResponse } from "../../src/main/services/buyOrderApi";

describe("parseItemNameId", () => {
  it("extracts id from Market_LoadOrderSpread call", () => {
    const html = `<script>Market_LoadOrderSpread( 176105068 );</script>`;
    expect(parseItemNameId(html)).toBe(176105068);
  });

  it("handles no surrounding spaces", () => {
    const html = `Market_LoadOrderSpread(999)`;
    expect(parseItemNameId(html)).toBe(999);
  });

  it("returns null when call is absent", () => {
    expect(parseItemNameId(`<html><body>nothing here</body></html>`)).toBeNull();
  });
});

describe("parseHistogramResponse", () => {
  it("returns null values when success is falsy", () => {
    expect(parseHistogramResponse({ success: 0 })).toEqual({
      highestBuyOrder: null,
      rawHighestBuyOrder: null,
    });
  });

  it("parses highest_buy_order string", () => {
    expect(parseHistogramResponse({ success: 1, highest_buy_order: "$0.17" })).toEqual({
      highestBuyOrder: 0.17,
      rawHighestBuyOrder: "$0.17",
    });
  });

  it("returns null price when highest_buy_order is absent", () => {
    expect(parseHistogramResponse({ success: 1 })).toEqual({
      highestBuyOrder: null,
      rawHighestBuyOrder: null,
    });
  });

  it("returns null price when highest_buy_order is not parseable", () => {
    expect(parseHistogramResponse({ success: 1, highest_buy_order: "N/A" })).toEqual({
      highestBuyOrder: null,
      rawHighestBuyOrder: "N/A",
    });
  });
});
