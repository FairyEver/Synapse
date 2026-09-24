import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

function workflowEvents(filename: string): string[] {
  const path = new URL(`../../../.github/workflows/${filename}`, import.meta.url)
  const workflow = parse(readFileSync(path, "utf8")) as { on?: Record<string, unknown> }
  return Object.keys(workflow.on ?? {})
}

describe("GitHub workflow triggers", () => {
  it.each(["ci.yml", "release.yml"])("runs %s only by explicit dispatch", (filename) => {
    expect(workflowEvents(filename)).toEqual(["workflow_dispatch"])
  })
})
