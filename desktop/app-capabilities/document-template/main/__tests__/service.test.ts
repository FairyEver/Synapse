import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import PizZip from "pizzip"
import { describe, expect, it } from "vitest"
import { createDocumentTemplateService } from "../service"

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "synapse-doc-template-"))
}

async function writeTemplate(filePath: string, bodyXml = "<w:p><w:r><w:t>Hello {name}</w:t></w:r></w:p>"): Promise<void> {
  const zip = new PizZip()
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
    <w:sectPr/>
  </w:body>
</w:document>`)
  const buffer = zip.generate({ type: "nodebuffer" })
  await writeFile(filePath, buffer)
}

describe("DocumentTemplateService", () => {
  it("generates a docx from inline JSON data", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)

      const result = await createDocumentTemplateService(() => new Date("2026-06-23T00:00:00.000Z")).generateDocx({
        templatePath,
        outputPath,
        data: { name: "Ada" },
      })

      expect(result).toMatchObject({
        outputPath,
        fileName: "output.docx",
        generatedAt: "2026-06-23T00:00:00.000Z",
      })
      expect(result.size).toBeGreaterThan(0)
      await expect(stat(outputPath)).resolves.toMatchObject({ size: expect.any(Number) })
      const outputZip = new PizZip(await readFile(outputPath))
      expect(outputZip.file("word/document.xml")?.asText()).toContain("Hello Ada")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("generates a docx from a JSON file", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const dataPath = path.join(dir, "data.json")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)
      await writeFile(dataPath, JSON.stringify({ name: "Grace" }))

      await createDocumentTemplateService().generateDocx({ templatePath, dataPath, outputPath })

      const outputZip = new PizZip(await readFile(outputPath))
      expect(outputZip.file("word/document.xml")?.asText()).toContain("Hello Grace")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("renders indexed aliases and date fields when they are present in JSON data", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath, [
        "<w:p><w:r><w:t>{year}年{month}月{date}日</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>{#xue_xi_ti_hui}{indexValue}。{/xue_xi_ti_hui}</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>{#xue_xi_ti_hui_li_jie}{indexTitle}{#sections}{indexValueBracket}{/sections}{/xue_xi_ti_hui_li_jie}</w:t></w:r></w:p>",
      ].join(""))

      await createDocumentTemplateService(() => new Date("2026-06-23T00:00:00.000Z")).generateDocx({
        templatePath,
        outputPath,
        data: {
          year: 2026,
          month: 6,
          date: 23,
          xue_xi_ti_hui: [
            { indexValue: "1、守初心" },
            { indexValue: "2、担使命" },
          ],
          xue_xi_ti_hui_li_jie: [
            {
              indexTitle: "1、守初心",
              sections: [
                { indexValueBracket: "（1）第一段" },
                { indexValueBracket: "（2）第二段" },
              ],
            },
            {
              indexTitle: "2、担使命",
              sections: [
                { indexValueBracket: "（1）第三段" },
              ],
            },
          ],
        },
      })

      const outputZip = new PizZip(await readFile(outputPath))
      const documentXml = outputZip.file("word/document.xml")?.asText()
      expect(documentXml).toContain("2026年6月23日")
      expect(documentXml).toContain("1、守初心。")
      expect(documentXml).toContain("2、担使命。")
      expect(documentXml).toContain("1、守初心")
      expect(documentXml).toContain("（1）第一段")
      expect(documentXml).toContain("（2）第二段")
      expect(documentXml).toContain("2、担使命")
      expect(documentXml).toContain("（1）第三段")
      expect(documentXml).not.toContain("undefined")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("does not derive date fields or indexed aliases from raw JSON data", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath, [
        "<w:p><w:r><w:t>{year}年{month}月{date}日</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>{#xue_xi_ti_hui}{indexValue}。{/xue_xi_ti_hui}</w:t></w:r></w:p>",
      ].join(""))

      await createDocumentTemplateService(() => new Date("2026-06-23T00:00:00.000Z")).generateDocx({
        templatePath,
        outputPath,
        data: {
          xue_xi_ti_hui: ["守初心"],
        },
      })

      const outputZip = new PizZip(await readFile(outputPath))
      const documentXml = outputZip.file("word/document.xml")?.asText()
      expect(documentXml).toContain("undefined年undefined月undefined日")
      expect(documentXml).toContain("undefined。")
      expect(documentXml).not.toContain("2026年6月23日")
      expect(documentXml).not.toContain("1、守初心")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rejects existing output without overwrite", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)
      await writeFile(outputPath, "existing")

      await expect(createDocumentTemplateService().generateDocx({
        templatePath,
        outputPath,
        data: { name: "Ada" },
      })).rejects.toThrow("输出文件已存在")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("overwrites existing output when requested", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)
      await writeFile(outputPath, "existing")

      await createDocumentTemplateService().generateDocx({
        templatePath,
        outputPath,
        data: { name: "Ada" },
        overwrite: true,
      })

      const outputZip = new PizZip(await readFile(outputPath))
      expect(outputZip.file("word/document.xml")?.asText()).toContain("Hello Ada")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("rejects a symlink output without modifying its target", async () => {
    const dir = await createTempDir()
    try {
      const templatePath = path.join(dir, "template.docx")
      const targetPath = path.join(dir, "protected.docx")
      const outputPath = path.join(dir, "output.docx")
      await writeTemplate(templatePath)
      await writeFile(targetPath, "protected")
      await symlink(targetPath, outputPath)

      await expect(createDocumentTemplateService().generateDocx({
        templatePath,
        outputPath,
        data: { name: "Ada" },
        overwrite: true,
      })).rejects.toThrow("输出文件不能是符号链接")

      await expect(readFile(targetPath, "utf8")).resolves.toBe("protected")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rejects invalid input combinations", async () => {
    await expect(createDocumentTemplateService().generateDocx({
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
    })).rejects.toThrow("Exactly one of dataPath or data is required")
  })
})
