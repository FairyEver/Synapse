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

  it("checks release public app URL before bumping a local mac release", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts?: Record<string, string>
    }
    const releaseMac = packageJson.scripts?.["release:mac"] ?? ""

    expect(releaseMac).toContain("node scripts/release/package-mac-release.mjs --check && pnpm bump:commit:push")
    expect(releaseMac).toContain("node scripts/release/package-mac-release.mjs && node scripts/release/publish-mac-release.mjs")
  })

  it("keeps the shared workspace runtime package in packaged apps", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly build?: { readonly files?: readonly string[] }
    }

    expect(packageJson.build?.files).toContain("node_modules/@synapse/shared/**/*")
  })

  it("does not expose a committed E2E test script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      readonly scripts?: Record<string, string>
    }
    const e2eScript = ["test", "e2e"].join(":")

    expect(packageJson.scripts).not.toHaveProperty(e2eScript)
  })
})
