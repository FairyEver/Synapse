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
  readonly title: string
  readonly width: 720 | 960
  readonly scale: 2 | 3
  readonly redact: boolean
  readonly showTitle: boolean
  readonly showBrand: boolean
}

export const DEFAULT_AGENT_SHARE_SETTINGS: AgentShareSettings = {
  title: "对话摘录", width: 720, scale: 2, redact: true,
  showTitle: true, showBrand: true,
}
