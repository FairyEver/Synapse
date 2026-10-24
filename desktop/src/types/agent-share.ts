import { z } from "zod"
export const AGENT_SHARE_MAX_PNG_BYTES = 32 * 1024 * 1024
export const AGENT_SHARE_MAX_PIXELS = 128_000_000
export const AGENT_SHARE_COPY_MAX_PIXELS = 32_000_000
export const AGENT_SHARE_MAX_HEIGHT = 64_000

export type AgentShareImageRequest = {
  readonly action: "copy" | "save"
  readonly pngBase64: string
  readonly fileName: string
}

export type AgentShareImageResult = { readonly success: boolean; readonly filePath?: string }

export type AgentShareSettings = {
  readonly width: 720 | 960
  readonly scale: 2 | 3
  readonly redact: boolean
  readonly showModel: boolean
  readonly showTime: boolean
}

export const DEFAULT_AGENT_SHARE_SETTINGS: AgentShareSettings = {
  width: 720, scale: 2, redact: true,
  showModel: true, showTime: true,
}

export const shareSettingsSchema = z.object({
  width: z.union([z.literal(720), z.literal(960)]).default(720),
  scale: z.union([z.literal(2), z.literal(3)]).default(2),
  redact: z.boolean().default(true), showModel: z.boolean().default(true), showTime: z.boolean().default(true),
}).strict()
