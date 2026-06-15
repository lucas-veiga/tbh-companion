import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type ItemNameIdMap = Record<string, number>;

function cachePath(): string {
  try {
    return join(app.getPath("userData"), "item_nameids.json");
  } catch {
    return join(process.cwd(), "item_nameids.json");
  }
}

export function loadItemNameIds(): ItemNameIdMap {
  const path = cachePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ItemNameIdMap;
  } catch {
    return {};
  }
}

export function saveItemNameIds(ids: ItemNameIdMap): void {
  const path = cachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ids));
}
