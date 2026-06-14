/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { ActionResultView } from "../action-result-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

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
    expect(html).not.toContain("费用")
    expect(html).not.toContain("¥0.072")
    expect(html).not.toContain("$0.01")
  })

  it("redacts sensitive action result text while preserving regular paths", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <ActionResultView
          result={{
            status: "failed",
            summary: "Authorization: Bearer abc123 at /Users/example/repo",
            error: "token=sk-secret-value at /Users/example/repo",
            logs: [{ label: "stdout", value: "Cookie: session=session-secret" }],
          }}
        />,
      )
    })

    const text = document.body.textContent ?? ""
    expect(text).not.toContain("abc123")
    expect(text).not.toContain("sk-secret-value")
    expect(text).not.toContain("session-secret")
    expect(text).toContain("[redacted]")
    expect(text).toContain("/Users/example/repo")
  })
})
