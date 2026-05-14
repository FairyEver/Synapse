import { describe, expect, it, vi } from "vitest"

import type {
  DataChangeListener,
  DataNamespace,
  WebhookConfigEntryV1,
  WebhookRunEntryV1,
} from "../../../runtime/data-repo"
import { createNetworkServiceRegistry } from "../../../runtime/network"
import type { AuditSink } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import { AGENT_RUNTIME_SERVICE_ID } from "../../agent-runtime"
import { AutomationIngressService } from "../automation-ingress-service"

describe("AutomationIngressService", () => {
  it("passes webhook messageId into AgentMessage for runtime correlation", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const send = vi.fn(async () => ({ resultText: "ok" }))
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: {
        run: async () => {
          throw new Error("not used")
        },
      },
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })
    await service.start()
    const status = await service.getStatus()

    const response = await fetch(`http://${status.bindAddress}:${String(status.assignedPort)}${status.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: "project-1",
        sessionKey: "local:automation",
        messageId: "message-webhook-1",
        prompt: "run",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(200)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "message-webhook-1",
      projectId: "project-1",
      sessionKey: "local:automation",
    }))

    await service.stop()
  })

  it("records webhook prompt agent errors as failed runs with redacted diagnostics", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const logger = structuredLogger()
    const errorText = "SDK failed for secret prompt text"
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => ({ error: errorText }),
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: {
        run: async () => {
          throw new Error("not used")
        },
      },
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
      auditSink: {
        record: (event) => {
          auditEvents.push(event)
        },
        list: () => [],
        clearForTests: () => {},
      },
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })
    await service.start()
    const status = await service.getStatus()

    const response = await fetch(`http://${status.bindAddress}:${String(status.assignedPort)}${status.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: "project-1",
        sessionKey: "local:automation",
        prompt: "run",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        status: "failed",
        error: errorText,
      }),
    }))
    expect(await runs.list()).toEqual([
      expect.objectContaining({
        kind: "prompt",
        status: "failed",
        lastError: errorText,
      }),
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook prompt run completed with agent error.",
      expect.objectContaining({
        projectId: "project-1",
        kind: "prompt",
        sessionKey: "local:automation",
        status: "failed",
        boundary: "agent-runtime",
        errorName: "string",
        errorLength: errorText.length,
      }),
    )
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcome: "failed",
        metadata: expect.objectContaining({
          boundary: "agent-runtime",
          errorName: "string",
          errorLength: errorText.length,
        }),
      }),
    ]))
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt text")
    expect(JSON.stringify(auditEvents)).not.toContain("secret prompt text")

    await service.stop()
  })

  it("logs thrown webhook prompt runs with run context and redacted error text", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => {
          throw new Error("SDK failed for secret prompt text")
        },
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: {
        run: async () => {
          throw new Error("not used")
        },
      },
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })
    await service.start()
    const status = await service.getStatus()

    const response = await fetch(`http://${status.bindAddress}:${String(status.assignedPort)}${status.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: "project-1",
        sessionKey: "local:automation",
        prompt: "run",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(500)
    const responseBody = await response.json()
    expect(responseBody).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "internal error",
      },
    })
    expect(JSON.stringify(responseBody)).not.toContain("secret prompt text")
    const [run] = await runs.list()
    expect(run).toEqual(expect.objectContaining({
      kind: "prompt",
      projectId: "project-1",
      sessionKey: "local:automation",
      status: "failed",
    }))
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook run threw.",
      expect.objectContaining({
        runId: run?.id,
        projectId: "project-1",
        kind: "prompt",
        sessionKey: "local:automation",
        boundary: "agent-runtime",
        errorName: "Error",
        errorLength: "SDK failed for secret prompt text".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt text")

    await service.stop()
  })

  it("redacts async webhook background failure diagnostics", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => {
          throw new Error("SDK failed for secret async prompt text")
        },
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: {
        run: async () => {
          throw new Error("not used")
        },
      },
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })
    await service.start()
    const status = await service.getStatus()

    const response = await fetch(`http://${status.bindAddress}:${String(status.assignedPort)}${status.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: "project-1",
        sessionKey: "local:automation",
        prompt: "run",
      }),
    })

    expect(response.status).toBe(202)
    await waitFor(() => logger.warn.mock.calls.some((call) => call[0] === "Webhook background run failed."))
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook background run failed.",
      expect.objectContaining({
        boundary: "webhook-background",
        path: "/hook",
        mode: "async",
        errorName: "Error",
        errorLength: "SDK failed for secret async prompt text".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret async prompt text")

    await service.stop()
  })
})

function structuredLogger(): StructuredLogger & { warn: ReturnType<typeof vi.fn> } {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } satisfies Omit<StructuredLogger, "child"> & {
    child: ReturnType<typeof vi.fn>
  }
  logger.child.mockReturnValue(logger)
  return logger
}

function fakeProjectContainers(agent: { send: (message: unknown) => Promise<unknown> }) {
  return {
    open: async () => ({
      get: (id: string) => {
        if (id !== AGENT_RUNTIME_SERVICE_ID) throw new Error("unexpected service")
        return agent
      },
      inspect: () => [],
      dispose: async () => {},
      projectId: "project-1",
    }),
    peek: () => undefined,
    close: async () => {},
    list: () => [],
    registerService: () => {},
    setQuota: () => {},
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return this.items.values().next().value ?? null
  }

  async setSingleton(value: T): Promise<void> {
    this.items.set(value.id, value)
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.items.values()]
    if (!filter) return values
    return values.filter((item) =>
      Object.entries(filter).every(([key, value]) => item[key as keyof T] === value))
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(_listener: DataChangeListener<T>): () => void {
    return () => {}
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}
