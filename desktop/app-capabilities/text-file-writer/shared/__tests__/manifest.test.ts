import { describe, expect, it } from "vitest"
import { textFileWriterCapabilityManifest } from "../manifest"

describe("text file writer capability manifest", () => {
  it("registers MCP and Workflow surfaces without a System App or deep link", () => {
    expect(textFileWriterCapabilityManifest).toEqual({
      id: "text-file-writer",
      app: null,
      capabilities: ["app.text_file_writer.file.write"],
      mcpTools: ["app_text_file_writer_file_write"],
      workflowNodes: ["text_file_writer_file_write"],
      deepLinks: [],
    })
  })
})
