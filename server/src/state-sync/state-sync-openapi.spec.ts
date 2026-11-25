import { describe, expect, it } from "vitest"
import { createOpenApiContractDocument } from "../open-api/open-api-contract"
import { stateSyncOpenApiPaths } from "./state-sync-openapi"

describe("State Sync OpenAPI contract", () => {
  it("exposes all Open REST state-sync routes with accurate scopes, error codes and no Idempotency-Key requirement", () => {
    const doc = createOpenApiContractDocument("http://localhost:19773/document")
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>

    const expectedPaths = [
      "/state-sync/spaces",
      "/state-sync/spaces/{spaceId}",
      "/state-sync/spaces/{spaceId}/tokens",
      "/state-sync/spaces/{spaceId}/tokens/{tokenId}",
      "/state-sync/spaces/{spaceId}/docs",
      "/state-sync/spaces/{spaceId}/docs/{docId}",
      "/state-sync/spaces/{spaceId}/docs/{docId}/presence",
    ]
    for (const p of expectedPaths) {
      expect(paths[p]).toBeDefined()
    }

    expect(paths["/state-sync/spaces"]?.post).toMatchObject({
      operationId: "createStateSyncSpace",
      "x-required-scope": "state_sync.manage",
    })
    expect(paths["/state-sync/spaces/{spaceId}"]?.get).toMatchObject({
      operationId: "getStateSyncSpace",
      "x-required-scope": "state_sync.manage",
    })
    expect(paths["/state-sync/spaces/{spaceId}"]?.patch).toMatchObject({
      operationId: "updateStateSyncSpace",
      "x-required-scope": "state_sync.manage",
    })
    expect(paths["/state-sync/spaces/{spaceId}"]?.delete).toMatchObject({
      operationId: "deleteStateSyncSpace",
      "x-required-scope": "state_sync.manage",
    })
    expect(paths["/state-sync/spaces/{spaceId}/tokens"]?.post).toMatchObject({
      operationId: "createStateSyncToken",
      "x-required-scope": "state_sync.manage",
    })
    expect(paths["/state-sync/spaces/{spaceId}/tokens/{tokenId}"]?.delete).toMatchObject({
      operationId: "revokeStateSyncToken",
      "x-required-scope": "state_sync.manage",
    })
    expect(paths["/state-sync/spaces/{spaceId}/docs"]?.get).toMatchObject({
      operationId: "listStateSyncDocs",
      "x-required-scope": "state_sync.manage",
    })
    const listDocsLimit = (paths["/state-sync/spaces/{spaceId}/docs"]?.get?.parameters as any[])?.find(
      (p) => p.name === "limit"
    )
    expect(listDocsLimit?.schema?.maximum).toBe(200)
    expect(paths["/state-sync/spaces/{spaceId}/docs"]?.post).toMatchObject({
      operationId: "createStateSyncDoc",
    })
    expect(paths["/state-sync/spaces/{spaceId}/docs/{docId}"]?.get).toMatchObject({
      operationId: "getStateSyncDoc",
      "x-required-scope": "state_sync.read",
    })
    expect(paths["/state-sync/spaces/{spaceId}/docs/{docId}"]?.patch).toMatchObject({
      operationId: "mutateStateSyncDoc",
      "x-required-scope": "state_sync.write",
    })
    expect(paths["/state-sync/spaces/{spaceId}/docs/{docId}"]?.delete).toMatchObject({
      operationId: "deleteStateSyncDoc",
      "x-required-scope": "state_sync.manage",
    })
    expect(paths["/state-sync/spaces/{spaceId}/docs/{docId}/presence"]?.get).toMatchObject({
      operationId: "getStateSyncPresence",
    })

    expect(doc.components.schemas.StateSyncJsonValue).toBeDefined()

    const mutateResponses = paths["/state-sync/spaces/{spaceId}/docs/{docId}"]?.patch?.responses as Record<string, any>
    expect(mutateResponses["409"]).toBeDefined()
    expect(JSON.stringify(mutateResponses["409"])).toContain("REV_CONFLICT")
    expect(JSON.stringify(mutateResponses["409"])).toContain("currentRev")

    expect(mutateResponses["429"]).toBeDefined()
    expect(JSON.stringify(mutateResponses["429"])).toContain("RATE_LIMITED")
    expect(JSON.stringify(mutateResponses["429"])).toContain("Retry-After")

    expect(mutateResponses["403"]).toBeDefined()
    expect(mutateResponses["404"]).toBeDefined()
    expect(mutateResponses["413"]).toBeDefined()

    const createDocResponses = paths["/state-sync/spaces/{spaceId}/docs"]?.post?.responses as Record<string, any>
    expect(createDocResponses["422"]).toBeDefined()
    expect(JSON.stringify(createDocResponses["422"])).toContain("DOC_LIMIT_EXCEEDED")

    // Must not declare Idempotency-Key parameter
    expect(JSON.stringify(stateSyncOpenApiPaths())).not.toContain("Idempotency-Key")
  })
})
