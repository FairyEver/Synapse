import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../action-runtime/action-registry"
import { AutomationTriggerRegistry, type AutomationTriggerDefinition } from "../../services/automation/trigger-registry"
import type { AutomationItem, AutomationRun } from "../../services/automation/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createAutomationCapabilityDispatcher, toPublicAutomationItemSummary } from "../automation-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { buildAutomationTools } from "../../../synapse-capabilities/shared/automation-domain"

const baseItem: AutomationItem = {
  id: "automation:1",
  schemaVersion: 1,
  name: "Daily automation",
  description: "Send summary",
  enabled: true,
  scope: { type: "global" },
  cwd: "/Users/liyang/project",
  trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1, 2, 3] } },
  executor: { type: "builtin.agent", config: { projectId: "project:1", agentType: "claude-code", providerId: "p1", modelTier: "sonnet", prompt: "private prompt" } },
  policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:10:00.000Z",
  nextRunAt: "2026-06-07T00:30:00.000Z",
  lastRunAt: "2026-06-07T00:05:00.000Z",
  lastStatus: "success",
  activeRun: { status: "running", id: "automation-run:1" },
  runCount: 2,
  configVersion: 1,
}

const baseRun: AutomationRun = {
  id: "automation-run:1",
  schemaVersion: 1,
  automationId: "automation:1",
  startedAt: "2026-06-07T00:05:00.000Z",
  finishedAt: "2026-06-07T00:05:02.000Z",
  status: "success",
  triggeredBy: "manual",
  triggerType: "builtin.interval",
  executorType: "builtin.agent",
  result: {
    status: "success",
    summary: "ok",
    logs: [{ label: "prompt", value: "private prompt" }],
    outputs: { text: "private output" },
    metrics: { durationMs: 2000 },
  },
}

const intervalTriggerSchema = z.object({
  everyMinutes: z.number().int().positive(),
  anchor: z.enum(["created_at", "last_completed_at"]),
  activeDays: z.array(z.number().int().min(0).max(6)).min(1),
})

function intervalTrigger(): AutomationTriggerDefinition {
  return {
    manifest: {
      id: "builtin.interval",
      title: "Fixed interval",
      kind: "schedule",
      defaultConfig: { everyMinutes: 60, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      configSchema: intervalTriggerSchema,
      variables: [{ key: "trigger.everyMinutes", label: "Interval minutes", group: "config" }],
    },
    summarize: (config) => `Every ${(config as { everyMinutes: number }).everyMinutes} minutes`,
    runtime: {
      computeNextRunAt: () => new Date("2026-06-07T00:30:00.000Z"),
    },
  }
}

const commandActionSchema = z.object({ command: z.string().min(1), shell: z.enum(["posix", "cmd", "powershell"]) })
type CommandActionConfig = z.infer<typeof commandActionSchema>

function commandAction(): MainActionDefinition<CommandActionConfig> {
  return {
    manifest: {
      id: "builtin.command",
      title: "Command",
      permissions: ["shell.exec"],
      defaultConfig: { command: "date", shell: "posix" },
      configFields: [{ name: "command", kind: "string", required: true, defaultValue: "" }],
      configSchema: commandActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.command,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async (_input: ActionExecutionInput<CommandActionConfig>) => ({ status: "success" }),
  }
}

const scriptActionSchema = z.object({ script: z.string().min(1), shell: z.enum(["posix", "cmd", "powershell"]) })
type ScriptActionConfig = z.infer<typeof scriptActionSchema>

function scriptAction(): MainActionDefinition<ScriptActionConfig> {
  return {
    manifest: {
      id: "builtin.script",
      title: "Script",
      permissions: ["shell.exec"],
      defaultConfig: { script: "date", shell: "posix" },
      configFields: [{ name: "script", kind: "string", required: true, defaultValue: "" }],
      configSchema: scriptActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.script,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async (_input: ActionExecutionInput<ScriptActionConfig>) => ({ status: "success" }),
  }
}

const agentActionSchema = z.object({
  projectId: z.string().min(1),
  agentType: z.string().min(1),
  providerId: z.string().min(1),
  modelTier: z.string().min(1),
  prompt: z.string().min(1),
})

function agentAction(): MainActionDefinition<z.infer<typeof agentActionSchema>> {
  return {
    manifest: {
      id: "builtin.agent",
      title: "Agent",
      permissions: ["agent.spawn"],
      defaultConfig: { projectId: "", agentType: "claude-code", providerId: "", modelTier: "sonnet", prompt: "" },
      configFields: [{ name: "prompt", kind: "string", required: true }],
      configSchema: agentActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "agent.spawn",
      actor: context.actor,
      resource: config.projectId,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async () => ({ status: "success" }),
  }
}

function registries() {
  const triggers = new AutomationTriggerRegistry()
  triggers.register(intervalTrigger())
  const actions = new MainActionRegistry()
  actions.register(commandAction())
  actions.register(scriptAction())
  actions.register(agentAction())
  return { triggers, actions }
}

function serviceMock() {
  const items = [baseItem, { ...baseItem, id: "automation:2", enabled: false }]
  return {
    automationList: vi.fn(async (options?: { readonly enabled?: boolean; readonly limit?: number }) => (
      items
        .filter((item) => options?.enabled === undefined || item.enabled === options.enabled)
        .slice(0, options?.limit ?? items.length)
    )),
    automationGet: vi.fn(async (id: string) => (id === "automation:1" ? baseItem : null)),
    automationCreate: vi.fn(),
    automationUpdate: vi.fn(),
    automationDelete: vi.fn(),
    automationEnable: vi.fn(),
    automationDisable: vi.fn(),
    runAutomationNow: vi.fn(),
    stopRun: vi.fn(),
    automationRunList: vi.fn(async () => [baseRun]),
    automationRuntimeInspect: vi.fn(() => ({ timers: ["automation:1"], runningItemIds: ["automation:1"] })),
  }
}

function accountServiceMock() {
  return {
    listWebhooks: vi.fn(async () => [{
      id: "webhook-row:1",
      publicId: "wh_public",
      name: "Deploy hook",
      enabled: true,
      url: "https://synapse.test/webhooks/wh_public/whsec_secret",
      maskedUrl: "https://synapse.test/webhooks/wh_public/[secret]",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      lastDeliveryAt: "2026-06-07T00:05:00.000Z",
      lastDeliveryStatus: "delivered" as const,
    }]),
  }
}

function permissionGuardMock(result: Awaited<ReturnType<PermissionGuard["check"]>> = { allowed: true }) {
  return {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => result),
  } satisfies PermissionGuard
}

function auditSinkMock() {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  } satisfies AuditSink
}

function createHarness(options: {
  readonly permissionResult?: Awaited<ReturnType<PermissionGuard["check"]>>
  readonly platform?: string
} = {}) {
  const { triggers, actions } = registries()
  const service = serviceMock()
  const accountService = accountServiceMock()
  const permissionGuard = permissionGuardMock(options.permissionResult)
  const auditSink = auditSinkMock()
  const dispatcher = createAutomationCapabilityDispatcher({
    service,
    accountService,
    triggers,
    actions,
    platform: options.platform,
    permissionGuard,
    auditSink,
  })
  return { accountService, actions, auditSink, dispatcher, permissionGuard, service, triggers }
}

describe("automation capability dispatcher", () => {
  it("exposes webhook discovery in Automation MCP tools", () => {
    const tools = buildAutomationTools()

    expect(tools.map((tool) => tool.name)).toContain("automation_webhook_list")
    expect(tools.find((tool) => tool.name === "automation_webhook_list")?.description)
      .toContain("webhookPublicId")
    expect(tools.find((tool) => tool.name === "automation_run_disable")?.description)
      .toContain("Fails if the run is missing or no longer active")
    expect(tools.find((tool) => tool.name === "automation_run_disable")?.description)
      .toContain("stopRequested")
  })

  it("lists trigger and executor descriptors from registries", async () => {
    const { auditSink, dispatcher, permissionGuard } = createHarness()

    await expect(dispatcher.dispatch("automation.trigger_type.list", {}, { source: "api" }))
      .resolves.toMatchObject({
        ok: true,
        total: 1,
        data: [{
          type: "builtin.interval",
          title: "Fixed interval",
          kind: "schedule",
          defaultConfig: { everyMinutes: 60, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
          variables: [{ key: "trigger.everyMinutes", label: "Interval minutes", group: "config" }],
        }],
      })

    const result = await dispatcher.dispatch("automation.executor_type.list", {}, { source: "api" })
    expect(result).toMatchObject({
      ok: true,
      total: 3,
      data: [
        expect.objectContaining({ type: "builtin.command", title: "Command", permissions: ["shell.exec"] }),
        expect.objectContaining({ type: "builtin.script", title: "Script", permissions: ["shell.exec"] }),
        expect.objectContaining({ type: "builtin.agent", title: "Agent", permissions: ["agent.spawn"] }),
      ],
    })
    expect(JSON.stringify(result)).not.toContain("private prompt")
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.trigger_type.list",
      context: expect.objectContaining({ automationAction: "automation.trigger_type.list" }),
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.executor_type.list",
      context: expect.objectContaining({ automationAction: "automation.executor_type.list" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.trigger_type.list",
      outcome: "allowed",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.executor_type.list",
      outcome: "allowed",
    }))
  })

  it("blocks Automation discovery when read permission is denied", async () => {
    const { auditSink, dispatcher, permissionGuard } = createHarness({
      permissionResult: { allowed: false, reason: "read denied", policyId: "deny-automation-read" },
    })

    await expect(dispatcher.dispatch("automation.trigger_type.list", {}, { source: "mcp-http" }))
      .rejects.toThrow("read denied")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.trigger_type.list",
      context: expect.objectContaining({ automationAction: "automation.trigger_type.list" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.trigger_type.list",
      outcome: "denied",
      metadata: expect.objectContaining({
        policyId: "deny-automation-read",
        reason: "read denied",
      }),
    }))
  })

  it("checks read permission and lists Webhooks for builtin webhook trigger configuration", async () => {
    const { accountService, auditSink, dispatcher, permissionGuard } = createHarness()

    const result = await dispatcher.dispatch("automation.webhook.list", {}, { source: "mcp-http" })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "automation.read",
      actor: { kind: "user", id: "automation-dispatch:mcp-http" },
      resource: "automation:automation.webhook.list",
      context: expect.objectContaining({
        source: "mcp-http",
        automationAction: "automation.webhook.list",
      }),
    })
    expect(accountService.listWebhooks).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: true,
      total: 1,
      data: [{
        publicId: "wh_public",
        name: "Deploy hook",
        enabled: true,
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
        lastDeliveryAt: "2026-06-07T00:05:00.000Z",
        lastDeliveryStatus: "delivered",
      }],
    })
    expect(JSON.stringify(result)).not.toContain("whsec_secret")
    expect(JSON.stringify(result)).not.toContain("maskedUrl")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.webhook.list",
      outcome: "allowed",
    }))
  })

  it("returns Windows-aware shell defaults for Automation executor discovery", async () => {
    const { dispatcher } = createHarness({ platform: "win32" })

    const result = await dispatcher.dispatch("automation.executor_type.list", {}, { source: "mcp-http" })
    const data = result.ok ? result.data : []
    const executors = Array.isArray(data) ? data : []

    expect(executors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "builtin.command",
        defaultConfig: expect.objectContaining({ shell: "cmd" }),
      }),
      expect.objectContaining({
        type: "builtin.script",
        defaultConfig: expect.objectContaining({ shell: "cmd" }),
      }),
    ]))
  })

  it("uses Windows-aware shell defaults when creating and updating Automation executors", async () => {
    const { dispatcher, service } = createHarness({ platform: "win32" })
    vi.mocked(service.automationCreate)
      .mockResolvedValueOnce({ ...baseItem, id: "automation:new" })
      .mockResolvedValueOnce({ ...baseItem, id: "automation:powershell" })
    vi.mocked(service.automationUpdate).mockResolvedValueOnce({ ...baseItem, executor: { type: "builtin.script", config: { script: "echo ok", shell: "cmd" } } })

    await dispatcher.dispatch("automation.item.create", {
      name: "Windows command",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
      executor: { type: "builtin.command", config: { command: "echo ok" } },
    }, { source: "mcp-http" })
    await dispatcher.dispatch("automation.item.update", {
      automationId: "automation:1",
      patch: {
        executor: { type: "builtin.script", config: { script: "echo ok" } },
      },
    }, { source: "mcp-http" })
    await dispatcher.dispatch("automation.item.create", {
      name: "PowerShell command",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
      executor: { type: "builtin.command", config: { command: "Get-Date", shell: "powershell" } },
    }, { source: "mcp-http" })

    expect(service.automationCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "cmd" } },
    }))
    expect(service.automationUpdate).toHaveBeenCalledWith("automation:1", {
      executor: { type: "builtin.script", config: { script: "echo ok", shell: "cmd" } },
    })
    expect(service.automationCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      executor: { type: "builtin.command", config: { command: "Get-Date", shell: "powershell" } },
    }))
  })

  it("checks read permission when listing and getting public item summaries without raw configs", async () => {
    const { auditSink, dispatcher, permissionGuard } = createHarness()

    const list = await dispatcher.dispatch("automation.item.list", { enabled: true }, { source: "mcp-http" })
    const get = await dispatcher.dispatch("automation.item.get", { automationId: "automation:1" }, { source: "mcp-http" })

    expect(list).toEqual({
      ok: true,
      data: [toPublicAutomationItemSummary(baseItem, registries().triggers, registries().actions)],
      total: 1,
    })
    expect(get).toEqual({
      ok: true,
      data: toPublicAutomationItemSummary(baseItem, registries().triggers, registries().actions),
    })
    expect(JSON.stringify([list, get])).not.toContain("private prompt")
    expect(JSON.stringify([list, get])).not.toContain("everyMinutes")
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.item.list",
      context: expect.objectContaining({
        source: "mcp-http",
        automationAction: "automation.item.list",
      }),
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation:1",
      context: expect.objectContaining({
        source: "mcp-http",
        automationAction: "automation.item.get",
        automationId: "automation:1",
      }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation.item.list",
      outcome: "allowed",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "automation:automation:1",
      outcome: "allowed",
    }))
  })

  it("denies automation reads before service calls", async () => {
    const { actions, triggers } = registries()
    const service = serviceMock()
    const permissionGuard = permissionGuardMock({ allowed: false, reason: "blocked", policyId: "test-policy" })
    const auditSink = auditSinkMock()
    const dispatcher = createAutomationCapabilityDispatcher({
      service,
      accountService: accountServiceMock(),
      triggers,
      actions,
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("automation.item.list", {}, { source: "mcp-http" }))
      .rejects.toThrow("blocked")

    expect(service.automationList).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      outcome: "denied",
      resource: "automation:automation.item.list",
      metadata: expect.objectContaining({ reason: "blocked", policyId: "test-policy" }),
    }))
  })

  it("passes item list filters and limit to the Automation service", async () => {
    const { dispatcher, service } = createHarness()
    const scope = { type: "project" as const, projectId: "project:1" }

    await dispatcher.dispatch("automation.item.list", { enabled: true, scope, limit: 1 }, { source: "mcp-http" })

    expect(service.automationList).toHaveBeenCalledWith({ enabled: true, scope, limit: 1 })
  })

  it("creates updates enables disables and deletes automations through the service", async () => {
    const { dispatcher, service } = createHarness()
    vi.mocked(service.automationCreate).mockResolvedValueOnce({ ...baseItem, id: "automation:new" })
    vi.mocked(service.automationUpdate).mockResolvedValueOnce({ ...baseItem, name: "Updated automation" })
    vi.mocked(service.automationEnable).mockResolvedValueOnce({ ...baseItem, enabled: true })
    vi.mocked(service.automationDisable).mockResolvedValueOnce({ ...baseItem, enabled: false })
    vi.mocked(service.automationDelete).mockResolvedValueOnce({ deleted: true })

    const createInput = {
      name: "New automation",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
      executor: { type: "builtin.command", config: { command: "echo ok" } },
    }

    const created = await dispatcher.dispatch("automation.item.create", createInput, { source: "mcp-http" })
    const updated = await dispatcher.dispatch("automation.item.update", {
      automationId: "automation:1",
      patch: { name: "Updated automation" },
    }, { source: "mcp-http" })
    const enabled = await dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" })
    const disabled = await dispatcher.dispatch("automation.item.disable", { automationId: "automation:1" }, { source: "mcp-http" })
    const deleted = await dispatcher.dispatch("automation.item.delete", { automationId: "automation:1" }, { source: "mcp-http" })

    expect(service.automationCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "New automation",
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    }))
    expect(service.automationUpdate).toHaveBeenCalledWith("automation:1", { name: "Updated automation" })
    expect(service.automationEnable).toHaveBeenCalledWith("automation:1")
    expect(service.automationDisable).toHaveBeenCalledWith("automation:1")
    expect(service.automationDelete).toHaveBeenCalledWith("automation:1")
    expect(JSON.stringify([created, updated, enabled, disabled, deleted])).not.toContain("echo ok")
  })

  it("rejects unknown trigger and executor types before persistence", async () => {
    const { dispatcher, service } = createHarness()

    await expect(dispatcher.dispatch("automation.item.create", {
      name: "Broken trigger",
      scope: { type: "global" },
      trigger: { type: "builtin.missing-trigger", config: {} },
      executor: { type: "builtin.command", config: { command: "echo ok" } },
    }, { source: "mcp-http" })).rejects.toThrow('Automation trigger "builtin.missing-trigger" is not registered')

    await expect(dispatcher.dispatch("automation.item.create", {
      name: "Broken executor",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
      executor: { type: "builtin.missing-executor", config: {} },
    }, { source: "mcp-http" })).rejects.toThrow('Task action "builtin.missing-executor" is not registered')

    expect(service.automationCreate).not.toHaveBeenCalled()
  })

  it("runs stops lists runs and inspects runtime without exposing raw logs", async () => {
    const { dispatcher, service } = createHarness()
    vi.mocked(service.runAutomationNow).mockResolvedValueOnce(baseRun)
    vi.mocked(service.stopRun).mockResolvedValueOnce({ stopped: false, stopRequested: true })

    const run = await dispatcher.dispatch("automation.run.execute", { automationId: "automation:1" }, { source: "mcp-http" })
    const stopped = await dispatcher.dispatch("automation.run.disable", { runId: "automation-run:1" }, { source: "mcp-http" })
    const runs = await dispatcher.dispatch("automation.run.list", { automationId: "automation:1" }, { source: "mcp-http" })
    const runtime = await dispatcher.dispatch("automation.runtime.inspect", {}, { source: "mcp-http" })

    expect(service.runAutomationNow).toHaveBeenCalledWith("automation:1")
    expect(service.stopRun).toHaveBeenCalledWith("automation-run:1")
    expect(stopped).toEqual({ ok: true, data: { stopped: false, stopRequested: true } })
    expect(runs).toMatchObject({ ok: true, total: 1 })
    expect(runtime).toMatchObject({
      ok: true,
      data: {
        runningItemIds: ["automation:1"],
        scheduledItemIds: ["automation:1"],
        items: [expect.objectContaining({ id: "automation:1", running: true, scheduled: true })],
      },
    })
    expect(service.automationList).not.toHaveBeenCalled()
    expect(service.automationGet).toHaveBeenCalledWith("automation:1")
    expect(JSON.stringify([run, runs, runtime])).not.toContain("private prompt")
    expect(JSON.stringify([run, runs, runtime])).not.toContain("private output")
  })

  it("fails stop run requests when the run is not active or missing", async () => {
    const { auditSink, dispatcher, service } = createHarness()
    vi.mocked(service.stopRun).mockResolvedValueOnce({ stopped: false })

    await expect(dispatcher.dispatch("automation.run.disable", { runId: "automation-run:missing" }, { source: "mcp-http" }))
      .rejects
      .toThrow('Automation run "automation-run:missing" was not active or was not found')

    expect(service.stopRun).toHaveBeenCalledWith("automation-run:missing")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      resource: "automation:automation-run:missing",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        automationAction: "automation.run.disable",
        runId: "automation-run:missing",
        errorName: "Error",
      }),
    }))
  })

  it("fails manual run execution when the automation is missing or no run starts", async () => {
    const { auditSink, dispatcher, service } = createHarness()
    vi.mocked(service.runAutomationNow).mockResolvedValueOnce(null)

    await expect(dispatcher.dispatch("automation.run.execute", { automationId: "automation:missing" }, { source: "mcp-http" }))
      .rejects
      .toThrow('Automation "automation:missing" was not found or did not start')

    expect(service.runAutomationNow).toHaveBeenCalledWith("automation:missing")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      resource: "automation:automation:missing",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        automationAction: "automation.run.execute",
        automationId: "automation:missing",
        errorName: "Error",
      }),
    }))
  })

  it("redacts sensitive run summaries and whitelists public metrics", async () => {
    const { dispatcher, service } = createHarness()
    const sensitiveRun: AutomationRun = {
      ...baseRun,
      error: "failed Authorization: Bearer sk-error-token",
      result: {
        ...baseRun.result,
        status: "success",
        summary: "Authorization: Bearer sk-live-token token=secret-token apiKey=sk-api-private at /Users/liyang/private/file.txt",
        metrics: {
          durationMs: 2000,
          exitCode: null,
          httpStatus: 200,
          token: "secret-metric",
        } as unknown as NonNullable<AutomationRun["result"]>["metrics"],
      },
    }
    vi.mocked(service.runAutomationNow).mockResolvedValueOnce(sensitiveRun)
    vi.mocked(service.automationRunList).mockResolvedValueOnce([sensitiveRun])

    const run = await dispatcher.dispatch("automation.run.execute", { automationId: "automation:1" }, { source: "mcp-http" })
    const runs = await dispatcher.dispatch("automation.run.list", { automationId: "automation:1" }, { source: "mcp-http" })
    const serialized = JSON.stringify([run, runs])

    expect(serialized).not.toContain("sk-live-token")
    expect(serialized).not.toContain("secret-token")
    expect(serialized).not.toContain("sk-api-private")
    expect(serialized).not.toContain("sk-error-token")
    expect(serialized).not.toContain("secret-metric")
    expect(serialized).not.toContain("/Users/liyang/private/file.txt")
    expect(serialized).toContain("durationMs")
    expect(serialized).toContain("httpStatus")
  })

  it("checks permission and audits allowed automation mutations", async () => {
    const { auditSink, dispatcher, permissionGuard, service } = createHarness()
    vi.mocked(service.automationDisable).mockResolvedValueOnce({ ...baseItem, enabled: false })

    await dispatcher.dispatch("automation.item.disable", { automationId: "automation:1" }, {
      source: "mcp-http",
      actor: mcpClientActorForSource("mcp-http"),
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "automation.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "automation:automation:1",
      context: expect.objectContaining({
        source: "mcp-http",
        automationAction: "automation.item.disable",
        automationId: "automation:1",
      }),
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "automation:automation:1",
      outcome: "allowed",
    }))
  })

  it("denies automation mutations before service calls", async () => {
    const { actions, triggers } = registries()
    const service = serviceMock()
    const permissionGuard = permissionGuardMock({ allowed: false, reason: "blocked", policyId: "test-policy" })
    const auditSink = auditSinkMock()
    const dispatcher = createAutomationCapabilityDispatcher({
      service,
      accountService: accountServiceMock(),
      triggers,
      actions,
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" }))
      .rejects.toThrow("blocked")

    expect(service.automationEnable).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      outcome: "denied",
      metadata: expect.objectContaining({ reason: "blocked", policyId: "test-policy" }),
    }))
  })

  it("sanitizes external run ids before permission checks and denied audits", async () => {
    const { actions, triggers } = registries()
    const service = serviceMock()
    const permissionGuard = permissionGuardMock({ allowed: false, reason: "blocked", policyId: "test-policy" })
    const auditSink = auditSinkMock()
    const dispatcher = createAutomationCapabilityDispatcher({
      service,
      accountService: accountServiceMock(),
      triggers,
      actions,
      permissionGuard,
      auditSink,
    })
    const unsafeRunId = "run-token=secret-value-/Users/example/private"

    await expect(dispatcher.dispatch("automation.run.disable", { runId: unsafeRunId }, { source: "mcp-http" }))
      .rejects.toThrow("blocked")

    expect(service.stopRun).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      resource: "automation:automation.run.disable",
      context: expect.not.objectContaining({ runId: unsafeRunId }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      outcome: "denied",
      resource: "automation:automation.run.disable",
      metadata: expect.not.objectContaining({ runId: unsafeRunId }),
    }))
    const serialized = JSON.stringify([
      vi.mocked(permissionGuard.check).mock.calls,
      vi.mocked(auditSink.record).mock.calls,
    ])
    expect(serialized).not.toContain("secret-value")
    expect(serialized).not.toContain("/Users/example/private")
  })

  it("audits permission guard failures before automation mutations", async () => {
    const { actions, triggers } = registries()
    const service = serviceMock()
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => {
        throw new Error("guard failed token=secret-value at /Users/liyang/private")
      }),
    }
    const auditSink = auditSinkMock()
    const dispatcher = createAutomationCapabilityDispatcher({
      service,
      accountService: accountServiceMock(),
      triggers,
      actions,
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" }))
      .rejects.toThrow("guard failed token=secret-value at /Users/liyang/private")

    expect(service.automationEnable).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        automationAction: "automation.item.enable",
        automationId: "automation:1",
        reason: "permission-check-error",
        errorName: "Error",
        errorLength: "Error: guard failed token=secret-value at /Users/liyang/private".length,
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret-value")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("/Users/liyang/private")
  })

  it("audits failed mutations without raw error text", async () => {
    const { auditSink, dispatcher, service } = createHarness()
    vi.mocked(service.automationEnable).mockRejectedValueOnce(new Error("failed with private prompt"))

    await expect(dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" }))
      .rejects.toThrow("failed with private prompt")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      outcome: "failed",
      metadata: expect.objectContaining({
        errorName: "Error",
        errorLength: "Error: failed with private prompt".length,
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("private prompt")
  })

  it("logs public summary fallback when trigger or executor definitions are missing", () => {
    const logger = { warn: vi.fn() }
    const summary = toPublicAutomationItemSummary(baseItem, new AutomationTriggerRegistry(), new MainActionRegistry(), logger)

    expect(summary.trigger).toEqual({ type: baseItem.trigger.type })
    expect(summary.executor).toEqual({ type: baseItem.executor.type })
    expect(logger.warn).toHaveBeenCalledWith("Automation trigger summary fallback.", expect.objectContaining({
      triggerType: baseItem.trigger.type,
      boundary: "automation-dispatcher.triggerSummary",
    }))
    expect(logger.warn).toHaveBeenCalledWith("Automation executor summary fallback.", expect.objectContaining({
      executorType: baseItem.executor.type,
      boundary: "automation-dispatcher.executorSummary",
    }))
  })
})
