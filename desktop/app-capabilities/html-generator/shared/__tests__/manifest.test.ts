import { describe, expect, it } from "vitest"
import { htmlGeneratorCapabilityManifest } from "../manifest"

describe("HTML Generator capability manifest", () => {
  it("registers two capabilities, tools, and nodes without a System App or deep link", () => {
    expect(htmlGeneratorCapabilityManifest).toEqual({
      id: "html-generator",
      app: null,
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
