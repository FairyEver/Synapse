import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentComposer } from "../index"

describe("AgentComposer", () => {
  it("renders a tokenized input bar with an icon-only send button", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft="你好"
        disabled={false}
        canSend={true}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(html).toContain("gap-2 rounded-md border border-border bg-background")
    expect(html).toContain("border-0")
    expect(html).toContain("bg-transparent")
    expect(html).toContain("focus-visible:ring-0")
    expect(html).toContain("aria-label=\"发送\"")
    expect(html).toContain("data-size=\"icon\"")
    expect(html).toContain("lucide-arrow-up")
    expect(html).not.toContain("gap-2 rounded-full bg-muted/50")
    expect(html).not.toContain(">发送</button>")
  })
})
