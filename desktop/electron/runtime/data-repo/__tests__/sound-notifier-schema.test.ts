import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { JsonNamespace } from "../backends/json"
import {
  reviveSoundNotifierSettingsEnvelope,
  soundNotifierSettingsSchemaDefinition,
  type SoundNotifierSettingsEntryV3,
} from "../schemas"

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-sound-notifier-"))

describe("sound notifier settings schema", () => {
  it("revives persisted v1 default-preset settings as v3 settings", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "app.sound-notifier.settings.json")

    try {
      await writeFile(file, JSON.stringify({
        schemaVersion: 1,
        singleton: {
          schemaVersion: 1,
          enabled: false,
          selectedPresetId: "done",
          volume: 42,
        },
        items: {},
      }), "utf8")

      const namespace = new JsonNamespace<SoundNotifierSettingsEntryV3>({
        name: soundNotifierSettingsSchemaDefinition.name,
        schemaVersion: soundNotifierSettingsSchemaDefinition.currentVersion,
        backend: "json",
        filePath: file,
        validate: soundNotifierSettingsSchemaDefinition.validate,
        reviveEnvelope: reviveSoundNotifierSettingsEnvelope,
      })

      await expect(namespace.getSingleton()).resolves.toEqual({
        schemaVersion: 3,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("revives persisted v2 volume settings as v3 settings", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "app.sound-notifier.settings.json")

    try {
      await writeFile(file, JSON.stringify({
        schemaVersion: 2,
        singleton: {
          schemaVersion: 2,
          volume: 42,
        },
        items: {},
      }), "utf8")

      const namespace = new JsonNamespace<SoundNotifierSettingsEntryV3>({
        name: soundNotifierSettingsSchemaDefinition.name,
        schemaVersion: soundNotifierSettingsSchemaDefinition.currentVersion,
        backend: "json",
        filePath: file,
        validate: soundNotifierSettingsSchemaDefinition.validate,
        reviveEnvelope: reviveSoundNotifierSettingsEnvelope,
      })

      await expect(namespace.getSingleton()).resolves.toEqual({
        schemaVersion: 3,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
