import { describe, expect, it } from "vitest"
import {
  getSystemAppDefinition,
  listSystemAppDefinitions,
  parseSystemAppId,
} from "../definitions"
import {
  getSystemAppManifest,
  listLaunchableSystemApps,
  listSystemApps,
} from "../registry"

describe("system app registry", () => {
  it("lists all system apps in launcher order", () => {
    expect(listSystemApps().map((app) => app.id)).toEqual([
      "agent",
      "workflow",
      "drive",
      "automation",
      "launcher",
      "settings",
      "resource-repository",
      "git",
      "database",
      "document-template",
      "terminal",
      "screenshot",
      "editor-scan",
      "usage-monitor",
      "model-price",
    ])
  })

  it("exposes stable namespaces and Dock metadata", () => {
    expect(getSystemAppManifest("launcher")).toMatchObject({
      id: "launcher",
      namespace: "launcher",
      name: "应用",
      dock: { pinnedByDefault: true, order: 50 },
    })
    expect(getSystemAppManifest("database")).toMatchObject({
      namespace: "database",
      capabilities: {
        primaryMcpPrefix: "app_database",
        legacyMcpPrefixes: ["database"],
      },
    })
    expect(getSystemAppManifest("resource-repository")).toMatchObject({
      namespace: "resource_repository",
      capabilities: {
        primaryMcpPrefix: "app_resource_repository",
        legacyMcpPrefixes: ["content"],
      },
    })
  })

  it("lists launchable apps without the launcher entry", () => {
    const launchableAppIds = listLaunchableSystemApps().map((app) => app.id)

    expect(launchableAppIds).not.toContain("launcher")
    expect(launchableAppIds).not.toContain("workflow")
    expect(launchableAppIds).toContain("database")
    expect(launchableAppIds).toContain("resource-repository")
    expect(launchableAppIds).toEqual(listSystemApps().map((app) => app.id).filter((id) => id !== "launcher" && id !== "workflow"))
  })

  it("filters hidden workflow from launchable apps", () => {
    expect(listLaunchableSystemApps({ workflowEntryVisible: false }).map((app) => app.id))
      .not.toContain("workflow")
    expect(listLaunchableSystemApps({ workflowEntryVisible: true }).map((app) => app.id))
      .toContain("workflow")
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
      expect(app.namespace.length).toBeGreaterThan(0)
      expect(app.dock).toBeDefined()
      expect(app.window).toBeDefined()
      expect(app.capabilities?.primaryMcpPrefix).toMatch(/^app_[a-z0-9_]+$/)
    }
  })

  it("exposes pure definitions without icon URLs for Electron", () => {
    const definitions = listSystemAppDefinitions()
    expect(definitions.map((app) => app.id)).toEqual(listSystemApps().map((app) => app.id))
    expect(definitions.every((app) => !("icon" in app))).toBe(true)
    expect(getSystemAppDefinition("model-price")?.windowTitle).toBe("价格管理")
    expect(getSystemAppDefinition("screenshot")?.windowTitle).toBe("截图")
  })

  it("gets and parses known app ids only", () => {
    expect(getSystemAppManifest("database")?.name).toBe("本地数据库")
    expect(getSystemAppManifest("unknown")).toBeNull()
    expect(parseSystemAppId("launcher")).toBe("launcher")
    expect(parseSystemAppId("usage-monitor")).toBe("usage-monitor")
    expect(parseSystemAppId("unknown")).toBeNull()
  })
})
