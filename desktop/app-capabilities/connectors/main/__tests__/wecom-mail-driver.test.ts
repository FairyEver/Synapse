import { describe, expect, it, vi } from "vitest"
import type { WecomMailStateV1 } from "../../../../electron/runtime/data-repo/schemas/connectors"
import type { SynapseAccountState } from "../../../../src/types/account"
import { wecomMailConnector } from "../definitions"
import { WecomCliError, type WecomCliAuthSession, type WecomCliClient } from "../wecom-cli-client"
import { createWecomMailDriver } from "../wecom-mail-driver"

function authenticated(id: string): SynapseAccountState {
  return {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: { id, email: `${id}@example.test`, handle: id, status: "active" },
      syncedAt: "2026-10-22T00:00:00Z",
    },
  }
}

function fakeState(initial?: WecomMailStateV1) {
  let state = initial ?? null
  return {
    getSingleton: vi.fn(async () => state),
    setSingleton: vi.fn(async (next: WecomMailStateV1) => { state = next }),
    value: () => state,
  }
}

function harness() {
  let accountState = authenticated("owner-a")
  const state = fakeState()
  let resolveAuth!: () => void
  const wait = new Promise<void>((resolve) => { resolveAuth = resolve })
  const authSession: WecomCliAuthSession = {
    qrCodeDataUrl: "data:image/png;base64,cXItY29kZQ==",
    wait: vi.fn(() => wait),
    cancel: vi.fn(async () => undefined),
  }
  const client: WecomCliClient = {
    startAuth: vi.fn(async () => authSession),
    validate: vi.fn(async () => ({ address: "owner@example.com", displayName: "Owner" })),
    disconnect: vi.fn(async () => undefined),
    search: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    get: vi.fn(async () => ({
      mailId: "mail-1",
      subject: "主题",
      sendTime: "2026-10-22T08:00:00Z",
      sender: { name: "发件人", email: "sender@example.com" },
      receivers: [],
      isRead: false,
      content: "正文",
      to: [],
      cc: [],
      bcc: [],
      attachments: [],
    })),
    send: vi.fn(async () => ({ ok: true as const })),
  }
  const driver = createWecomMailDriver({
    state: state as never,
    account: {
      getState: () => accountState,
      onBeforeIdentityChange: () => () => undefined,
      onStateChanged: () => () => undefined,
    },
    client,
    now: () => Date.parse("2026-10-22T09:00:00Z"),
  })

  return {
    driver,
    client,
    state,
    resolveAuth,
    switchAccount: () => { accountState = authenticated("owner-b") },
  }
}

describe("WeCom mail connector", () => {
  it("starts a scan session, persists only local binding metadata, and exposes mail operations", async () => {
    const h = harness()
    await h.driver.lifecycle!.initialize(() => undefined)

    const connecting = await h.driver.lifecycle!.connect(wecomMailConnector)
    expect(connecting).toMatchObject({
      kind: "wecom-mail",
      connectionStatus: "connecting",
      enabled: true,
      qrCodeDataUrl: "data:image/png;base64,cXItY29kZQ==",
    })

    h.resolveAuth()
    await vi.waitFor(async () => {
      expect(await h.driver.lifecycle!.item(wecomMailConnector)).toMatchObject({
        connectionStatus: "connected",
        mailbox: { address: "owner@example.com", displayName: "Owner" },
      })
    })

    expect(Object.values(h.state.value()?.bindings ?? {})).toEqual([
      expect.objectContaining({
        ownerUserId: "owner-a",
        connectorId: "wecom-mail",
        address: "owner@example.com",
        displayName: "Owner",
      }),
    ])
    expect(JSON.stringify(h.state.value())).not.toContain("credentials")

    await expect(h.driver.mail!.search(wecomMailConnector, { query: "周报" })).resolves.toEqual({ items: [], nextCursor: null, hasMore: false })
    await expect(h.driver.mail!.get(wecomMailConnector, { mailId: "mail-1" })).resolves.toMatchObject({ content: "正文" })
    await expect(h.driver.mail!.send(wecomMailConnector, {
      to: ["to@example.com"],
      subject: "主题",
      body: "正文",
    })).resolves.toEqual({ ok: true })
    expect(h.client.search).toHaveBeenCalledWith("owner-a", { query: "周报" })
    expect(h.client.send).toHaveBeenCalledWith("owner-a", expect.objectContaining({ subject: "主题" }))
  })

  it("makes an expired authorization reconnectable without deleting the local binding metadata", async () => {
    const h = harness()
    h.client.startAuth = vi.fn(async () => ({
      qrCodeDataUrl: "data:image/png;base64,cXItY29kZQ==",
      wait: vi.fn(async () => { throw new WecomCliError("auth_required", "请重新连接。") }),
      cancel: vi.fn(async () => undefined),
    }))
    await h.driver.lifecycle!.initialize(() => undefined)
    await h.driver.lifecycle!.connect(wecomMailConnector)
    await vi.waitFor(async () => {
      expect(await h.driver.lifecycle!.item(wecomMailConnector)).toMatchObject({
        connectionStatus: "reconnect_required",
        canRetry: true,
        errorMessage: "请重新连接。",
      })
    })
    await expect(h.driver.mail!.search(wecomMailConnector, {})).rejects.toThrow("请先连接企业微信邮箱")
  })

  it("disconnects through the local-only client and removes mailbox metadata", async () => {
    const h = harness()
    await h.driver.lifecycle!.initialize(() => undefined)
    await h.driver.lifecycle!.connect(wecomMailConnector)
    h.resolveAuth()
    await vi.waitFor(async () => {
      expect(await h.driver.lifecycle!.item(wecomMailConnector)).toMatchObject({ connectionStatus: "connected" })
    })
    await h.driver.lifecycle!.disconnect(wecomMailConnector)
    expect(h.client.disconnect).toHaveBeenCalledWith("owner-a")
    expect(h.state.value()?.bindings).toEqual({})
    expect(await h.driver.lifecycle!.item(wecomMailConnector)).toMatchObject({ connectionStatus: "disconnected" })
  })
})
