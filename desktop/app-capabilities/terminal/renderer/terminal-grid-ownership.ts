/**
 * What the desktop's own fit is allowed to do about a terminal's grid.
 *
 * Two things can decide a terminal's size: a phone, when its display mode asks the
 * desktop to adopt the phone's grid so the phone can render it exactly, and this
 * machine's own layout. Only one of them may speak at a time, and which one is not
 * a matter of preference — it changes when somebody acts.
 */
export type TerminalGridDecision =
  /** The local fit decides, as it always did. */
  | "fit"
  /** A phone decides, and nothing here has acted, so the fit stays out of it. */
  | "hold"
  /** A phone decides, and someone here has acted, so the claim is given back. */
  | "release"

export function decideTerminalGrid(input: {
  /** A phone has claimed this terminal's grid. */
  readonly hasMobileOwner: boolean
  /** This pane has already asked to give the grid back. */
  readonly releaseRequested: boolean
  /** The pane's own size moved since the last look. */
  readonly paneChanged: boolean
}): TerminalGridDecision {
  // Nobody claimed it, so the local fit is the only candidate there is.
  if (!input.hasMobileOwner) return "fit"
  // It has already asked. The claim is on its way out, and asking again would be
  // a second request for a state that is already changing.
  if (input.releaseRequested) return "fit"
  // A phone owns the grid and this machine has not acted, so the fit has nothing
  // to say: whatever it proposes is a size the phone did not choose.
  if (!input.paneChanged) return "hold"
  // The pane's own size moved, which only happens when someone here resized a
  // window or re-split a panel. That is the same act as typing into a terminal the
  // phone holds the write lease for, and it takes the grid back the same way.
  return "release"
}
