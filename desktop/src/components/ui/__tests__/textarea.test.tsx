/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Textarea } from "@/components/ui/textarea"

describe("Textarea", () => {
  it("uses three rows by default", () => {
    const html = renderToStaticMarkup(<Textarea aria-label="备注" />)

    expect(html).toContain('rows="3"')
    expect(html).not.toContain("min-h-28")
  })

  it("preserves an explicit row count", () => {
    const html = renderToStaticMarkup(<Textarea aria-label="正文" rows={5} />)

    expect(html).toContain('rows="5"')
  })
})
