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

  it("renders token usage when present", () => {
    const html = renderToStaticMarkup(
      <ActionResultView
        result={{
          status: "success",
          summary: "done",
          usage: {
            input_tokens: 1234,
            output_tokens: 56,
            cache_read_input_tokens: 7890,
            cache_creation_input_tokens: 12,
          },
          costUsd: 0.01,
        }}
      />,
    )

    expect(html).toContain("输入")
    expect(html).toContain("1,234")
    expect(html).toContain("输出")
    expect(html).toContain("56")
    expect(html).toContain("缓存读")
    expect(html).toContain("7,890")
    expect(html).toContain("缓存写")
    expect(html).toContain("12")
    expect(html).not.toContain("0.01")
  })
})
