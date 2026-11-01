import { describe, expect, it } from "vitest"
import { createOpenApiContractDocument } from "../open-api/open-api-contract"
import { cloudTableOpenApiPaths } from "./cloud-table-openapi"
import { querySchema, recordCreateSchema } from "./cloud-table-contract"
describe("cloud table machine contract", () => {
  it("publishes the runtime routes and strict record/query bodies without changing old paths", () => {
    const doc = createOpenApiContractDocument("https://example.test/document")
    const paths = cloudTableOpenApiPaths()
    expect(Object.keys(paths)).toHaveLength(14)
    expect(doc.paths["/tables/{id}/records/query"]).toEqual(paths["/tables/{id}/records/query"])
    expect(doc.paths).toHaveProperty("/drive/public-links/downloads")
    expect(querySchema.safeParse({ filters: Array.from({ length: 21 }, () => ({ field: "x", op: "eq", value: 1 })) }).success).toBe(false)
    expect(recordCreateSchema.safeParse({ values: {}, creatorUserId: "forged" }).success).toBe(false)
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
})
