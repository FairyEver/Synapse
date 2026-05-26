import { describe, expect, it, vi } from "vitest"
import type {
  SynapseContentDetail,
  SynapseContentMeta,
  SynapseContentType,
} from "../../../src/types/content"
import { ContentCapabilityError } from "../../services/content-capability-errors"
import { createContentCapabilityDispatcher } from "../content-dispatcher"

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
    })),
    resolveCurrentIdentity: vi.fn(async () => ({ userId: options.currentUserId ?? "user-1" })),
  }
}

describe("content capability dispatcher", () => {
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

    expect(result.total).toBe(2)
    expect(deps.contentReader.listContent).toHaveBeenCalledWith("rule")
    expect(deps.contentReader.listDeletedContent).toHaveBeenCalledWith("rule")
  })

  it("creates a skill from sourceDirectoryPath and generated icon bytes", async () => {
    const deps = createDeps()
    const dispatcher = createContentCapabilityDispatcher(deps)

    await dispatcher.dispatch("content.skill.create", {
      description: "Skill description.",
      iconType: "image",
      iconImageBase64: Buffer.from("image").toString("base64"),
      sourceDirectoryPath: "/tmp/demo-skill",
    }, { source: "mcp-stdio" })

    expect(deps.readSkillDraftFromDirectory).toHaveBeenCalledWith("/tmp/demo-skill", undefined)
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

  it("rejects update and delete for resources created by another user", async () => {
    const deps = createDeps({
      detail: contentDetail({ createdBy: "other-user" }),
    })
    const dispatcher = createContentCapabilityDispatcher(deps)

    await expect(dispatcher.dispatch("content.rule.delete", {
      id: "rule-1",
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
