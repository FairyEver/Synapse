import { DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE } from "@/lib/content-appearance"

interface ContentPayload {
  title: string
  description: string
  category: string
  icon: string
  iconBg: string
  content: string
}

interface ContentFieldErrors {
  title?: string
  description?: string
  category?: string
  icon?: string
  iconBg?: string
  content?: string
}

interface ContentPayloadConfig {
  labels: {
    title: string
    description: string
    content: string
  }
}

function createEmptyContentPayload<T extends ContentPayload>(
  defaults: Partial<T> = {},
): T {
  return {
    title: "",
    description: "",
    category: "",
    icon: "",
    iconBg: DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
    content: "",
    ...defaults,
  } as T
}

function normalizeContentPayload<T extends ContentPayload>(payload: T): T {
  return {
    ...payload,
    iconBg: payload.iconBg || DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
    title: payload.title.trim(),
    description: payload.description.trim(),
    content: payload.content.trim(),
  }
}

function validateContentPayload<T extends ContentPayload>(
  payload: T,
  config: ContentPayloadConfig,
): ContentFieldErrors {
  const normalizedPayload = normalizeContentPayload(payload)
  const errors: ContentFieldErrors = {}

  if (!normalizedPayload.title) {
    errors.title = config.labels.title
  }

  if (!normalizedPayload.description) {
    errors.description = config.labels.description
  }

  if (!normalizedPayload.category) {
    errors.category = "请选择分类。"
  }

  if (!normalizedPayload.icon) {
    errors.icon = "请选择图标。"
  }

  if (!normalizedPayload.iconBg) {
    errors.iconBg = "请选择背景色。"
  }

  if (!normalizedPayload.content) {
    errors.content = config.labels.content
  }

  return errors
}

function isContentPayloadDirty<T extends ContentPayload>(
  payload: T,
  extraChecks: (payload: T) => boolean = () => false,
): boolean {
  return (
    payload.title !== ""
    || payload.description !== ""
    || payload.category !== ""
    || payload.icon !== ""
    || payload.iconBg !== DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE
    || payload.content !== ""
    || extraChecks(payload)
  )
}

export {
  createEmptyContentPayload,
  isContentPayloadDirty,
  normalizeContentPayload,
  validateContentPayload,
}

export type { ContentFieldErrors, ContentPayload, ContentPayloadConfig }
