import type {
  EditorScanSkillRepositoryIdentityRetryRequest,
  EditorScanSkillRepositoryUploadRequest,
  EditorScanSkillRepositoryUploadResult,
  ScanItemForDetail,
} from "@/types/editor-scan"

function getUploadSkillToSkillRepositoryDisabledReason(item: ScanItemForDetail | null): string | null {
  if (!item) return "未选择内容"
  if (item.type !== "skill") return "只有 Skill 可以上传到 Skill Repository"
  if (!item.path.trim()) return "本地路径为空"
  if (item.mainFileName && item.mainFileName !== "SKILL.md") {
    return "上传到 Skill Repository 需要根目录 SKILL.md"
  }
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
    ...(item.mainFileName ? { mainFileName: item.mainFileName } : {}),
  }
}

function buildUploadSkillToSkillRepositorySuccessMessage(): string {
  return "已上传到 Skill Repository"
}

function buildRetrySkillRepositoryIdentityRequest(
  item: ScanItemForDetail,
  result: EditorScanSkillRepositoryUploadResult,
  expectedSourceFingerprint: string | undefined,
): EditorScanSkillRepositoryIdentityRetryRequest {
  if (!expectedSourceFingerprint) {
    throw new Error("缺少已确认的本地 Skill 版本，请重新上传。")
  }
  return {
    ...buildUploadSkillToSkillRepositoryRequest(item),
    repositoryId: result.repositoryId,
    name: result.name,
    owner: result.owner,
    expectedSourceFingerprint,
    expectedIdentityId: result.identityBeforeUploadId ?? null,
  }
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
  buildRetrySkillRepositoryIdentityRequest,
  canUploadSkillToSkillRepository,
  getUploadSkillToSkillRepositoryDisabledReason,
}
