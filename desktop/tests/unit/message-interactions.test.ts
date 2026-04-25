import { describe, expect, it } from "vitest"
import type { SynapseRichCard, SynapseSessionMessage } from "../../src/types/agent-session"
import {
  collectRichCardInteractions,
  renderRichCardFallback,
  resolveInteractionDispatch,
  richCardHasInteractions,
  toRenderableMessage,
} from "../../src/modules/agent-sessions/message-interactions"

function richCardFixture(): SynapseRichCard {
  return {
    header: { title: "Help", color: "blue" },
    elements: [
      { type: "markdown", content: "Use `/help` to see commands." },
      { type: "divider" },
      {
        type: "actions",
        layout: "row",
        buttons: [
          { text: "Run", type: "primary", value: "cmd:/run" },
          { text: "Cancel", type: "default", value: "cmd:/cancel" },
        ],
      },
      {
        type: "list_item",
        text: "Current session",
        buttonText: "Switch",
        buttonType: "primary",
        buttonValue: "act:/switch 1",
      },
      {
        type: "select",
        placeholder: "Mode",
        initValue: "default",
        options: [
          { text: "Default", value: "default" },
          { text: "YOLO", value: "yolo" },
        ],
      },
      { type: "note", text: "Tip: /new starts a fresh session." },
    ],
  }
}

function message(card: SynapseRichCard): SynapseSessionMessage {
  return {
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    content: "",
    createdAt: "2026-04-25T00:00:00.000Z",
    card,
  }
}

describe("message rich interactions", () => {
  it("renders the same plain-text fallback as the CC Connect card model", () => {
    expect(renderRichCardFallback(richCardFixture())).toBe(
      "**Help**\n\nUse `/help` to see commands.\n\n---\n\n[Run]  [Cancel]\n\nCurrent session  [Switch]\nMode: Default | YOLO\n\nTip: /new starts a fresh session.",
    )
  })

  it("collects button and select intents without executing them in the renderer", () => {
    const interactions = collectRichCardInteractions(richCardFixture())

    expect(richCardHasInteractions(richCardFixture())).toBe(true)
    expect(interactions).toEqual([
      { kind: "button", text: "Run", value: "cmd:/run", buttonType: "primary", row: 0 },
      { kind: "button", text: "Cancel", value: "cmd:/cancel", buttonType: "default", row: 0 },
      { kind: "button", text: "Switch", value: "act:/switch 1", buttonType: "primary", row: 1 },
      {
        kind: "select",
        placeholder: "Mode",
        initValue: "default",
        row: 2,
        options: [
          { text: "Default", value: "default" },
          { text: "YOLO", value: "yolo" },
        ],
      },
    ])
  })

  it("falls back to text when platform capabilities cannot preserve interaction intent", () => {
    const renderable = toRenderableMessage(message(richCardFixture()), {
      card: true,
      buttons: false,
    })

    expect(renderable.canRenderCard).toBe(false)
    expect(renderable.interactions).toEqual([])
    expect(renderable.fallbackText).toContain("[Run]")
  })

  it("maps platform action values into main-process dispatch intents", () => {
    expect(resolveInteractionDispatch("perm:allow")).toEqual({ kind: "message", content: "allow" })
    expect(resolveInteractionDispatch("askq:0:1")).toEqual({ kind: "message", content: "askq:0:1" })
    expect(resolveInteractionDispatch("cmd:/new")).toEqual({ kind: "message", content: "/new" })
    expect(resolveInteractionDispatch("nav:/help session")).toEqual({
      kind: "navigation",
      action: "nav:/help session",
    })
    expect(resolveInteractionDispatch("custom:raw")).toEqual({ kind: "unsupported", action: "custom:raw" })
  })
})
