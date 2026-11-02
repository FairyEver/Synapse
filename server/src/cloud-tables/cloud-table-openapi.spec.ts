import { describe, expect, it } from "vitest"
import { createOpenApiContractDocument } from "../open-api/open-api-contract"
import { cloudTableOpenApiPaths } from "./cloud-table-openapi"
import { querySchema, recordCreateSchema } from "./cloud-table-contract"
describe("cloud table machine contract", () => {
  it("publishes the runtime routes and strict record/query bodies without changing old paths", () => {
    const doc = createOpenApiContractDocument("https://example.test/document")
    const paths = cloudTableOpenApiPaths()
    expect(Object.keys(paths)).toHaveLength(16)
    expect(doc.paths["/tables/{id}/records/query"]).toEqual(paths["/tables/{id}/records/query"])
    expect(doc.paths).toHaveProperty("/drive/public-links/downloads")
    expect(querySchema.safeParse({ filters: Array.from({ length: 21 }, () => ({ field: "x", op: "eq", value: 1 })) }).success).toBe(false)
    expect(recordCreateSchema.safeParse({ values: {}, creatorUserId: "forged" }).success).toBe(false)
  })
  it("describes read-only count and exists using strict filter bodies and precise responses", () => {
    const paths = cloudTableOpenApiPaths() as Record<string, Record<string, any>>
    for (const [suffix, operationId, result, type] of [
      ["count", "countCloudTableRecords", "count", "integer"],
      ["exists", "existsCloudTableRecords", "exists", "boolean"],
    ]) {
      const operation = paths[`/tables/{id}/records/${suffix}`]?.post
      expect(operation).toMatchObject({ operationId, security: [{}, { ApiKeyBearer: [] }] })
      expect(operation.description).toContain("tables.records.read")
      expect(operation.parameters.some((p: { name: string }) => p.name === "Idempotency-Key")).toBe(false)
      const body = operation.requestBody.content["application/json"].schema
      expect(body.additionalProperties).toBe(false)
      expect(Object.keys(body.properties).sort()).toEqual(["filterMode", "filters"])
      expect(body.properties.filterMode).toMatchObject({ enum: ["all", "any"], default: "all" })
      const response = operation.responses["201"].content["application/json"].schema
      expect(response).toMatchObject({ required: [result], properties: { [result]: { type } } })
    }
    const body = paths["/tables/{id}/records/query"]!.post.requestBody.content["application/json"].schema
    expect(body.properties.fields).toMatchObject({ type: "array", maxItems: 100, uniqueItems: true })
    expect(body.properties.filterMode.default).toBe("all")
  })
  it("publishes owner and scope requirements for Agent management operations", () => {
    const operations = Object.values(cloudTableOpenApiPaths()).flatMap(methods => Object.values(methods)) as { operationId: string; summary: string; description: string; security: unknown[] }[]
    const create = operations.find(o => o.operationId === "createCloudTable")!
    expect(create.description).toContain("tables.manage")
    expect(create.description).toContain("all_owned")
    for (const id of ["updateCloudTable", "setCloudTablePermissions", "deleteCloudTable", "restoreCloudTable", "resolveCloudTableCollaborator", "listCloudTableLogs", "listDeletedCloudTableRecords", "restoreCloudTableRecord"]) {
      const operation = operations.find(o => o.operationId === id)!
      expect(operation.summary).toEqual(expect.any(String))
      expect(operation.description, id).toContain("仅表主")
      expect(operation.description, id).toContain("tables.manage")
      expect(operation.security).toEqual([{ ApiKeyBearer: [] }])
    }
  })
  it("advertises idempotency only on writes with transactional receipts", () => {
    const operations = Object.values(cloudTableOpenApiPaths()).flatMap(methods => Object.values(methods)) as { operationId: string; parameters: { name: string }[] }[]
    expect(operations.filter(o => o.parameters.some(p => p.name === "Idempotency-Key")).map(o => o.operationId).sort()).toEqual([
      "createCloudTable", "createCloudTableRecord", "updateCloudTableRecord", "deleteCloudTableRecord", "mutateCloudTableRecords",
    ].sort())
  })
  it("describes the actual required response fields for summaries, permissions and logs", () => {
    const paths = cloudTableOpenApiPaths() as Record<string, Record<string, any>>
    const response = (path: string, method: string, status: string) => paths[path]![method].responses[status].content["application/json"].schema
    const summary = response("/tables", "get", "200").properties.data.items
    expect(summary.required).toEqual(expect.arrayContaining(["id", "ownerId", "viewerId", "name", "schemaVersion", "permissions"]))
    expect(summary.properties).not.toHaveProperty("fields")
    expect(summary.properties).not.toHaveProperty("members")
    const permissions = response("/tables/{id}/permissions", "patch", "200")
    expect(permissions.required).toEqual(["schemaVersion"])
    expect(Object.keys(permissions.properties)).toEqual(["schemaVersion"])
    const log = response("/tables/{id}/logs", "get", "200").properties.data.items
    expect(log.required).toEqual(expect.arrayContaining(["requestId", "operation", "status", "durationMs", "createdAt"]))
    expect(log.properties.tableId.type).toEqual(["string", "null"])
    const details = response("/tables/{id}", "get", "200").anyOf
    expect(details).toHaveLength(2)
    expect(details.some((detail: any) => detail.required.includes("ownerId"))).toBe(true)
    expect(details.some((detail: any) => detail.required.length === 3 && detail.required.includes("fields"))).toBe(true)
  })
})
