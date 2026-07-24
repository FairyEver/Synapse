import { parentPort, workerData } from "node:worker_threads"
import { HTML_GENERATION_OUTPUT_MAX_BYTES } from "../shared/limits"
import type { JsonObject } from "../shared/schema"
import { isWellFormedUnicode } from "./normalization"
import { ejsRuntime } from "./ejs-runtime"
import type { HtmlGenerationWorkerInput, HtmlGenerationWorkerMessage } from "./worker-protocol"

const port = parentPort
if (!port) throw new Error("HTML generation Worker requires a parent port")
const activePort = port

const input = parseInput(workerData)
const disabledIncluder = (): never => {
  throw new Error("EJS include is disabled")
}
ejsRuntime.fileLoader = (): never => {
  throw new Error("EJS file loading is disabled")
}

run()

function run(): void {
  post({ type: "started" })

  let render: (data: Record<string, unknown>) => string
  try {
    render = ejsRuntime.compile(input.template, {
      _with: false,
      strict: true,
      localsName: "data",
      delimiter: "%",
      openDelimiter: "<",
      closeDelimiter: ">",
      async: false,
      compileDebug: true,
      debug: false,
      rmWhitespace: false,
      cache: false,
      filename: false,
      root: [],
      views: [],
      includer: disabledIncluder,
      escape: ejsRuntime.escapeXML,
      context: undefined,
      outputFunctionName: undefined,
      destructuredLocals: undefined,
      unsafePrototypeLocals: false,
      legacyInclude: false,
    })
  } catch {
    post({ type: "error", code: "TEMPLATE_COMPILE_FAILED" })
    return
  }

  try {
    const html = render(input.data)
    if (typeof html !== "string" || !isWellFormedUnicode(html)) {
      post({ type: "error", code: "RENDER_FAILED" })
    } else {
      const size = Buffer.byteLength(html, "utf8")
      post(size > HTML_GENERATION_OUTPUT_MAX_BYTES
        ? { type: "error", code: "OUTPUT_TOO_LARGE" }
        : { type: "success", html, size })
    }
  } catch (error) {
    const line = extractRuntimeLine(error, input.template)
    post({ type: "error", code: "RENDER_FAILED", ...(line === undefined ? {} : { line }) })
  }
}

function post(message: HtmlGenerationWorkerMessage): void {
  activePort.postMessage(message)
}

function parseInput(value: unknown): HtmlGenerationWorkerInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Worker input")
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !== "data,template") throw new Error("Invalid Worker input")
  if (typeof record.template !== "string" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    throw new Error("Invalid Worker input")
  }
  return { template: record.template, data: record.data as JsonObject }
}

function extractRuntimeLine(error: unknown, template: string): number | undefined {
  const message = error instanceof Error ? error.message : ""
  const match = /^ejs:(\d+)\n/.exec(message)
  if (!match) return undefined
  const line = Number(match[1])
  const lineCount = template.split("\n").length
  return Number.isSafeInteger(line) && line > 0 && line <= lineCount ? line : undefined
}
