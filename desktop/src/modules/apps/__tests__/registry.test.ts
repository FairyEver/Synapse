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
      "text-extractor",
      "file-opener",
      "text-file-writer",
      "html-generator",
      "json-repair",
      "skill-installer",
      "skill-uninstaller",
      "synapse-skill",
      "secrets",
      "rule-installer",
      "quick-input",
      "sound-notifier",
      "system-notifier",
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
    expect(getSystemAppManifest("file-opener")).toMatchObject({
      namespace: "file_opener",
      dock: { pinnedByDefault: false, order: 242 },
    })
    expect(getSystemAppManifest("text-file-writer")).toMatchObject({
      id: "text-file-writer",
      namespace: "text_file_writer",
      name: "文本写入文件",
      windowTitle: "文本写入文件",
      dock: { pinnedByDefault: false, order: 241 },
    })
    const htmlGenerator = getSystemAppManifest("html-generator")!
    expect(htmlGenerator).toMatchObject({
      id: "html-generator",
      namespace: "html_generator",
      name: "HTML 生成器",
      windowTitle: "HTML 生成器",
      dock: { pinnedByDefault: false, order: 243 },
      window: { openable: true },
      removable: false,
      renameable: false,
      iconEditable: false,
    })
    expect(htmlGenerator.icon).not.toBe(getSystemAppManifest("text-file-writer")!.icon)
    expect(htmlGenerator.icon).not.toBe(getSystemAppManifest("document-template")!.icon)
    expect(getSystemAppManifest("json-repair")).toMatchObject({
      id: "json-repair",
      namespace: "json_repair",
      name: "JSON Repair",
      windowTitle: "JSON Repair",
      dock: { pinnedByDefault: false, order: 244 },
      window: { openable: true },
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
    expect(getSystemAppManifest("skill-uninstaller")).toMatchObject({
      id: "skill-uninstaller",
      namespace: "skill_uninstaller",
      name: "Skill 卸载器",
      windowTitle: "Skill 卸载器",
      dock: { pinnedByDefault: false, order: 285 },
    })
    expect(getSystemAppManifest("text-extractor")).toMatchObject({
      id: "text-extractor",
      namespace: "text_extractor",
      name: "文本提取",
      windowTitle: "文本提取",
      dock: { pinnedByDefault: false, order: 245 },
      window: { openable: true },
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
    expect(getSystemAppDefinition("system-notifier")?.windowTitle).toBe("System Notifier")
    expect(getSystemAppDefinition("json-repair")?.windowTitle).toBe("JSON Repair")
  })

  it("gets and parses known app ids only", () => {
    expect(getSystemAppManifest("database")?.name).toBe("本地数据库")
    expect(getSystemAppManifest("unknown")).toBeNull()
    expect(parseSystemAppId("launcher")).toBe("launcher")
    expect(parseSystemAppId("usage-monitor")).toBe("usage-monitor")
    expect(parseSystemAppId("unknown")).toBeNull()
  })
})
