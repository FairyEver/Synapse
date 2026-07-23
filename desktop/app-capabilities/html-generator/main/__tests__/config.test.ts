import { describe, expect, it } from "vitest"
import {
  HTML_GENERATION_MAX_CONCURRENCY,
  HTML_GENERATION_MAX_QUEUED,
  HTML_GENERATION_TIMEOUT_MS,
  HTML_GENERATION_WORKER_START_TIMEOUT_MS,
} from "../../../../config"

describe("HTML Generator fixed budgets", () => {
  it("keeps the worst legal render batch bounded", () => {
    const waves = Math.ceil((HTML_GENERATION_MAX_CONCURRENCY + HTML_GENERATION_MAX_QUEUED) / HTML_GENERATION_MAX_CONCURRENCY)
    const worstRenderBatchMs = waves * (HTML_GENERATION_WORKER_START_TIMEOUT_MS + HTML_GENERATION_TIMEOUT_MS)
    expect(worstRenderBatchMs).toBe(30_000)
  })
})
