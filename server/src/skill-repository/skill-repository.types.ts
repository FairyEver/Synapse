import type { SkillRepositoryImportFileInput } from "@synapse/shared"

export type SkillRepositoryImportRequest = {
  readonly repositoryId?: string | null
  readonly name?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly files: readonly SkillRepositoryImportFileInput[]
}
