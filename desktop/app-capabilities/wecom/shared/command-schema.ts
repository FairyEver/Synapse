import { z } from "zod"

const MAX_CLI_ARGS = 256
const MAX_CLI_ARG_CHARS = 64 * 1024
const MAX_CLI_TOTAL_CHARS = 512 * 1024

export const WECOM_CLI_SERVICES = [
  "message",
  "media",
  "identity",
  "schema",
] as const

export const WECOM_CLI_SERVICE_SET: ReadonlySet<string> = new Set<string>(WECOM_CLI_SERVICES)

export const wecomConnectionGetInputSchema = z.object({}).strict()

export const wecomCliRunInputSchema = z.object({
  args: z.array(z.string().max(MAX_CLI_ARG_CHARS)).min(1).max(MAX_CLI_ARGS),
}).strict().superRefine((input, context) => {
  const totalChars = input.args.reduce((total, value) => total + value.length, 0)
  if (totalChars > MAX_CLI_TOTAL_CHARS) {
    context.addIssue({
      code: "custom",
      path: ["args"],
      message: `命令参数总长度不能超过 ${MAX_CLI_TOTAL_CHARS}。`,
    })
  }

  const service = input.args[0]
  if (!service || !WECOM_CLI_SERVICE_SET.has(service)) {
    context.addIssue({
      code: "custom",
      path: ["args", 0],
      message: "不支持的企业微信命令。",
    })
  }
  if (service === "media" && input.args[1] !== "upload") {
    context.addIssue({
      code: "custom",
      path: ["args", 1],
      message: "仅支持企业微信消息所需的媒体上传。",
    })
  }
})

export type WecomConnectionGetInput = z.infer<typeof wecomConnectionGetInputSchema>
export type WecomCliRunInput = z.infer<typeof wecomCliRunInputSchema>

export type WecomConnectionView = {
  readonly status: "disconnected" | "connecting" | "verifying" | "connected" | "reconnect_required" | "failed"
  readonly enabled: boolean
  readonly connectedAt?: string
  readonly lastValidatedAt?: string
}

export type WecomCliOutputFormat = "json" | "ndjson" | "text"

export type WecomCliRunResult = {
  readonly output: unknown
  readonly format: WecomCliOutputFormat
  readonly workingDirectory: string
}
