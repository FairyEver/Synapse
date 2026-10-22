import { describe, expect, it, vi } from "vitest"
import { WecomCliError } from "../cli-client"
import { createWecomMailCapabilityDispatcher } from "../mail-dispatcher"

function mailService(overrides: Partial<{
  list: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}> = {}) {
  return {
    list: overrides.list ?? vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    get: overrides.get ?? vi.fn(async () => ({ mailId: "mail-1" })),
    send: overrides.send ?? vi.fn(async () => ({ ok: true as const })),
  }
}

describe("WeCom mail capability dispatcher", () => {
  it("routes list, get and confirmed send through the mail service", async () => {
    const mail = mailService()
    const dispatcher = createWecomMailCapabilityDispatcher({ mail: mail as never })

    await expect(dispatcher.dispatch("app.wecom.mail.list", { query: "周报", limit: 20 }, {})).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.wecom.mail.get", { mailId: "mail-1" }, {})).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.wecom.mail.send", {
      to: ["to@example.com"],
      subject: "主题",
      body: "正文",
      confirmed: true,
    }, {})).resolves.toMatchObject({ ok: true })

    expect(mail.list).toHaveBeenCalledWith({ query: "周报", limit: 20 })
    expect(mail.get).toHaveBeenCalledWith({ mailId: "mail-1" })
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ subject: "主题", confirmed: true }))
  })

  it("rejects send without the preview confirmation declaration", async () => {
    const mail = mailService()
    const dispatcher = createWecomMailCapabilityDispatcher({ mail: mail as never })
    await expect(dispatcher.dispatch("app.wecom.mail.send", {
      to: ["to@example.com"],
      subject: "主题",
      body: "正文",
    }, {})).resolves.toMatchObject({ ok: false, code: "WECOM_INVALID_INPUT" })
    expect(mail.send).not.toHaveBeenCalled()
  })

  it("returns a structured enterprise permission failure with the official link", async () => {
    const helpUrl = "https://work.weixin.qq.com/ai/aiHelper/authorizationList?type=7"
    const mail = mailService({
      list: vi.fn(async () => {
        throw new WecomCliError("permission_denied", "当前机器人未被授权「搜索与获取邮件内容」能力。", {
          permission: "搜索与获取邮件内容",
          helpUrl,
        })
      }),
    })
    const dispatcher = createWecomMailCapabilityDispatcher({ mail: mail as never })

    await expect(dispatcher.dispatch("app.wecom.mail.list", {}, { source: "mcp-http" })).resolves.toEqual({
      ok: false,
      code: "WECOM_PERMISSION_REQUIRED",
      error: "当前机器人未被授权「搜索与获取邮件内容」能力。",
      data: {
        permission: "搜索与获取邮件内容",
        helpUrl,
      },
    })
  })

  it("distinguishes connector and authentication failures", async () => {
    const missing = mailService({
      list: vi.fn(async () => { throw new WecomCliError("connector_required", "请先连接企业微信。") }),
    })
    const expired = mailService({
      list: vi.fn(async () => { throw new WecomCliError("auth_required", "授权已失效。") }),
    })

    await expect(createWecomMailCapabilityDispatcher({ mail: missing as never }).dispatch("app.wecom.mail.list", {}, {}))
      .resolves.toMatchObject({ code: "WECOM_CONNECTOR_REQUIRED" })
    await expect(createWecomMailCapabilityDispatcher({ mail: expired as never }).dispatch("app.wecom.mail.list", {}, {}))
      .resolves.toMatchObject({ code: "WECOM_AUTH_REQUIRED" })
  })
})
