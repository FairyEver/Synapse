import { describe, expect, it } from "vitest"

import {
  CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
  CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
  conversationRolloverTotalTokens,
  shouldShowConversationRolloverPrompt,
} from "../conversation-rollover"

describe("conversation rollover threshold", () => {
  it("shows when cumulative CNY cost reaches the threshold", () => {
    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
      usage: {
        inputTokens: 1,
      },
    })).toBe(true)
  })

  it("does not show below the cumulative CNY cost threshold", () => {
    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY - 0.01,
      usage: {
        inputTokens: CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD + 1,
      },
    })).toBe(false)
  })

  it("uses the provided CNY cost threshold", () => {
    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: 15,
      usage: {
        inputTokens: 100,
      },
    }, {
      costThresholdCny: 20,
      tokenThreshold: CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
    })).toBe(false)

    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: 15,
      usage: {
        inputTokens: 100,
      },
    }, {
      costThresholdCny: 15,
      tokenThreshold: CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
    })).toBe(true)
  })

  it("uses token fallback when cost is unavailable", () => {
    expect(shouldShowConversationRolloverPrompt({
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 3_000_000,
        cache_creation_input_tokens: 400_000,
        reasoning_output_tokens: 100_000,
      },
    })).toBe(true)
  })

  it("uses the provided token threshold when cost is unavailable", () => {
    expect(shouldShowConversationRolloverPrompt({
      usage: {
        inputTokens: 1_200_000,
      },
    }, {
      costThresholdCny: CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
      tokenThreshold: 1_500_000,
    })).toBe(false)

    expect(shouldShowConversationRolloverPrompt({
      usage: {
        inputTokens: 1_500_000,
      },
    }, {
      costThresholdCny: CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
      tokenThreshold: 1_500_000,
    })).toBe(true)
  })

  it("does not use token fallback when known cost is low", () => {
    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: 1,
      usage: {
        inputTokens: CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
      },
    }, {
      costThresholdCny: 10,
      tokenThreshold: 100,
    })).toBe(false)
  })

  it("sums known cumulative token fields and falls back to totalTokens when components are absent", () => {
    expect(conversationRolloverTotalTokens({
      inputTokens: 2,
      outputTokens: 3,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 7,
      reasoningOutputTokens: 11,
      totalTokens: 999,
    })).toBe(28)

    expect(conversationRolloverTotalTokens({
      total_tokens: 123,
    })).toBe(123)
  })

  it("does not show when neither cost nor usage is available", () => {
    expect(shouldShowConversationRolloverPrompt(undefined)).toBe(false)
    expect(shouldShowConversationRolloverPrompt({})).toBe(false)
  })
})
