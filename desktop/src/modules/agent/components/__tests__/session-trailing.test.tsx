import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SessionTrailing } from "../session-trailing"

describe("SessionTrailing", () => {
  it("omits malformed Agent session timestamps instead of rendering NaN", () => {
    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="not-a-date"
        unread={0}
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).not.toContain("NaN")
  })
})
