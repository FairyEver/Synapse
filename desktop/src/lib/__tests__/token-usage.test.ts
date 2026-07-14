import { describe, expect, it } from "vitest"

import {
  normalizeClaudeSdkUsage,
  sumClaudeSdkUsage,
  tokenUsageFields,
} from "../token-usage"

describe("token usage helpers", () => {
  it("normalizes Claude SDK usage with optional reasoning fields", () => {
    expect(normalizeClaudeSdkUsage({
      input_tokens: 10,
      output_tokens: 2,
      cache_creation_input_tokens: 4,
      cache_read_input_tokens: 30,
      reasoning_output_tokens: 7,
    })).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheCreationInputTokens: 4,
      cacheReadInputTokens: 30,
      reasoningOutputTokens: 7,
      totalTokens: 53,
    })
  })

  it("normalizes camel-case model usage fields", () => {
    expect(normalizeClaudeSdkUsage({
      inputTokens: 10,
      outputTokens: 2,
      cacheCreationInputTokens: 4,
      cacheReadInputTokens: 30,
      reasoningOutputTokens: 7,
    })).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheCreationInputTokens: 4,
      cacheReadInputTokens: 30,
      reasoningOutputTokens: 7,
      totalTokens: 53,
    })
  })

  it("sums unique Claude SDK usage records with reasoning when present", () => {
    expect(sumClaudeSdkUsage([
      {
        input_tokens: 10,
        output_tokens: 2,
        cache_creation_input_tokens: 4,
        cache_read_input_tokens: 30,
        reasoning_output_tokens: 7,
      },
      {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: 3,
        reasoning_tokens: 5,
      },
    ])).toEqual({
      inputTokens: 11,
      outputTokens: 4,
      cacheCreationInputTokens: 4,
      cacheReadInputTokens: 33,
      reasoningOutputTokens: 12,
      totalTokens: 64,
    })
  })

  it("supports an optional summary prefix", () => {
    const fields = tokenUsageFields({
      inputTokens: 1,
      outputTokens: 2,
    }, { prefix: "累计" })

    expect(fields?.[0]).toEqual({ label: "累计" })
    expect(fields?.map((field) => field.label)).toEqual([
      "累计",
      "输入",
      "输出",
      "缓存读",
      "缓存写",
    ])
  })

  it("shows independent reasoning only when a source provides it", () => {
    expect(tokenUsageFields({
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 4,
    })?.map((field) => field.label)).toEqual(["输入", "输出", "缓存读", "缓存写"])

    expect(tokenUsageFields({
      input_tokens: 1,
      output_tokens: 2,
      reasoning_output_tokens: 5,
    })?.map((field) => field.label)).toEqual(["输入", "输出", "缓存读", "缓存写", "思考"])
  })
})
