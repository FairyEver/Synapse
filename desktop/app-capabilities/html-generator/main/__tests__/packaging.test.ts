import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, it } from "vitest"
import packageJson from "../../../../package.json"
import electronTsconfig from "../../../../tsconfig.electron.json"
import { resolveHtmlGenerationWorkerPath } from "../worker-launch"

const require = createRequire(import.meta.url)
const ejsPackagePath = path.resolve(require.resolve("ejs"), "../../../package.json")
const ejsPackage = JSON.parse(readFileSync(ejsPackagePath, "utf8")) as {
  readonly version: string
  readonly main: string
  readonly license: string
}

describe("HTML Generator packaging", () => {
  it("pins EJS and keeps the Worker, sourcemap, and runtime in one unpacked closure", () => {
    expect(packageJson.dependencies.ejs).toBe("6.0.1")
    expect(ejsPackage).toMatchObject({ version: "6.0.1", main: "./lib/cjs/ejs.js", license: "Apache-2.0" })
    expect(packageJson.build.asarUnpack).toContain("dist-electron/app-capabilities/html-generator/**")
    expect(packageJson.build.asarUnpack).toContain("node_modules/ejs/**")
    expect(electronTsconfig.include).toContain("app-capabilities/html-generator/main/worker.ts")
    expect(resolveHtmlGenerationWorkerPath(
      "/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/app-capabilities/html-generator/main",
    )).toBe(path.join(
      "/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/dist-electron/app-capabilities/html-generator/main",
      "worker.js",
    ))
  })
})
