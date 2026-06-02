import type { SynapseContentMeta } from "@/types/content"

function normalizeTitleForDuplicateCheck(title: string): string {
  return title.trim()
}

function hasDuplicateContentTitle(
  existingItems: readonly Pick<SynapseContentMeta, "title">[],
  title: string,
): boolean {
  const normalizedTitle = normalizeTitleForDuplicateCheck(title)
  if (!normalizedTitle) return false

  return existingItems.some((item) => normalizeTitleForDuplicateCheck(item.title) === normalizedTitle)
}

export { hasDuplicateContentTitle }
