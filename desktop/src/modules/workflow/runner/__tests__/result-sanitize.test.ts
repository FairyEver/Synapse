import { describe, expect, it } from "vitest"

import {
  sanitizeWorkflowPrimaryOutput,
  sanitizeWorkflowResultValue,
} from "../result-sanitize"

describe("workflow runner result sanitization", () => {
  it("preserves declared file-result paths", () => {
    const outputPath = "/tmp/generated/report.html"

    expect(sanitizeWorkflowPrimaryOutput(outputPath, { path: outputPath })).toBe(outputPath)
    expect(sanitizeWorkflowResultValue({ path: outputPath })).toEqual({ path: outputPath })
  })

  it("continues to redact arbitrary paths from plain output", () => {
    expect(sanitizeWorkflowPrimaryOutput("/Users/liyang/private.txt", undefined)).toBe("[path]")
  })
})
