import type { SynapseCreatePromptPayload } from "@/types/content"

export type CreatePromptPayload = SynapseCreatePromptPayload

export type PromptCreateFieldName = keyof CreatePromptPayload

export type PromptCreateFieldErrors = Partial<Record<PromptCreateFieldName, string>>
