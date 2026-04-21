import type {
  SynapseEditorAdapterSummary,
  SynapseEditorResolvedTarget,
  SynapseResolveEditorTargetPayload,
} from "../../src/types/editor"
import { editorAdapterById, editorAdapters } from "./editor-adapters"
import { createUnavailableTarget, createUnsupportedTarget } from "./editor-adapters/utils"

class EditorAdapterService {
  listAdapters(): SynapseEditorAdapterSummary[] {
    return editorAdapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      supportsGlobal: adapter.supportsGlobal,
      supportsProject: adapter.supportsProject,
      supportedContentTypes: adapter.supportedContentTypes,
    }))
  }

  async resolveTarget(
    payload: SynapseResolveEditorTargetPayload,
  ): Promise<SynapseEditorResolvedTarget> {
    const adapter = editorAdapterById.get(payload.editorId)

    if (!adapter) {
      return createUnsupportedTarget({
        adapter: {
          id: payload.editorId,
          label: payload.editorId,
          supportsGlobal: false,
          supportsProject: false,
          supportedContentTypes: [],
        },
        contentType: payload.contentType,
        message: "未找到对应的编辑器适配器。",
        scope: payload.scope,
      })
    }

    if (!adapter.supportedContentTypes.includes(payload.contentType)) {
      return createUnsupportedTarget({
        adapter,
        contentType: payload.contentType,
        message: `${adapter.label} 暂不支持 ${payload.contentType} 类型。`,
        scope: payload.scope,
      })
    }

    const trimmedContentId = payload.contentId.trim()

    if (!trimmedContentId) {
      return createUnavailableTarget({
        adapter,
        contentType: payload.contentType,
        message: "内容 ID 为空，无法解析安装目标位置。",
        scope: payload.scope,
      })
    }

    if (payload.scope === "global") {
      return adapter.resolveGlobalTarget({
        contentId: trimmedContentId,
        contentType: payload.contentType,
        skillName: payload.skillName,
        skillTitle: payload.skillTitle,
        ruleName: payload.ruleName,
      })
    }

    if (!payload.projectPath?.trim()) {
      return createUnavailableTarget({
        adapter,
        contentType: payload.contentType,
        message: "项目路径为空，无法解析项目安装位置。",
        scope: payload.scope,
      })
    }

    return adapter.resolveProjectTarget(payload.projectPath, {
      contentId: trimmedContentId,
      contentType: payload.contentType,
      skillName: payload.skillName,
      skillTitle: payload.skillTitle,
      ruleName: payload.ruleName,
    })
  }
}

export const editorAdapterService = new EditorAdapterService()
