import { describe, expect, it } from "vitest"

import { MOBILE_KEYS } from "@synapse/shared"

import { terminalSemanticKeySchema } from "../../shared/contract-schema"
import { KEY_BYTES } from "../service"

/**
 * The terminal's key byte table, written out a second time by hand.
 *
 * `service.ts`'s table is the thing that runs. Every entry in it is an escape sequence
 * somebody typed — `PageUp` is `\x1b[5~`, `Delete` is `\x1b[3~`, `Backspace` is `\x7f` —
 * and nothing else in the codebase would notice one of them being wrong, because a
 * wrong sequence still sends *something*. The tests below are that second opinion.
 *
 * The table has two callers shaped the same way: the desktop's own key sends, and the
 * `keys` intent a phone's key press arrives as, where `KEY_BYTES[action.key]` is what
 * actually reaches the PTY. So the phone's vocabulary and this table's keys have to be
 * the same set, which is what the vocabulary check pins down.
 */

const EXPECTED_KEY_BYTES: Readonly<Record<string, string>> = {
  Enter: "\r",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Backspace: "\x7f",
  "Ctrl+C": "\x03",
  "Ctrl+D": "\x04",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~",
  "Ctrl+A": "\x01",
  "Ctrl+E": "\x05",
  "Ctrl+U": "\x15",
  "Ctrl+K": "\x0b",
  "Ctrl+W": "\x17",
  "Ctrl+L": "\x0c",
  "Ctrl+R": "\x12",
  "Ctrl+Z": "\x1a",
  "Ctrl+B": "\x02",
  "Ctrl+F": "\x06",
  "Ctrl+G": "\x07",
  "Ctrl+H": "\x08",
  "Ctrl+J": "\x0a",
  "Ctrl+N": "\x0e",
  "Ctrl+O": "\x0f",
  "Ctrl+P": "\x10",
  "Ctrl+Q": "\x11",
  "Ctrl+S": "\x13",
  "Ctrl+T": "\x14",
  "Ctrl+V": "\x16",
  "Ctrl+X": "\x18",
  "Ctrl+Y": "\x19",
  "Shift+Tab": "\x1b[Z",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
  Insert: "\x1b[2~",
}

describe("the terminal's key byte table", () => {
  it("means by each key name exactly the bytes the design says", () => {
    // The whole mobile key path rests on these being right, and they are the part no
    // type checker and no other test can help with.
    expect(KEY_BYTES).toEqual(EXPECTED_KEY_BYTES)
    // The table and the wire's vocabulary describe the same set: a name in one and not
    // the other is a key that validates on the cloud and throws on the computer.
    expect(new Set(Object.keys(KEY_BYTES))).toEqual(new Set(MOBILE_KEYS))
    expect(Object.keys(KEY_BYTES)).toHaveLength(MOBILE_KEYS.length)
    // Two keys sharing a sequence would silently send one of them for the other, and
    // nothing downstream could tell.
    expect(new Set(Object.values(KEY_BYTES)).size).toBe(MOBILE_KEYS.length)
  })

  it("accepts exactly the key names the wire's vocabulary allows", () => {
    // Four lists describe these keys — the two mobile-live modules, this schema, and
    // the byte table — and the phone is only audible if all four agree. This is the
    // one comparison that would fail loudly rather than as a rejected keystroke.
    expect([...terminalSemanticKeySchema.options]).toEqual([...MOBILE_KEYS])
  })

  it("means the two control bytes a hand-written table swaps", () => {
    // The full-keyboard page's worst pair. `Ctrl+H` is a backspace *character* and
    // `Ctrl+J` is a line feed, while `\x7f` and `\x0d` — which look like the obvious
    // answers — are the bytes `Backspace` and `Enter` already send. Getting this
    // wrong sends a different key than the user pressed, and nothing reports it.
    expect(KEY_BYTES["Ctrl+H"]).toBe("\x08")
    expect(KEY_BYTES["Ctrl+J"]).toBe("\x0a")
    expect(KEY_BYTES["Ctrl+H"]).not.toBe(KEY_BYTES.Backspace)
    expect(KEY_BYTES["Ctrl+J"]).not.toBe(KEY_BYTES.Enter)
    // And the other two of the four: a swapped pair here is Ctrl+Q's byte for
    // Ctrl+S, and `\x1b[I` for the back-tab.
    expect(KEY_BYTES["Ctrl+S"]).toBe("\x13")
    expect(KEY_BYTES["Ctrl+Q"]).toBe("\x11")
    expect(KEY_BYTES["Shift+Tab"]).toBe("\x1b[Z")
  })

  it("keeps the newly added keys distinct from the ones they could be confused with", () => {
    // The three pairs a hand-written table gets wrong: backspace is not delete,
    // End is not PageDown, and the desktop's local Clear is not Ctrl+L.
    expect(KEY_BYTES.Backspace).toBe("\x7f")
    expect(KEY_BYTES.Delete).toBe("\x1b[3~")
    expect(KEY_BYTES.End).toBe("\x1b[F")
    expect(KEY_BYTES.PageDown).toBe("\x1b[6~")
    expect(KEY_BYTES.PageUp).toBe("\x1b[5~")
    expect(KEY_BYTES["Ctrl+L"]).toBe("\x0c")
    // `Clear` writes nothing to the PTY, so it must not be reachable as a key.
    expect(MOBILE_KEYS).not.toContain("Clear")
  })
})
