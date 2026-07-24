import { describe, expect, it } from "vitest"
import {
  allSchemas,
  auditSchema,
  agentArtifactsSchema,
  agentCompressStateSchema,
  agentCommandSettingsSchema,
  agentCommandsSchema,
  agentEventsSchema,
  agentPersonaItemsSchema,
  agentPersonaRemoteCacheSchema,
  agentPersonaSettingsSchema,
  agentUsageSchema,
  automationItemsSchema,
  automationRunsSchema,
  conversationsSchema,
  coreConfigSchema,
  coreIdentitySchema,
  driveSyncBaselineSchema,
  driveSyncBindingsSchema,
  driveSyncConflictsSchema,
  driveSyncOperationsSchema,
  driveSyncStateSchema,
  opsDiagnosticsSchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  quickInputItemsSchema,
  quickInputSettingsSchema,
  relayBindingsSchema,
  relayRunsSchema,
  repoPendingPushesSchema,
  repoRepositoriesSchema,
  runAsConfigSchema,
  runAsPreflightSchema,
  secretsItemsSchema,
  secretsSchema,
  secretsSettingsSchema,
  soundNotifierSettingsSchemaDefinition,
  systemNotifierSettingsSchemaDefinition,
  runMigrations,
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
        "agent.artifacts",
        "agent.events",
        "agent.usage",
        "app.agent-personas.items",
        "app.agent-personas.remote-cache",
        "app.agent-personas.settings",
        "app.quick-input.items",
        "app.quick-input.settings",
        "app.secrets.items",
        "app.secrets.settings",
        "app.sound-notifier.settings",
        "app.system-notifier.settings",
        "app.terminal.blocks",
        "app.terminal.command-bodies",
        "app.terminal.commands",
        "app.terminal.delete-intents",
        "app.terminal.domain-state",
        "app.terminal.group-launch-bodies",
        "app.terminal.groups",
        "app.terminal.idempotency",
        "app.terminal.launch-bodies",
        "app.terminal.operations",
        "app.terminal.sessions",
        "automation.items",
        "automation.runs",
        "cheat-code.states",
        "conversations",
        "core.config",
        "core.identity",
        "drive.sync.bindings",
        "drive.sync.baseline",
        "drive.sync.conflicts",
        "drive.sync.operations",
        "drive.sync.state",
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
        "webhook.config",
        "webhook.runs",
        "workflow.migration-state",
        "workflow.param-presets",
        "workflow.share-state",
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
    expect(secretsItemsSchema.backend).toBe("encrypted-json")
    expect(secretsSettingsSchema.backend).toBe("json")
    expect(providersSchema.backend).toBe("json")
    expect(projectsSchema.backend).toBe("json")
    expect(conversationsSchema.backend).toBe("sqlite")
    expect(auditSchema.backend).toBe("jsonl")
    expect(outboxSchema.backend).toBe("sqlite")
    expect(repoPendingPushesSchema.backend).toBe("sqlite")
    expect(repoRepositoriesSchema.backend).toBe("json")
    expect(automationItemsSchema.backend).toBe("json")
    expect(automationRunsSchema.backend).toBe("json")
    expect(runAsConfigSchema.backend).toBe("json")
    expect(runAsPreflightSchema.backend).toBe("jsonl")
    expect(webhookConfigSchema.backend).toBe("encrypted-json")
    expect(webhookRunsSchema.backend).toBe("sqlite")
    expect(relayBindingsSchema.backend).toBe("json")
    expect(relayRunsSchema.backend).toBe("sqlite")
    expect(agentArtifactsSchema.backend).toBe("sqlite")
    expect(agentCompressStateSchema.backend).toBe("json")
    expect(agentEventsSchema.backend).toBe("sqlite")
    expect(agentUsageSchema.backend).toBe("sqlite")
    expect(agentPersonaItemsSchema.backend).toBe("sqlite")
    expect(agentPersonaRemoteCacheSchema.backend).toBe("json")
    expect(agentPersonaSettingsSchema.backend).toBe("json")
    expect(opsDiagnosticsSchema.backend).toBe("jsonl")
    expect(quickInputItemsSchema.backend).toBe("sqlite")
    expect(quickInputSettingsSchema.backend).toBe("json")
    expect(soundNotifierSettingsSchemaDefinition.backend).toBe("json")
    expect(systemNotifierSettingsSchemaDefinition.backend).toBe("json")
    expect(driveSyncBindingsSchema.backend).toBe("sqlite")
    expect(driveSyncBaselineSchema.backend).toBe("sqlite")
    expect(driveSyncOperationsSchema.backend).toBe("sqlite")
    expect(driveSyncConflictsSchema.backend).toBe("sqlite")
    expect(driveSyncStateSchema.backend).toBe("json")
  })

  it("encrypted flag is set only on secret-bearing namespaces", () => {
    for (const schema of allSchemas) {
      const expected = schema.name === "secrets"
        || schema.name === "app.secrets.items"
        || schema.name === "app.terminal.command-bodies"
        || schema.name === "app.terminal.group-launch-bodies"
        || schema.name === "app.terminal.launch-bodies"
        || schema.name === "webhook.config"
      expect(schema.encrypted ?? false, schema.name).toBe(expected)
    }
  })

  it("validate returns false for empty objects across every placeholder", () => {
    for (const schema of allSchemas) {
      expect(schema.validate({}), `${schema.name} should reject {}`).toBe(false)
    }
  })

  it("workflows schema accepts option params", () => {
    const workflows = allSchemas.find((schema) => schema.name === "workflows")
    expect(workflows).toBeDefined()
    expect(workflows?.validate({
      id: "workflow-1",
      schemaVersion: 1,
      name: "Workflow",
      version: "v1",
      createdAt: 1,
      updatedAt: 1,
      params: [{
        name: "report_type",
        type: "option",
        default: "周报",
        options: ["日报", "周报"],
        allowCustomOption: false,
      }],
      nodes: [],
      edges: [],
    })).toBe(true)
  })

  it("rejects invalid webhook numeric config records", () => {
    const validWebhookConfig = {
      id: "webhook:default",
      schemaVersion: 1,
      enabled: false,
      bindAddress: "127.0.0.1",
      preferredPort: 4567,
      assignedPort: 4568,
      path: "/hook",
      token: "token",
      maxBodyBytes: 256 * 1024,
      rateLimitPerMinute: 60,
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
    }

    expect(webhookConfigSchema.validate(validWebhookConfig)).toBe(true)
    expect(webhookConfigSchema.validate({ ...validWebhookConfig, preferredPort: -1 })).toBe(false)
    expect(webhookConfigSchema.validate({ ...validWebhookConfig, assignedPort: 0 })).toBe(false)
    expect(webhookConfigSchema.validate({ ...validWebhookConfig, maxBodyBytes: 0 })).toBe(false)
    expect(webhookConfigSchema.validate({ ...validWebhookConfig, rateLimitPerMinute: 0 })).toBe(false)
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
      quickInputItemsSchema.validate({
        id: "quick-1",
        schemaVersion: 1,
        content: "给个结论",
        sortOrder: 10,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
      }),
    ).toBe(true)
    expect(
      agentPersonaItemsSchema.validate({
        id: "persona-1",
        schemaVersion: 1,
        name: "产品顾问",
        description: "整理产品判断和下一步。",
        systemPrompt: "你是产品顾问，先给结论，再列原因。",
        providerModel: null,
        source: "user",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      }),
    ).toBe(true)
    expect(
      quickInputSettingsSchema.validate({
        schemaVersion: 1,
        legacyConfigMigratedAt: null,
        defaultSeededVersion: null,
      }),
    ).toBe(true)
    expect(quickInputItemsSchema.validate({
      id: "bad",
      schemaVersion: 1,
      content: "",
      sortOrder: 0,
    })).toBe(false)
    expect(quickInputSettingsSchema.validate({ schemaVersion: 1 })).toBe(false)
    expect(
      soundNotifierSettingsSchemaDefinition.validate({
        schemaVersion: 3,
      }),
    ).toBe(true)
    expect(
      soundNotifierSettingsSchemaDefinition.validate({
        schemaVersion: 3,
        volume: 70,
      }),
    ).toBe(false)
    expect(systemNotifierSettingsSchemaDefinition.validate({
      schemaVersion: 1,
      enabled: true,
      silent: false,
    })).toBe(true)
    expect(systemNotifierSettingsSchemaDefinition.validate({
      schemaVersion: 1,
      enabled: true,
    })).toBe(false)
    expect(
      driveSyncBindingsSchema.validate({
        id: "binding-1",
        schemaVersion: 1,
        driveItemId: "drive-item-1",
        driveItemName: "产品文档",
        kind: "folder",
        drivePathHint: "/产品文档",
        localPath: "/Users/me/docs",
        status: "active",
        remoteCursor: "42",
        lastSyncedAt: null,
        lastError: null,
        excludeRules: {
          forced: [".git/**"],
          defaults: ["node_modules/**"],
          importedGitignore: [],
          user: ["private/**"],
        },
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      }),
    ).toBe(true)
    expect(driveSyncBindingsSchema.validate({
      id: "binding-1",
      schemaVersion: 1,
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      localPath: "",
      status: "active",
      excludeRules: {
        forced: [".git/**"],
        defaults: [],
        importedGitignore: [],
        user: [],
      },
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    })).toBe(false)
    expect(driveSyncBindingsSchema.validate({
      id: "binding-1",
      schemaVersion: 1,
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
      status: "active",
      remoteCursor: "42",
      lastSyncedAt: null,
      lastError: null,
      excludeRules: [".git/**"],
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    })).toBe(false)
    expect(
      driveSyncBaselineSchema.validate({
        id: "baseline-1",
        schemaVersion: 1,
        bindingId: "binding-1",
        relativePath: "docs/spec.md",
        kind: "file",
        remoteItemId: "drive-item-1",
        remoteVersionId: "version-1",
        remoteEtag: "etag-1",
        localSize: 42,
        localMtimeMs: 1_798_000_000_000,
        localHash: "sha256:abc",
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      }),
    ).toBe(true)
    expect(driveSyncBaselineSchema.validate({
      id: "baseline-1",
      schemaVersion: 1,
      bindingId: "binding-1",
      relativePath: "../secret.md",
      kind: "file",
      remoteItemId: "drive-item-1",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      lastSyncedAt: "2026-06-28T00:00:00.000Z",
      deletedAt: null,
    })).toBe(false)
    expect(
      driveSyncOperationsSchema.validate({
        id: "operation-1",
        schemaVersion: 1,
        bindingId: "binding-1",
        kind: "download",
        status: "running",
        driveItemId: "drive-item-1",
        relativePath: "spec.md",
        localPath: "/Users/me/docs/spec.md",
        remotePathHint: "/产品文档/spec.md",
        message: null,
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        startedAt: "2026-06-28T00:00:01.000Z",
        completedAt: null,
      }),
    ).toBe(true)
    expect(driveSyncOperationsSchema.validate({
      id: "operation-1",
      schemaVersion: 1,
      bindingId: "binding-1",
      kind: "download",
      status: "maybe",
      relativePath: "spec.md",
      message: null,
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    })).toBe(false)
    expect(
      driveSyncConflictsSchema.validate({
        id: "conflict-1",
        schemaVersion: 1,
        bindingId: "binding-1",
        driveItemId: "drive-item-1",
        relativePath: "spec.md",
        localPath: "/Users/me/docs/spec.md",
        remotePathHint: "/产品文档/spec.md",
        type: "both_modified",
        status: "open",
        localSnapshot: { mtimeMs: 1000, size: 10 },
        remoteSnapshot: { sequence: "43", versionId: "version-1" },
        resolution: null,
        createdAt: "2026-06-28T00:00:00.000Z",
        resolvedAt: null,
      }),
    ).toBe(true)
    expect(driveSyncConflictsSchema.validate({
      id: "conflict-1",
      schemaVersion: 1,
      bindingId: "binding-1",
      relativePath: "spec.md",
      type: "both_modified",
      status: "open",
      resolution: "invented",
      createdAt: "2026-06-28T00:00:00.000Z",
      resolvedAt: null,
    })).toBe(false)
    expect(
      driveSyncStateSchema.validate({
        schemaVersion: 1,
        health: "idle",
        lastCursor: "42",
        lastStartedAt: null,
        lastStoppedAt: null,
        lastError: null,
        updatedAt: "2026-06-28T00:00:00.000Z",
      }),
    ).toBe(true)
    expect(driveSyncStateSchema.validate({ schemaVersion: 1, health: "invented" })).toBe(false)
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
      agentArtifactsSchema.validate({
        id: "artifact-1",
        schemaVersion: 1,
        projectId: "project-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        toolUseId: "toolu-1",
        toolName: "Read",
        kind: "image",
        mimeType: "image/png",
        byteSize: 68,
        sha256: "a".repeat(64),
        storagePath: "/tmp/synapse/agent-artifacts/project-1/conv-1/artifact-1.png",
        createdAt: "2026-07-03T00:00:00.000Z",
      }),
    ).toBe(true)
    expect(
      agentArtifactsSchema.validate({
        id: "artifact-1",
        schemaVersion: 1,
        projectId: "project-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        kind: "image",
        mimeType: "image/png",
        byteSize: 68,
        sha256: "a".repeat(64),
        storagePath: "/tmp/file.png",
        base64: "must-not-be-valid",
        createdAt: "2026-07-03T00:00:00.000Z",
      }),
    ).toBe(false)
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
      automationItemsSchema.validate({
        id: "automation:1",
        schemaVersion: 1,
        name: "Daily report",
        enabled: true,
        scope: { type: "global" },
        trigger: {
          type: "builtin.cron",
          config: { expr: "0 9 * * *", activeDays: [1, 2, 3, 4, 5] },
        },
        executor: {
          type: "builtin.command",
          config: { command: "echo ok", shell: "posix" },
        },
        policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        runCount: 0,
        configVersion: 0,
      }),
    ).toBe(true)
    expect(
      automationRunsSchema.validate({
        id: "automation-run:1",
        schemaVersion: 1,
        automationId: "automation:1",
        startedAt: "2026-06-03T00:00:00.000Z",
        status: "running",
        triggeredBy: "manual",
        triggerType: "builtin.cron",
        executorType: "builtin.command",
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
    expect(
      agentUsageSchema.validate({
        id: "usage-1",
        schemaVersion: 1,
        projectId: "proj-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        usage: {},
        usageSummary: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalTokens: 30,
        },
        createdAt: "2026-05-28T00:00:00Z",
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
    expect(conversationsSchema.validate({ ...baseConversation, titleSource: "manual" })).toBe(true)
    expect(conversationsSchema.validate({ ...baseConversation, titleSource: "inferred" })).toBe(false)
  })

  it("migrates Sound Notifier settings from v1 default preset settings to v3 empty settings", async () => {
    const migrated = await runMigrations({
      currentVersion: 1,
      targetVersion: soundNotifierSettingsSchemaDefinition.currentVersion,
      migrations: soundNotifierSettingsSchemaDefinition.migrations,
      namespace: soundNotifierSettingsSchemaDefinition.name,
      data: {
        schemaVersion: 1,
        enabled: false,
        selectedPresetId: "done",
        volume: 42,
      },
    })

    expect(migrated).toEqual({
      schemaVersion: 3,
    })
    expect(soundNotifierSettingsSchemaDefinition.validate(migrated)).toBe(true)
  })

  it("migrates Sound Notifier settings from v2 volume settings to v3 empty settings", async () => {
    const migrated = await runMigrations({
      currentVersion: 2,
      targetVersion: soundNotifierSettingsSchemaDefinition.currentVersion,
      migrations: soundNotifierSettingsSchemaDefinition.migrations,
      namespace: soundNotifierSettingsSchemaDefinition.name,
      data: {
        schemaVersion: 2,
        volume: 42,
      },
    })

    expect(migrated).toEqual({
      schemaVersion: 3,
    })
    expect(soundNotifierSettingsSchemaDefinition.validate(migrated)).toBe(true)
  })
})
