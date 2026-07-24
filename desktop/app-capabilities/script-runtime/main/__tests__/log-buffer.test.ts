import { describe, expect, it } from "vitest"

import { SCRIPT_LOG_MAX_BYTES } from "../../shared/json"
import { ScriptLogBuffer } from "../log-buffer"

const MARKER = "[log output truncated]"

describe("ScriptLogBuffer", () => {
  it.each([
    ["ASCII", "a".repeat(SCRIPT_LOG_MAX_BYTES)],
    ["three-byte Unicode", "中".repeat(Math.ceil(SCRIPT_LOG_MAX_BYTES / 3))],
    ["four-byte Unicode", "😀".repeat(Math.ceil(SCRIPT_LOG_MAX_BYTES / 4))],
  ])("keeps %s content and the marker within the shared byte limit", (_label, value) => {
    const logs = new ScriptLogBuffer()

    logs.append("console", value)
    logs.append("console", "ignored")

    expect(totalBytes(logs.values())).toBeLessThanOrEqual(SCRIPT_LOG_MAX_BYTES)
    expect(logs.values().filter((entry) => entry.value === MARKER)).toHaveLength(1)
    expect(logs.values().some((entry) => entry.value.includes("\uFFFD"))).toBe(false)
  })

  it("shares one byte budget across entries", () => {
    const logs = new ScriptLogBuffer()

    logs.append("console", "a".repeat(SCRIPT_LOG_MAX_BYTES - 10))
    logs.append("stderr", "中".repeat(20))

    expect(totalBytes(logs.values())).toBeLessThanOrEqual(SCRIPT_LOG_MAX_BYTES)
    expect(logs.values().filter((entry) => entry.value === MARKER)).toHaveLength(1)
    expect(logs.values().some((entry) => entry.value.includes("\uFFFD"))).toBe(false)
  })

  it("does not add a marker at exactly the limit", () => {
    const logs = new ScriptLogBuffer()

    logs.append("console", "a".repeat(SCRIPT_LOG_MAX_BYTES))

    expect(totalBytes(logs.values())).toBe(SCRIPT_LOG_MAX_BYTES)
    expect(logs.values()).toHaveLength(1)
    expect(logs.values()[0]?.value).not.toContain(MARKER)
  })

  it("reserves marker bytes when content exceeds the limit by one byte", () => {
    const logs = new ScriptLogBuffer()

    logs.append("console", "a".repeat(SCRIPT_LOG_MAX_BYTES + 1))

    expect(totalBytes(logs.values())).toBe(SCRIPT_LOG_MAX_BYTES)
    expect(logs.values().at(-1)?.value).toBe(MARKER)
  })

  it("returns an immutable snapshot that does not change with later appends", () => {
    const logs = new ScriptLogBuffer()
    logs.append("stderr", "first")

    const snapshot = logs.values()
    logs.append("stderr", "second")

    expect(snapshot).toEqual([{ label: "stderr", value: "first" }])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot[0])).toBe(true)
    expect(logs.values()).toEqual([
      { label: "stderr", value: "first" },
      { label: "stderr", value: "second" },
    ])
  })
})

function totalBytes(values: readonly { readonly value: string }[]): number {
  return values.reduce((total, entry) => total + Buffer.byteLength(entry.value, "utf8"), 0)
}
