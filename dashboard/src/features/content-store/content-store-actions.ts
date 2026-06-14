import type { ContentStoreItemDto } from '@synapse/shared'

export function canInstallContent(
  item: ContentStoreItemDto,
  currentUserId?: string | null
) {
  if (item.type === 'prompt') return false
  if (!item.latestVersionId) return false
  if (item.moderationStatus !== 'normal') return false
  return item.visibility === 'public' || item.owner.id === currentUserId
}

export function canCopyContent(item: ContentStoreItemDto) {
  return item.moderationStatus === 'normal' && Boolean(item.latestVersionId)
}

export function canCopyPromptText(item: ContentStoreItemDto) {
  return item.type === 'prompt' && canCopyContent(item)
}

export function canDeleteMyContent(item: ContentStoreItemDto) {
  return item.moderationStatus === 'normal' && item.visibility === 'private'
}

export function canChangeMyContentVisibility(item: ContentStoreItemDto) {
  return item.moderationStatus === 'normal'
}

export function canSetContentPublic(item: ContentStoreItemDto) {
  return item.moderationStatus === 'normal' && Boolean(item.latestVersionId)
}
