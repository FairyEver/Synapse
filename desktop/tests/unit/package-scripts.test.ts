import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("desktop package scripts", () => {
  it("rebuilds before local installer packaging", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts?: Record<string, string>
    }
    const scripts = packageJson.scripts ?? {}

    expect(scripts["package:mac"]).toMatch(/^pnpm build && pnpm package:mac:compiled$/)
    expect(scripts["package:win"]).toMatch(/^pnpm build && pnpm package:win:compiled$/)
    expect(scripts["package:mac:compiled"]).toContain("electron-builder --mac")
    expect(scripts["package:win:compiled"]).toContain("electron-builder --win")
  })
})
