import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

describe("package entrypoint", () => {
  const packageDirectory = fileURLToPath(new URL("..", import.meta.url))

  it("does not load CommonJS-only modules from the ESM root entrypoint", async () => {
    const entrypoint = await readFile(new URL("../dist/index.js", import.meta.url), "utf8")
    const driveEntrypoint = await readFile(new URL("../dist/drive.js", import.meta.url), "utf8")

    expect(entrypoint).not.toContain("versioned-data-migrator.cjs")
    expect(driveEntrypoint).not.toContain("drive-sync-constants.cjs")
  })

  it("loads the ESM root without Node CommonJS interoperability", () => {
    const result = execFileSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "--eval", `
      import { readFileSync } from "node:fs"
      import { SourceTextModule } from "node:vm"

      const modules = new Map()
      function loadModule(url) {
        const identifier = url.href
        if (!modules.has(identifier)) {
          modules.set(identifier, new SourceTextModule(readFileSync(url, "utf8"), { identifier }))
        }
        return modules.get(identifier)
      }

      const entrypoint = loadModule(new URL("./dist/index.js", import.meta.url))
      await entrypoint.link((specifier, module) => loadModule(new URL(specifier, module.identifier)))
      await entrypoint.evaluate()
      process.stdout.write(JSON.stringify(entrypoint.namespace.NOTIFICATION_SOURCES))
    `], { cwd: packageDirectory, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] })

    expect(JSON.parse(result)).toEqual([
      "external", "system-notifier", "terminal-attention", "terminal-complete", "meeting-transcription", "mail",
    ])
  })

  it("exposes matching notification constants to native ESM and CommonJS consumers", () => {
    const result = execFileSync(process.execPath, ["--input-type=module", "--eval", `
      import { createRequire } from "node:module"
      import { NOTIFICATION_SOURCES as rootSources, DESKTOP_NOTIFICATION_SOURCES } from "@synapse/shared"
      import { NOTIFICATION_SOURCES as esmSources } from "@synapse/shared/notification-constants"

      const require = createRequire(import.meta.url)
      const { NOTIFICATION_SOURCES: cjsSources } = require("@synapse/shared/notification-constants")
      process.stdout.write(JSON.stringify({
        esmPath: import.meta.resolve("@synapse/shared/notification-constants"),
        cjsPath: require.resolve("@synapse/shared/notification-constants"),
        rootSources, esmSources, cjsSources, desktopSources: DESKTOP_NOTIFICATION_SOURCES,
      }))
    `], { cwd: packageDirectory, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] })
    const { esmPath, cjsPath, rootSources, esmSources, cjsSources, desktopSources } = JSON.parse(result)

    expect(esmPath).toMatch(/\.js$/)
    expect(cjsPath).toMatch(/\.cjs$/)
    expect(esmSources).toEqual(rootSources)
    expect(cjsSources).toEqual(rootSources)
    expect(desktopSources).toEqual(["system-notifier", "terminal-complete"])
  })
})
