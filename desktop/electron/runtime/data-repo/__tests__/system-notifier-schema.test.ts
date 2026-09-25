import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { JsonNamespace } from "../backends/json"
import {
  reviveSystemNotifierSettingsEnvelope,
  systemNotifierSettingsSchemaDefinition,
  type SystemNotifierSettingsEntryV2,
} from "../schemas"

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-system-notifier-"))

async function readSingleton(singleton: unknown, schemaVersion: number) {
  const dir = await tempDir()
  const file = path.join(dir, "app.system-notifier.settings.json")
  try {
    await writeFile(file, JSON.stringify({ schemaVersion, singleton, items: {} }), "utf8")
    const namespace = new JsonNamespace<SystemNotifierSettingsEntryV2>({
      name: systemNotifierSettingsSchemaDefinition.name,
      schemaVersion: systemNotifierSettingsSchemaDefinition.currentVersion,
      backend: "json",
      filePath: file,
      validate: systemNotifierSettingsSchemaDefinition.validate,
      reviveEnvelope: reviveSystemNotifierSettingsEnvelope,
    })
    return await namespace.getSingleton()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("system notifier settings schema", () => {
  it("revives a v1 singleton that had notifications on as account sync on", async () => {
    await expect(readSingleton({ schemaVersion: 1, enabled: true, silent: true }, 1)).resolves.toEqual({
      schemaVersion: 2,
      enabled: true,
      silent: true,
      syncToAccount: true,
    })
  })

  it("revives a v1 singleton that had notifications off as account sync off", async () => {
    await expect(readSingleton({ schemaVersion: 1, enabled: false, silent: false }, 1)).resolves.toEqual({
      schemaVersion: 2,
      enabled: false,
      silent: false,
      syncToAccount: false,
    })
  })

  it("passes a v2 singleton through unchanged", async () => {
    await expect(readSingleton(
      { schemaVersion: 2, enabled: false, silent: false, syncToAccount: true },
      2,
    )).resolves.toEqual({
      schemaVersion: 2,
      enabled: false,
      silent: false,
      syncToAccount: true,
    })
  })
})
