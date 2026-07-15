import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { describe, expect, it } from "vitest"
import "../../../../workflow-nodes/register.main"
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import {
  WORKFLOW_SCHEMA_VERSION,
  workflowMigrationVersions,
} from "../workflow-document-migration"
import { WORKFLOW_DOCUMENT_SCHEMA_CONTRACT } from "../workflow-schema-contract"

const fixtures = path.join(__dirname, "..", "__fixtures__", "workflow-schema")

describe("workflow persisted schema contract", () => {
  it("requires a schema version bump and fixture update when the persisted contract changes", async () => {
    const expected = JSON.parse(await readFile(path.join(fixtures, "contract.json"), "utf8")) as {
      schemaVersion: string
      digest: string
    }
    const contract = {
      document: WORKFLOW_DOCUMENT_SCHEMA_CONTRACT,
      nodeTypes: nodeTypeRegistry.listTypes().sort().map((type) => {
        const manifest = nodeTypeRegistry.getManifest(type)
        return {
          type,
          configSchema: z.toJSONSchema(manifest.configSchema, {
            io: "input",
            unrepresentable: "any",
          }),
        }
      }),
    }
    const digest = createHash("sha256").update(stableJson(contract)).digest("hex")

    expect(expected.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION)
    expect(expected.digest).toBe(digest)
    expect(workflowMigrationVersions()).toContain(WORKFLOW_SCHEMA_VERSION)
    await expect(readFile(path.join(fixtures, `${WORKFLOW_SCHEMA_VERSION}.json`))).resolves.toBeDefined()
  })
})

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
