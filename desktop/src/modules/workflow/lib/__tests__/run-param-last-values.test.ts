import { describe, expect, it } from "vitest"

import { createWorkflowLastRunValues } from "../run-param-last-values"

describe("createWorkflowLastRunValues", () => {
  it("records resource types without inspecting or changing the raw values", () => {
    const values = {
      files: ["/tmp/one.txt", "/tmp/two.txt"],
      output: "/tmp/output",
      topic: "release",
    }

    expect(createWorkflowLastRunValues([
      { name: "files", type: "file", default: null, allowMultiple: true },
      { name: "output", type: "directory", default: null },
      { name: "topic", type: "text", default: "" },
    ], values)).toEqual({
      values,
      resourceEntryTypes: {
        files: "file",
        output: "directory",
      },
    })
  })
})
