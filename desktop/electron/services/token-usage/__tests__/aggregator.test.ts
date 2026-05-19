import { beforeEach, describe, expect, it, vi } from "vitest"

const dbMocks = vi.hoisted(() => ({
  queryDailyRowsFiltered: vi.fn(() => []),
  queryHourlyRowsFiltered: vi.fn(() => []),
}))

vi.mock("../db", () => dbMocks)

import { getHourlyReport } from "../aggregator"

describe("token usage aggregator", () => {
  beforeEach(() => {
    dbMocks.queryDailyRowsFiltered.mockReturnValue([])
    dbMocks.queryHourlyRowsFiltered.mockReturnValue([])
  })

  it("keeps hourly rows split by provider for the same client and model", () => {
    dbMocks.queryHourlyRowsFiltered.mockReturnValue([
      createHourlyRow({ provider_id: "openai", input_tokens: 100, cost_usd: 0.1 }),
      createHourlyRow({ provider_id: "azure-openai", input_tokens: 200, cost_usd: 0.2 }),
    ])

    expect(getHourlyReport()).toEqual([
      expect.objectContaining({
        hour: "2026-05-19 10",
        client: "codex",
        model: "gpt-5",
        provider: "openai",
        input: 100,
        cost: 0.1,
      }),
      expect.objectContaining({
        hour: "2026-05-19 10",
        client: "codex",
        model: "gpt-5",
        provider: "azure-openai",
        input: 200,
        cost: 0.2,
      }),
    ])
  })
})

function createHourlyRow(overrides: Partial<{
  hour: string
  client: string
  model_id: string
  provider_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  message_count: number
  turn_count: number
  cost_usd: number
}> = {}) {
  return {
    hour: "2026-05-19 10",
    client: "codex",
    model_id: "gpt-5",
    provider_id: "openai",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    message_count: 1,
    turn_count: 1,
    cost_usd: 0,
    ...overrides,
  }
}
