import { constants } from "node:fs"
import { access, lstat, open, readFile, stat } from "node:fs/promises"
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
      const generatedAt = now()
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
        throw new Error(`Word 模板渲染失败：${formatTemplateError(error)}`, { cause: error })
      }

      const outputSize = await writeOutputFile(parsed.outputPath, output, parsed.overwrite === true)

      return {
        outputPath: parsed.outputPath,
        fileName: path.basename(parsed.outputPath),
        size: outputSize,
        generatedAt: generatedAt.toISOString(),
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
    throw new Error("输出目录不存在", { cause: error })
  }
}

async function assertOutputWritable(outputPath: string, overwrite: boolean): Promise<void> {
  try {
    const outputStat = await lstat(outputPath)
    if (outputStat.isSymbolicLink()) throw new Error("输出文件不能是符号链接")
    if (!outputStat.isFile()) throw new Error("输出路径必须是普通文件")
    if (!overwrite) throw new Error("输出文件已存在，请启用覆盖后重试")
  } catch (error) {
    if (isFileNotFoundError(error)) return
    throw error
  }
}

async function writeOutputFile(outputPath: string, output: Buffer, overwrite: boolean): Promise<number> {
  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const flags = constants.O_WRONLY
    | constants.O_CREAT
    | noFollowFlag
    | (overwrite ? 0 : constants.O_EXCL)
  let handle
  try {
    handle = await open(outputPath, flags)
  } catch (error) {
    if (isSymlinkOpenError(error)) {
      throw new Error("输出文件不能是符号链接", { cause: error })
    }
    if (!overwrite && isFileExistsError(error)) {
      throw new Error("输出文件已存在，请启用覆盖后重试", { cause: error })
    }
    throw error
  }

  try {
    const [openedStat, outputStat] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(outputPath, { bigint: true }),
    ])
    if (outputStat.isSymbolicLink()) {
      throw new Error("输出文件不能是符号链接")
    }
    if (!openedStat.isFile() || !outputStat.isFile()) {
      throw new Error("输出路径必须是普通文件")
    }
    if (openedStat.dev !== outputStat.dev || openedStat.ino !== outputStat.ino) {
      throw new Error("输出文件在写入前发生变化")
    }
    await handle.truncate(0)
    await handle.writeFile(output)
    return (await handle.stat()).size
  } finally {
    await handle.close()
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
}

function isFileExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST"
}

function isSymlinkOpenError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ELOOP"
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
