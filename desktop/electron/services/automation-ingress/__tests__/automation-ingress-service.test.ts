import { describe, expect, it, vi } from "vitest"

import type {
  DataChangeListener,
  DataNamespace,
  WebhookConfigEntryV1,
  WebhookRunEntryV1,
} from "../../../runtime/data-repo"
import {
  createNetworkServiceRegistry,
  type LocalHttpRequest,
  type LocalHttpResponse,
} from "../../../runtime/network"
import type { ControlledProcessRunner } from "../../../runtime/process"
import type { ProjectContainerRegistry } from "../../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import { AGENT_RUNTIME_SERVICE_ID } from "../../agent-runtime"
import { AutomationIngressService } from "../automation-ingress-service"

describe("AutomationIngressService", () => {
  it("records denied audit when persisted webhook listener restore is blocked", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false, reason: "denied by startup policy", policyId: "deny-startup" })),
    }
    await configs.upsert({
      id: "webhook:default",
      schemaVersion: 1,
      enabled: true,
      bindAddress: "0.0.0.0",
      preferredPort: 4567,
      path: "/hook",
      token: "token",
      maxBodyBytes: 256 * 1024,
      rateLimitPerMinute: 60,
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
    })
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      permissionGuard,
      auditSink: {
        record: (event) => {
          auditEvents.push(event)
        },
        list: () => [],
        clearForTests: () => {},
      },
    })

    await expect(service.start()).rejects.toThrow("denied by startup policy")

    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "network.listen",
        actor: { kind: "user" },
        resource: "0.0.0.0:4567/hook",
        outcome: "denied",
        metadata: expect.objectContaining({
          serviceId: "automation.webhook",
          reason: "denied by startup policy",
          policyId: "deny-startup",
        }),
      }),
    ])
  })

  it("rejects webhook listener updates when permission is denied before persisting", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false, reason: "denied by policy", policyId: "deny-webhook" })),
    }
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      permissionGuard,
      auditSink: {
        record: (event) => {
          auditEvents.push(event)
        },
        list: () => [],
        clearForTests: () => {},
      },
    })

    await expect(service.updateConfig({
      enabled: true,
      bindAddress: "0.0.0.0",
      preferredPort: 4567,
      resetToken: true,
    })).rejects.toThrow("denied by policy")

    await expect(configs.get("webhook:default")).resolves.toBeNull()
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "network.listen",
      actor: { kind: "user" },
      resource: "0.0.0.0:4567/hook",
      context: {
        serviceId: "automation.webhook",
        source: "automationIngress.updateConfig",
      },
    })
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "network.listen",
        actor: { kind: "user" },
        resource: "0.0.0.0:4567/hook",
        outcome: "denied",
        metadata: expect.objectContaining({
          source: "automationIngress.updateConfig",
          policyId: "deny-webhook",
          changedFields: expect.arrayContaining(["enabled", "bindAddress", "preferredPort", "resetToken"]),
        }),
      }),
    ])
  })

  it("rejects invalid numeric webhook config before persisting", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
    })

    await expect(service.updateConfig({ preferredPort: -1 })).rejects.toThrow("preferredPort 必须是")
    await expect(service.updateConfig({ maxBodyBytes: 0 })).rejects.toThrow("maxBodyBytes 必须是")
    await expect(service.updateConfig({ rateLimitPerMinute: 0 })).rejects.toThrow("rateLimitPerMinute 必须是")

    await expect(configs.get("webhook:default")).resolves.toBeNull()
  })

  it("does not persist the default disabled config during startup or status reads", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
    })

    await service.start()
    await expect(configs.get("webhook:default")).resolves.toBeNull()

    await expect(service.getStatus()).resolves.toMatchObject({
      enabled: false,
      bindAddress: "127.0.0.1",
      path: "/hook",
    })
    await expect(configs.get("webhook:default")).resolves.toBeNull()
  })

  it("does not keep restart-required status when assigned port persistence fails after binding", async () => {
    const configs = new FailingAssignedPortNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    await configs.seed({
      id: "webhook:default",
      schemaVersion: 1,
      enabled: true,
      bindAddress: "127.0.0.1",
      path: "/hook",
      token: "token",
      maxBodyBytes: 256 * 1024,
      rateLimitPerMinute: 60,
      serviceRestartRequired: true,
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
    })
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
    })

    await service.start()
    await waitFor(() => logger.warn.mock.calls.length > 0)
    const status = await service.getStatus()

    expect(status.enabled).toBe(true)
    expect(status.assignedPort).toEqual(expect.any(Number))
    expect(status.serviceRestartRequired).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook assigned port persistence failed.",
      expect.objectContaining({
        errorName: "Error",
        errorLength: "persist failed at /Users/test token=sk-secret".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/test")

    await service.stop()
  })

  it("audits allowed webhook listener updates and token resets without exposing tokens", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      permissionGuard,
      auditSink: {
        record: (event) => {
          auditEvents.push(event)
        },
        list: () => [],
        clearForTests: () => {},
      },
    })

    const result = await service.updateConfig({
      enabled: true,
      bindAddress: "0.0.0.0",
      preferredPort: 4567,
      resetToken: true,
    })

    expect(result.token).toEqual(expect.any(String))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.listen",
      resource: "0.0.0.0:4567/hook",
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      resource: "automation.webhook.token",
    }))
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "network.listen",
        outcome: "allowed",
        resource: "0.0.0.0:4567/hook",
      }),
      expect.objectContaining({
        action: "secret.write",
        outcome: "allowed",
        resource: "automation.webhook.token",
      }),
    ])
    expect(JSON.stringify(auditEvents)).not.toContain(result.token ?? "")
  })

  it("reports restart required when runtime-captured webhook limits change while running", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
    })
    await service.updateConfig({ enabled: true, resetToken: true })
    await service.start()

    const result = await service.updateConfig({ maxBodyBytes: 512 * 1024 })
    const status = await service.getStatus()

    expect(result.status.maxBodyBytes).toBe(512 * 1024)
    expect(result.status.serviceRestartRequired).toBe(true)
    expect(status.serviceRestartRequired).toBe(true)
    await service.stop()
  })

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

  it("uses the configured project workspace for webhook prompt agent messages", async () => {
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
        workspacePath: "/tmp/other-project",
        prompt: "run",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(200)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      workspacePath: "/repo",
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

  it("rate limits unauthorized webhook attempts before authentication", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
    })
    await service.updateConfig({ enabled: true, rateLimitPerMinute: 2, resetToken: true })

    const first = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: { "x-forwarded-for": "203.0.113.10" },
      body: Buffer.alloc(0),
      remoteAddress: "127.0.0.1",
    })
    const second = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: { "x-forwarded-for": "203.0.113.11" },
      body: Buffer.alloc(0),
      remoteAddress: "127.0.0.1",
    })
    const third = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: { "x-forwarded-for": "203.0.113.12" },
      body: Buffer.alloc(0),
      remoteAddress: "127.0.0.1",
    })

    expect(first.status).toBe(401)
    expect(second.status).toBe(401)
    expect(third.status).toBe(429)
  })

  it("does not trust x-forwarded-for for authenticated webhook rate limits", async () => {
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
    const config = await service.updateConfig({ enabled: true, rateLimitPerMinute: 1, resetToken: true })
    const body = JSON.stringify({
      project: "project-1",
      sessionKey: "local:automation",
      prompt: "run",
      replyMode: "wait",
    })

    const first = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: {
        authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
      body: Buffer.from(body),
      remoteAddress: "127.0.0.1",
    })
    const second = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: {
        authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.11",
      },
      body: Buffer.from(body),
      remoteAddress: "127.0.0.1",
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("does not persist or return webhook session credentials or unsafe metadata", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "ok" }) }),
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
        sessionKey: "local:automation-secret",
        workspacePath: "/Users/alice/private/repo",
        messageId: "message-webhook-safe",
        metadata: {
          traceId: "trace-1",
          source: "ci",
          token: "sk-webhook-secret",
          sessionKey: "metadata-session-secret",
          nested: { credential: "hidden" },
        },
        prompt: "run",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(200)
    const persistedRuns = await runs.list()
    expect(JSON.stringify(persistedRuns)).not.toContain("local:automation-secret")
    expect(JSON.stringify(persistedRuns)).not.toContain("/Users/alice/private/repo")
    expect(JSON.stringify(persistedRuns)).not.toContain("sk-webhook-secret")
    expect(JSON.stringify(persistedRuns)).not.toContain("metadata-session-secret")
    expect(persistedRuns[0]?.metadata).toEqual(expect.objectContaining({
      messageId: "message-webhook-safe",
      source: "ci",
      traceId: "trace-1",
    }))

    await runs.upsert({
      id: "webhook-run:legacy",
      schemaVersion: 1,
      requestId: "legacy-request",
      projectId: "project-1",
      kind: "prompt",
      status: "success",
      source: "local",
      sessionKey: "legacy-session-secret",
      workspacePath: "/Users/alice/private/legacy",
      startedAt: "2026-05-25T00:00:00.000Z",
      metadata: {
        conversationId: "conversation-legacy",
        token: "legacy-token-secret",
        traceId: "legacy-trace",
      },
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
    })
    const safeRuns = await service.listRuns()
    expect(JSON.stringify(safeRuns)).not.toContain("legacy-session-secret")
    expect(JSON.stringify(safeRuns)).not.toContain("/Users/alice/private/legacy")
    expect(JSON.stringify(safeRuns)).not.toContain("legacy-token-secret")
    expect(safeRuns.find((run) => run.id === "webhook-run:legacy")?.metadata).toEqual({
      conversationId: "conversation-legacy",
      traceId: "legacy-trace",
    })

    await service.stop()
  })

  it("prunes old finished webhook runs after retaining the newest runs", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    let clock = Date.parse("2026-06-06T10:00:00.000Z")
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "ok" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      runRetentionLimit: 2,
      now: () => {
        clock += 1000
        return new Date(clock)
      },
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })

    for (let index = 0; index < 4; index += 1) {
      const response = await handleWebhookRequest(service, {
        method: "POST",
        url: "/hook",
        headers: {
          authorization: `Bearer ${config.token ?? ""}`,
          "content-type": "application/json",
        },
        body: Buffer.from(JSON.stringify({
          project: "project-1",
          sessionKey: "local:automation",
          messageId: `request-${index}`,
          prompt: "run",
          replyMode: "wait",
        })),
        remoteAddress: "127.0.0.1",
      })
      expect(response.status).toBe(200)
    }

    expect((await runs.list()).map((run) => run.metadata?.messageId).sort()).toEqual([
      "request-2",
      "request-3",
    ])
    expect((await service.listRuns()).map((run) => run.metadata?.messageId)).toEqual([
      "request-3",
      "request-2",
    ])
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
      status: "failed",
      lastError: safeErrorText,
    }))
    expect(run?.sessionKey).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook run threw.",
      expect.objectContaining({
        runId: run?.id,
        projectId: "project-1",
        kind: "prompt",
        boundary: "agent-runtime",
        errorName: "Error",
        errorLength: errorText.length,
      }),
    )
    expect(JSON.stringify(await runs.list())).not.toContain("sk-ant-test123456")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-ant-test123456")

    await service.stop()
  })

  it("logs finish persistence failures without masking the original webhook run error", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new FailingFinishedRunNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const originalError = "SDK failed before finish token=sk-ant-test123456"
    const finishError = "finish persist failed at /Users/test token=sk-finish"
    runs.failWith(finishError)
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => {
          throw new Error(originalError)
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

    const response = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: {
        authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: Buffer.from(JSON.stringify({
        project: "project-1",
        sessionKey: "local:automation",
        prompt: "run",
        replyMode: "wait",
      })),
      remoteAddress: "127.0.0.1",
    })

    expect(response.status).toBe(500)
    const [run] = await runs.list()
    expect(run).toEqual(expect.objectContaining({
      kind: "prompt",
      projectId: "project-1",
      status: "running",
    }))
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook run finish failed.",
      expect.objectContaining({
        runId: run?.id,
        projectId: "project-1",
        kind: "prompt",
        status: "failed",
        boundary: "webhook.run-finish",
        errorName: "Error",
        errorLength: finishError.length,
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook run threw.",
      expect.objectContaining({
        runId: run?.id,
        projectId: "project-1",
        kind: "prompt",
        boundary: "agent-runtime",
        errorName: "Error",
        errorLength: originalError.length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-ant-test123456")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-finish")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/test")
  })

  it("marks interrupted running webhook runs as failed on start", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    await runs.upsert({
      id: "webhook-run:interrupted",
      schemaVersion: 1,
      requestId: "request-1",
      projectId: "project-1",
      kind: "exec",
      status: "running",
      source: "127.0.0.1",
      startedAt: "2026-06-06T10:00:00.000Z",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      metadata: {
        traceId: "trace-1",
        token: "sk-secret",
      },
    })
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
      now: () => new Date("2026-06-07T09:00:00.000Z"),
    })

    await service.start()

    const [run] = await runs.list()
    expect(run).toEqual(expect.objectContaining({
      id: "webhook-run:interrupted",
      status: "failed",
      lastError: "Webhook 运行因应用关闭或重启而中断。",
      finishedAt: "2026-06-07T09:00:00.000Z",
      updatedAt: "2026-06-07T09:00:00.000Z",
      metadata: { traceId: "trace-1" },
    }))
    expect(JSON.stringify(await runs.list())).not.toContain("sk-secret")
    expect(logger.info).toHaveBeenCalledWith("Recovered interrupted webhook runs.", {
      boundary: "webhook-startup-run-recovery",
      recoveredCount: 1,
    })
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
        source: expect.any(String),
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("test body")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(config.token ?? "")

    await service.stop()
  })

  it("rejects invalid async webhook payloads before returning queued", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const send = vi.fn(async () => ({ resultText: "not used" }))
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send }),
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
      body: JSON.stringify({ project: "project-1" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "invalid_payload",
        message: "prompt and exec are mutually exclusive",
      },
    })
    expect(await runs.list()).toEqual([])
    expect(send).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook request validation failed.",
      expect.objectContaining({
        boundary: "webhook.validation",
        status: 400,
        errorCode: "invalid_payload",
      }),
    )

    await service.stop()
  })

  it("rejects invalid webhook exec timeout overrides before creating runs", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const run = vi.fn()
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: { run } as unknown as ControlledProcessRunner,
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })

    for (const timeoutMins of [0, -1, 1.5, 121, "2"]) {
      const response = await handleWebhookRequest(service, {
        method: "POST",
        url: "/hook",
        headers: {
          authorization: `Bearer ${config.token ?? ""}`,
          "Content-Type": "application/json",
        },
        body: Buffer.from(JSON.stringify({
          project: "project-1",
          exec: "echo ok",
          timeoutMins,
          replyMode: "wait",
        })),
        remoteAddress: "127.0.0.1",
      })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        ok: false,
        error: {
          code: "invalid_timeout",
          message: "timeoutMins must be an integer from 1 to 120",
        },
      })
    }

    expect(await runs.list()).toEqual([])
    expect(run).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook request validation failed.",
      expect.objectContaining({
        boundary: "webhook.validation",
        status: 400,
        errorCode: "invalid_timeout",
      }),
    )
  })

  it("passes valid snake_case webhook exec timeout overrides to the process runner", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    }))
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: { run } as unknown as ControlledProcessRunner,
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })

    const response = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: {
        authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: Buffer.from(JSON.stringify({
        project: "project-1",
        exec: "echo ok",
        timeout_mins: 2,
        replyMode: "wait",
      })),
      remoteAddress: "127.0.0.1",
    })

    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 120_000,
    }))
  })

  it("defaults webhook exec to cmd on Windows when shell is omitted", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    }))
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: { run } as unknown as ControlledProcessRunner,
      listProjects: async () => [{ projectId: "project-1", workspacePath: "C:\\repo" }],
      platform: "win32",
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })

    const response = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: {
        authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: Buffer.from(JSON.stringify({
        project: "project-1",
        exec: "echo %USERNAME%",
        replyMode: "wait",
      })),
      remoteAddress: "127.0.0.1",
    })

    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "echo %USERNAME%"],
      cwd: "C:\\repo",
    }))
  })

  it("redacts successful exec output before returning or storing webhook runs", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const stdoutSecret = "raw.bearer.token"
    const stderrSecret = "session-secret"
    const tokenSecret = "sk-ant-test123456"
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: `normal output at /Users/alice/repo\nAuthorization: Bearer ${stdoutSecret}\ntoken=${tokenSecret}`,
      stderr: `Cookie: sid=${stderrSecret}`,
      timedOut: false,
    }))
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: { run } as unknown as ControlledProcessRunner,
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
    })
    const config = await service.updateConfig({ enabled: true, resetToken: true })

    const response = await handleWebhookRequest(service, {
      method: "POST",
      url: "/hook",
      headers: {
        authorization: `Bearer ${config.token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: Buffer.from(JSON.stringify({
        project: "project-1",
        exec: "printenv",
        replyMode: "wait",
      })),
      remoteAddress: "127.0.0.1",
    })

    expect(response.status).toBe(200)
    const [storedRun] = await runs.list()
    const [listedRun] = await service.listRuns("project-1")
    const serialized = JSON.stringify([response.body, storedRun, listedRun])
    expect(serialized).toContain("normal output at /Users/alice/repo")
    expect(serialized).toContain("Authorization:")
    expect(serialized).toContain("Cookie:")
    expect(serialized).toContain("token=[redacted]")
    expect(serialized).toContain("[redacted]")
    expect(serialized).not.toContain(stdoutSecret)
    expect(serialized).not.toContain(stderrSecret)
    expect(serialized).not.toContain(tokenSecret)
  })

  it("returns a fixed internal error when webhook config loading fails during a request", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const config: WebhookConfigEntryV1 = {
      id: "webhook:default",
      schemaVersion: 1,
      enabled: true,
      bindAddress: "127.0.0.1",
      path: "/hook",
      token: "token",
      maxBodyBytes: 256 * 1024,
      rateLimitPerMinute: 60,
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
    }
    await configs.upsert(config)
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({ send: async () => ({ resultText: "not used" }) }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: unusedProcessRunner(),
      listProjects: async () => [{ projectId: "project-1", workspacePath: "/repo" }],
      logger,
    })

    await service.start()
    const status = await service.getStatus()
    vi.spyOn(configs, "get")
      .mockRejectedValueOnce(new Error("config read failed at /Users/test/synapse token=sk-secret"))
    const response = await fetch(`http://${status.bindAddress}:${String(status.assignedPort)}/not-hook`, {
      method: "GET",
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "internal error",
      },
    })
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook request failed before dispatch.",
      expect.objectContaining({
        boundary: "webhook.request",
        path: "/not-hook",
        method: "GET",
        errorName: "Error",
        errorLength: "config read failed at /Users/test/synapse token=sk-secret".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/test")

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
      status: "failed",
    }))
    expect(run?.sessionKey).toBeUndefined()
    expect(run?.lastError).toBeDefined()
    expect(run?.lastError).not.toContain("sk-ant-test5678")
    expect(run?.lastError).not.toContain("/Users/alice/.ssh/id_rsa")
    expect(run?.lastError).toContain("[path]")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-ant-test5678")

    await service.stop()
  })

  it("redacts returned exec shell errors from wait-mode HTTP responses", async () => {
    const configs = new MemoryNamespace<WebhookConfigEntryV1>("webhook.config")
    const runs = new MemoryNamespace<WebhookRunEntryV1>("webhook.runs")
    const logger = structuredLogger()
    const errorText = "exec failed: token=sk-ant-test5678 at /Users/alice/.ssh/id_rsa"
    const service = new AutomationIngressService({
      projectContainers: fakeProjectContainers({
        send: async () => ({ resultText: "not used" }),
      }),
      networkRegistry: createNetworkServiceRegistry(),
      configs,
      runs,
      processRunner: returnedFailedProcessRunner(errorText),
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
        exec: "cat /etc/passwd",
        shell: "posix",
        replyMode: "wait",
      }),
    })

    expect(response.status).toBe(500)
    const responseBody = await response.json()
    expect(JSON.stringify(responseBody)).not.toContain("sk-ant-test5678")
    expect(JSON.stringify(responseBody)).not.toContain("/Users/alice/.ssh/id_rsa")
    expect(responseBody).toEqual({
      ok: false,
      error: {
        code: "failed",
        message: "exec failed: token=[redacted] at [path]",
      },
    })
    const [run] = await runs.list()
    expect(run?.lastError).toBe("exec failed: token=[redacted] at [path]")

    await service.stop()
  })
})

function structuredLogger(): StructuredLogger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} {
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
  return logger as StructuredLogger & {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
  }
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

function returnedFailedProcessRunner(message: string): ControlledProcessRunner {
  return {
    run: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
      error: message,
      timedOut: false,
    }),
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

class FailingAssignedPortNamespace<T extends WebhookConfigEntryV1> extends MemoryNamespace<T> {
  async seed(item: T): Promise<void> {
    await super.upsert(item)
  }

  override async upsert(item: T): Promise<void> {
    if (typeof item.assignedPort === "number") {
      throw new Error("persist failed at /Users/test token=sk-secret")
    }
    await super.upsert(item)
  }
}

class FailingFinishedRunNamespace<T extends WebhookRunEntryV1> extends MemoryNamespace<T> {
  private finishError = "finish failed"

  failWith(message: string): void {
    this.finishError = message
  }

  override async upsert(item: T): Promise<void> {
    if (item.status !== "running") {
      throw new Error(this.finishError)
    }
    await super.upsert(item)
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}

function handleWebhookRequest(
  service: AutomationIngressService,
  request: LocalHttpRequest,
): Promise<LocalHttpResponse> {
  return (service as unknown as {
    handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse>
  }).handleHttp(request)
}
