import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ActionResultView } from "../action-result-view"

describe("ActionResultView", () => {
  it("renders summary, metrics, and logs", () => {
    const html = renderToStaticMarkup(
      <ActionResultView
        result={{
          status: "success",
          summary: "200 OK",
          metrics: { httpStatus: 200, durationMs: 25 },
          logs: [{ label: "response", value: "{\"ok\":true}" }],
        }}
      />,
    )

    expect(html).toContain("200 OK")
    expect(html).toContain("HTTP 200")
    expect(html).toContain("25 ms")
    expect(html).toContain("response")
    expect(html).toContain("{&quot;ok&quot;:true}")
  })
})
