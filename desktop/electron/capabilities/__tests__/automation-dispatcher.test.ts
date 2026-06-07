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
})
