import { describe, expect, it } from "vitest"
import {
  findOrphanTestAssetCoverage,
  renderTestAssetsCoverageMarkdown,
  TEST_ASSET_COVERAGE_ENTRIES,
} from "../../electron/services/test-assets-coverage-service"

describe("test assets coverage", () => {
  it("maps CC Connect test asset groups to CC IDs or explicit exclusions", () => {
    expect(findOrphanTestAssetCoverage()).toEqual([])
    expect(TEST_ASSET_COVERAGE_ENTRIES.some((entry) => entry.sourcePattern.includes("smoke_test.go"))).toBe(true)
    expect(TEST_ASSET_COVERAGE_ENTRIES.some((entry) => entry.sourcePattern.includes("bench_test.go") && entry.status === "excluded")).toBe(true)
  })

  it("renders a coverage artifact with no dropped CC IDs", () => {
    const markdown = renderTestAssetsCoverageMarkdown()

    expect(markdown).toContain("tests/e2e/smoke_test.go")
    expect(markdown).toContain("CC-038")
    expect(markdown).toContain("No test asset group is orphaned.")
    expect(markdown).not.toContain("marked dropped: true")
  })
})
