import { describe, expect, it, vi } from "vitest"

import type { SynapseAccountLoginResult, SynapseAccountState } from "../../../../src/types/account"
import { createAccountCapabilityDispatcher } from "../dispatcher"
import {
  ACCOUNT_LOGIN_START_CAPABILITY_ID,
  ACCOUNT_STATE_GET_CAPABILITY_ID,
} from "../../shared/capability"

const authenticated: SynapseAccountState = {
  status: "authenticated",
  connectivity: "online",
  profile: {
    user: { id: "user-1", email: "someone@example.com", handle: "someone", status: "active" },
    syncedAt: "2026-09-16T10:00:00.000Z",
  },
}

function createDispatcher(overrides: {
  readonly state?: SynapseAccountState
  readonly login?: SynapseAccountLoginResult
} = {}) {
  const startLogin = vi.fn(async () => overrides.login ?? {
    state: { status: "authenticating", loginUrl: "https://example.com/login" } as SynapseAccountState,
    loginUrl: "https://example.com/login",
    outcome: "opened" as const,
  })
  const service = {
    getState: () => overrides.state ?? ({ status: "unauthenticated" } as SynapseAccountState),
    startLogin,
  }
  return { dispatcher: createAccountCapabilityDispatcher({ service }), startLogin }
}

describe("account capability dispatcher", () => {
  it("returns the account state as the data of a read", async () => {
    const { dispatcher } = createDispatcher({ state: authenticated })
    const result = await dispatcher.dispatch(ACCOUNT_STATE_GET_CAPABILITY_ID, {})
    expect(result).toEqual({ ok: true, data: authenticated })
  })

  it("reports what a login call did, not just the resulting state", async () => {
    const { dispatcher } = createDispatcher()
    const result = await dispatcher.dispatch(ACCOUNT_LOGIN_START_CAPABILITY_ID, {})
    expect(result).toMatchObject({ ok: true, affected: 1 })
    // The URL travels with the result so a caller can hand it over when the browser
    // did not open, and `outcome` is what tells it whether anything was started.
    expect(result.ok && (result.data as SynapseAccountLoginResult).loginUrl)
      .toBe("https://example.com/login")
    expect(result.ok && (result.data as SynapseAccountLoginResult).outcome).toBe("opened")
  })

  it("counts a resumed login as work done and a no-op as nothing done", async () => {
    const resumed = createDispatcher({
      login: { state: authenticated, loginUrl: "https://example.com/login", outcome: "reused_attempt" },
    })
    expect(await resumed.dispatcher.dispatch(ACCOUNT_LOGIN_START_CAPABILITY_ID, {}))
      .toMatchObject({ ok: true, affected: 1 })

    const noop = createDispatcher({
      login: { state: authenticated, outcome: "already_authenticated" },
    })
    expect(await noop.dispatcher.dispatch(ACCOUNT_LOGIN_START_CAPABILITY_ID, {}))
      .toMatchObject({ ok: true })
    expect(await noop.dispatcher.dispatch(ACCOUNT_LOGIN_START_CAPABILITY_ID, {}))
      .not.toHaveProperty("affected")
  })

  it("still succeeds when the page could not be opened, so a caller can pass the URL on", async () => {
    const { dispatcher } = createDispatcher({
      login: {
        state: { status: "error", message: "无法打开浏览器，请检查默认浏览器设置后重试。" },
        loginUrl: "https://example.com/login",
        outcome: "open_failed",
      },
    })
    const result = await dispatcher.dispatch(ACCOUNT_LOGIN_START_CAPABILITY_ID, {})
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && (result.data as SynapseAccountLoginResult).loginUrl)
      .toBe("https://example.com/login")
  })

  it("fails when no attempt was established, since there is nothing to poll", async () => {
    const { dispatcher } = createDispatcher({
      login: {
        state: { status: "error", message: "无法保存登录状态。" },
        loginUrl: "https://example.com/login",
        outcome: "start_failed",
      },
    })
    const result = await dispatcher.dispatch(ACCOUNT_LOGIN_START_CAPABILITY_ID, {})
    expect(result).toMatchObject({ ok: false, code: "login_unavailable" })
  })

  it("refuses an action it does not own", async () => {
    const { dispatcher } = createDispatcher()
    await expect(dispatcher.dispatch("app.account.login.cancel", {})).rejects.toThrow(
      "Unknown account action: app.account.login.cancel",
    )
  })
})
