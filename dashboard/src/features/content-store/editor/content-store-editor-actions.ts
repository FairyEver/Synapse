import type { ContentStoreVisibility } from '@synapse/shared'

type ConfirmContentVisibilityChangeOptions = {
  visibilityTarget: ContentStoreVisibility | null
  setVisibility: (visibility: ContentStoreVisibility) => Promise<unknown>
  clearVisibilityTarget: () => void
  notifyError: (message: string) => void
}

export async function confirmContentVisibilityChange({
  visibilityTarget,
  setVisibility,
  clearVisibilityTarget,
  notifyError,
}: ConfirmContentVisibilityChangeOptions) {
  if (!visibilityTarget) return
  try {
    await setVisibility(visibilityTarget)
    clearVisibilityTarget()
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '更新失败')
  }
}
