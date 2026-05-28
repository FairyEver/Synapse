import { describe, expect, it } from "vitest"

import {
  normalizeClaudeSdkUsage,
  sumClaudeSdkUsage,
  tokenUsageFields,
} from "../token-usage"

describe("token usage helpers", () => {
  it("normalizes Claude SDK usage with only SDK result fields", () => {
    expect(normalizeClaudeSdkUsage({
      input_tokens: 10,
      output_tokens: 2,
      cache_creation_input_tokens: 4,
      cache_read_input_tokens: 30,
      reasoning_tokens: 999,
    })).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheCreationInputTokens: 4,
      cacheReadInputTokens: 30,
      totalTokens: 46,
    })
  })

  it("sums unique Claude SDK usage records without adding reasoning tokens", () => {
    expect(sumClaudeSdkUsage([
      {
        input_tokens: 10,
        output_tokens: 2,
        cache_creation_input_tokens: 4,
        cache_read_input_tokens: 30,
      },
      {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: 3,
      },
    ])).toEqual({
      inputTokens: 11,
      outputTokens: 4,
      cacheCreationInputTokens: 4,
      cacheReadInputTokens: 33,
      totalTokens: 52,
    })
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
