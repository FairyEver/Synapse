import { describe, expect, it } from "vitest"
import {
  addUserPinnedDockAppId,
  readUserPinnedDockAppIds,
  removeUserPinnedDockAppId,
  writeUserPinnedDockAppIds,
} from "../dock-pins"

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe("dock pins", () => {
  it("persists pinned app ids and ignores unknown values", () => {
    const storage = new MemoryStorage()

    writeUserPinnedDockAppIds(storage, ["database", "ghost", "terminal", "database"])

    expect(readUserPinnedDockAppIds(storage)).toEqual(["database", "terminal"])
  })

  it("adds and removes user pinned apps without duplicates", () => {
    expect(addUserPinnedDockAppId(["database"], "database")).toEqual(["database"])
    expect(addUserPinnedDockAppId(["database"], "terminal")).toEqual(["database", "terminal"])
    expect(removeUserPinnedDockAppId(["database", "terminal"], "database")).toEqual(["terminal"])
  })
})
