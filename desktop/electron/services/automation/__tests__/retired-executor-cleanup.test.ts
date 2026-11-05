import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { build } from "esbuild"
import { afterEach, describe, expect, it, vi } from "vitest"
import { JsonNamespace } from "../../../runtime/data-repo/backends/json"
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"
import { AutomationItemRepository } from "../item-repository"
import type { AutomationItem } from "../types"
import { RetiredExecutorCleanup } from "../retired-executor-cleanup"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function harness() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-only-")); directories.push(dir)
  const workerPath = path.join(dir, "worker.cjs")
  await build({ entryPoints: [path.join(__dirname, "../retired-executor-cleanup-worker.ts")], outfile: workerPath, platform: "node", format: "cjs", bundle: true })
  const changes = new JsonNamespace<AutomationItem>({ name: "automation.items", schemaVersion: 1, backend: "json", filePath: path.join(dir, "items.json") })
  const items = new AutomationItemRepository({ items: changes, triggers: createBuiltinAutomationTriggerRegistry() })
  const logger = { warn: vi.fn() }
  const cleanup = new RetiredExecutorCleanup({ items, changes, workerPath, logger })
  return { changes, items, cleanup, logger }
}
function item(id: string, type: string): AutomationItem {
  return { id, schemaVersion: 2, name: id, enabled: true, scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
    executor: { type, config: { prompt: "原样保留", unknownField: true } },
    policy: { missedRunPolicy: "run_once", overlapPolicy: "skip" },
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", runCount: 7, configVersion: 3 }
}
describe("Agent-only Automation cleanup", () => {
  it("deletes retired types in batches and preserves both supported configurations exactly", async () => {
    const h = await harness()
    const agent = item("agent", "builtin.agent")
    await h.changes.upsert(agent)
    const claudeCode = item("claude", "builtin.claude-code")
    await h.changes.upsert(claudeCode)
    for (let i = 0; i < 55; i++) await h.changes.upsert(item(`legacy:${i}`, ["builtin.command", "builtin.script", "builtin.http-request", "builtin.workflow", "builtin.javascript-run", "builtin.nodejs-run", "unknown"][i % 7]!))
    try {
      await h.cleanup.start()
      expect(await h.items.list()).toEqual([agent, claudeCode])
      await h.cleanup.run()
      expect(await h.items.get("agent")).toEqual(agent)
      await h.changes.upsert(item("restored", "builtin.command"))
      await h.cleanup.run()
      expect(await h.items.list()).toEqual([agent, claudeCode])
    } finally { await h.cleanup.stop() }
  })
  it("rechecks the current type before deleting a stale candidate", async () => {
    const h = await harness()
    const legacy = item("converted", "builtin.command")
    await h.changes.upsert(legacy)
    await h.items.update(legacy.id, { executor: { type: "builtin.claude-code", config: legacy.executor.config } })
    expect(await h.items.deleteNonAgent(legacy.id)).toBe(false)
    expect((await h.items.get(legacy.id))?.executor.type).toBe("builtin.claude-code")
  })
  it("does not delete an Agent restored while a candidate deletion is waiting", async () => {
    const h = await harness()
    const legacy = item("restored-agent", "builtin.command")
    const agent = item(legacy.id, "builtin.agent")
    await h.changes.upsert(legacy)
    const original = h.changes.removeIfUnchanged.bind(h.changes)
    vi.spyOn(h.changes, "removeIfUnchanged").mockImplementationOnce(async (id, expected) => {
      await h.changes.upsert(agent)
      return original(id, expected)
    })
    expect(await h.items.deleteNonAgent(legacy.id)).toBe(false)
    expect(await h.items.get(legacy.id)).toEqual(agent)
  })
  it("retains a failed deletion and succeeds on a later retry", async () => {
    const h = await harness()
    await h.changes.upsert(item("legacy", "builtin.command"))
    const remove = vi.spyOn(h.changes, "removeIfUnchanged").mockRejectedValueOnce(new Error("disk unavailable"))
    try {
      await expect(h.cleanup.start()).rejects.toThrow("disk unavailable")
      expect(await h.items.get("legacy")).not.toBeNull()
      await h.cleanup.run()
      expect(await h.items.get("legacy")).toBeNull()
      expect(remove).toHaveBeenCalledTimes(2)
    } finally { await h.cleanup.stop() }
  })

  it("never deletes legacy configurations", async () => {
    const h = await harness()
    const legacy = { ...item("legacy", "builtin.command"), schemaVersion: 1 as const }
    await h.changes.upsert(legacy)
    try {
      await h.cleanup.start()
      expect(await h.items.get(legacy.id)).toEqual(legacy)
      expect(await h.items.deleteNonAgent(legacy.id)).toBe(false)
    } finally { await h.cleanup.stop() }
  })
})
