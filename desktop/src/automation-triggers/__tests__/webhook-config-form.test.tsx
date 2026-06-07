// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WebhookTriggerConfigForm } from "../../../automation-trigger-packages/builtin/webhook/config.renderer"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("WebhookTriggerConfigForm", () => {
  const originalSynapse = window.synapse

  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
    window.synapse = originalSynapse
  })

  it("keeps the saved webhook visible when webhook list loading fails", async () => {
    window.synapse = {
      account: {
        listWebhooks: vi.fn().mockRejectedValue(new Error("账号未登录。")),
      },
    } as unknown as typeof window.synapse

    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(
        <WebhookTriggerConfigForm
          value={{ webhookPublicId: "wh_saved", webhookName: "GitHub Push" }}
          onChange={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("GitHub Push")
    expect(document.body.textContent).toContain("列表加载失败")
    expect(document.body.textContent).toContain("重试")
  })
})
