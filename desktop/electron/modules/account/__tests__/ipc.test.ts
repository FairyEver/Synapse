import { describe, expect, it } from "vitest"
import { vi } from "vitest"
import os from "node:os"
import path from "node:path"

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-account-${name}`),
    getAppPath: () => path.join(os.tmpdir(), "synapse-account-app"),
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher: Buffer) => cipher.toString("utf8"),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}))

import { accountIpcModule } from "../ipc"

describe("accountIpcModule", () => {
  it("declares account invoke channels", () => {
    expect(accountIpcModule.id).toBe("account")
    expect(accountIpcModule.methods.getState.channel).toBe("synapse:account:get-state")
    expect(accountIpcModule.methods.startLogin.channel).toBe("synapse:account:start-login")
    expect(accountIpcModule.methods.refresh.channel).toBe("synapse:account:refresh")
    expect(accountIpcModule.methods.logout.channel).toBe("synapse:account:logout")
    expect(accountIpcModule.methods.listWebhooks.channel).toBe("synapse:account:webhooks:list")
  })

  it("validates account webhook responses", () => {
    const responseSchema = accountIpcModule.methods.listWebhooks.response
    expect(responseSchema).toBeDefined()
    if (!responseSchema) throw new Error("expected webhook list response schema")

    expect(responseSchema.parse([{
      id: "webhook-1",
      publicId: "wh_public",
      name: "GitHub",
      enabled: true,
      url: "https://synapse.test/webhooks/wh_public/whsec_secret",
      maskedUrl: "https://synapse.test/webhooks/wh_public/***",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      lastDeliveryAt: "2026-06-06T10:01:00.000Z",
      lastDeliveryStatus: "delivered",
    }])).toEqual([
      expect.objectContaining({
        publicId: "wh_public",
        url: "https://synapse.test/webhooks/wh_public/whsec_secret",
        maskedUrl: "https://synapse.test/webhooks/wh_public/***",
      }),
    ])
  })

  it("validates state changed domain events", () => {
    const parsed = accountIpcModule.events.stateChanged.payload.parse({
      domain: "account",
      type: "account.stateChanged",
      payload: {
        state: {
          status: "authenticated",
          connectivity: "online",
          profile: {
            user: { id: "u1", email: "u@example.com", displayName: "Ada", status: "active" },
            teams: [],
            syncedAt: "2026-05-28T00:00:00.000Z",
          },
        },
      },
      timestamp: "2026-05-28T00:00:00.000Z",
    })

    expect(parsed).toMatchObject({
      payload: {
        state: {
          status: "authenticated",
          profile: {
            user: {
              displayName: "Ada",
            },
          },
        },
      },
    })
  })

  it("validates offline authenticated account events", () => {
    const parsed = accountIpcModule.events.stateChanged.payload.parse({
      domain: "account",
      type: "account.stateChanged",
      payload: {
        state: {
          status: "authenticated",
          connectivity: "offline",
          offlineReason: "server_unavailable",
          retry: { attempt: 1, nextRetryAt: "2026-06-06T00:00:10.000Z" },
          profile: {
            user: { id: "u1", email: "u@example.com", displayName: "Ada", status: "active" },
            teams: [],
            syncedAt: "2026-06-06T00:00:00.000Z",
          },
        },
      },
      timestamp: "2026-06-06T00:00:00.000Z",
    })

    expect(parsed).toMatchObject({
      payload: {
        state: {
          status: "authenticated",
          connectivity: "offline",
          offlineReason: "server_unavailable",
        },
      },
    })
  })
})
