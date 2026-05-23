import { describe, expect, it } from "vitest"
import {
  allPermissionKeys,
  assertActivePermissionKey,
  normalizePermissionKeys,
  permissionDefinitions,
} from "./permission-registry"

describe("permission registry", () => {
  it("keeps permission keys unique and kebab-case", () => {
    expect(new Set(allPermissionKeys).size).toBe(allPermissionKeys.length)
    for (const key of allPermissionKeys) {
      expect(key).toMatch(/^[a-z]+(?:-[a-z]+)*(?:\.[a-z]+(?:-[a-z]+)*){1,2}$/)
    }
  })

  it("rejects unknown permission keys", () => {
    expect(() => assertActivePermissionKey("database.use")).not.toThrow()
    expect(() => assertActivePermissionKey("page.database")).toThrow("Unknown permission key: page.database")
  })

  it("marks first-release permissions as active", () => {
    expect(permissionDefinitions.every((item) => item.status === "active")).toBe(true)
  })

  it("dedupes and sorts permission keys", () => {
    expect(normalizePermissionKeys(["workflow.use", "database.use", "workflow.use"])).toEqual([
      "database.use",
      "workflow.use",
    ])
  })

  it("rejects unknown keys when normalizing permissions", () => {
    expect(() => normalizePermissionKeys(["database.use", "page.database"])).toThrow(
      "Unknown permission key: page.database",
    )
  })
})
