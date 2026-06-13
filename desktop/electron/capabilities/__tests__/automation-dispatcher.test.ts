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

const commandActionSchema = z.object({ command: z.string().min(1) })
type CommandActionConfig = z.infer<typeof commandActionSchema>

function commandAction(): MainActionDefinition<CommandActionConfig> {
  return {
    manifest: {
      id: "builtin.command",
      title: "Command",
      permissions: ["shell.exec"],
      defaultConfig: { command: "date" },
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
  actions.register(agentAction())
  return { triggers, actions }
}

function serviceMock() {
  return {
    automationList: vi.fn(async () => [baseItem, { ...baseItem, id: "automation:2", enabled: false }]),
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

function createHarness() {
  const { triggers, actions } = registries()
  const service = serviceMock()
  const permissionGuard = permissionGuardMock()
  const auditSink = auditSinkMock()
  const dispatcher = createAutomationCapabilityDispatcher({
    service,
    triggers,
    actions,
    permissionGuard,
    auditSink,
  })
  return { actions, auditSink, dispatcher, permissionGuard, service, triggers }
}

describe("automation capability dispatcher", () => {
  it("lists trigger and executor descriptors from registries", async () => {
    const { dispatcher } = createHarness()

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
      total: 2,
      data: [
        expect.objectContaining({ type: "builtin.command", title: "Command", permissions: ["shell.exec"] }),
        expect.objectContaining({ type: "builtin.agent", title: "Agent", permissions: ["agent.spawn"] }),
      ],
    })
    expect(JSON.stringify(result)).not.toContain("private prompt")
  })

  it("lists and gets public item summaries without raw configs", async () => {
    const { dispatcher, permissionGuard } = createHarness()

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
    expect(permissionGuard.check).not.toHaveBeenCalled()
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
      executor: { type: "builtin.command", config: { command: "echo ok" } },
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
    vi.mocked(service.stopRun).mockResolvedValueOnce({ stopped: false, alreadyFinished: true })

    const run = await dispatcher.dispatch("automation.run.execute", { automationId: "automation:1" }, { source: "mcp-http" })
    const stopped = await dispatcher.dispatch("automation.run.disable", { runId: "automation-run:1" }, { source: "mcp-http" })
    const runs = await dispatcher.dispatch("automation.run.list", { automationId: "automation:1" }, { source: "mcp-http" })
    const runtime = await dispatcher.dispatch("automation.runtime.inspect", {}, { source: "mcp-http" })

    expect(service.runAutomationNow).toHaveBeenCalledWith("automation:1")
    expect(service.stopRun).toHaveBeenCalledWith("automation-run:1")
    expect(stopped).toEqual({ ok: true, data: { stopped: false, alreadyFinished: true } })
    expect(runs).toMatchObject({ ok: true, total: 1 })
    expect(runtime).toMatchObject({
      ok: true,
      data: {
        runningItemIds: ["automation:1"],
        scheduledItemIds: ["automation:1"],
        items: [expect.objectContaining({ id: "automation:1", running: true, scheduled: true })],
      },
    })
    expect(JSON.stringify([run, runs, runtime])).not.toContain("private prompt")
    expect(JSON.stringify([run, runs, runtime])).not.toContain("private output")
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
    const dispatcher = createAutomationCapabilityDispatcher({ service, triggers, actions, permissionGuard, auditSink })

    await expect(dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" }))
      .rejects.toThrow("blocked")

    expect(service.automationEnable).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.mutate",
      outcome: "denied",
      metadata: expect.objectContaining({ reason: "blocked", policyId: "test-policy" }),
    }))
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
})
