import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.skill-repository-external-open")

export const SKILL_REPOSITORY_OPEN_WARNING = "操作已完成，但未能打开外部链接。请使用返回的链接重试。"

export async function openSkillRepositoryExternalLink(input: {
  readonly requested: boolean
  readonly targetKind: "install" | "management" | "public"
  readonly url: string
  readonly openExternal?: (url: string) => Promise<void> | void
}): Promise<string | undefined> {
  if (!input.requested) return undefined
  if (!input.openExternal) return SKILL_REPOSITORY_OPEN_WARNING
  try {
    await input.openExternal(input.url)
    return undefined
  } catch (error) {
    logger.warn("Skill Repository external link open failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
      targetKind: input.targetKind,
    })
    return SKILL_REPOSITORY_OPEN_WARNING
  }
}
