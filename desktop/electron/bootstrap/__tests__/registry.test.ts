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
        "core.audit-sink",
        "core.app-icon",
        "core.config",
        "core.data-repository",
        "core.data-store",
        "core.event-bus",
        "core.logging",
        "core.network-registry",
        "core.permission-guard",
        "core.process-runtime",
        "core.project-containers",
        "core.update",
        "core.window-manager",
        "repo.maintenance",
        "repo.pending-pushes",
        "repo.watch",
        "ui.tray",
      ].sort(),
    )

    const byId = new Map(inspected.map((e) => [e.id, e] as const))
    expect(byId.get("core.config")?.dependsOn).toEqual([])
    expect(byId.get("core.logging")?.dependsOn).toEqual([])
    expect(byId.get("core.audit-sink")?.dependsOn).toEqual(["core.data-repository"])
    expect(byId.get("core.data-repository")?.dependsOn).toEqual([])
    expect(byId.get("core.network-registry")?.dependsOn).toEqual([])
    expect(byId.get("core.permission-guard")?.dependsOn).toEqual([])
    expect(byId.get("core.process-runtime")?.dependsOn).toEqual([])
    expect(byId.get("core.app-icon")?.dependsOn).toEqual([])
    expect(byId.get("core.window-manager")?.dependsOn).toEqual([])
    expect(byId.get("core.event-bus")?.dependsOn).toEqual(["core.window-manager"])
    expect(byId.get("core.project-containers")?.dependsOn).toEqual([
      "core.event-bus",
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(byId.get("core.data-store")?.dependsOn).toEqual(["core.config", "core.event-bus"])
    expect(byId.get("core.update")?.dependsOn).toEqual(["core.config", "core.window-manager"])
    expect(byId.get("repo.watch")?.dependsOn).toEqual(["core.config"])
    expect(byId.get("repo.maintenance")?.dependsOn).toEqual(["repo.watch"])
    expect(byId.get("repo.pending-pushes")?.dependsOn).toEqual(["core.data-store"])
    expect(byId.get("ui.tray")?.dependsOn).toEqual(["core.app-icon"])

    // Every registered service starts pending.
    expect(inspected.every((e) => e.status === "pending")).toBe(true)
  })

  it("planStartOrder() succeeds — graph is acyclic and all deps resolve", async () => {
    const { buildServiceRegistry } = await import("../registry")
    const registry = buildServiceRegistry({ trayShowOrCreate: () => {} })
    expect(() => registry.planStartOrder()).not.toThrow()
    const order = registry.planStartOrder().map((d) => d.id)
    // Each dependency precedes its dependent.
    const idx = (id: string) => order.indexOf(id)
    expect(idx("core.config")).toBeLessThan(idx("core.data-store"))
    expect(idx("core.config")).toBeLessThan(idx("repo.watch"))
    expect(idx("core.data-repository")).toBeLessThan(idx("core.project-containers"))
    expect(idx("core.data-repository")).toBeLessThan(idx("core.audit-sink"))
    expect(idx("core.event-bus")).toBeLessThan(idx("core.project-containers"))
    expect(idx("core.permission-guard")).toBeLessThan(idx("core.project-containers"))
    expect(idx("core.audit-sink")).toBeLessThan(idx("core.project-containers"))
    expect(idx("repo.watch")).toBeLessThan(idx("repo.maintenance"))
    expect(idx("core.data-store")).toBeLessThan(idx("repo.pending-pushes"))
    expect(idx("core.app-icon")).toBeLessThan(idx("ui.tray"))
  })

  it("fatal services include runtime foundations", async () => {
    const { buildServiceRegistry } = await import("../registry")
    const registry = buildServiceRegistry({ trayShowOrCreate: () => {} })
    const inspected = registry.inspect()
    const fatals = inspected.filter((e) => e.criticality === "fatal").map((e) => e.id).sort()
    expect(fatals).toEqual([
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
    ].sort())
  })
})
