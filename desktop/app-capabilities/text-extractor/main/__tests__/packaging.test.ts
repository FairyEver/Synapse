import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, it } from "vitest"
import packageJson from "../../../../package.json"
import electronTsconfig from "../../../../tsconfig.electron.json"
import { resolveTextExtractionWorkerPath } from "../service"

const require = createRequire(import.meta.url)
const mammothEntryPath = require.resolve("mammoth")
const mammothPackageJson = JSON.parse(readFileSync(
  path.resolve(mammothEntryPath, "../../package.json"),
  "utf8",
)) as { readonly license?: unknown }
const unpdfEntryPath = require.resolve("unpdf")
const unpdfPackageJson = JSON.parse(readFileSync(
  path.resolve(unpdfEntryPath, "../../package.json"),
  "utf8",
)) as { readonly license?: unknown }

describe("text extraction packaging", () => {
  it("resolves the worker and document parsers from the unpacked runtime closure", () => {
    expect(resolveTextExtractionWorkerPath(
      "/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/app-capabilities/text-extractor/main",
    )).toBe(path.join(
      "/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/dist-electron/app-capabilities/text-extractor/main",
      "worker.js",
    ))
    expect(packageJson.build.asarUnpack).toContain(
      "dist-electron/app-capabilities/text-extractor/**",
    )
    expect(packageJson.build.asarUnpack).toContain("node_modules/unpdf/**")
    expect(packageJson.build.asarUnpack).toContain("node_modules/mammoth/**")
    expect(packageJson.build.asarUnpack).toContain("node_modules/pizzip/**")
    expect(packageJson.dependencies.unpdf).toBeDefined()
    expect(packageJson.dependencies.mammoth).toBeDefined()
    expect(unpdfPackageJson.license).toBe("MIT")
    expect(mammothPackageJson.license).toBe("BSD-2-Clause")
    expect(electronTsconfig.include).toContain(
      "app-capabilities/text-extractor/main/worker.ts",
    )
  })
})
