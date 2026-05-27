import { describe, expect, it } from "vitest"
import {
  allSchemas,
  auditSchema,
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  agentEventsSchema,
  conversationsSchema,
  coreConfigSchema,
  coreIdentitySchema,
  opsDiagnosticsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  relayBindingsSchema,
  relayRunsSchema,
  repoPendingPushesSchema,
  repoRepositoriesSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  secretsSchema,
  taskSchedulerRunsSchema,
  taskSchedulerTasksSchema,
  webhookConfigSchema,
  webhookRunsSchema,
} from "../index"

describe("Phase 0.2 schema registration (T2.8 + T2.9)", () => {
  it("allSchemas exposes runtime namespaces", () => {
    const names = allSchemas.map((s) => s.name).sort()
    expect(names).toEqual(
      [
        "audit",
        "agent.command-settings",
        "agent.commands",
        "agent.compress_state",
        "agent.events",
        "cheat-code.states",
        "conversations",
        "core.config",
        "core.identity",
        "ops.diagnostics",
        "outbox",
        "projects",
        "providers",
        "relay.bindings",
        "relay.runs",
        "repo.pending-pushes",
        "repo.repositories",
        "run_as.config",
        "run_as.preflight",
        "secrets",
        "task-scheduler.runs",
        "task-scheduler.tasks",
        "webhook.config",
        "webhook.runs",
        "workflows",
      ].sort(),
    )
  })

  it("each schema declares a positive currentVersion and migrations consistent with it", () => {
    for (const schema of allSchemas) {
      expect(schema.currentVersion, `${schema.name}.currentVersion`).toBeGreaterThan(0)
      // Migrations array `to` values must never exceed currentVersion.
      for (const m of schema.migrations) {
        expect(m.to, `${schema.name} migration ${m.from}->${m.to}`).toBeLessThanOrEqual(schema.currentVersion)
      }
    }
  })

  it("backend kind matches SPEC §5 namespace strategy", () => {
    expect(coreConfigSchema.backend).toBe("json")
    expect(coreIdentitySchema.backend).toBe("json")
    expect(secretsSchema.backend).toBe("encrypted-json")
    expect(providersSchema.backend).toBe("json")
    expect(projectsSchema.backend).toBe("json")
    expect(conversationsSchema.backend).toBe("sqlite")
    expect(auditSchema.backend).toBe("jsonl")
    expect(outboxSchema.backend).toBe("sqlite")
    expect(repoPendingPushesSchema.backend).toBe("sqlite")
    expect(repoRepositoriesSchema.backend).toBe("json")
    expect(taskSchedulerTasksSchema.backend).toBe("json")
    expect(taskSchedulerRunsSchema.backend).toBe("json")
    expect(runAsConfigSchema.backend).toBe("json")
    expect(runAsPreflightSchema.backend).toBe("jsonl")
    expect(webhookConfigSchema.backend).toBe("encrypted-json")
    expect(webhookRunsSchema.backend).toBe("sqlite")
    expect(relayBindingsSchema.backend).toBe("json")
    expect(relayRunsSchema.backend).toBe("sqlite")
    expect(agentCompressStateSchema.backend).toBe("json")
    expect(agentEventsSchema.backend).toBe("sqlite")
    expect(opsDiagnosticsSchema.backend).toBe("jsonl")
  })

  it("encrypted flag is set only on secret-bearing namespaces", () => {
    for (const schema of allSchemas) {
      const expected = schema.name === "secrets"
        || schema.name === "webhook.config"
      expect(schema.encrypted ?? false, schema.name).toBe(expected)
    }
  })

  it("validate returns false for empty objects across every placeholder", () => {
    for (const schema of allSchemas) {
      expect(schema.validate({}), `${schema.name} should reject {}`).toBe(false)
    }
  })

  it("validate accepts a minimal valid record for each namespace", () => {
    expect(
      coreConfigSchema.validate({
        schemaVersion: 1,
        activeRepoUuid: null,
        repositories: [],
        global: {},
      }),
    ).toBe(true)
    expect(
      coreIdentitySchema.validate({
        schemaVersion: 2,
        userId: "abc",
      }),
    ).toBe(true)
    expect(
      secretsSchema.validate({
        id: "k1",
        schemaVersion: 1,
        kind: "api-key",
      }),
    ).toBe(true)
    expect(
      providersSchema.validate({
        id: "anthropic",
        schemaVersion: 1,
        scope: "global",
        kind: "anthropic",
      }),
    ).toBe(true)
    expect(
      projectsSchema.validate({
        id: "proj-1",
        schemaVersion: 1,
        name: "demo",
      }),
    ).toBe(true)
    expect(
      conversationsSchema.validate({
        id: "conv-1",
        schemaVersion: 1,
        projectId: "proj-1",
        sessionKey: "external:u1",
        channelKey: "external:u1",
        workspaceKey: "workspace:abc",
        workspacePath: "/tmp/workspaces/backend",
        history: [
          { role: "user", content: "hi", timestamp: "2026-04-25T00:00:00Z" },
        ],
        active: true,
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(true)
    expect(
      conversationsSchema.validate({
        id: "conv-1",
        schemaVersion: 1,
        projectId: "project-1",
        sessionKey: "local:renderer",
        providerId: "anthropic",
        sdkSessionId: "sdk-session-1",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        costUsd: 0.01,
        history: [],
        active: true,
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
      }),
    ).toBe(true)
    expect(
      agentEventsSchema.validate({
        id: "event-1",
        schemaVersion: 1,
        projectId: "project-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        eventType: "assistant",
        payload: { type: "assistant" },
        createdAt: "2026-05-13T00:00:00.000Z",
      }),
    ).toBe(true)
    expect(
      auditSchema.validate({
        id: "evt-1",
        schemaVersion: 1,
        action: "fs.write",
        actor: { kind: "user" },
        resource: { type: "file", id: "/tmp/x", projectId: "proj-1" },
        outcome: "allowed",
        timestamp: "2026-04-25T00:00:00Z",
      }),
    ).toBe(true)
    expect(
      outboxSchema.validate({
        id: "job-1",
        schemaVersion: 1,
        projectId: "proj-1",
        destination: { platform: "external", sessionKey: "external:u1" },
        payload: { kind: "text", content: "done" },
        attempts: 0,
        status: "pending",
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(true)
    expect(
      outboxSchema.validate({
        id: "job-2",
        schemaVersion: 1,
        projectId: "proj-1",
        destination: { platform: "local-renderer", sessionKey: "local:u1" },
        payload: { kind: "event", content: "done" },
        attempts: 1,
        status: "sent",
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(true)
    expect(
      repoRepositoriesSchema.validate({
        id: "1",
        uuid: "abc",
        schemaVersion: 1,
      }),
    ).toBe(true)
    expect(
      repoPendingPushesSchema.validate({
        schemaVersion: 1,
        id: "p1",
        repositoryUuid: "abc",
        action: "push",
        commitHash: null,
        targetId: "main",
        title: null,
        createdAt: "2026-04-25",
        retryCount: 0,
        lastError: null,
      }),
    ).toBe(true)
    expect(
      taskSchedulerTasksSchema.validate({
        id: "task:1",
        schemaVersion: 2,
        name: "Nightly backup",
        scope: { type: "global" },
        trigger: { type: "builtin.cron", config: { expr: "0 2 * * *" } },
        action: {
          type: "builtin.command",
          config: {
            command: "echo backup",
            shell: "posix",
            timeoutMins: 30,
          },
        },
        enabled: true,
        missedRunPolicy: "skip",
        overlapPolicy: "skip",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
        runCount: 0,
      }),
    ).toBe(true)
    expect(
      taskSchedulerRunsSchema.validate({
        id: "run:1",
        schemaVersion: 2,
        taskId: "task:1",
        startedAt: "2026-04-29T00:00:00.000Z",
        finishedAt: "2026-04-29T00:00:01.000Z",
        status: "success",
        result: {
          status: "success",
          summary: "ok",
          metrics: { exitCode: 0 },
        },
        triggeredBy: "manual",
      }),
    ).toBe(true)
    expect(
      agentCommandsSchema.validate({
        id: "agent-command:1",
        schemaVersion: 1,
        projectId: "proj-1",
        name: "review",
        kind: "prompt",
        prompt: "Review {{args}}",
        enabled: true,
        source: "runtime",
        adminOnly: false,
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(true)
    expect(
      agentCommandSettingsSchema.validate({
        id: "agent-command-settings:proj-1",
        schemaVersion: 1,
        projectId: "proj-1",
        agentNativeSlashAllowlist: ["help"],
        remoteAgentNativeSlashAllowlist: [],
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(true)
  })

  it("business schemas reject missing project/session/status/outcome fields", () => {
    expect(
      conversationsSchema.validate({
        id: "conv-1",
        schemaVersion: 1,
        projectId: "proj-1",
        history: [],
        active: true,
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(false)
    expect(
      auditSchema.validate({
        id: "evt-1",
        schemaVersion: 1,
        action: "agent.spawn",
        actor: { kind: "agent", id: "a1" },
        resource: { type: "process" },
        outcome: "unknown",
        timestamp: "2026-04-25T00:00:00Z",
      }),
    ).toBe(false)
    expect(
      outboxSchema.validate({
        id: "job-1",
        schemaVersion: 1,
        destination: { platform: "external" },
        payload: { kind: "text" },
        attempts: 0,
        status: "pending",
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(false)
  })

  it("conversations schema rejects invalid sdk usage and cost values", () => {
    const baseConversation = {
      id: "conv-1",
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "local:renderer",
      history: [],
      active: true,
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    }

    expect(conversationsSchema.validate({ ...baseConversation, usage: [] })).toBe(false)
    expect(conversationsSchema.validate({ ...baseConversation, usage: { inputTokens: "1" } })).toBe(false)
    expect(conversationsSchema.validate({ ...baseConversation, usage: { inputTokens: NaN } })).toBe(false)
    expect(conversationsSchema.validate({ ...baseConversation, usage: { inputTokens: -1 } })).toBe(false)
    expect(conversationsSchema.validate({ ...baseConversation, costUsd: Infinity })).toBe(false)
    expect(conversationsSchema.validate({ ...baseConversation, costUsd: -0.01 })).toBe(false)
  })
})
