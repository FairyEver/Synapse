import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const callerPersistenceIds = [
  ["src/modules/agent/index.tsx", "agent"],
  ["src/modules/editor-scan/index.tsx", "editor-scan"],
  ["src/modules/database/index.tsx", "database"],
  ["app-capabilities/terminal/renderer/index.tsx", "terminal"],
] as const

describe("resizable sidebar persistence callers", () => {
  it.each(callerPersistenceIds)("assigns %s its own persistence identity", (sourcePath, persistenceId) => {
    const source = readFileSync(resolve(__dirname, "../../..", sourcePath), "utf8")

    expect(source).toContain(`sidebarPersistenceId="${persistenceId}"`)
  })
})
