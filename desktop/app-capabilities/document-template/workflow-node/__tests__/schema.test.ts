import { describe, expect, it } from "vitest"
import { documentTemplateNodeConfigSchema } from "../schema"

describe("documentTemplateNodeConfigSchema", () => {
  it("accepts JSON file input", () => {
    expect(documentTemplateNodeConfigSchema.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
      dataSource: "dataPath",
      dataPath: "/tmp/data.json",
      overwrite: false,
      variables: [],
    }).success).toBe(true)
  })

  it("requires inline JSON when inline source is selected", () => {
    expect(documentTemplateNodeConfigSchema.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
      dataSource: "inline",
      dataJson: "",
      overwrite: false,
      variables: [],
    }).success).toBe(false)
  })
})
