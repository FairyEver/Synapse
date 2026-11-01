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
})
