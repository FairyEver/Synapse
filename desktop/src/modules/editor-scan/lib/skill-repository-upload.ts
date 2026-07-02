import type {
  EditorScanSkillRepositoryUploadRequest,
  ScanItemForDetail,
} from "@/types/editor-scan"

function getUploadSkillToSkillRepositoryDisabledReason(item: ScanItemForDetail | null): string | null {
  if (!item) return "未选择内容"
  if (item.type !== "skill") return "只有 Skill 可以上传到 Skill Repository"
  if (!item.path.trim()) return "本地路径为空"
  return null
}

function canUploadSkillToSkillRepository(item: ScanItemForDetail | null): boolean {
  return getUploadSkillToSkillRepositoryDisabledReason(item) === null
}

function buildUploadSkillToSkillRepositoryRequest(
  item: ScanItemForDetail,
): EditorScanSkillRepositoryUploadRequest {
  const disabledReason = getUploadSkillToSkillRepositoryDisabledReason(item)
  if (disabledReason) {
    throw new Error(disabledReason)
  }
  return {
    itemType: "skill",
    itemPath: item.path,
    itemName: item.name,
    editorId: item.editorId,
    scope: item.scope,
    ...(item.projectPath ? { projectPath: item.projectPath } : {}),
  }
}

function buildUploadSkillToSkillRepositorySuccessMessage(): string {
  return "已上传到 Skill Repository"
}

function buildUploadSkillToSkillRepositoryErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "上传到 Skill Repository 失败。"
}

export {
  buildUploadSkillToSkillRepositoryErrorMessage,
  buildUploadSkillToSkillRepositoryRequest,
  buildUploadSkillToSkillRepositorySuccessMessage,
  canUploadSkillToSkillRepository,
  getUploadSkillToSkillRepositoryDisabledReason,
}
