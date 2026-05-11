/**
 * Minimum delay (ms) after calling onClose() before dispatching cross-tab navigation.
 *
 * Radix DismissableLayer animates dialog close over ~150ms (tw-animate-css default,
 * controlled by --tw-duration CSS variable). After animation ends, DismissableLayer
 * cleanup restores body.pointerEvents. 300ms = 150ms animation + 150ms settle buffer
 * for React cleanup scheduling.
 *
 * If the animation duration ever changes (e.g., via --tw-duration CSS variable),
 * update this constant to remain > animation duration.
 */
export const DIALOG_CLOSE_SETTLE_MS = 300

/**
 * Defensively clears body.pointerEvents if it has been left in a non-empty state.
 *
 * Radix DismissableLayer stores originalBodyPointerEvents in a module-level shared
 * variable. If a new Dialog opens while a previous Dialog's close animation is still
 * running, the new instance captures "none" as the restore value, permanently freezing
 * pointer events after it closes.
 *
 * Call this before opening any Dialog that may follow another Dialog's close.
 */
export function ensureBodyInteractable(): void {
  if (document.body.style.pointerEvents) {
    document.body.style.pointerEvents = ""
  }
}

/**
 * Closes a Radix Dialog and safely dispatches a navigation action after
 * the close animation and DismissableLayer cleanup have settled.
 *
 * Use this instead of:
 *   onClose()
 *   setTimeout(() => navigate(...), 300)
 *
 * The body.pointerEvents guard fires just before the action to break any
 * residual Radix DismissableLayer pollution.
 */
export function closeDialogThenNavigate(
  onClose: () => void,
  action: () => void,
): void {
  onClose()
  setTimeout(() => {
    ensureBodyInteractable()
    action()
  }, DIALOG_CLOSE_SETTLE_MS)
}
