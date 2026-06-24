import { describe, expect, it } from "vitest"
import {
  getSystemAppDefinition,
  listSystemAppDefinitions,
  parseSystemAppId,
} from "../definitions"
import {
  getSystemAppManifest,
  listSystemApps,
} from "../registry"

describe("system app registry", () => {
  it("lists the fixed first-phase system apps in launcher order", () => {
    expect(listSystemApps().map((app) => app.id)).toEqual([
      "resource-repository",
      "git",
      "database",
      "document-template",
      "terminal",
      "editor-scan",
      "usage-monitor",
      "model-price",
    ])
  })

  it("marks every system app as fixed", () => {
    for (const app of listSystemApps()) {
      expect(app.type).toBe("system")
      expect(app.removable).toBe(false)
      expect(app.renameable).toBe(false)
      expect(app.iconEditable).toBe(false)
      expect(app.icon).toMatch(/\.png/)
      expect(app.name.length).toBeGreaterThan(0)
      expect(app.windowTitle.length).toBeGreaterThan(0)
    }
  })

  it("exposes pure definitions without icon URLs for Electron", () => {
    const definitions = listSystemAppDefinitions()
    expect(definitions.map((app) => app.id)).toEqual(listSystemApps().map((app) => app.id))
    expect(definitions.every((app) => !("icon" in app))).toBe(true)
    expect(getSystemAppDefinition("model-price")?.windowTitle).toBe("价格管理")
  })

  it("gets and parses known app ids only", () => {
    expect(getSystemAppManifest("database")?.name).toBe("本地数据库")
    expect(getSystemAppManifest("unknown")).toBeNull()
    expect(parseSystemAppId("usage-monitor")).toBe("usage-monitor")
    expect(parseSystemAppId("unknown")).toBeNull()
  })
})
