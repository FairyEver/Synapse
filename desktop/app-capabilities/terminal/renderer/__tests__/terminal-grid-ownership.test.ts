import { describe, expect, it } from "vitest"

import { decideTerminalGrid } from "../terminal-grid-ownership"

/**
 * Which of the two things that can decide a terminal's size is allowed to speak.
 *
 * Getting this wrong is not a cosmetic bug: a fit that speaks while a phone owns
 * the grid silently resizes the terminal back to the desktop's shape, and the
 * phone's whole rendering mode stops being true. The cases below are written so
 * that neither a blanket "always fit" nor a blanket "always hold" passes.
 */
describe("decideTerminalGrid", () => {
  it("lets the local fit decide when no phone has claimed the grid", () => {
    expect(
      decideTerminalGrid({ hasMobileOwner: false, releaseRequested: false, paneChanged: false }),
    ).toBe("fit")
    // The pane moving changes nothing here — there is nobody else to defer to.
    expect(
      decideTerminalGrid({ hasMobileOwner: false, releaseRequested: false, paneChanged: true }),
    ).toBe("fit")
  })

  it("keeps the fit out of it while a phone owns the grid and nothing here has moved", () => {
    // The ordinary case for the whole mode: a phone set the size, and the desktop
    // is not allowed to argue.
    expect(
      decideTerminalGrid({ hasMobileOwner: true, releaseRequested: false, paneChanged: false }),
    ).toBe("hold")
  })

  it("gives the grid back when the pane itself moves", () => {
    // Someone dragged the window or re-split a panel. Same act as typing into a
    // terminal the phone holds the write lease for.
    expect(
      decideTerminalGrid({ hasMobileOwner: true, releaseRequested: false, paneChanged: true }),
    ).toBe("release")
  })

  it("does not ask twice before the claim has cleared", () => {
    // The release is in flight and the session has not caught up, so the owner is
    // still visible. Asking again would be a second request for one act.
    expect(
      decideTerminalGrid({ hasMobileOwner: true, releaseRequested: true, paneChanged: true }),
    ).toBe("fit")
    expect(
      decideTerminalGrid({ hasMobileOwner: true, releaseRequested: true, paneChanged: false }),
    ).toBe("fit")
  })
})
