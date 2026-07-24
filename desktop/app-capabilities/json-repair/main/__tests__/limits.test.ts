import { describe, expect, it } from "vitest"
import {
  JSON_REPAIR_MAX_DEPTH,
  JSON_REPAIR_OUTPUT_MAX_BYTES,
} from "../../shared/schema"
import {
  assertRepairedTextResources,
  exceedsJsonNestingLimit,
} from "../limits"

describe("JSON Repair resource limits", () => {
  it("rejects repaired text larger than one MiB before parsing", () => {
    const repaired = `"${"x".repeat(JSON_REPAIR_OUTPUT_MAX_BYTES)}"`

    expect(() => assertRepairedTextResources(repaired)).toThrowError(
      expect.objectContaining({ code: "OUTPUT_TOO_LARGE" }),
    )
  })

  it("rejects nesting deeper than 128 levels", () => {
    const repaired = `${"[".repeat(JSON_REPAIR_MAX_DEPTH + 1)}0${"]".repeat(JSON_REPAIR_MAX_DEPTH + 1)}`

    expect(() => assertRepairedTextResources(repaired)).toThrowError(
      expect.objectContaining({ code: "MAX_DEPTH_EXCEEDED" }),
    )
  })

  it("does not count braces inside strings as nesting", () => {
    expect(exceedsJsonNestingLimit(`{"value":"${"[".repeat(256)}"}`)).toBe(false)
  })
})
