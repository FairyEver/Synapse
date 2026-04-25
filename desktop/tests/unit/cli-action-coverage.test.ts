import { describe, expect, it } from "vitest"
import {
  CC_CONNECT_CLI_COMMANDS,
  DEFAULT_CLI_ACTION_COVERAGE,
  findMissingCliActions,
  renderCliActionCoverageMarkdown,
} from "../../electron/services/cli-action-coverage-service"

describe("CLI action coverage", () => {
  it("covers every CC Connect command and startup flag without dropped entries", () => {
    expect(findMissingCliActions()).toEqual([])
    expect(DEFAULT_CLI_ACTION_COVERAGE.map((entry) => entry.command).sort()).toEqual(
      [...CC_CONNECT_CLI_COMMANDS].sort(),
    )
    expect(DEFAULT_CLI_ACTION_COVERAGE.every((entry) => entry.status !== "covered" || entry.evidence.length > 0)).toBe(true)
  })

  it("renders the coverage artifact table", () => {
    const markdown = renderCliActionCoverageMarkdown()

    expect(markdown).toContain("| daemon | covered | daemon admin service |")
    expect(markdown).toContain("| web | replaced | 3S app shell modules |")
    expect(markdown).toContain("No CC command is marked dropped.")
  })
})
