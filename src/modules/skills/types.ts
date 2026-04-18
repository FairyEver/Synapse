export type CreateSkillFilePayload = {
  relativePath: string
  size: number
  file: File
}

export type CreateSkillPayload = {
  title: string
  description: string
  category: string
  icon: string
  iconBg: string
  content: string
  files: CreateSkillFilePayload[]
}

export type SkillCreateFieldName = keyof CreateSkillPayload

export type SkillCreateFieldErrors = Partial<Record<SkillCreateFieldName, string>>
