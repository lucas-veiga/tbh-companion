import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import { rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), "tbh-test-item-nameids");

vi.mock("electron", () => ({
  app: { getPath: () => testDir },
}));

const { loadItemNameIds, saveItemNameIds } =
  await import("../../src/main/services/itemNameIdCache");

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
});

describe("itemNameIdCache", () => {
  it("returns empty object when file does not exist", () => {
    expect(loadItemNameIds()).toEqual({});
  });

  it("roundtrips save and load", () => {
    const ids = { "TBH Gear A Alpha": 176105068, "TBH Gear B Beta": 176105069 };
    saveItemNameIds(ids);
    expect(loadItemNameIds()).toEqual(ids);
  });

  it("returns empty object when file is malformed JSON", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "item_nameids.json"), "not-json");
    expect(loadItemNameIds()).toEqual({});
  });
});
