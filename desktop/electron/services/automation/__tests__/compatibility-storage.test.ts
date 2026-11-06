import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { JsonNamespace } from "../../../runtime/data-repo/backends/json"
import { DataRepositoryImpl } from "../../../runtime/data-repo/repository"
import { automationItemsSchema, type AutomationItemEntryV1 } from "../../../runtime/data-repo/schemas/placeholders"
import { sanitizeImportedAutomation } from "../../automation-mail-triggers/transfer"
import type { AutomationItem } from "../types"

const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })

function stored(id: string): AutomationItem {
  return {
    id, schemaVersion: 2, name: id, enabled: true, scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 60, anchor: "created_at" } },
    executor: { type: "builtin.agent", config: { prompt: "保留配置" } },
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
    createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z", runCount: 2, configVersion: 3,
  }
}

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-automation-compat-"))
  directories.push(dir)
  const open = (name: string) => new JsonNamespace<AutomationItemEntryV1>({
    name: "automation.items", schemaVersion: 1, backend: "json", filePath: path.join(dir, name), validate: automationItemsSchema.validate,
  })
  return { open }
}

describe("Automation compatibility persistence", () => {
  it("loads a future policy and scope alongside a current task without rejecting the collection", async () => {
    const { open } = await fixture()
    const writer = open("items.json")
    const future = Object.assign(stored("future"), {
      scope: { type: "future-scope", resource: "synthetic" },
      policy: { missedRunPolicy: "replay", overlapPolicy: "queue", queue: { limit: 3 } },
    }) as AutomationItem
    await writer.upsert(future)
    await writer.upsert(stored("current"))
    expect(await open("items.json").list()).toEqual([future, stored("current")])
  })

  it("exports and imports future configuration without losing fields or enabling it", async () => {
    const { open } = await fixture()
    const source = new DataRepositoryImpl()
    const original = open("source.json")
    source.register(automationItemsSchema, original)
    const future = { ...stored("future"), formatRevision: 2, metadata: { label: "保留" },
      executor: { type: "builtin.future", config: { nested: { newOption: true } } }, nextRunAt: "2026-11-07T00:00:00Z" }
    await original.upsert(future)
    await original.upsert(stored("current"))
    const backup = await source.exportAll()
    const target = new DataRepositoryImpl({ importTransforms: { "automation.items": sanitizeImportedAutomation } })
    target.register(automationItemsSchema, open("target.json"))
    await target.importAll(backup)
    expect(await open("target.json").get(future.id)).toEqual({ ...future, enabled: false, nextRunAt: undefined })
    expect(await open("target.json").get("current")).toEqual(stored("current"))
  })

  it("preserves a future overall version as disabled portable data", () => {
    const future = { ...stored("future"), schemaVersion: 3, formatRevision: 1 }
    expect(automationItemsSchema.validate(future)).toBe(true)
    expect(sanitizeImportedAutomation(future)).toEqual({ ...future, enabled: false, nextRunAt: undefined })
  })
})
