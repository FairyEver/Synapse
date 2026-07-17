import type { SynapseContentType } from "../types/content"

type ContentOwnershipFields = {
  createdBy: string
  type: SynapseContentType
}

function isContentCreator(
  item: ContentOwnershipFields,
  currentUserId: string | null,
): boolean {
  return Boolean(currentUserId && item.createdBy === currentUserId)
}

function canUpdateRepositoryContent(
  item: ContentOwnershipFields,
  currentUserId: string | null,
): boolean {
  return item.type === "skill" || isContentCreator(item, currentUserId)
}

function canManageRepositoryContentLifecycle(
  item: ContentOwnershipFields,
  currentUserId: string | null,
): boolean {
  return isContentCreator(item, currentUserId)
}

export {
  canManageRepositoryContentLifecycle,
  canUpdateRepositoryContent,
  isContentCreator,
}
