import type {
  EditorScanContentStoreUploadRequest,
  ScanItemForDetail,
} from "@/types/editor-scan"

type UploadSkillDraftContext = {
  readonly projectPath?: string | null
}

function getUploadSkillToContentStoreDisabledReason(item: ScanItemForDetail | null): string | null {
  if (!item) return "未选择内容"
  if (item.type !== "skill") return "只有 Skill 可以上传到 Skill Repository"
  if (!item.path?.trim()) return "本地路径为空"
  return null
}

function canUploadSkillToContentStore(item: ScanItemForDetail | null): boolean {
  return getUploadSkillToContentStoreDisabledReason(item) === null
}

function buildUploadSkillDraftRequest(
  item: ScanItemForDetail,
  context: UploadSkillDraftContext = {},
): EditorScanContentStoreUploadRequest {
  const disabledReason = getUploadSkillToContentStoreDisabledReason(item)
  if (disabledReason) {
    throw new Error(disabledReason)
  }

  return {
    itemType: "skill",
    itemPath: item.path,
    itemName: item.name,
    editorId: item.editorId,
    scope: item.scope,
    projectPath: context.projectPath ?? item.projectPath ?? null,
  }
}

function buildUploadSkillDraftSuccessMessage(): string {
  return "Skill 仓库已保存。"
}

function buildUploadSkillDraftErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("账号未登录") || message.includes("AccountAuthenticationRequiredError")) {
    return "请先登录账号。"
  }
  return message || "上传失败。"
}

export {
  buildUploadSkillDraftErrorMessage,
  buildUploadSkillDraftRequest,
  buildUploadSkillDraftSuccessMessage,
  canUploadSkillToContentStore,
  getUploadSkillToContentStoreDisabledReason,
}
