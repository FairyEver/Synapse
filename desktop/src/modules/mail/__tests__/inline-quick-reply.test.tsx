/** @vitest-environment jsdom */
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import type { Draft, MailPreview, SendReceipt } from "../../../../app-capabilities/mail/shared/types"
import { detail, flush, mocks, mount } from "./harness"
import { InlineMailQuickReply } from "../inline-quick-reply"

const baseDraft: Draft = {
  id: "md_prepared",
  accountId: "ma_one",
  revision: 1,
  state: "editing",
  sourceMessageId: "em_one",
  mode: "reply",
  to: [{ address: "writer@example.com" }],
  cc: [],
  bcc: [],
  subject: "Re: 测试主题",
  html: "<p></p><blockquote>原文</blockquote>",
  text: "\n\n> 原文",
  assetIds: [],
  inlineImages: [],
  remoteLocator: null,
  localSaved: false,
  syncState: "pending",
  updatedAt: "2026-11-05T00:00:00.000Z",
}

const committedDraft: Draft = { ...baseDraft, id: "md_committed", revision: 2, localSaved: true }
const preview: MailPreview = {
  previewId: "mp_preview",
  expiresAt: "2099-01-01T00:00:00.000Z",
  from: { address: "me@example.com" },
  draft: committedDraft,
  attachments: [],
  messageId: "<reply@example.com>",
}
const receipt: SendReceipt = {
  operationId: "mo_send",
  accountId: "ma_one",
  state: "accepted",
  accepted: ["writer@example.com"],
  rejected: [],
  messageId: "em_reply",
  sentCopyState: "saved",
  retryStage: "none",
  errorCode: null,
}

function installApi() {
  mocks.api.draftPrepare = vi.fn().mockResolvedValue(baseDraft)
  mocks.api.draftCommit = vi.fn().mockImplementation(async ({ content }) => ({ ...committedDraft, ...content }))
  mocks.api.draftUpdate = vi.fn().mockImplementation(async ({ patch }) => ({ ...committedDraft, ...patch, revision: 3 }))
  mocks.api.sendPreview = vi.fn().mockResolvedValue(preview)
  mocks.api.messageSend = vi.fn().mockResolvedValue(receipt)
}

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('input[aria-label="快速回复内容"]')
  if (!element) throw new Error("Input not found")
  return element
}

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)
  if (!element) throw new Error(`Button not found: ${label}`)
  return element
}

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input(), value)
    input().dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function submit(method: "button" | "enter") {
  await act(async () => {
    if (method === "button") button("发送").click()
    else input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
  })
  await flush()
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
  installApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("external mail inline quick reply", () => {
  it.each(["button", "enter"] as const)("uses the compose preview and send pipeline with %s", async (method) => {
    const success = vi.spyOn(toast, "success")
    const onSent = vi.fn()
    mount(<InlineMailQuickReply source={detail} onSent={onSent} />)

    await type("  收到 <b>  ")
    await submit(method)

    expect(mocks.api.draftPrepare).toHaveBeenCalledWith({
      accountId: "ma_one",
      sourceMessageId: "em_one",
      mode: "reply",
      forwardMode: "inline",
    })
    expect(mocks.api.draftCommit).toHaveBeenCalledWith({
      content: expect.objectContaining({
        accountId: "ma_one",
        subject: "Re: 测试主题",
        html: "<p>收到 &lt;b&gt;</p><p></p><blockquote>原文</blockquote>",
        text: "收到 <b>\n\n> 原文",
      }),
      source: { messageId: "em_one", mode: "reply" },
    })
    expect(mocks.api.sendPreview).toHaveBeenCalledWith({ draftId: "md_committed", expectedRevision: 2 })
    expect(mocks.api.messageSend).toHaveBeenCalledWith({
      previewId: "mp_preview",
      clientRequestId: expect.any(String),
      confirmed: true,
    })
    expect(onSent).toHaveBeenCalledWith(receipt)
    expect(success).toHaveBeenCalledWith("已发送")
    expect(input().value).toBe("")
  })

  it("reuses the committed draft and preview request after a non-expiry failure", async () => {
    mocks.api.messageSend
      .mockRejectedValueOnce(new Error("网络失败"))
      .mockResolvedValueOnce(receipt)
    const onSent = vi.fn()
    mount(<InlineMailQuickReply source={detail} onSent={onSent} />)

    await type("收到")
    await submit("button")
    expect(input().value).toBe("收到")
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("网络失败")
    const requestId = mocks.api.messageSend.mock.calls[0][0].clientRequestId

    await submit("button")
    expect(mocks.api.draftPrepare).toHaveBeenCalledTimes(1)
    expect(mocks.api.draftCommit).toHaveBeenCalledTimes(1)
    expect(mocks.api.sendPreview).toHaveBeenCalledTimes(1)
    expect(mocks.api.messageSend).toHaveBeenLastCalledWith({ previewId: "mp_preview", clientRequestId: requestId, confirmed: true })
    expect(onSent).toHaveBeenCalledWith(receipt)
  })

  it("updates the committed draft when the text changes before retrying", async () => {
    mocks.api.sendPreview
      .mockRejectedValueOnce(new Error("网络失败"))
      .mockResolvedValueOnce(preview)
    mount(<InlineMailQuickReply source={detail} onSent={vi.fn()} />)

    await type("第一版")
    await submit("button")
    await type("第二版")
    await submit("button")

    expect(mocks.api.draftUpdate).toHaveBeenCalledWith({
      draftId: "md_committed",
      expectedRevision: 2,
      patch: expect.objectContaining({
        html: "<p>第二版</p><p></p><blockquote>原文</blockquote>",
        text: "第二版\n\n> 原文",
      }),
    })
    expect(mocks.api.sendPreview).toHaveBeenLastCalledWith({ draftId: "md_committed", expectedRevision: 3 })
  })
})
