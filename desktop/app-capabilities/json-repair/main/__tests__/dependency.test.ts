import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { repairJson } from "repair-json-stream"
import {
  extractAllJson,
  stripLlmWrapper,
} from "repair-json-stream/extract"

const require = createRequire(import.meta.url)
const desktopRoot = path.resolve(__dirname, "../../../..")
const dependencyEntry = require.resolve("repair-json-stream")
const dependencyRoot = path.resolve(dependencyEntry, "../..")

describe("repair-json-stream dependency contract", () => {
  it("pins the reviewed upstream version exactly", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> }

    expect(packageJson.dependencies?.["repair-json-stream"]).toBe("1.3.1")
  })

  it("retains the upstream MIT license", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(dependencyRoot, "package.json"), "utf8"),
    ) as { license?: string; version?: string }
    const license = await readFile(path.join(dependencyRoot, "LICENSE"), "utf8")

    expect(packageJson).toMatchObject({ license: "MIT", version: "1.3.1" })
    expect(license).toContain("MIT License")
    expect(license).toContain("Permission is hereby granted, free of charge")
  })

  it("resolves every public export used by the repair pipeline", () => {
    expect(repairJson("{value:1}")).toBe('{"value":1}')
    expect(stripLlmWrapper("Result: {\"value\":1}")).toContain("{\"value\":1}")
    expect(extractAllJson('before {"value":1} after')).toEqual(['{"value":1}'])
  })
})
