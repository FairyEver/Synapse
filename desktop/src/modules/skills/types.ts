import type { SynapseCreateSkillPayload } from "@/types/content"

export type SkillCreateFilePayloadDraft = {
  originalName: string
  sha256?: string
  size: number
  file?: File
  bytes?: Uint8Array
  textContent?: string
  textDirty?: boolean
}

export type CreateSkillPayload = Omit<SynapseCreateSkillPayload, "files"> & {
  files: SkillCreateFilePayloadDraft[]
}

export type SkillCreateFieldName = keyof CreateSkillPayload

export type SkillCreateFieldErrors = Partial<Record<SkillCreateFieldName, string>>
