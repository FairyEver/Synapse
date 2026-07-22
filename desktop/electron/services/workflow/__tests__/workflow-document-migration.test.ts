import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import "../../../../workflow-nodes/register.main"
import {
  migrateWorkflowDocument,
  WORKFLOW_SCHEMA_VERSION,
} from "../workflow-document-migration"
import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../../config"

const fixtures = path.join(__dirname, "..", "__fixtures__", "workflow-schema")

async function fixture(version: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixtures, `${version}.json`), "utf8"))
}

describe("workflow document migration", () => {
  it("migrates the historical unversioned document without losing unknown fields", async () => {
    const source = await fixture("0.0.0") as Record<string, unknown>
    const promptNode = (source.nodes as Array<Record<string, unknown>>)
      .find((node) => node.type === "prompt")
    if (!promptNode || typeof promptNode.config !== "object" || promptNode.config === null) {
      throw new Error("Fixture is missing the prompt node config.")
    }
    Object.assign(promptNode.config, {
      prompt: "处理 {{topic}}",
      variables: [],
    })

    const result = migrateWorkflowDocument(source)
    expect(result.kind).toBe("current")
    if (result.kind !== "current") return

    expect(result.document.meta.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION)
    expect(result.document.defaultProviderId).toBe("local-claude-code")
    expect(result.document.defaultModelTier).toBe("default")
    expect(result.document.params[0]).toMatchObject({ default: null, legacyParamField: "keep-me" })
    expect(result.document.nodes[0]?.config).toMatchObject({
      prompt: "处理 {{topic}}",
      variables: [],
      legacyConfigField: "keep-me",
    })
    expect(result.document.nodes[0]?.config).not.toHaveProperty("agent")
    expect(result.document).toMatchObject({ legacyTopLevelField: "keep-me" })
  })

  it("isolates the historical unversioned fixture when its node config is incomplete", async () => {
    const source = await fixture("0.0.0")
    const original = structuredClone(source)

    expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
    expect(source).toEqual(original)
  })

  it("migrates the previous major fixture without rewriting its source", async () => {
    const source = await fixture("1.0.0")
    const original = structuredClone(source)
    const result = migrateWorkflowDocument(source)
    expect(result).toMatchObject({ kind: "current", migrated: true })
    expect(source).toEqual(original)
  })

  it("migrates the previous minor fixture without rewriting its source", async () => {
    const source = await fixture("2.0.0")
    const original = structuredClone(source)
    const result = migrateWorkflowDocument(source)
    expect(result).toMatchObject({ kind: "current", migrated: true })
    expect(source).toEqual(original)
  })

  it("migrates 2.2.0 to 2.3.0 without changing the workflow body", async () => {
    const source = await fixture("2.2.0") as Record<string, unknown>
    const original = structuredClone(source)
    const result = migrateWorkflowDocument(source)

    expect(result).toMatchObject({ kind: "current", migrated: true })
    if (result.kind !== "current") return
    expect(result.document).toEqual({
      ...original,
      meta: { schemaVersion: "2.3.0" },
    })
    expect(source).toEqual(original)
  })

  it("validates the current fixture without rewriting its source", async () => {
    const source = await fixture("2.3.0")
    const original = structuredClone(source)
    const result = migrateWorkflowDocument(source)
    expect(result).toMatchObject({ kind: "current", migrated: false })
    expect(source).toEqual(original)
  })

  it("isolates future documents", async () => {
    const source = await fixture("2.0.0") as Record<string, unknown>
    source.meta = { schemaVersion: "3.0.0" }
    expect(migrateWorkflowDocument(source)).toMatchObject({
      kind: "unsupported_future",
      sourceVersion: "3.0.0",
      targetVersion: WORKFLOW_SCHEMA_VERSION,
    })
  })

  it("isolates previous-major documents that use a removed node type", async () => {
    const source = await fixture("1.0.0") as Record<string, unknown>
    const nodes = source.nodes as Array<Record<string, unknown>>
    nodes.unshift({
      id: "removed-node",
      name: "已移除节点",
      type: "removed_node_type",
      position: { x: 0, y: 0 },
      config: {},
    })
    const original = structuredClone(source)

    expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
    expect(source).toEqual(original)
  })

  it.each(["0.0.0", "1.0.0", "2.0.0", "2.1.0", "2.2.0", "2.3.0"])(
    "isolates %s documents whose node config violates the registered schema",
    async (version) => {
      const source = await fixture(version) as Record<string, unknown>
      const nodes = source.nodes as Array<Record<string, unknown>>
      const promptNode = nodes.find((node) => node.type === "prompt")
      if (promptNode && typeof promptNode.config === "object" && promptNode.config !== null) {
        Object.assign(promptNode.config, { prompt: "处理 {{topic}}", variables: [] })
      }
      const endNode = nodes.find((node) => node.type === "end")
      if (!endNode) throw new Error("Fixture is missing the end node.")
      endNode.config = { outputType: "text", template: 42, variables: [] }
      const original = structuredClone(source)

      expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
      expect(source).toEqual(original)
    },
  )

  it("rejects unsupported legacy agent values without changing the source", async () => {
    const source = await fixture("0.0.0") as Record<string, unknown>
    const nodes = source.nodes as Array<Record<string, unknown>>
    const config = nodes[0]!.config as Record<string, unknown>
    config.agent = "unknown-agent"
    const original = structuredClone(source)
    expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
    expect(source).toEqual(original)
  })

  it("rejects workflow ids that current operations cannot address", async () => {
    const source = await fixture("0.0.0") as Record<string, unknown>
    source.id = "unsafe/workflow"
    const original = structuredClone(source)

    const result = migrateWorkflowDocument(source)

    expect(result).toMatchObject({ kind: "failed" })
    if (result.kind !== "failed") return
    expect(result.error).toMatchObject({
      name: "DataMigrationValidationError",
      message: expect.stringContaining("failed validation"),
    })
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
    const source = await fixture("2.3.0") as Record<string, unknown>
    source.params = [{ name: "topic", type: "text", default: null }]
    mutate(source)
    expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
  })

  it.each([
    ["empty multi-resource defaults", {
      name: "files",
      type: "file",
      allowMultiple: true,
      default: [],
    }],
    ["oversized multi-resource defaults", {
      name: "files",
      type: "file",
      allowMultiple: true,
      default: Array.from({ length: WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS + 1 }, (_, index) => ({
        kind: "local_path",
        entryType: "file",
        path: `/tmp/file-${index}.txt`,
      })),
    }],
    ["resource type mismatches", {
      name: "files",
      type: "file",
      allowMultiple: true,
      default: [{ kind: "local_path", entryType: "directory", path: "/tmp/folder" }],
    }],
    ["duplicate multi-resource defaults", {
      name: "files",
      type: "file",
      allowMultiple: true,
      default: [
        { kind: "local_path", entryType: "file", path: "/tmp/file.txt" },
        { kind: "local_path", entryType: "file", path: "/tmp/file.txt" },
      ],
    }],
    ["resource arrays without allowMultiple", {
      name: "files",
      type: "file",
      default: [{ kind: "local_path", entryType: "file", path: "/tmp/file.txt" }],
    }],
    ["allowMultiple on non-resource params", {
      name: "topic",
      type: "text",
      allowMultiple: true,
      default: "value",
    }],
  ])("rejects %s before marking a document current", async (_case, param) => {
    const source = await fixture("0.0.0") as Record<string, unknown>
    source.params = [param]

    expect(migrateWorkflowDocument(source)).toMatchObject({ kind: "failed" })
  })
})
