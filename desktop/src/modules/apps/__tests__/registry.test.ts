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
      "document-template",
      "skill-installer",
      "skill-uninstaller",
      "synapse-skill",
      "secrets",
      "rule-installer",
      "quick-input",
      "sound-notifier",
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
    expect(getSystemAppManifest("agent-personas")).toMatchObject({
      id: "agent-personas",
      namespace: "agent_personas",
      name: "智能体",
      windowTitle: "智能体",
      dock: { pinnedByDefault: false, order: 15 },
      capabilities: {
        primaryMcpPrefix: "app_agent_personas",
      },
    })
    expect(getSystemAppManifest("synapse-skill")).toMatchObject({
      id: "synapse-skill",
      namespace: "synapse_skill",
      name: "Synapse Skill",
      windowTitle: "Synapse Skill",
      dock: { pinnedByDefault: false, order: 290 },
      capabilities: {
        primaryMcpPrefix: "app_synapse_skill",
      },
    })
    expect(getSystemAppManifest("secrets")).toMatchObject({
      id: "secrets",
      namespace: "secrets",
      name: "密钥库",
      windowTitle: "密钥库",
      dock: { pinnedByDefault: false, order: 260 },
      capabilities: {
        primaryMcpPrefix: "app_secrets",
      },
    })
    expect(getSystemAppManifest("skill-uninstaller")).toMatchObject({
      id: "skill-uninstaller",
      namespace: "skill_uninstaller",
      name: "Skill 卸载器",
      windowTitle: "Skill 卸载器",
      dock: { pinnedByDefault: false, order: 285 },
      capabilities: {
        primaryMcpPrefix: "app_skill_uninstaller",
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

  it("uses a distinct icon for the Skill uninstaller", () => {
    const installer = getSystemAppManifest("skill-installer")
    const uninstaller = getSystemAppManifest("skill-uninstaller")

    expect(uninstaller?.icon).not.toBe(installer?.icon)
  })

  it("exposes pure definitions without icon URLs for Electron", () => {
    const definitions = listSystemAppDefinitions()
    expect(definitions.map((app) => app.id)).toEqual(listSystemApps().map((app) => app.id))
    expect(definitions.every((app) => !("icon" in app))).toBe(true)
    expect(getSystemAppDefinition("model-price")?.windowTitle).toBe("价格管理")
    expect(getSystemAppDefinition("sound-notifier")?.windowTitle).toBe("Sound Notifier")
  })

  it("gets and parses known app ids only", () => {
    expect(getSystemAppManifest("database")?.name).toBe("本地数据库")
    expect(getSystemAppManifest("unknown")).toBeNull()
    expect(parseSystemAppId("launcher")).toBe("launcher")
    expect(parseSystemAppId("usage-monitor")).toBe("usage-monitor")
    expect(parseSystemAppId("unknown")).toBeNull()
  })
})
