/**
 * Phase 0.1 — Smoke test for buildServiceRegistry().
 *
 * We mock electron / electron-updater so the SQLite + auto-updater chain stays
 * inert. The point of this test is structural: registry contains the expected
 * bootstrap services with the correct dependsOn graph, and planStartOrder()
 * succeeds (no cycles, no missing deps) without invoking any service.
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: () => {},
    once: () => {},
    setFeedURL: () => {},
    checkForUpdates: () => Promise.resolve(null),
    downloadUpdate: () => Promise.resolve([]),
    quitAndInstall: () => {},
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    fullChangelog: false,
    forceDevUpdateConfig: false,
    logger: null,
  },
  CancellationToken: class {},
}))

const tmpUserData = "/tmp/synapse-build-registry-" + Date.now()
vi.mock("electron", () => ({
  app: {
    getPath: (which: string) =>
      which === "userData" ? tmpUserData : `/tmp/synapse-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    getAppPath: () => "/tmp/synapse-test-app",
    isPackaged: false,
    on: () => {},
    once: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() {
      return []
    }
  },
  dialog: {},
  ipcMain: { handle: () => {}, on: () => {} },
  shell: {},
  Tray: class {},
  Menu: { buildFromTemplate: () => ({}) },
  Notification: class {
    static isSupported() {
      return false
    }
    on() {}
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: {},
}))

describe("buildServiceRegistry (T1.8)", () => {
  it("registers all bootstrap services with correct dependsOn graph", async () => {
    const { buildServiceRegistry } = await import("../registry")
    const registry = buildServiceRegistry({
      trayShowOrCreate: () => {},
    })

    const inspected = registry.inspect()
    const ids = inspected.map((e) => e.id).sort()
    expect(ids).toEqual(
      [
        "core.action-runtime",
        "agent.conversation-window-service",
        "core.audit-sink",
        "core.app-icon",
        "core.agent-personas",
        "core.automation",
        "core.automation-ingress",
        "core.bridge-adapter",
        "core.cheat-code-state",
        "core.config",
        "core.data-repository",
        "core.database",
        "core.diagnostics",
        "core.drive-sync",
        "core.event-bus",
        "core.execution-isolation",
        "core.http-test",
        "core.logging",
        "core.model-price",
        "core.network-registry",
        "core.permission-guard",
        "core.process-environment",
        "core.process-runtime",
        "core.project-containers",
        "core.quick-input",
        "core.relay",
        "core.secrets",
        "core.side-channel",
        "core.sound-notifier",
        "core.synapse-skill",
        "core.terminal",
        "core.update",
        "core.usage-analysis",
        "core.window-manager",
        "core.workflow",
        "core.workflow.engine",
        "core.workflow.package",
        "core.workflow.param-presets",
        "core.workflow.run-aborts",
        "core.workflow.run-statuses",
        "core.workflow.snapshots",
        "core.workflow.window-manager",
        "git.access-service",
        "git.branch-service",
        "git.clone-service",
        "git.command-runner",
        "git.commit-service",
        "git.environment-service",
        "git.history-service",
        "git.repository-registry",
        "git.status-service",
        "git.sync-service",
        "knowledge-base.service",
        "knowledge-base.storage-migration-service",
        "provider",
        "repo.maintenance",
        "repo.pending-pushes",
        "repo.sync-coordinator",
        "repo.watch",
        "ui.tray",
      ].sort(),
    )

    const byId = new Map(inspected.map((e) => [e.id, e] as const))
    expect(byId.get("core.config")?.dependsOn).toEqual([])
    expect(byId.get("core.logging")?.dependsOn).toEqual([])
    expect(byId.get("core.audit-sink")?.dependsOn).toEqual(["core.data-repository"])
    expect(byId.get("core.data-repository")?.dependsOn).toEqual([])
    expect(byId.get("core.agent-personas")?.dependsOn).toEqual(["core.data-repository"])
    expect(byId.get("core.secrets")?.dependsOn).toEqual(["core.data-repository", "core.config"])
    expect(byId.get("provider")?.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.workflow",
      "core.agent-personas",
    ])
    expect(byId.get("core.network-registry")?.dependsOn).toEqual([])
    expect(byId.get("core.terminal")?.dependsOn).toEqual([])
    expect(byId.get("git.command-runner")?.dependsOn).toEqual([])
    expect(byId.get("core.sound-notifier")?.dependsOn).toEqual(["core.data-repository", "core.window-manager"])
    expect(byId.get("core.synapse-skill")?.dependsOn).toEqual([])
    expect(byId.get("core.drive-sync")?.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(byId.get("git.access-service")?.dependsOn).toEqual([
      "git.command-runner",
      "core.process-environment",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(byId.get("git.repository-registry")?.dependsOn).toEqual([])
    expect(byId.get("git.environment-service")?.dependsOn).toEqual(["git.command-runner", "core.process-environment"])
    expect(byId.get("git.clone-service")?.dependsOn).toEqual(["git.command-runner", "git.repository-registry"])
    expect(byId.get("git.status-service")?.dependsOn).toEqual(["git.command-runner"])
    expect(byId.get("git.commit-service")?.dependsOn).toEqual(["git.command-runner"])
    expect(byId.get("git.sync-service")?.dependsOn).toEqual(["git.command-runner", "git.status-service"])
    expect(byId.get("git.branch-service")?.dependsOn).toEqual(["git.command-runner", "git.status-service"])
    expect(byId.get("git.history-service")?.dependsOn).toEqual(["git.command-runner"])
    expect(byId.get("core.permission-guard")?.dependsOn).toEqual([])
    expect(byId.get("core.process-runtime")?.dependsOn).toEqual([])
    expect(byId.get("core.app-icon")?.dependsOn).toEqual([])
    expect(byId.get("knowledge-base.service")?.dependsOn).toEqual([])
    expect(byId.get("knowledge-base.storage-migration-service")?.dependsOn).toEqual([
      "core.event-bus",
      "core.project-containers",
    ])
    expect(byId.get("core.window-manager")?.dependsOn).toEqual([])
    expect(byId.get("agent.conversation-window-service")?.dependsOn).toEqual(["core.window-manager"])
    expect(byId.get("core.event-bus")?.dependsOn).toEqual(["core.window-manager"])
    expect(byId.get("core.action-runtime")?.dependsOn).toEqual([
      "core.process-environment",
      "core.permission-guard",
      "core.audit-sink",
      "core.event-bus",
      "core.workflow",
      "core.workflow.engine",
      "core.workflow.snapshots",
      "core.workflow.run-aborts",
      "core.workflow.run-statuses",
    ])
    expect(byId.get("core.project-containers")?.dependsOn).toEqual([
      "core.process-environment",
      "core.event-bus",
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(byId.get("core.side-channel")?.dependsOn).toEqual([
      "core.network-registry",
      "core.project-containers",
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.execution-isolation",
    ])
    expect(byId.get("core.bridge-adapter")?.dependsOn).toEqual([
      "core.network-registry",
      "core.project-containers",
      "core.side-channel",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(byId.get("core.automation")?.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.action-runtime",
      "core.event-bus",
    ])
    expect(byId.get("core.execution-isolation")?.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(byId.get("core.relay")?.dependsOn).toEqual([
      "core.project-containers",
      "core.side-channel",
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(byId.get("core.automation-ingress")?.dependsOn).toEqual([
      "core.network-registry",
      "core.project-containers",
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.execution-isolation",
    ])
    expect(byId.get("core.database")?.dependsOn).toEqual([
      "core.config",
      "core.event-bus",
      "core.automation",
      "core.action-runtime",
      "core.workflow",
      "core.workflow.snapshots",
      "core.workflow.run-aborts",
      "core.workflow.run-statuses",
      "core.workflow.engine",
      "core.permission-guard",
      "core.audit-sink",
      "core.terminal",
      "core.sound-notifier",
      "provider",
    ])
    expect(byId.get("core.diagnostics")?.dependsOn).toEqual([
      "core.process-environment",
      "core.config",
      "core.logging",
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.database",
    ])
    expect(byId.get("core.update")?.dependsOn).toEqual(["core.config", "core.window-manager"])
    expect(byId.get("repo.watch")?.dependsOn).toEqual(["core.config", "core.event-bus"])
    expect(byId.get("repo.maintenance")?.dependsOn).toEqual(["repo.watch", "repo.pending-pushes"])
    expect(byId.get("repo.pending-pushes")?.dependsOn).toEqual(["core.database"])
    expect(byId.get("repo.sync-coordinator")?.dependsOn).toEqual([
      "core.event-bus",
      "repo.pending-pushes",
    ])
    expect(byId.get("ui.tray")?.dependsOn).toEqual(["core.app-icon"])

    // Every registered service starts pending.
    expect(inspected.every((e) => e.status === "pending")).toBe(true)
  }, 10_000)

  it("planStartOrder() succeeds — graph is acyclic and all deps resolve", async () => {
    const { buildServiceRegistry } = await import("../registry")
    const registry = buildServiceRegistry({ trayShowOrCreate: () => {} })
    expect(() => registry.planStartOrder()).not.toThrow()
    const order = registry.planStartOrder().map((d) => d.id)
    // Each dependency precedes its dependent.
    const idx = (id: string) => order.indexOf(id)
    expect(idx("core.config")).toBeLessThan(idx("core.database"))
    expect(idx("core.action-runtime")).toBeLessThan(idx("core.database"))
    expect(idx("core.automation")).toBeLessThan(idx("core.database"))
    expect(idx("core.config")).toBeLessThan(idx("core.diagnostics"))
    expect(idx("core.config")).toBeLessThan(idx("repo.watch"))
    expect(idx("core.data-repository")).toBeLessThan(idx("core.project-containers"))
    expect(idx("core.data-repository")).toBeLessThan(idx("core.audit-sink"))
    expect(idx("core.event-bus")).toBeLessThan(idx("core.project-containers"))
    expect(idx("core.permission-guard")).toBeLessThan(idx("core.project-containers"))
    expect(idx("core.audit-sink")).toBeLessThan(idx("core.project-containers"))
    expect(idx("core.project-containers")).toBeLessThan(idx("core.side-channel"))
    expect(idx("core.side-channel")).toBeLessThan(idx("core.bridge-adapter"))
    expect(idx("core.data-repository")).toBeLessThan(idx("core.automation"))
    expect(idx("core.permission-guard")).toBeLessThan(idx("core.automation"))
    expect(idx("core.audit-sink")).toBeLessThan(idx("core.automation"))
    expect(idx("core.action-runtime")).toBeLessThan(idx("core.automation"))
    expect(idx("core.event-bus")).toBeLessThan(idx("core.automation"))
    expect(idx("repo.watch")).toBeLessThan(idx("repo.maintenance"))
    expect(idx("core.database")).toBeLessThan(idx("repo.pending-pushes"))
    expect(idx("repo.pending-pushes")).toBeLessThan(idx("repo.maintenance"))
    expect(idx("core.event-bus")).toBeLessThan(idx("repo.sync-coordinator"))
    expect(idx("repo.pending-pushes")).toBeLessThan(idx("repo.sync-coordinator"))
    expect(idx("core.database")).toBeLessThan(idx("core.diagnostics"))
    expect(idx("core.app-icon")).toBeLessThan(idx("ui.tray"))
    expect(idx("git.command-runner")).toBeLessThan(idx("git.access-service"))
    expect(idx("core.process-environment")).toBeLessThan(idx("git.access-service"))
  })

  it("fatal services include runtime foundations", async () => {
    const { buildServiceRegistry } = await import("../registry")
    const registry = buildServiceRegistry({ trayShowOrCreate: () => {} })
    const inspected = registry.inspect()
    const fatals = inspected.filter((e) => e.criticality === "fatal").map((e) => e.id).sort()
    expect(fatals).toEqual([
      "core.action-runtime",
      "core.audit-sink",
      "core.config",
      "core.data-repository",
      "core.event-bus",
      "core.logging",
      "core.network-registry",
      "core.permission-guard",
      "core.process-runtime",
      "core.project-containers",
      "core.window-manager",
      "provider",
    ].sort())
  })

  it("broadcasts sound notifier playback requests without requiring prior IPC calls", async () => {
    const { coreSoundNotifierDescriptor } = await import("../descriptors")
    const broadcast = vi.fn(() => 1)
    const namespace = {
      name: "memory",
      schemaVersion: 3,
      backend: "json",
      getSingleton: vi.fn(async () => null),
      setSingleton: vi.fn(),
      clearSingleton: vi.fn(),
      list: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      get: vi.fn(async () => null),
      upsert: vi.fn(),
      remove: vi.fn(),
      onChange: vi.fn(() => () => {}),
    }
    const context = {
      registry: {
        get(id: string) {
          if (id === "core.data-repository") {
            return { namespace: vi.fn(() => namespace) }
          }
          if (id === "core.window-manager") {
            return { broadcast }
          }
          throw new Error(id)
        },
      },
      logger: {
        child: vi.fn(() => ({
          warn: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        })),
      },
    }

    const service = await coreSoundNotifierDescriptor.create(context as never)
    await service.play({ eventType: "success" })

    expect(broadcast).toHaveBeenCalledWith(
      "synapse:app:sound_notifier:operation:play_requested",
      {
        eventType: "success",
        presetId: "done",
        repeatCount: 1,
        intervalMs: 1000,
      },
    )
  })
})
