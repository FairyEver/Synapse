import { describe, expect, it } from "vitest"

import {
  getToolDefinition,
  isSynapseToolId,
  listToolDefinitions,
  requireToolDefinition,
} from "../tool-registry"

describe("tool registry", () => {
  it("registers file conversion as a stable top-level tool", () => {
    expect(listToolDefinitions()).toEqual([
      expect.objectContaining({
        id: "file-conversion",
        label: "文件转换",
        supportedExtensions: [".docx", ".xlsx", ".pdf", ".pptx"],
        bounds: { width: 760, height: 560, minWidth: 560, minHeight: 420 },
      }),
    ])
    expect(getToolDefinition("file-conversion")?.windowTitle).toBe("文件转换")
    expect(isSynapseToolId("file-conversion")).toBe(true)
    expect(isSynapseToolId("unknown")).toBe(false)
  })

  it("rejects unknown tool ids", () => {
    expect(() => requireToolDefinition("unknown")).toThrow("Unknown tool: unknown")
  })
})
