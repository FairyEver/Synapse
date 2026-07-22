import { describe, expect, it } from "vitest"
import { textFileWriterCapabilityManifest } from "../manifest"

describe("text file writer capability manifest", () => {
  it("registers App, MCP, and Workflow surfaces without a deep link", () => {
    expect(textFileWriterCapabilityManifest).toEqual({
      id: "text-file-writer",
      app: { id: "text-file-writer" },
      capabilities: ["app.text_file_writer.file.write"],
      mcpTools: ["app_text_file_writer_file_write"],
      workflowNodes: ["text_file_writer_file_write"],
      deepLinks: [],
    })
  })
})
