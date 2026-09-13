import { describe, expect, it } from "vitest"

import { resolveAgentProviderTransportPolicy } from "../provider-transport-policy"

describe("resolveAgentProviderTransportPolicy", () => {
  it.each([
    "https://dashscope.aliyuncs.com/apps/anthropic",
    "https://coding.dashscope.aliyuncs.com/apps/anthropic/",
  ])("matches the official Bailian Anthropic endpoint %s", (baseUrl) => {
    expect(resolveAgentProviderTransportPolicy({ baseUrl })).toEqual({
      id: "bailian-anthropic-6m",
      providerScopeId: "bailian-cn",
      maxRequestBodyBytes: 6 * 1024 * 1024,
      requestBodyBudgetBytes: 5 * 1024 * 1024,
      autoCompactWindowTokens: 200_000,
      maxToolOutputBytes: 8 * 1024,
      maxToolBatchOutputBytes: 24 * 1024,
    })
  })

  it.each([
    "https://proxy.example.com/apps/anthropic",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://api.anthropic.com",
  ])("does not match proxies or other providers: %s", (baseUrl) => {
    expect(resolveAgentProviderTransportPolicy({ baseUrl })).toBeUndefined()
  })
})
