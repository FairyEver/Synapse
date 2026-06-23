import { constants } from "node:fs"
import { access, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import Docxtemplater from "docxtemplater"
import PizZip from "pizzip"
import {
  generateDocxInputSchema,
  type GenerateDocxInput,
  type GenerateDocxResult,
} from "../shared/schema"

export type DocumentTemplateService = {
  generateDocx(input: GenerateDocxInput): Promise<GenerateDocxResult>
}

export function createDocumentTemplateService(now: () => Date = () => new Date()): DocumentTemplateService {
  return {
    async generateDocx(input) {
      const parsed = generateDocxInputSchema.parse(input)
      assertDocxPath(parsed.templatePath, "模板文件")
      assertDocxPath(parsed.outputPath, "输出文件")
      await assertFileReadable(parsed.templatePath, "模板文件不存在或不可读取")
      await assertOutputParentDirectory(parsed.outputPath)
      await assertOutputWritable(parsed.outputPath, parsed.overwrite === true)

      const data = parsed.dataPath
        ? await readJsonObject(parsed.dataPath)
        : parsed.data

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("JSON 数据必须是对象")
      }

      const templateBytes = await readFile(parsed.templatePath)
      let output: Buffer
      try {
        const zip = new PizZip(templateBytes)
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
        })
        doc.render(data)
        output = doc.getZip().generate({
          type: "nodebuffer",
          compression: "DEFLATE",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }) as Buffer
      } catch (error) {
        throw new Error(`Word 模板渲染失败：${formatTemplateError(error)}`)
      }

      await writeFile(parsed.outputPath, output, { flag: parsed.overwrite ? "w" : "wx" })
      const outputStat = await stat(parsed.outputPath)

      return {
        outputPath: parsed.outputPath,
        fileName: path.basename(parsed.outputPath),
        size: outputStat.size,
        generatedAt: now().toISOString(),
      }
    },
  }
}

function assertDocxPath(filePath: string, label: string): void {
  if (path.extname(filePath).toLowerCase() !== ".docx") {
    throw new Error(`${label}必须是 .docx 文件`)
  }
}

async function assertFileReadable(filePath: string, message: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK)
  } catch {
    throw new Error(message)
  }
}

async function assertOutputParentDirectory(outputPath: string): Promise<void> {
  const parent = path.dirname(outputPath)
  try {
    const parentStat = await stat(parent)
    if (!parentStat.isDirectory()) {
      throw new Error("输出目录不是文件夹")
    }
  } catch (error) {
    if (error instanceof Error && error.message === "输出目录不是文件夹") throw error
    throw new Error("输出目录不存在")
  }
}

async function assertOutputWritable(outputPath: string, overwrite: boolean): Promise<void> {
  try {
    await access(outputPath, constants.F_OK)
    if (!overwrite) throw new Error("输出文件已存在，请启用覆盖后重试")
  } catch (error) {
    if (error instanceof Error && error.message.includes("输出文件已存在")) throw error
  }
}

async function readJsonObject(dataPath: string): Promise<Record<string, unknown>> {
  if (path.extname(dataPath).toLowerCase() !== ".json") {
    throw new Error("JSON 文件必须是 .json 文件")
  }
  const text = await readFile(dataPath, "utf-8")
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 文件内容必须是对象")
  }
  return parsed as Record<string, unknown>
}

function formatTemplateError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}
