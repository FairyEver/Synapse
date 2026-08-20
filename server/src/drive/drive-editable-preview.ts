import type {
  DriveBrowserEditDto,
  DriveBrowserEditUnavailableReason,
  DriveBrowserPreviewDto,
  DriveBrowserPreviewKind,
} from "@synapse/shared"

export function buildDriveBrowserEdit(input: {
  readonly canWrite: boolean
  readonly item: {
    readonly type: string
  }
  readonly preview: DriveBrowserPreviewDto | null
  readonly currentVersionId: string | null
  readonly unauthenticatedEditableShare?: boolean
}): DriveBrowserEditDto {
  const support = resolveTextEditSupport(input.item, input.preview)
  const canEdit = input.canWrite && support.supported && input.currentVersionId !== null
  return {
    canEdit,
    editorKind: support.supported ? "text" : "none",
    currentVersionId: input.currentVersionId,
    reason: canEdit ? null : resolveEditUnavailableReason({
      supportReason: support.reason,
      canWrite: input.canWrite,
      hasCurrentVersion: input.currentVersionId !== null,
      unauthenticatedEditableShare: input.unauthenticatedEditableShare ?? false,
    }),
  }
}

export function isDriveTextEditablePreviewKind(kind: DriveBrowserPreviewKind): boolean {
  return kind === "text" || kind === "html-source" || kind === "markdown"
}

function resolveTextEditSupport(
  item: { readonly type: string },
  preview: DriveBrowserPreviewDto | null,
): { readonly supported: boolean; readonly reason: DriveBrowserEditUnavailableReason | null } {
  if (item.type !== "file" || !preview || !isDriveTextEditablePreviewKind(preview.kind)) {
    return { supported: false, reason: "unsupported" }
  }
  if (preview.truncated) {
    return { supported: false, reason: "truncated" }
  }
  return { supported: true, reason: null }
}

function resolveEditUnavailableReason(input: {
  readonly supportReason: DriveBrowserEditUnavailableReason | null
  readonly canWrite: boolean
  readonly hasCurrentVersion: boolean
  readonly unauthenticatedEditableShare: boolean
}): DriveBrowserEditUnavailableReason | null {
  if (input.supportReason) return input.supportReason
  if (!input.hasCurrentVersion) return "unsupported"
  if (input.unauthenticatedEditableShare) return "login_required"
  if (!input.canWrite) return "permission_denied"
  return null
}
