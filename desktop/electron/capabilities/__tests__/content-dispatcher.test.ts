import { beforeEach, describe, expect, it, vi } from "vitest"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

import type {
  SynapseContentDetail,
  SynapseContentMeta,
  SynapseContentType,
} from "../../../src/types/content"
import { ContentCapabilityError } from "../../services/content-capability-errors"
import { createContentCapabilityDispatcher } from "../content-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"

function contentMeta(overrides: Partial<SynapseContentMeta> = {}): SynapseContentMeta {
  return {
    id: "rule-1",
    type: "rule",
    title: "Rule",
    description: "Description",
    category: "coding",
    icon: "wrench",
    iconBg: "graphite",
    iconType: "icon",
    createdBy: "user-1",
    createdByDisplayName: "User",
    createdAt: "2026-05-21T00:00:00.000Z",
    modifiedBy: "user-1",
    modifiedByDisplayName: "User",
    modifiedAt: "2026-05-21T00:00:00.000Z",
    deleted: false,
    latestHistoryDirname: "20260521000000Z__user__abc123",
    attachmentCount: 0,
    source: "repository",
    isReadonly: false,
    ...overrides,
  } as SynapseContentMeta
}

function contentDetail(overrides: Partial<SynapseContentDetail> = {}): SynapseContentDetail {
  return {
    ...contentMeta(overrides),
    content: "# Content",
    attachments: [],
    ...overrides,
  } as SynapseContentDetail
}

function createDeps(options: {
  currentUserId?: string
  detail?: SynapseContentDetail
} = {}) {
  const active = [contentMeta()]
  const deleted = [contentMeta({ id: "deleted-rule", deleted: true })]
  const detail = options.detail ?? contentDetail()

  return {
    contentReader: {
      getDetail: vi.fn(async (_contentType: SynapseContentType, _contentId: string) => detail),
      listContent: vi.fn(async () => active),
      listDeletedContent: vi.fn(async () => deleted),
    },
    contentWriter: {
      createContent: vi.fn(async (request) => ({
        id: "created",
        type: request.contentType,
        status: "saved" as const,
        title: request.payload.title,
        latestHistoryDirname: "20260521010101Z__user__abc123",
        modifiedAt: "2026-05-21T01:01:01.000Z",
        pushed: false,
        pendingPushCount: 1,
        message: "已保存。",
      })),
      deleteContent: vi.fn(async (payload) => ({
        id: payload.id,
        type: payload.type,
        status: "saved" as const,
        title: "Rule",
        latestHistoryDirname: "20260521010101Z__user__abc123",
        modifiedAt: "2026-05-21T01:01:01.000Z",
        pushed: false,
        pendingPushCount: 1,
        message: "已保存。",
      })),
      updateContent: vi.fn(async (request) => ({
        id: request.payload.id,
        type: request.contentType,
        status: "saved" as const,
        title: request.payload.title,
        latestHistoryDirname: "20260521010101Z__user__abc123",
        modifiedAt: "2026-05-21T01:01:01.000Z",
        pushed: false,
        pendingPushCount: 1,
        message: "已保存。",
      })),
    },
    prepareIconImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    eventBus: {
      emit: vi.fn(),
    },
    readSkillDraftFromDirectory: vi.fn(async () => ({
      sourceDirectoryPath: "/tmp/demo-skill",
      mainFilePath: "/tmp/demo-skill/SKILL.md",
      content: [
        "---",
        "name: demo-skill",
        "title: Demo Skill",
        "category: development",
        "---",
        "# Demo Skill",
        "",
        "Do useful work.",
      ].join("\n"),
      metadata: {
        name: "demo-skill",
        title: "Demo Skill",
        category: "development",
      },
      files: [{
        originalName: "references/guide.md",
        size: 5,
        bytes: new Uint8Array([104, 101, 108, 108, 111]),
      }],
      publishFingerprint: "sha256:publish",
      sourceFingerprint: "sha256:source",
      sourceImportSummary: {
        controlFilesExcluded: [],
        fileCount: 2,
        hiddenEntryCount: 0,
        runtimeEnvExcluded: false,
        symlinkCount: 0,
        totalBytes: 128,
      },
    })),
    resolveCurrentIdentity: vi.fn(async () => ({ userId: options.currentUserId ?? "user-1" })),
  }
}

function createSecurityHarness(
  result: { allowed: true } | { allowed: false; reason: string; policyId?: string } = { allowed: true },
) {
  const auditSink = {
    clearForTests: vi.fn(),
    list: vi.fn(() => []),
    record: vi.fn(),
  }
  const permissionGuard = {
    check: vi.fn(async () => result),
    registerPolicy: vi.fn(),
  }
  const actor = { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
  return { actor, auditSink, permissionGuard }
}

describe("content capability dispatcher", () => {
  beforeEach(() => {
    logStoreMock.logger.info.mockClear()
    logStoreMock.logger.warn.mockClear()
  })

  it("describes content types", async () => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)

    const result = await dispatcher.dispatch("content.type.describe", { contentType: "skill" }, { source: "api" })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(expect.objectContaining({
      appearance: expect.objectContaining({
        icons: expect.arrayContaining([expect.objectContaining({ value: "wrench" })]),
      }),
    }))
  })

  it("lists active and deleted content when requested", async () => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)

    const result = await dispatcher.dispatch("content.rule.list", { includeDeleted: true }, { source: "api" })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("content.rule.list should succeed")
    expect(result.total).toBe(2)
    expect(deps.contentReader.listContent).toHaveBeenCalledWith("rule")
    expect(deps.contentReader.listDeletedContent).toHaveBeenCalledWith("rule")
  })

  it("checks permission and audits allowed content reads without content body", async () => {
    const { actor, auditSink, permissionGuard } = createSecurityHarness()
    const deps = {
      ...createDeps(),
      security: { actor, auditSink, permissionGuard },
    }
    const dispatcher = createContentCapabilityDispatcher(deps)
    const contextActor = mcpClientActorForSource("mcp-stdio")

    await dispatcher.dispatch("content.rule.list", { includeDeleted: true }, { source: "mcp-stdio", actor: contextActor })
    await dispatcher.dispatch("content.rule.get", { id: "rule-1" }, { source: "mcp-stdio", actor: contextActor })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "content.read",
      actor: contextActor,
      resource: "content:rule:list",
      context: {
        source: "mcp-stdio",
        contentAction: "content.rule.list",
        contentType: "rule",
        operation: "list",
        includeDeleted: true,
      },
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "content.read",
      actor: contextActor,
      resource: "content:rule:rule-1",
      context: {
        source: "mcp-stdio",
        contentAction: "content.rule.get",
        contentType: "rule",
        operation: "get",
        contentId: "rule-1",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.read",
      actor: contextActor,
      resource: "content:rule:list",
      outcome: "allowed",
      metadata: expect.objectContaining({
        contentAction: "content.rule.list",
        resultCount: 2,
      }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.read",
      actor: contextActor,
      resource: "content:rule:rule-1",
      outcome: "allowed",
      metadata: expect.objectContaining({
        contentAction: "content.rule.get",
        contentId: "rule-1",
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("# Content")
  })

  it("denies content reads before reading content", async () => {
    const { actor, auditSink, permissionGuard } = createSecurityHarness({
      allowed: false as const,
      reason: "content read denied",
      policyId: "deny-content-read",
    })
    const deps = {
      ...createDeps(),
      security: { actor, auditSink, permissionGuard },
    }
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.rule.get", { id: "rule-1" }, { source: "mcp-stdio" }))
      .rejects.toThrow("content read denied")

    expect(deps.contentReader.getDetail).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.read",
      actor,
      resource: "content:rule:rule-1",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "mcp-stdio",
        contentAction: "content.rule.get",
        contentType: "rule",
        operation: "get",
        contentId: "rule-1",
        reason: "content read denied",
        policyId: "deny-content-read",
      }),
    }))
  })

  it("creates a skill from sourceDirectoryPath and generated icon bytes", async () => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)

    await dispatcher.dispatch("content.skill.create", {
      description: "Skill description.",
      iconType: "image",
      iconImageBase64: Buffer.from("image").toString("base64"),
      sourceDirectoryPath: "/tmp/demo-skill ",
    }, { source: "mcp-stdio" })

    expect(deps.readSkillDraftFromDirectory).toHaveBeenCalledWith("/tmp/demo-skill ", undefined, { mode: "publish" })
    expect(deps.contentWriter.createContent).toHaveBeenCalledWith(expect.objectContaining({
      contentType: "skill",
      payload: expect.objectContaining({
        name: "demo-skill",
        title: "Demo Skill",
        description: "Skill description.",
        category: "development",
        iconType: "image",
        iconImage: "icon.png",
        iconImageBytes: new Uint8Array([1, 2, 3]),
        files: [expect.objectContaining({ originalName: "references/guide.md" })],
      }),
    }))
  })

  it("logs content mutation dispatch lifecycle without content body", async () => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)

    await dispatcher.dispatch("content.rule.create", {
      name: "team-rule",
      title: "Team Rule",
      description: "Description",
      category: "coding",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Secret Rule Body",
    }, { source: "mcp-stdio" })

    expect(logStoreMock.logger.info).toHaveBeenCalledWith("content capability dispatch", expect.objectContaining({
      action: "content.rule.create",
      contentType: "rule",
      hasContent: true,
      operation: "create",
      source: "mcp-stdio",
    }))
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("content capability dispatch succeeded", expect.objectContaining({
      action: "content.rule.create",
      contentType: "rule",
      operation: "create",
      resultContentId: "created",
      resultStatus: "saved",
    }))
    expect(JSON.stringify(logStoreMock.logger.info.mock.calls)).not.toContain("# Secret Rule Body")
  })

  it("logs content mutation dispatch failures without full params", async () => {
    const deps = createDeps()
    deps.contentWriter.createContent.mockRejectedValueOnce(new Error("write failed"))
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.rule.create", {
      name: "team-rule",
      title: "Team Rule",
      description: "Description",
      category: "coding",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Secret Rule Body",
    }, { source: "mcp-stdio" })).rejects.toThrow("write failed")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith("content capability dispatch failed", expect.objectContaining({
      action: "content.rule.create",
      contentType: "rule",
      errorMessage: "write failed",
      errorName: "Error",
      hasContent: true,
      operation: "create",
      source: "mcp-stdio",
    }))
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("# Secret Rule Body")
  })

  it("preserves an existing image icon when updating a skill from sourceDirectoryPath without appearance fields", async () => {
    const deps = createDeps({
      detail: contentDetail({
        id: "skill-1",
        type: "skill",
        title: "Existing Skill",
        name: "existing-skill",
        category: "development",
        icon: "",
        iconBg: "",
        iconType: "image",
        iconImage: "icon.png",
      }),
    })
    const dispatcher = createContentCapabilityDispatcher(deps)

    await dispatcher.dispatch("content.skill.update", {
      id: "skill-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      sourceDirectoryPath: "/tmp/demo-skill",
    }, { source: "mcp-stdio" })

    expect(deps.prepareIconImageBytes).not.toHaveBeenCalled()
    expect(deps.contentWriter.updateContent).toHaveBeenCalledWith(expect.objectContaining({
      contentType: "skill",
      payload: expect.objectContaining({
        id: "skill-1",
        icon: "",
        iconBg: "",
        iconType: "image",
        iconImage: "icon.png",
      }),
    }))
  })

  it("checks permission and audits allowed content mutations", async () => {
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true as const })),
      registerPolicy: vi.fn(),
    }
    const actor = { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
    const deps = {
      ...createDeps(),
      security: { actor, auditSink, permissionGuard },
    }
    const dispatcher = createContentCapabilityDispatcher(deps)
    const contextActor = mcpClientActorForSource("mcp-stdio")

    const result = await dispatcher.dispatch("content.rule.create", {
      name: "team-rule",
      title: "Team Rule",
      description: "Description",
      category: "coding",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Rule",
    }, { source: "mcp-stdio", actor: contextActor })

    expect(result.ok).toBe(true)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "content.mutate",
      actor: contextActor,
      resource: "content:rule:create",
      context: {
        source: "mcp-stdio",
        contentAction: "content.rule.create",
        contentType: "rule",
        operation: "create",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      actor: contextActor,
      resource: "content:rule:create",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-stdio",
        contentAction: "content.rule.create",
        contentType: "rule",
        operation: "create",
      }),
    }))
  })

  it("denies content mutations before reading or writing content", async () => {
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: false as const, reason: "content denied", policyId: "deny-content" })),
      registerPolicy: vi.fn(),
    }
    const actor = { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
    const deps = {
      ...createDeps(),
      security: { actor, auditSink, permissionGuard },
    }
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.rule.delete", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    }, { source: "mcp-stdio" })).rejects.toThrow("content denied")

    expect(deps.contentReader.getDetail).not.toHaveBeenCalled()
    expect(deps.contentWriter.deleteContent).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      actor,
      resource: "content:rule:rule-1",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "mcp-stdio",
        contentAction: "content.rule.delete",
        contentType: "rule",
        operation: "delete",
        contentId: "rule-1",
        reason: "content denied",
        policyId: "deny-content",
      }),
    }))
  })

  it("audits failed content permission checks without raw error text", async () => {
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const permissionGuard = {
      check: vi.fn(async () => {
        throw new Error("policy backend failed token=secret at /Users/example/content.md")
      }),
      registerPolicy: vi.fn(),
    }
    const actor = { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
    const deps = {
      ...createDeps(),
      security: { actor, auditSink, permissionGuard },
    }
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.rule.delete", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    }, { source: "mcp-stdio" })).rejects.toThrow("policy backend failed")

    expect(deps.contentReader.getDetail).not.toHaveBeenCalled()
    expect(deps.contentWriter.deleteContent).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "content.mutate",
      actor,
      resource: "content:rule:rule-1",
      outcome: "failed",
      metadata: expect.objectContaining({
        contentAction: "content.rule.delete",
        reason: "permission-check-error",
        errorName: "Error",
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("token=secret")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("/Users/example")
  })

  it.each([
    ["rule", "create"],
    ["rule", "update"],
    ["rule", "delete"],
    ["skill", "create"],
    ["skill", "update"],
    ["skill", "delete"],
    ["prompt", "create"],
    ["prompt", "update"],
    ["prompt", "delete"],
  ] as const)("emits a content changed event after %s %s saves", async (contentType, operation) => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)

    const params = operation === "delete"
      ? {
          id: `${contentType}-1`,
          baseHistoryDirname: "20260521000000Z__user__abc123",
        }
      : {
          id: `${contentType}-1`,
          baseHistoryDirname: "20260521000000Z__user__abc123",
          name: `${contentType}-name`,
          title: "Title",
          description: "Description",
          category: contentType === "skill" ? "development" : "coding",
          iconType: "icon",
          icon: "wrench",
          iconBg: "graphite",
          content: "# Content",
        }

    await dispatcher.dispatch(`content.${contentType}.${operation}`, params, { source: "mcp-stdio" })

    expect(deps.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "content",
      type: "content.changed",
      payload: expect.objectContaining({
        contentType,
        operation,
      }),
    }), { backpressure: "block" })
  })

  it("allows update and delete for resources created by current user", async () => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)

    await dispatcher.dispatch("content.rule.update", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      name: "team-rule",
      title: "Team Rule",
      description: "Description",
      category: "coding",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Rule",
    }, { source: "mcp-stdio" })
    await dispatcher.dispatch("content.rule.delete", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    }, { source: "mcp-stdio" })

    expect(deps.contentWriter.updateContent).toHaveBeenCalled()
    expect(deps.contentWriter.deleteContent).toHaveBeenCalledWith({
      type: "rule",
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    })
  })

  it("allows updating a Skill created by another repository profile", async () => {
    const deps = createDeps({
      detail: contentDetail({
        createdBy: "other-user",
        id: "skill-1",
        name: "team-skill",
        type: "skill",
      }),
    })
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.skill.update", {
      id: "skill-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      name: "team-skill",
      title: "Team Skill",
      description: "Description",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(deps.contentWriter.updateContent).toHaveBeenCalled()
  })

  it("keeps version conflict protection when another repository profile updates a Skill", async () => {
    const deps = createDeps({
      detail: contentDetail({ createdBy: "other-user", id: "skill-1", type: "skill" }),
    })
    deps.contentWriter.updateContent.mockResolvedValueOnce({
      id: "skill-1",
      type: "skill",
      status: "conflict",
      latestHistoryDirname: "newer-history",
      latestModifiedAt: "2026-05-22T00:00:00.000Z",
      latestModifiedByDisplayName: "Other User",
    } as never)
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.skill.update", {
      id: "skill-1",
      baseHistoryDirname: "stale-history",
      name: "team-skill",
      title: "Team Skill",
      description: "Description",
      category: "development",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Skill",
    }, { source: "mcp-stdio" })).rejects.toMatchObject({ code: "CONTENT_CONFLICT" })
  })

  it.each(["rule", "prompt"] as const)("rejects updating a %s created by another user", async (contentType) => {
    const deps = createDeps({
      detail: contentDetail({ createdBy: "other-user", type: contentType }),
    })
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch(`content.${contentType}.update`, {
      id: `${contentType}-1`,
      baseHistoryDirname: "20260521000000Z__user__abc123",
      name: "team-rule",
      title: "Team Content",
      description: "Description",
      category: "coding",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Content",
    }, { source: "mcp-stdio" })).rejects.toThrow(ContentCapabilityError)

    expect(deps.contentWriter.updateContent).not.toHaveBeenCalled()
  })

  it("rejects deleting a Skill created by another user", async () => {
    const deps = createDeps({
      detail: contentDetail({ createdBy: "other-user", id: "skill-1", type: "skill" }),
    })
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.skill.delete", {
      id: "skill-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    }, { source: "mcp-stdio" })).rejects.toThrow(ContentCapabilityError)
    expect(deps.contentWriter.deleteContent).not.toHaveBeenCalled()
  })

  it.each([
    ["update", "updateContent", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
      name: "team-rule",
      title: "Team Rule",
      description: "Description",
      category: "coding",
      iconType: "icon",
      icon: "wrench",
      iconBg: "graphite",
      content: "# Rule",
    }],
    ["delete", "deleteContent", {
      id: "rule-1",
      baseHistoryDirname: "20260521000000Z__user__abc123",
    }],
  ] as const)("rejects %s conflicts as content capability errors", async (operation, serviceName, params) => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)
    const conflict = {
      id: "rule-1",
      type: "rule" as const,
      status: "conflict" as const,
      latestHistoryDirname: "20260522000000Z__user__newer",
      latestModifiedAt: "2026-05-22T00:00:00.000Z",
      latestModifiedByDisplayName: "Other User",
    }
    deps.contentWriter[serviceName].mockResolvedValueOnce(conflict as never)

    await expect(dispatcher.dispatch(`content.rule.${operation}`, params, { source: "mcp-stdio" }))
      .rejects.toMatchObject({
        code: "CONTENT_CONFLICT",
        details: {
          conflict,
        },
      })
    expect(deps.eventBus.emit).not.toHaveBeenCalled()
  })
})
