import { describe, expect, it } from "vitest"
import {
  allSchemas,
  auditSchema,
  connectorsSchema,
  conversationsSchema,
  coreConfigSchema,
  coreIdentitySchema,
  outboxSchema,
  projectsSchema,
  providersSchema,
  repoPendingPushesSchema,
  repoRepositoriesSchema,
  secretsSchema,
  scheduledHeartbeatSchema,
  scheduledJobsSchema,
  workspaceBindingsSchema,
} from "../index"

describe("Phase 0.2 schema registration (T2.8 + T2.9)", () => {
  it("allSchemas exposes runtime namespaces", () => {
    const names = allSchemas.map((s) => s.name).sort()
    expect(names).toEqual(
      [
        "audit",
        "connectors",
        "conversations",
        "core.config",
        "core.identity",
        "outbox",
        "projects",
        "providers",
        "repo.pending-pushes",
        "repo.repositories",
        "secrets",
        "scheduled.heartbeat",
        "scheduled.jobs",
        "workspace.bindings",
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
    expect(workspaceBindingsSchema.backend).toBe("json")
    expect(connectorsSchema.backend).toBe("json")
    expect(conversationsSchema.backend).toBe("sqlite")
    expect(auditSchema.backend).toBe("jsonl")
    expect(outboxSchema.backend).toBe("sqlite")
    expect(repoPendingPushesSchema.backend).toBe("sqlite")
    expect(repoRepositoriesSchema.backend).toBe("json")
    expect(scheduledJobsSchema.backend).toBe("json")
    expect(scheduledHeartbeatSchema.backend).toBe("json")
  })

  it("encrypted flag is set only on `secrets`", () => {
    for (const schema of allSchemas) {
      const expected = schema.name === "secrets"
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
      connectorsSchema.validate({
        id: "c1",
        schemaVersion: 1,
        projectId: "proj-1",
        platform: "feishu",
        status: "connected",
        allowlist: { mode: "users", userIds: ["u1"], adminIds: ["u1"] },
        sessionKeyPolicy: { mode: "per-user" },
        workspaceConfig: { enabled: true, baseDir: "/tmp/workspaces" },
      }),
    ).toBe(true)
    expect(
      workspaceBindingsSchema.validate({
        id: "wb-1",
        schemaVersion: 1,
        projectId: "proj-1",
        scope: "project",
        platform: "feishu",
        channelKey: "feishu:oc_group",
        workspacePath: "/tmp/workspaces/backend",
        boundAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(true)
    expect(
      conversationsSchema.validate({
        id: "conv-1",
        schemaVersion: 1,
        projectId: "proj-1",
        sessionKey: "feishu:u1",
        channelKey: "feishu:u1",
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
        destination: { platform: "feishu", sessionKey: "feishu:u1" },
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
      scheduledJobsSchema.validate({
        id: "scheduled:1",
        schemaVersion: 1,
        projectId: "proj-1",
        platform: "feishu",
        connectorId: "feishu:proj-1",
        sessionKey: "feishu:oc_group:ou_user",
        kind: "prompt",
        cronExpr: "*/30 * * * *",
        prompt: "check",
        enabled: true,
        silent: false,
        mute: false,
        sessionMode: "reuse",
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
        runCount: 0,
      }),
    ).toBe(true)
    expect(
      scheduledHeartbeatSchema.validate({
        id: "heartbeat:1",
        schemaVersion: 1,
        projectId: "proj-1",
        platform: "feishu",
        connectorId: "feishu:proj-1",
        sessionKey: "feishu:oc_group:ou_user",
        enabled: true,
        paused: false,
        intervalMins: 60,
        prompt: "check",
        silent: false,
        mute: false,
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
        runCount: 0,
      }),
    ).toBe(true)
  })

  it("business schemas reject missing project/session/status/outcome fields", () => {
    expect(
      connectorsSchema.validate({
        id: "c1",
        schemaVersion: 1,
        platform: "feishu",
        status: "connected",
        allowlist: { mode: "all" },
        sessionKeyPolicy: { mode: "per-user" },
      }),
    ).toBe(false)
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
        destination: { platform: "feishu" },
        payload: { kind: "text" },
        attempts: 0,
        status: "pending",
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      }),
    ).toBe(false)
  })
})
