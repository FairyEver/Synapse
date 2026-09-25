import type { MobileToolbarButton } from "@synapse/shared" with { "resolution-mode": "import" }

import type { TerminalCustomToolbarAction } from "../shared/schema"

/**
 * Turns the user's own toolbar entries into the list a phone shows.
 *
 * **Only what the user wrote crosses the wire.** The computer's built-ins — the return
 * key, `Ctrl+C`, the slash commands — are drawn by each end from its own code, and that
 * split is deliberate rather than incidental. A phone's front row is not the computer's
 * front row: the phone needs arrows and `Tab` where a computer has a keyboard for them,
 * and the previous arrangement, where the phone's front row was a projection of the
 * computer's, made every key the phone needed something the computer had to be taught
 * first. The two ends share exactly one list, and it is the one the user authored.
 *
 * One rule decides what this function does with that list, and it exists so that
 * pressing a button on the phone does what clicking it on the computer does:
 * **the text is passed through untouched.** No trimming, no quoting, no escaping. A
 * command the phone runs has to be the command the user wrote, character for
 * character; anything clever done here is a way for the two ends to disagree.
 *
 * A projection that drifted would look entirely healthy on both ends and simply do the
 * wrong thing, on a terminal, where the wrong thing is often destructive. That is what
 * the equivalence test beside this file is for: it compares these buttons against what
 * the desktop's own click path writes into the PTY.
 */

/**
 * `pressEnter` rides along as the user set it, and the two arms are not
 * interchangeable: a button that only types writes exactly its text, while one that
 * runs writes the text and then a carriage return. The phone turns the first into a
 * `keys` intent and the second into a `command` intent, so blurring them here would
 * press Enter on the user's behalf — a different, and potentially destructive, act.
 */
export function projectMobileToolbarButtons(
  custom: readonly TerminalCustomToolbarAction[],
): readonly MobileToolbarButton[] {
  return custom.map((action) => ({
    id: action.id,
    label: action.label,
    group: "custom",
    action: { type: "text", text: action.content, pressEnter: action.pressEnter },
  }))
}
