/**
 * Phase 0.1 — Smoke test for buildServiceRegistry().
 *
 * We mock electron / electron-updater so the SQLite + auto-updater chain stays
 * inert. The point of this test is structural: registry contains all 9 SPEC §4
 * services with the correct dependsOn graph, and planStartOrder() succeeds
 * (no cycles, no missing deps) without invoking any service.
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
  it("registers all 11 SPEC §4 services with correct dependsOn graph", async () => {
    const { buildServiceRegistry } = await import("../registry")
    const registry = buildServiceRegistry({
      trayShowOrCreate: () => {},
    })

    const inspected = registry.inspect()
    const ids = inspected.map((e) => e.id).sort()
    expect(ids).toEqual(
      [
        "core.app-icon",
        "core.config",
        "core.data-store",
        "core.event-bus",
        "core.logging",
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
    expect(byId.get("core.app-icon")?.dependsOn).toEqual([])
    expect(byId.get("core.window-manager")?.dependsOn).toEqual([])
    expect(byId.get("core.event-bus")?.dependsOn).toEqual(["core.window-manager"])
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
    expect(idx("repo.watch")).toBeLessThan(idx("repo.maintenance"))
    expect(idx("core.data-store")).toBeLessThan(idx("repo.pending-pushes"))
    expect(idx("core.app-icon")).toBeLessThan(idx("ui.tray"))
  })

  it("fatal services include core.config, core.logging, core.window-manager, and core.event-bus", async () => {
    const { buildServiceRegistry } = await import("../registry")
    const registry = buildServiceRegistry({ trayShowOrCreate: () => {} })
    const inspected = registry.inspect()
    const fatals = inspected.filter((e) => e.criticality === "fatal").map((e) => e.id).sort()
    expect(fatals).toEqual(["core.config", "core.event-bus", "core.logging", "core.window-manager"].sort())
  })
})
