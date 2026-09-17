import { describe, expect, it } from "vitest"

import { MOBILE_FRAME_LIMITS, MOBILE_KEYS } from "@synapse/shared"

import { terminalSemanticKeySchema } from "../../shared/contract-schema"
import { buildTerminalCommandWrites } from "../../shared/terminal-input"
import type { TerminalCustomToolbarAction } from "../../shared/schema"
import type { TerminalToolbarAction } from "../../shared/toolbar-actions"
import { TERMINAL_TOOLBAR_ACTIONS, resolveTerminalToolbarPayload } from "../../shared/toolbar-actions"
import { projectMobileToolbarButtons } from "../mobile-toolbar"
// The real table, so the equivalence checks below compare the two ends and not the
// test against itself — see the byte-by-byte spec that pins its values.
import { KEY_BYTES as DESKTOP_KEY_BYTES } from "../service"

/**
 * What each key name has to mean, written out by hand.
 *
 * Deliberately a second copy. The table in `service.ts` is the thing that runs, and
 * every entry in it is an escape sequence somebody typed — `PageUp` is `\x1b[5~`,
 * `Delete` is `\x1b[3~`, `Backspace` is `\x7f`. Nothing else in the codebase would
 * notice one of them being wrong, because a wrong sequence still sends *something*.
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
}

const BUILT_IN = TERMINAL_TOOLBAR_ACTIONS

function custom(overrides: Partial<TerminalCustomToolbarAction> = {}): TerminalCustomToolbarAction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    label: "部署",
    content: "pnpm deploy",
    pressEnter: true,
    createdAt: "2026-09-17T10:00:00.000Z",
    updatedAt: "2026-09-17T10:00:00.000Z",
    actionRevision: 1,
    ...overrides,
  }
}

function project(input: {
  readonly custom?: readonly TerminalCustomToolbarAction[]
  readonly platform?: string
} = {}) {
  return projectMobileToolbarButtons({
    custom: input.custom ?? [],
    platform: input.platform ?? "darwin",
    keyBytes: DESKTOP_KEY_BYTES,
  })
}

/**
 * What the desktop writes into the PTY when one of its own toolbar buttons is
 * clicked, taken from `runToolbarAction` in the renderer.
 */
function desktopWritesFor(action: TerminalToolbarAction, platform: string): readonly string[] | null {
  if (action.kind === "xterm-local") return null
  const payload = resolveTerminalToolbarPayload(action, platform)
  if (payload === undefined) return null
  return action.kind === "shell-command" ? buildTerminalCommandWrites(payload) : [payload]
}

/** What the desktop writes when one of the user's own buttons is clicked. */
function desktopWritesForCustom(action: TerminalCustomToolbarAction): readonly string[] {
  return action.pressEnter ? [action.content, "\r"] : [action.content]
}

/**
 * What the desktop writes when the phone's intent for this button arrives.
 *
 * `command` writes the text, waits for it to flush, then writes a carriage return;
 * `keys` with a `key` action writes the table's bytes; `keys` with a `text` action
 * writes the text and nothing else.
 */
function mobileWritesFor(button: ReturnType<typeof project>[number]): readonly string[] {
  if (button.action.type === "key") return [DESKTOP_KEY_BYTES[button.action.key] ?? "<missing>"]
  return button.action.pressEnter ? [button.action.text, "\r"] : [button.action.text]
}

describe("mobile toolbar projection", () => {
  /*
   * This is the only guard the feature has. The phone and the computer each hold
   * their own encoding of these buttons, and nothing at runtime compares them: a
   * projection that drifted would look entirely healthy on both ends and simply do
   * the wrong thing, on a terminal, where the wrong thing is often destructive.
   *
   * So every button is checked the only way that means anything — by writing out
   * what each end puts into the PTY and comparing the bytes.
   */
  it("sends exactly what the desktop's own click sends, for every button", () => {
    const platform = "darwin"
    const customActions = [
      custom(),
      custom({ id: "c2", label: "查端口", content: "lsof -i :3001", pressEnter: false }),
    ]
    const buttons = project({ platform, custom: customActions })
    const byId = new Map(buttons.map((button) => [button.id, button]))

    for (const action of BUILT_IN) {
      const expected = desktopWritesFor(action, platform)
      const button = byId.get(action.id)
      if (expected === null) {
        // `Clear` is the one built-in the phone does not get: it clears the desktop's
        // own renderer and never reaches the PTY, so there is nothing to be equal to.
        expect(button, `${action.id} must not be projected`).toBeUndefined()
        continue
      }
      if (!button) throw new Error(`Missing projection for ${action.id}`)
      expect({ id: action.id, bytes: mobileWritesFor(button) })
        .toEqual({ id: action.id, bytes: expected })
    }

    for (const action of customActions) {
      const button = byId.get(action.id)
      if (!button) throw new Error(`Missing projection for ${action.id}`)
      expect({ id: action.id, bytes: mobileWritesFor(button) })
        .toEqual({ id: action.id, bytes: desktopWritesForCustom(action) })
    }
  })

  it("projects the built-ins in the desktop's own order, with the user's after them", () => {
    const buttons = project({ custom: [custom({ id: "c1" }), custom({ id: "c2" })] })
    expect(buttons.map((button) => button.id)).toEqual([
      "enter", "interrupt", "slash-exit", "slash-clear", "c1", "c2",
    ])
  })

  it("groups the buttons so the phone can draw the desktop's separators", () => {
    // The desktop's rule is positional — its separator sits before the first shell
    // command — which a phone cannot reproduce without re-deriving the list. The
    // group is the answer sent instead of the rule.
    const buttons = project({ custom: [custom({ id: "c1" })] })
    expect(buttons.map((button) => `${button.id}:${button.group}`)).toEqual([
      "enter:key", "interrupt:key", "slash-exit:command", "slash-clear:command", "c1:custom",
    ])
  })

  it("leaves Clear on the desktop's toolbar while keeping it off the phone", () => {
    // Deleting it from the registry would be the wrong fix: on a computer it is a
    // working button. It is dropped from the projection instead.
    expect(BUILT_IN.some((action) => action.id === "clear")).toBe(true)
    expect(project().some((button) => button.id === "clear")).toBe(false)
  })

  it("maps each built-in onto the key whose bytes it writes", () => {
    const buttons = project()
    expect(buttons.find((button) => button.id === "enter")?.action).toEqual({ type: "key", key: "Enter" })
    expect(buttons.find((button) => button.id === "interrupt")?.action).toEqual({ type: "key", key: "Ctrl+C" })
    // A shell command is "run this", which is a write followed by Enter — not a key.
    expect(buttons.find((button) => button.id === "slash-exit")?.action).toEqual({
      type: "text", text: "/exit", pressEnter: true,
    })
  })

  it("passes a custom command through untouched", () => {
    // Not trimmed, not quoted, not escaped. The phone must run the command the user
    // wrote — anything done here is a way for the two ends to disagree.
    const content = "  echo \"a  b\"  |  grep a  "
    const [button] = project({ custom: [custom({ content, pressEnter: false })] })
      .filter((entry) => entry.group === "custom")
    expect(button?.action).toEqual({ type: "text", text: content, pressEnter: false })
    expect(button?.label).toBe("部署")
  })

  it("keeps a button that only types distinct from one that runs", () => {
    // The flag is the whole difference between the two text arms, and getting it
    // wrong means pressing a key on the user's behalf.
    const typed = project({ custom: [custom({ id: "c1", pressEnter: false, content: "lsof -i :3001" })] })
    const run = project({ custom: [custom({ id: "c1", pressEnter: true, content: "lsof -i :3001" })] })
    expect(typed.filter((b) => b.group === "custom")[0]?.action).toEqual(
      { type: "text", text: "lsof -i :3001", pressEnter: false },
    )
    expect(run.filter((b) => b.group === "custom")[0]?.action).toEqual(
      { type: "text", text: "lsof -i :3001", pressEnter: true },
    )
  })

  it("drops a built-in whose bytes have no key on the phone", () => {
    // There is no fallback encoding: the terminal service refuses every control byte
    // except Tab, so a sequence the phone cannot name is a button it cannot press.
    const buttons = projectMobileToolbarButtons({
      custom: [],
      platform: "darwin",
      keyBytes: { ...DESKTOP_KEY_BYTES, F5: "\x1b[15~" },
    })
    expect(buttons.some((button) => button.id === "enter")).toBe(true)
    // The table's own extra entry is not a key name the phone has, so nothing in the
    // projection may name it.
    expect(JSON.stringify(buttons)).not.toContain("F5")
  })

  it("produces a payload the wire's own validator accepts", () => {
    const buttons = project({ custom: [custom({ label: "部署" })] })
    for (const button of buttons) {
      expect(button.id.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxToolbarButtonIdLength)
      expect(button.label.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxToolbarLabelLength)
      if (button.action.type === "text") {
        expect(button.action.text.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxToolbarTextLength)
        expect(button.action.text.length).toBeGreaterThan(0)
      } else {
        expect(MOBILE_KEYS).toContain(button.action.key)
      }
    }
  })

  it("means by each key name exactly the bytes the design says", () => {
    // The whole feature rests on these being right, and they are the part no type
    // checker and no other test can help with.
    expect(DESKTOP_KEY_BYTES).toEqual(EXPECTED_KEY_BYTES)
    // The table and the wire's vocabulary describe the same set: a name in one and
    // not the other is a key that validates on the cloud and throws on the computer.
    expect(new Set(Object.keys(DESKTOP_KEY_BYTES))).toEqual(new Set(MOBILE_KEYS))
    expect(Object.keys(DESKTOP_KEY_BYTES)).toHaveLength(MOBILE_KEYS.length)
    // The projection is a reverse lookup over these bytes, so two keys sharing a
    // sequence would silently resolve to whichever the list happened to name last.
    expect(new Set(Object.values(DESKTOP_KEY_BYTES)).size).toBe(MOBILE_KEYS.length)
  })

  it("accepts exactly the key names the wire's vocabulary allows", () => {
    // Four lists describe these keys — the two mobile-live modules, this schema, and
    // the byte table — and the phone is only audible if all four agree. This is the
    // one comparison that would fail loudly rather than as a rejected keystroke.
    expect([...terminalSemanticKeySchema.options]).toEqual([...MOBILE_KEYS])
  })

  it("keeps the newly added keys distinct from the ones they could be confused with", () => {
    // The three pairs a hand-written table gets wrong: backspace is not delete,
    // End is not PageDown, and the desktop's local Clear is not Ctrl+L.
    expect(DESKTOP_KEY_BYTES.Backspace).toBe("\x7f")
    expect(DESKTOP_KEY_BYTES.Delete).toBe("\x1b[3~")
    expect(DESKTOP_KEY_BYTES.End).toBe("\x1b[F")
    expect(DESKTOP_KEY_BYTES.PageDown).toBe("\x1b[6~")
    expect(DESKTOP_KEY_BYTES.PageUp).toBe("\x1b[5~")
    expect(DESKTOP_KEY_BYTES["Ctrl+L"]).toBe("\x0c")
    // `Clear` writes nothing to the PTY, so it must not be reachable as a key.
    expect(MOBILE_KEYS).not.toContain("Clear")
  })
})
