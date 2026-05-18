import { describe, expect, it, vi } from "vitest"

import type {
  DataChangeListener,
  DataNamespace,
  WebhookConfigEntryV1,
  WebhookRunEntryV1,
} from "../../../runtime/data-repo"
import { createNetworkServiceRegistry } from "../../../runtime/network"
import type { ControlledProcessRunner } from "../../../runtime/process"
import type { ProjectContainerRegistry } from "../../../runtime/project-container"
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
      processRunner: unusedProcessRunner(),
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

  it("uses webhook run id as AgentMessage messageId when no messageId is provided", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const send = vi.fn(async () => ({ resultText: "ok" }))
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
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
        prompt: "run",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(200)
    const responseBody = await response.json()
    const runId = responseBody.data.runId
    expect(runId).toMatch(/^webhook-run:/)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      messageId: runId,
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
    const errorText = "SDK failed for api_key=sk-ant-test123456 secret prompt"
    const sanitizedErrorText = "SDK failed for api_key=[redacted] secret prompt"
    const safeErrorText = `执行失败：${sanitizedErrorText}`
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => ({
          conversationId: "conversation-webhook-1",
          agentSessionId: "sdk-webhook-1",
          error: errorText,
        }),
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
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
        messageId: "message-webhook-1",
        prompt: "run",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        status: "failed",
        error: safeErrorText,
        conversationId: "conversation-webhook-1",
        sdkSessionId: "sdk-webhook-1",
      }),
    }))
    expect(await runs.list()).toEqual([
      expect.objectContaining({
        kind: "prompt",
        status: "failed",
        lastError: safeErrorText,
        metadata: expect.objectContaining({
          messageId: "message-webhook-1",
          conversationId: "conversation-webhook-1",
          sdkSessionId: "sdk-webhook-1",
        }),
      }),
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook prompt run completed with agent error.",
      expect.objectContaining({
        projectId: "project-1",
        kind: "prompt",
        sessionKey: "local:automation",
        messageId: "message-webhook-1",
        conversationId: "conversation-webhook-1",
        sdkSessionId: "sdk-webhook-1",
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
          messageId: "message-webhook-1",
          conversationId: "conversation-webhook-1",
          sdkSessionId: "sdk-webhook-1",
          errorName: "string",
          errorLength: errorText.length,
        }),
      }),
    ]))
    expect(JSON.stringify(responseBody)).toContain("api_key=[redacted]")
    expect(JSON.stringify(responseBody)).not.toContain("sk-ant-test123456")
    expect(JSON.stringify(await runs.list())).not.toContain("sk-ant-test123456")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-ant-test123456")
    expect(JSON.stringify(auditEvents)).not.toContain("sk-ant-test123456")

    await service.stop()
  })

  it("summarizes webhook prompt agent errors before sending automation replies", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const errorText = "SDK failed for api_key=sk-ant-test123456 secret prompt"
    const sanitizedErrorText = "SDK failed for api_key=[redacted] secret prompt"
    const safeErrorText = `执行失败：${sanitizedErrorText}`
    const sendAutomationMessage = vi.fn(async () => {})
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => ({ error: errorText }),
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      feishuConnector: { sendAutomationMessage },
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
        replyCtx: {
          kind: "feishu",
          projectId: "project-1",
          sessionKey: "local:automation",
          connectorId: "feishu-main",
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(sendAutomationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        sessionKey: "local:automation",
      }),
      safeErrorText,
    )
    expect(JSON.stringify(sendAutomationMessage.mock.calls)).not.toContain("sk-ant-test123456")

    await service.stop()
  })

  it("logs thrown webhook prompt runs with run context and redacted error text", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const errorText = "SDK failed for api_key=sk-ant-test123456 secret prompt"
    const sanitizedErrorText = "SDK failed for api_key=[redacted] secret prompt"
    const safeErrorText = `执行失败：${sanitizedErrorText}`
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => {
          throw new Error(errorText)
        },
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
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
    expect(JSON.stringify(responseBody)).not.toContain("sk-ant-test123456")
    const [run] = await runs.list()
    expect(run).toEqual(expect.objectContaining({
      kind: "prompt",
      projectId: "project-1",
      sessionKey: "local:automation",
      status: "failed",
      lastError: safeErrorText,
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
        errorLength: errorText.length,
      }),
    )
    expect(JSON.stringify(await runs.list())).not.toContain("sk-ant-test123456")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-ant-test123456")

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
      processRunner: unusedProcessRunner(),
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

  it("logs webhook validation failures before a run is created", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => ({ resultText: "not used" }),
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
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
      body: '{"prompt":"test body",',
    })

    expect(response.status).toBe(400)
    expect(await runs.list()).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook request validation failed.",
      expect.objectContaining({
        boundary: "webhook.validation",
        path: "/hook",
        method: "POST",
        status: 400,
        errorCode: "invalid_json",
        bodyLength: '{"prompt":"test body",'.length,
        source: "local",
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("test body")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(config.token ?? "")

    await service.stop()
  })

  it("redacts exec shell errors from processRunner in persisted lastError", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const errorText = "exec failed: /Users/alice/.ssh/id_rsa found at sk-ant-test5678"
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => ({ resultText: "not used" }),
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: failingProcessRunner(errorText),
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
        exec: "cat /etc/passwd",
        shell: "posix",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(500)
    const [run] = await runs.list()
    expect(run).toEqual(expect.objectContaining({
      kind: "exec",
      projectId: "project-1",
      sessionKey: "local:automation",
      status: "failed",
    }))
    expect(run?.lastError).toBeDefined()
    expect(run?.lastError).not.toContain("sk-ant-test5678")
    expect(run?.lastError).not.toContain("/Users/alice/.ssh/id_rsa")
    expect(run?.lastError).toContain("[path]")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-ant-test5678")

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
  return logger as StructuredLogger & { warn: ReturnType<typeof vi.fn> }
}

function fakeProjectContainers(agent: { send: (message: unknown) => Promise<unknown> }): ProjectContainerRegistry {
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
  } as ProjectContainerRegistry
}

function unusedProcessRunner(): ControlledProcessRunner {
  return failingProcessRunner("not used")
}

function failingProcessRunner(message: string): ControlledProcessRunner {
  return {
    run: async () => {
      throw new Error(message)
    },
  } as unknown as ControlledProcessRunner
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
