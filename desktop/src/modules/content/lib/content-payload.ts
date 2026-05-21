import type { SynapseContentIconType } from "@/types/content"
import { DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE } from "@/lib/content-appearance"

type ContentPayload = {
  title: string
  usage?: string
  description: string
  category: string
  icon: string
  iconBg: string
  iconType: SynapseContentIconType
  iconImage: string
  content: string
}

type ContentFieldErrors = {
  title?: string
  description?: string
  category?: string
  icon?: string
  iconBg?: string
  iconImage?: string
  content?: string
}

type ContentPayloadConfig = {
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
    usage: "",
    description: "",
    category: "",
    icon: "",
    iconBg: DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
    iconType: "icon",
    iconImage: "",
    content: "",
    ...defaults,
  } as T
}

function normalizeContentPayload<T extends ContentPayload>(payload: T): T {
  return {
    ...payload,
    iconBg: payload.iconBg || DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
    iconType: payload.iconType || "icon",
    title: payload.title.trim(),
    usage: payload.usage?.trim() ?? "",
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

  if (normalizedPayload.iconType === "image") {
    if (!normalizedPayload.iconImage) {
      errors.iconImage = "请上传图片。"
    }
  } else {
    if (!normalizedPayload.icon) {
      errors.icon = "请选择图标。"
    }

    if (!normalizedPayload.iconBg) {
      errors.iconBg = "请选择背景色。"
    }
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
    payload.title.trim() !== ""
    || (payload.usage?.trim() ?? "") !== ""
    || payload.description.trim() !== ""
    || payload.category.trim() !== ""
    || payload.icon.trim() !== ""
    || payload.iconBg !== DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE
    || payload.iconImage.trim() !== ""
    || payload.content.trim() !== ""
    || extraChecks(payload)
  )
}

function buildBaseContentInitialValue(detail: Partial<Pick<ContentPayload, "iconType" | "iconImage" | "usage">> & Omit<ContentPayload, "iconType" | "iconImage" | "usage">): ContentPayload {
  return {
    title: detail.title,
    usage: detail.usage ?? "",
    description: detail.description,
    category: detail.category,
    icon: detail.icon,
    iconBg: detail.iconBg,
    iconType: detail.iconType || "icon",
    iconImage: detail.iconImage || "",
    content: detail.content,
  }
}

export {
  buildBaseContentInitialValue,
  createEmptyContentPayload,
  isContentPayloadDirty,
  normalizeContentPayload,
  validateContentPayload,
}

export type { ContentFieldErrors, ContentPayload, ContentPayloadConfig }
