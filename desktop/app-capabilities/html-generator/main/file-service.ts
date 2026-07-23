import path from "node:path"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import type { TextFileWriterService } from "../../text-file-writer/main/service"
import { TextFileWriteError } from "../../text-file-writer/shared/errors"
import { HtmlGenerationError } from "../shared/errors"
import type { HtmlGenerationFileInput, HtmlGenerationFileResult } from "../shared/schema"
import type { HtmlGenerationService } from "./service"

export type HtmlGenerationToFileService = {
  generateToFile(
    input: HtmlGenerationFileInput,
    context?: {
      readonly actor?: DispatchContext["actor"]
      readonly source?: DispatchContext["source"] | "app.ui"
      readonly metadata?: Record<string, unknown>
      readonly abortSignal?: AbortSignal
    },
  ): Promise<HtmlGenerationFileResult>
}

export function createHtmlGenerationToFileService(deps: {
  readonly generator: Pick<HtmlGenerationService, "generateForOperation">
  readonly writer: Pick<TextFileWriterService, "write">
}): HtmlGenerationToFileService {
  return {
    async generateToFile(input, context = {}) {
      const parsed = parseFileInput(input)
      const rendered = await deps.generator.generateForOperation("ejs_file", {
        template: parsed.template,
        data: parsed.data,
      }, context)
      if (context.abortSignal?.aborted) throw new HtmlGenerationError("RENDER_CANCELLED")
      const output = await deps.writer.write({
        text: rendered.html,
        path: parsed.outputPath,
        encoding: "utf8",
        overwrite: parsed.overwrite,
      }, {
        actor: context.actor,
        source: context.source,
        metadata: { ...context.metadata, parentCapability: "app.html_generator.ejs_file.generate" },
        abortSignal: context.abortSignal,
      })
      if (output.format !== "html" && output.format !== "htm") {
        throw new TextFileWriteError("UNSUPPORTED_EXTENSION")
      }
      return { output: { ...output, format: output.format, encoding: "utf8" } }
    },
  }
}

function parseFileInput(input: HtmlGenerationFileInput): {
  readonly template: string
  readonly data: Record<string, unknown>
  readonly outputPath: string
  readonly overwrite: boolean
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HtmlGenerationError("INVALID_DATA")
  const record = input as Record<string, unknown>
  const allowed = new Set(["template", "data", "outputPath", "overwrite"])
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new HtmlGenerationError("INVALID_DATA")
  if (typeof record.outputPath !== "string" || !path.isAbsolute(record.outputPath) || record.outputPath.includes("\0")) {
    throw new TextFileWriteError("INVALID_PATH")
  }
  const extension = path.extname(record.outputPath).toLowerCase()
  if (extension !== ".html" && extension !== ".htm") throw new TextFileWriteError("UNSUPPORTED_EXTENSION")
  if (record.overwrite !== undefined && typeof record.overwrite !== "boolean") throw new TextFileWriteError("WRITE_FAILED")
  return {
    template: record.template as string,
    data: record.data as Record<string, unknown>,
    outputPath: record.outputPath,
    overwrite: record.overwrite === true,
  }
}
