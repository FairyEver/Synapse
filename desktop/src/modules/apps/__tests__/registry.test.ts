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
      "agent-personas",
      "workflow",
      "drive",
      "automation",
      "launcher",
      "settings",
      "resource-repository",
      "git",
      "database",
      "synapse-skill",
      "secrets",
      "quick-input",
      "terminal",
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
      dock: { pinnedByDefault: true, order: 60 },
    })
    expect(getSystemAppManifest("database")).toMatchObject({
      namespace: "database",
    })
    expect(getSystemAppManifest("resource-repository")).toMatchObject({
      namespace: "resource_repository",
    })
    expect(getSystemAppManifest("agent-personas")).toMatchObject({
      id: "agent-personas",
      namespace: "agent_personas",
      name: "智能体",
      windowTitle: "智能体",
      dock: { pinnedByDefault: false, order: 15 },
    })
    expect(getSystemAppManifest("synapse-skill")).toMatchObject({
      id: "synapse-skill",
      namespace: "synapse_skill",
      name: "Synapse Skill",
      windowTitle: "Synapse Skill",
      dock: { pinnedByDefault: false, order: 290 },
    })
    expect(getSystemAppManifest("secrets")).toMatchObject({
      id: "secrets",
      namespace: "secrets",
      name: "密钥库",
      windowTitle: "密钥库",
      dock: { pinnedByDefault: false, order: 260 },
    })
  })

  it("lists launchable apps without the launcher entry", () => {
    const launchableAppIds = listLaunchableSystemApps().map((app) => app.id)

    expect(launchableAppIds).not.toContain("launcher")
    expect(launchableAppIds).not.toContain("workflow")
    expect(launchableAppIds).toContain("database")
    expect(launchableAppIds).toContain("resource-repository")
    expect(launchableAppIds).toEqual(
      listSystemApps()
        .filter((app) => app.id !== "launcher" && app.visibility !== "workflow-entry-enabled")
        .map((app) => app.id),
    )
  })

  it("filters hidden workflow from launchable apps", () => {
    expect(listLaunchableSystemApps({ workflowEntryVisible: false }).map((app) => app.id))
      .not.toContain("workflow")
    expect(listLaunchableSystemApps({ workflowEntryVisible: true }).map((app) => app.id))
      .toContain("workflow")
  })

  it("marks every system app as fixed", () => {
    const apps = listSystemApps()
    expect(new Set(apps.map((app) => app.namespace)).size).toBe(apps.length)

    for (const app of apps) {
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
    expect(getSystemAppManifest("system-notifier")).toBeNull()
    expect(getSystemAppManifest("unknown")).toBeNull()
    expect(parseSystemAppId("launcher")).toBe("launcher")
    expect(parseSystemAppId("usage-monitor")).toBe("usage-monitor")
    expect(parseSystemAppId("file-opener")).toBeNull()
    expect(parseSystemAppId("unknown")).toBeNull()
  })
})
