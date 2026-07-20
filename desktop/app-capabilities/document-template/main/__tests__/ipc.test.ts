import path from "node:path"
import { describe, expect, it } from "vitest"
import { documentTemplateIpcModule } from "../ipc"

const templatePath = path.resolve("template.docx")
const outputPath = path.resolve("output.docx")
const dataPath = path.resolve("data.json")

describe("documentTemplateIpcModule", () => {
  it("declares document template channels", () => {
    expect(documentTemplateIpcModule.id).toBe("documentTemplate")
    expect(documentTemplateIpcModule.methods.chooseTemplateFile.operationId).toBe("app.document_template.template.choose")
    expect(documentTemplateIpcModule.methods.chooseJsonFile.operationId).toBe("app.document_template.json.choose")
    expect(documentTemplateIpcModule.methods.chooseOutputFile.operationId).toBe("app.document_template.output.choose")
    expect(documentTemplateIpcModule.methods.generateDocx.operationId).toBe("app.document_template.docx.generate")
  })

  it("validates dataPath and inline data alternatives", () => {
    const request = documentTemplateIpcModule.methods.generateDocx.request
    expect(request.safeParse({
      templatePath,
      outputPath,
      data: { name: "Ada" },
    }).success).toBe(true)
    expect(request.safeParse({
      templatePath,
      outputPath,
      dataPath,
    }).success).toBe(true)
    expect(request.safeParse({
      templatePath,
      outputPath,
    }).success).toBe(false)
    expect(request.safeParse({
      templatePath: "template.docx",
      outputPath,
      data: { name: "Ada" },
    }).success).toBe(false)
    expect(request.safeParse({
      templatePath,
      outputPath: "output.docx",
      data: { name: "Ada" },
    }).success).toBe(false)
    expect(request.safeParse({
      templatePath,
      outputPath,
      dataPath: "data.json",
    }).success).toBe(false)
  })
})
