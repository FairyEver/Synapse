import { describe, expect, it, vi } from "vitest"
import { wecomConnector } from "../../../connectors/main/definitions"
import { createWecomConnectorDriver } from "../connector-driver"

describe("WeCom connector driver", () => {
  it("publishes a connection-only Enterprise WeChat card", async () => {
    const driver = createWecomConnectorDriver({
      service: {
        snapshot: vi.fn(async () => ({
          status: "connected" as const,
          enabled: true,
          connectedAt: "2026-10-22T09:00:00Z",
          lastValidatedAt: "2026-10-22T09:30:00Z",
        })),
        onChanged: vi.fn(() => vi.fn()),
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as never,
    })
    await driver.lifecycle!.initialize(() => undefined)

    await expect(driver.lifecycle!.item(wecomConnector)).resolves.toEqual({
      id: "wecom",
      kind: "wecom",
      name: "企业微信",
      description: "连接企业微信智能机器人",
      enabled: true,
      probeStatus: "ready",
      connectionStatus: "connected",
      canRetry: false,
      wecom: {
        connectedAt: "2026-10-22T09:00:00Z",
        lastValidatedAt: "2026-10-22T09:30:00Z",
      },
    })
  })
})
