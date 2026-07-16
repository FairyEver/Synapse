import type {
  SynapseContentMeta,
  SynapseContentMutationResult,
  SynapseContentMutationSuccessResult,
} from "@/types/content"

function isContentMutationSaved(
  result: SynapseContentMutationResult,
): result is SynapseContentMutationSuccessResult {
  return result.status === "saved"
}

function countSavedContentMutations(results: SynapseContentMutationResult[]): number {
  return results.filter(isContentMutationSaved).length
}

function canManageContentDeletion(
  item: Pick<SynapseContentMeta, "createdBy" | "type">,
  currentUserId: string | null,
): boolean {
  return item.type !== "skill" || item.createdBy === currentUserId
}

function summarizeContentMutationConflictTitles(items: SynapseContentMeta[], limit = 3): string {
  const titles = items.slice(0, limit).map((item) => `「${item.title}」`)
  const remainingCount = items.length - titles.length
  return remainingCount > 0
    ? `${titles.join("、")} 等 ${items.length} 项`
    : titles.join("、")
}

export {
  canManageContentDeletion,
  countSavedContentMutations,
  isContentMutationSaved,
  summarizeContentMutationConflictTitles,
}
