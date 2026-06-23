import { describe, expect, it } from "vitest"
import { documentTemplateIpcModule } from "../ipc"

describe("documentTemplateIpcModule", () => {
  it("declares document template channels", () => {
    expect(documentTemplateIpcModule.id).toBe("documentTemplate")
    expect(documentTemplateIpcModule.methods.chooseTemplateFile.channel).toBe("synapse:document-template:template:choose")
    expect(documentTemplateIpcModule.methods.chooseJsonFile.channel).toBe("synapse:document-template:json:choose")
    expect(documentTemplateIpcModule.methods.chooseOutputFile.channel).toBe("synapse:document-template:output:choose")
    expect(documentTemplateIpcModule.methods.generateDocx.channel).toBe("synapse:document-template:docx:generate")
  })

  it("validates dataPath and inline data alternatives", () => {
    const request = documentTemplateIpcModule.methods.generateDocx.request
    expect(request.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
      data: { name: "Ada" },
    }).success).toBe(true)
    expect(request.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
      dataPath: "/tmp/data.json",
    }).success).toBe(true)
    expect(request.safeParse({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
    }).success).toBe(false)
  })
})
