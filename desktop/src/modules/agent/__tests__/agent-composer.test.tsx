import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentComposer } from "../components/agent-composer"

describe("AgentComposer", () => {
  it("renders a ChatGPT-style input with an icon-only send button", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft="你好"
        disabled={false}
        canSend={true}
        sending={false}
        cancelPhase="idle"
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain("agent-composer")
    expect(html).toContain("agent-composer__container")
    expect(html).toContain("agent-composer__input")
    expect(html).toContain("agent-composer__send")
    expect(html).toContain('aria-label="发送"')
    expect(html).toContain('placeholder="输入消息"')
    expect(html).toContain("你好")
    expect(html).not.toContain(">发送</button>")
  })

  it("disables send button when canSend is false", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain("disabled")
  })
})
