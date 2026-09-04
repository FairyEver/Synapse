import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const callerPersistenceIds = [
  ["src/modules/agent/index.tsx", ['sidebarPersistenceId="agent"']],
  ["src/modules/editor-scan/index.tsx", ['sidebarPersistenceId="editor-scan"']],
  ["src/modules/database/index.tsx", ['sidebarPersistenceId="database"']],
  ["app-capabilities/terminal/renderer/index.tsx", [
    'const TERMINAL_SIDEBAR_PERSISTENCE_ID = "terminal"',
    "sidebarPersistenceId={TERMINAL_SIDEBAR_PERSISTENCE_ID}",
  ]],
] as const

describe("resizable sidebar persistence callers", () => {
  it.each(callerPersistenceIds)("assigns %s its own persistence identity", (sourcePath, expectedSnippets) => {
    const source = readFileSync(resolve(__dirname, "../../..", sourcePath), "utf8")

    for (const snippet of expectedSnippets) {
      expect(source).toContain(snippet)
    }
  })
})
