import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

const ROOT = path.resolve(__dirname, "..", "..", "..", "..")
const OUTPUT = path.join(
  ROOT,
  "electron",
  "generated",
  "ipc-channels.generated.ts",
)

describe("IPC codegen output (T3.3)", () => {
  it("generated file exists at the expected path", () => {
    expect(existsSync(OUTPUT)).toBe(true)
  })

  it("generated file declares IPC_CHANNELS const + IpcChannelMap type", async () => {
    const text = await readFile(OUTPUT, "utf8")
    expect(text).toContain("export const IPC_CHANNELS")
    expect(text).toContain("export type IpcChannelMap = typeof IPC_CHANNELS")
    expect(text).toContain("AUTO-GENERATED FILE")
  })

  it("generated file is the only declaration touching IPC_CHANNELS — no manual edits", async () => {
    const text = await readFile(OUTPUT, "utf8")
    // The first non-blank, non-comment line after the leading docblock should
    // be either the eslint disable or a directive — never a manual `import` /
    // `function`.
    const meaningful = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    const firstCode = meaningful.find(
      (l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/**") && !l.startsWith("/*"),
    )
    expect(firstCode).toBeDefined()
    expect(firstCode).toMatch(/^export /)
  })
})
