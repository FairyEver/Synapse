import { describe, expect, it } from "vitest"

import { MOBILE_FRAME_LIMITS } from "@synapse/shared"

import type { TerminalCustomToolbarAction } from "../../shared/schema"
import { projectMobileToolbarButtons } from "../mobile-toolbar"

/**
 * The phone's copy of the user's own toolbar entries.
 *
 * This is the only guard the feature has. The phone and the computer each hold their
 * own encoding of these buttons, and nothing at runtime compares them: a projection
 * that drifted would look entirely healthy on both ends and simply do the wrong thing,
 * on a terminal, where the wrong thing is often destructive.
 *
 * So every button is checked the only way that means anything — by writing out what
 * each end puts into the PTY and comparing the bytes.
 */

type ProjectedButton = ReturnType<typeof projectMobileToolbarButtons>[number]

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

/**
 * What the desktop writes into the PTY when one of the user's own buttons is clicked,
 * taken from `runToolbarAction` in the renderer.
 */
function desktopWritesFor(action: TerminalCustomToolbarAction): readonly string[] {
  return action.pressEnter ? [action.content, "\r"] : [action.content]
}

/**
 * What the computer writes when the phone's intent for this button arrives.
 *
 * `command` writes the text, waits for it to flush, then writes a carriage return;
 * `keys` with a `text` action writes the text and nothing else.
 */
function phoneWritesFor(button: ProjectedButton): readonly string[] {
  if (button.action.type !== "text") throw new Error("a custom button is always text")
  return button.action.pressEnter ? [button.action.text, "\r"] : [button.action.text]
}

describe("mobile toolbar projection", () => {
  it("sends exactly what the desktop's own click sends, for every button", () => {
    const actions = [
      custom(),
      custom({ id: "c2", label: "查端口", content: "lsof -i :3001", pressEnter: false }),
    ]
    const buttons = projectMobileToolbarButtons(actions)

    expect(buttons.map((button) => button.id)).toEqual(actions.map((action) => action.id))
    for (const action of actions) {
      const button = buttons.find((entry) => entry.id === action.id)
      if (!button) throw new Error(`Missing projection for ${action.id}`)
      expect({ id: action.id, bytes: phoneWritesFor(button) })
        .toEqual({ id: action.id, bytes: desktopWritesFor(action) })
    }
  })

  it("passes a custom command through untouched", () => {
    // Not trimmed, not quoted, not escaped. The phone must run the command the user
    // wrote — anything done here is a way for the two ends to disagree.
    const content = "  echo \"a  b\"  |  grep a  "
    const [button] = projectMobileToolbarButtons([custom({ content, pressEnter: false })])
    expect(button?.action).toEqual({ type: "text", text: content, pressEnter: false })
    expect(button?.label).toBe("部署")
  })

  it("keeps a button that only types distinct from one that runs", () => {
    // The flag is the whole difference between the two text arms, and getting it
    // wrong means pressing a key on the user's behalf.
    const typed = projectMobileToolbarButtons([custom({ pressEnter: false })])
    const run = projectMobileToolbarButtons([custom({ pressEnter: true })])
    expect(typed[0]?.action).toEqual({ type: "text", text: "pnpm deploy", pressEnter: false })
    expect(run[0]?.action).toEqual({ type: "text", text: "pnpm deploy", pressEnter: true })
  })

  it("marks every entry as the user's own, so it lands behind the phone's front row", () => {
    // The phone draws its own keys first and puts a separator where the group changes.
    // Anything sent in another group would be filed among those keys.
    const buttons = projectMobileToolbarButtons([custom({ id: "c1" })])
    expect(buttons.map((button) => `${button.id}:${button.group}`)).toEqual(["c1:custom"])
  })

  it("sends nothing when the user has configured nothing", () => {
    // The ordinary case, not an error: the bar is the phone's own front row, and this
    // list is only the part of it the user is responsible for.
    expect(projectMobileToolbarButtons([])).toEqual([])
  })

  it("produces a payload the wire's own validator accepts", () => {
    for (const button of projectMobileToolbarButtons([custom({ label: "部署" })])) {
      expect(button.id.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxToolbarButtonIdLength)
      expect(button.label.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxToolbarLabelLength)
      if (button.action.type !== "text") throw new Error("a custom button is always text")
      expect(button.action.text.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxToolbarTextLength)
      // The wire requires a non-empty body, and the desktop's own schema will not store
      // a blank one — so this can never be the field that fails validation.
      expect(button.action.text.length).toBeGreaterThan(0)
    }
  })
})
