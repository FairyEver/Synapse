/**
 * Placeholder for performance benchmarks (SPEC §9 / §15.10).
 *
 * Future PRs add real `desktop/tests/perf/*.bench.ts` benchmarks once the
 * actual hot paths (cold-startup, tab-switch, message-list scrolling) have
 * concrete consumers. Until then, this directory exists so the repo layout
 * matches SPEC §15.13.
 */

import { describe, expect, it } from "vitest"

describe("perf placeholder", () => {
  it("placeholder passes", () => {
    expect(true).toBe(true)
  })
})
