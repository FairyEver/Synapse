import type { MobileKey, MobileToolbarButton } from "@synapse/shared" with { "resolution-mode": "import" }

import { MOBILE_KEYS } from "@synapse/shared/mobile-live-constants"
import type { TerminalCustomToolbarAction } from "../shared/schema"
import type { TerminalToolbarAction } from "../shared/toolbar-actions"
import { getTerminalToolbarActions, resolveTerminalToolbarPayload } from "../shared/toolbar-actions"

/**
 * Turns the computer's toolbar into the list a phone shows.
 *
 * Two rules decide everything here, and both of them exist so that pressing a button
 * on the phone does what pressing the same button on the computer does:
 *
 * - **The text is passed through untouched.** No trimming, no quoting, no escaping.
 *   A command the phone runs has to be the command the user wrote, character for
 *   character; anything clever done here is a way for the two ends to disagree.
 * - **The chips are derived from the bytes, not from a hand-written table.** A
 *   built-in whose sequence is what `Enter` sends becomes the `Enter` key, looked up
 *   rather than spelled out, so a built-in whose sequence is later changed changes
 *   its projection with it instead of quietly pointing at the old key.
 *
 * Nothing here is a source of truth: it is a pure function of the registry, the
 * user's stored actions, and the byte table, which is what makes the equivalence test
 * able to check it against the desktop's own click path.
 */

export type MobileToolbarProjectionInput = {
  /** The user's own actions, in the order the desktop lists them. */
  readonly custom: readonly TerminalCustomToolbarAction[]
  /** The desktop's platform, so the phone is offered what this computer offers. */
  readonly platform: string | undefined
  /** The terminal service's own key table. Injected so this module stays a leaf. */
  readonly keyBytes: Readonly<Record<string, string>>
}

export function projectMobileToolbarButtons(
  input: MobileToolbarProjectionInput,
): readonly MobileToolbarButton[] {
  const keyBySequence = reverseKeyBytes(input.keyBytes)
  const buttons: MobileToolbarButton[] = []

  for (const action of getTerminalToolbarActions(input.platform)) {
    const button = projectBuiltIn(action, input.platform, keyBySequence)
    if (button) buttons.push(button)
  }
  for (const action of input.custom) {
    buttons.push({
      id: action.id,
      label: action.label,
      group: "custom",
      action: { type: "text", text: action.content, pressEnter: action.pressEnter },
    })
  }
  return buttons
}

/**
 * `undefined` means the phone is not shown this button, and there are two reasons for
 * that, both of them "the phone has no way to do what this does":
 *
 * - A `xterm-local` action never reaches the PTY — it clears the desktop's own
 *   renderer. Drawn on a phone it would appear to do nothing, because the next frame
 *   the computer pushes would paint the cleared lines straight back.
 * - A `terminal-sequence` whose bytes are not one of `MOBILE_KEYS` cannot be sent.
 *   Text is the only other route onto the wire and the terminal service refuses every
 *   control byte except Tab, so there is no fallback encoding to fall back to.
 */
function projectBuiltIn(
  action: TerminalToolbarAction,
  platform: string | undefined,
  keyBySequence: ReadonlyMap<string, MobileKey>,
): MobileToolbarButton | undefined {
  if (action.kind === "xterm-local") return undefined

  const payload = resolveTerminalToolbarPayload(action, platform)
  if (payload === undefined) return undefined

  if (action.kind === "terminal-sequence") {
    const key = keyBySequence.get(payload)
    if (!key) return undefined
    return { id: action.id, label: action.label, group: "key", action: { type: "key", key } }
  }

  // A shell command is the desktop's "run this", which is the intent the mobile
  // protocol already answers with a write followed by a carriage return.
  return {
    id: action.id,
    label: action.label,
    group: "command",
    action: { type: "text", text: payload, pressEnter: true },
  }
}

/**
 * Bytes → key name, over `MOBILE_KEYS` only.
 *
 * Restricting it to the sendable keys is what keeps the projection honest: a byte
 * string that exists in the table but has no name on the phone is not a button the
 * phone can press, and inventing one here would produce a payload the phone renders
 * and then fails to send.
 *
 * The table is injective — no two keys share a sequence — which is what makes this a
 * function rather than a guess; a test pins that down, because a collision would
 * silently pick whichever came last in the list.
 */
function reverseKeyBytes(keyBytes: Readonly<Record<string, string>>): ReadonlyMap<string, MobileKey> {
  const bySequence = new Map<string, MobileKey>()
  for (const key of MOBILE_KEYS) {
    const bytes = keyBytes[key]
    if (bytes === undefined) continue
    bySequence.set(bytes, key)
  }
  return bySequence
}
