import { describe, expect, it } from "vitest"

import {
  getToolDefinition,
  isSynapseToolId,
  listToolDefinitions,
  resolveToolWindowBounds,
  requireToolDefinition,
} from "../tool-registry"

describe("tool registry", () => {
  it("registers atomic builtin conversion tools", () => {
    expect(listToolDefinitions().map((tool) => tool.id)).toEqual([
      "docx-to-markdown",
      "xlsx-to-markdown",
      "csv-to-markdown",
      "pdf-to-markdown",
      "pptx-to-markdown",
    ])
    expect(getToolDefinition("docx-to-markdown")).toMatchObject({
      id: "docx-to-markdown",
      title: "DOCX 转 Markdown",
      windowTitle: "DOCX 转 Markdown",
      bounds: { width: 500, height: 560, minWidth: 500, minHeight: 420 },
    })
    expect(isSynapseToolId("docx-to-markdown")).toBe(true)
    expect(isSynapseToolId("unknown")).toBe(false)
  })

  it("resolves tool window bounds with default fallback", () => {
    expect(resolveToolWindowBounds({
      window: { bounds: { width: 640 } },
    })).toEqual({ width: 640, height: 560, minWidth: 560, minHeight: 420 })

    expect(resolveToolWindowBounds({})).toEqual({ width: 760, height: 560, minWidth: 560, minHeight: 420 })
  })

  it("rejects unknown tool ids", () => {
    expect(() => requireToolDefinition("unknown")).toThrow("Unknown tool: unknown")
  })
})
