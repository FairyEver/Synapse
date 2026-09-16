// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DashboardWebhookDto } from "@synapse/shared"

import { WebhookTriggerConfigForm } from "../../../automation-trigger-packages/builtin/webhook/config.renderer"
import type { SynapseAccountState, SynapseAccountStateChangedEvent } from "../../types/account"
import type { SynapseBridge } from "../../types/bridge"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const authenticatedState: SynapseAccountState = {
  status: "authenticated",
  connectivity: "online",
  profile: {
    user: { id: "user-1", email: "user@example.com", handle: "user-1", status: "active" },
    syncedAt: "2026-06-07T10:00:00.000Z",
  },
}

const webhook: DashboardWebhookDto = {
  id: "webhook-1",
  publicId: "wh_public",
  name: "Deploy",
  enabled: true,
  url: null,
  maskedUrl: "https://synapse.test/webhooks/wh_public/***",
  createdAt: "2026-06-07T10:00:00.000Z",
  updatedAt: "2026-06-07T10:00:00.000Z",
}

type AccountBridgeMock = {
  state: {
    get: ReturnType<typeof vi.fn>
    onChanged: ReturnType<typeof vi.fn>
  }
  login: { start: ReturnType<typeof vi.fn> }
  cancelLogin: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
  listWebhooks: ReturnType<typeof vi.fn>
}

/** Overrides mirror the bridge's own shape so a call site reads like the call it stands for. */
type AccountBridgeOverrides = {
  readonly state?: Partial<AccountBridgeMock["state"]>
  readonly listWebhooks?: ReturnType<typeof vi.fn>
}

describe("WebhookTriggerConfigForm", () => {
  let root: Root | null = null

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = null
    document.body.innerHTML = ""
    delete (window as unknown as { synapse?: Partial<SynapseBridge> }).synapse
    vi.clearAllMocks()
  })

  it("keeps the saved webhook visible when webhook list loading fails", async () => {
    installAccountBridge({
      state: { get: vi.fn().mockResolvedValue(authenticatedState) },
      listWebhooks: vi.fn().mockRejectedValue(new Error("账号未登录。")),
    })

    await renderForm({
      webhookPublicId: "wh_saved",
      webhookName: "GitHub Push",
    })
    await waitForText("GitHub Push")

    expect(document.body.textContent).toContain("列表加载失败")
    expect(document.body.textContent).toContain("重试")
  })

  it("shows the logged-out state instead of a load error", async () => {
    const account = installAccountBridge({
      state: { get: vi.fn().mockResolvedValue({ status: "unauthenticated" } satisfies SynapseAccountState) },
      listWebhooks: vi.fn().mockRejectedValue(new Error("账号未登录")),
    })

    await renderForm()
    await waitForText("登录后可选择 Webhook")

    expect(document.body.textContent).not.toContain("加载失败")
    expect(account.listWebhooks).not.toHaveBeenCalled()
  })

  it("reloads webhooks after the account becomes authenticated", async () => {
    let accountListener: ((event: { readonly state: SynapseAccountState }) => void) | undefined
    const account = installAccountBridge({
      state: {
        get: vi.fn()
          .mockResolvedValueOnce({ status: "unauthenticated" } satisfies SynapseAccountState)
          .mockResolvedValue(authenticatedState),
        onChanged: vi.fn((listener) => {
          accountListener = listener as (event: SynapseAccountStateChangedEvent) => void
          return vi.fn()
        }),
      },
      listWebhooks: vi.fn().mockResolvedValue([webhook]),
    })

    await renderForm()
    await waitForText("登录后可选择 Webhook")

    await act(async () => {
      accountListener?.({ state: authenticatedState })
    })
    await waitForCondition(() => account.listWebhooks.mock.calls.length === 1)

    expect(document.body.textContent).toContain("选择 Webhook")
  })

  it("warns when the selected webhook is disabled", async () => {
    installAccountBridge({
      state: { get: vi.fn().mockResolvedValue(authenticatedState) },
      listWebhooks: vi.fn().mockResolvedValue([
        { ...webhook, enabled: false },
      ]),
    })

    await renderForm({
      webhookPublicId: webhook.publicId,
      webhookName: webhook.name,
    })
    await waitForText("Webhook 已停用")
  })

  async function renderForm(
    value: { readonly webhookPublicId: string; readonly webhookName?: string } = {
      webhookPublicId: "",
    },
  ): Promise<void> {
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    root = createRoot(rootElement)
    await act(async () => {
      root?.render(<WebhookTriggerConfigForm value={value} onChange={vi.fn()} />)
    })
  }
})

function installAccountBridge(overrides: AccountBridgeOverrides = {}) {
  const account = {
    state: {
      get: vi.fn().mockResolvedValue({ status: "unauthenticated" } satisfies SynapseAccountState),
      onChanged: vi.fn(() => () => undefined),
      ...overrides.state,
    },
    login: { start: vi.fn() },
    cancelLogin: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    listWebhooks: overrides.listWebhooks ?? vi.fn().mockResolvedValue([]),
  } satisfies AccountBridgeMock
  ;(window as unknown as { synapse?: Partial<SynapseBridge> }).synapse = {
    account: account as unknown as SynapseBridge["account"],
  }
  return account
}

async function waitForText(text: string): Promise<void> {
  await waitForCondition(() => document.body.textContent?.includes(text) ?? false)
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await act(async () => {
      await Promise.resolve()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    if (condition()) {
      return
    }
  }
  throw new Error("Timed out waiting for condition")
}
