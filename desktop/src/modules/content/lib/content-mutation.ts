import type {
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

export {
  countSavedContentMutations,
  isContentMutationSaved,
}
