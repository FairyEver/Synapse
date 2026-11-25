import { describe, expect, it } from "vitest"
import { createOpenApiContractDocument } from "../open-api/open-api-contract"
import { channelOpenApiPaths } from "./channel-openapi"

describe("Channels OpenAPI contract", () => {
  it("exposes all Open REST channel routes with accurate scopes and no Idempotency-Key requirement", () => {
    const doc = createOpenApiContractDocument("http://localhost:19773/document")
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>

    const expectedPaths = [
      "/channels",
      "/channels/{channelId}",
      "/channels/{channelId}/tokens",
      "/channels/{channelId}/tokens/{tokenId}",
      "/channels/{channelId}/events",
      "/channels/{channelId}/presence",
      "/channels/{channelId}/retained",
      "/channels/{channelId}/retained/{event}",
    ]
    for (const p of expectedPaths) {
      expect(paths[p]).toBeDefined()
    }

    expect(paths["/channels"]?.post).toMatchObject({
      operationId: "createChannel",
      "x-required-scope": "channels.manage",
    })
    expect(paths["/channels/{channelId}/events"]?.post).toMatchObject({
      operationId: "publishChannelEvent",
      "x-required-scope": "channels.publish",
    })
    expect(paths["/channels/{channelId}/presence"]?.get).toMatchObject({
      operationId: "getChannelPresence",
    })
    expect(paths["/channels/{channelId}/retained"]?.get).toMatchObject({
      operationId: "listChannelRetained",
      "x-required-scope": "channels.subscribe",
    })
    expect(paths["/channels/{channelId}/retained/{event}"]?.delete).toMatchObject({
      operationId: "clearChannelRetained",
      "x-required-scope": "channels.publish",
    })
    expect(paths["/channels/{channelId}"]?.patch).toMatchObject({ operationId: "updateChannel", "x-required-scope": "channels.manage" })
    expect(paths["/channels/{channelId}"]?.delete).toMatchObject({ operationId: "deleteChannel", "x-required-scope": "channels.manage" })
    expect(paths["/channels/{channelId}/tokens"]?.post).toMatchObject({ operationId: "createChannelToken", "x-required-scope": "channels.manage" })
    expect(paths["/channels/{channelId}/tokens/{tokenId}"]?.delete).toMatchObject({ operationId: "revokeChannelToken", "x-required-scope": "channels.manage" })
    expect(doc.components.schemas.ChannelJsonValue).toBeDefined()

    const publishErrors = JSON.stringify(paths["/channels/{channelId}/events"]?.post?.responses)
    expect(publishErrors).toContain("INVALID_CREDENTIAL")
    expect(publishErrors).toContain("RETAIN_LIMIT_EXCEEDED")
    expect(publishErrors).toContain("CHANNEL_NOT_FOUND")

    // Must not declare Idempotency-Key parameter on channel routes
    expect(JSON.stringify(channelOpenApiPaths())).not.toContain("Idempotency-Key")
  })
})
