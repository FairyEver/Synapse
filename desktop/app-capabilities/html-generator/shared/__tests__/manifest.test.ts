import { describe, expect, it } from "vitest"
import { htmlGeneratorCapabilityManifest } from "../manifest"

describe("HTML Generator capability manifest", () => {
  it("registers one App, two capabilities, two tools, two nodes, and no deep link", () => {
    expect(htmlGeneratorCapabilityManifest).toEqual({
      id: "html-generator",
      app: { id: "html-generator" },
      capabilities: [
        "app.html_generator.ejs.generate",
        "app.html_generator.ejs_file.generate",
      ],
      mcpTools: [
        "app_html_generator_ejs_generate",
        "app_html_generator_ejs_file_generate",
      ],
      workflowNodes: [
        "html_generator_ejs_generate",
        "html_generator_ejs_file_generate",
      ],
      deepLinks: [],
    })
  })
})
