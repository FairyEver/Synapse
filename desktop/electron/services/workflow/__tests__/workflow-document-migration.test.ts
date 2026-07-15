import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import "../../../../workflow-nodes/register.main"
import {
  migrateWorkflowDocument,
  WORKFLOW_SCHEMA_VERSION,
} from "../workflow-document-migration"

const fixtures = path.join(__dirname, "..", "__fixtures__", "workflow-schema")

async function fixture(version: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixtures, `${version}.json`), "utf8"))
}

describe("workflow document migration", () => {
  it("migrates the historical unversioned document without losing unknown fields", async () => {
    const result = migrateWorkflowDocument(await fixture("0.0.0"))
    expect(result.kind).toBe("current")
    if (result.kind !== "current") return

    expect(result.document.meta.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION)
    expect(result.document.defaultProviderId).toBe("local-claude-code")
    expect(result.document.defaultModelTier).toBe("default")
    expect(result.document.params[0]).toMatchObject({ default: null, legacyParamField: "keep-me" })
    expect(result.document.nodes[0]?.config).toMatchObject({
      prompt: "",
      legacyConfigField: "keep-me",
    })
    expect(result.document.nodes[0]?.config).not.toHaveProperty("agent")
    expect(result.document).toMatchObject({ legacyTopLevelField: "keep-me" })
  })

  it("validates a current historical fixture without rewriting its source", async () => {
    const source = await fixture("1.0.0")
    const original = structuredClone(source)
    const result = migrateWorkflowDocument(source)
    expect(result).toMatchObject({ kind: "current", migrated: false })
    expect(source).toEqual(original)
  })

  it("isolates future documents", async () => {
    const source = await fixture("1.0.0") as Record<string, unknown>
    source.meta = { schemaVersion: "2.0.0" }
    expect(migrateWorkflowDocument(source)).toMatchObject({
      kind: "unsupported_future",
      sourceVersion: "2.0.0",
      targetVersion: WORKFLOW_SCHEMA_VERSION,
    })
  })

  it("rejects unsupported legacy agent values without changing the source", async () => {
    const source = await fixture("0.0.0") as Record<string, unknown>
    const nodes = source.nodes as Array<Record<string, unknown>>
    const config = nodes[0]!.config as Record<string, unknown>
    config.agent = "unknown-agent"
    const original = structuredClone(source)
    expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
    expect(source).toEqual(original)
  })

  it.each([
    ["description", (source: Record<string, unknown>) => { source.description = 42 }],
    ["defaultProviderId", (source: Record<string, unknown>) => { source.defaultProviderId = false }],
    ["defaultModelTier", (source: Record<string, unknown>) => { source.defaultModelTier = "unknown" }],
    ["defaultNodeTimeoutMins", (source: Record<string, unknown>) => { source.defaultNodeTimeoutMins = 0 }],
    ["param default", (source: Record<string, unknown>) => {
      (source.params as Array<Record<string, unknown>>)[0]!.default = { kind: "unknown" }
    }],
    ["param options", (source: Record<string, unknown>) => {
      (source.params as Array<Record<string, unknown>>)[0]!.options = ["ok", 1]
    }],
    ["param flags", (source: Record<string, unknown>) => {
      (source.params as Array<Record<string, unknown>>)[0]!.allowMultiple = "yes"
    }],
  ])("rejects a current document with invalid %s structure", async (_field, mutate) => {
    const source = await fixture("1.0.0") as Record<string, unknown>
    source.params = [{ name: "topic", type: "text", default: null }]
    mutate(source)
    expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
  })
})
