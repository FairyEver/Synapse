import { chmod, mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

const trashItem = vi.hoisted(() => vi.fn())
const fsMocks = vi.hoisted(() => ({ open: vi.fn() }))
const serviceLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
  child: vi.fn(),
}))
serviceLogger.child.mockReturnValue(serviceLogger)

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    open: (...args: unknown[]) => fsMocks.open(...args),
  }
})

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/synapse-editor-scan-test-app",
    getPath: (which: string) => `/tmp/synapse-editor-scan-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  shell: {
    trashItem,
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => serviceLogger,
}))

import { scanCodexRules, scanCursorRules } from "../../../src/definitions/editor/shared-rule-scanners"
import { createDefaultConfig } from "../../../src/lib/config"
import {
  buildRuleQuickPublishPayload,
  buildSkillQuickPublishPayload,
} from "../../../src/modules/editor-scan/lib/quick-publish"
import { configStore } from "../config-store"
import { contentHistoryService } from "../content-history-service"
import * as editorScanRoots from "../editor-scan-roots"
import {
  EditorScanCancelledError,
  EDITOR_SCAN_SKILL_FILE_LIST_LIMITS,
  EDITOR_SCAN_SKILL_PREVIEW_LIMITS,
  finalizeQuickPublish,
  listSkillFiles,
  prepareQuickPublishDraft,
  readItemContent,
  scanAll,
  scanGlobalEditorById,
  scanSkillDirectories,
  trashScanItem,
} from "../editor-scan-service"

const tempDirs: string[] = []

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  fsMocks.open.mockImplementation((...args: unknown[]) => (
    actual.open as unknown as (...openArgs: unknown[]) => unknown
  )(...args))
  serviceLogger.debug.mockClear()
  serviceLogger.error.mockClear()
  serviceLogger.fatal.mockClear()
  serviceLogger.info.mockClear()
  serviceLogger.trace.mockClear()
  serviceLogger.warn.mockClear()
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-scan-"))
  tempDirs.push(dir)
  return dir
}

function createAllowingSecurity() {
  const auditEvents: Array<{
    action: string
    outcome: string
    resource: string
    metadata?: Record<string, unknown>
  }> = []
  const auditSink: AuditSink = {
    record: vi.fn((event) => { auditEvents.push(event) }),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(() => () => {}),
    check: vi.fn(async () => ({ allowed: true as const })),
  }

  return {
    auditEvents,
    security: {
      actor: { kind: "user" as const },
      auditSink,
      permissionGuard,
    },
  }
}

function createDenyingReadSecurity() {
  const auditEvents: Array<{
    action: string
    outcome: string
    resource: string
    metadata?: Record<string, unknown>
  }> = []
  const auditSink: AuditSink = {
    record: vi.fn((event) => { auditEvents.push(event) }),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(() => () => {}),
    check: vi.fn(async () => ({
      allowed: false as const,
      policyId: "deny-read",
      reason: "denied by deny-read",
    })),
  }

  return {
    auditEvents,
    security: {
      actor: { kind: "user" as const },
      auditSink,
      permissionGuard,
    },
  }
}

function mockEditorScanProject(projectPath: string) {
  const config = createDefaultConfig()
  config.global.projects = [{
    id: "project-1",
    name: "Project",
    path: projectPath,
  }]
  vi.spyOn(configStore, "load").mockResolvedValue(config)
}

afterEach(async () => {
  vi.restoreAllMocks()
  trashItem.mockReset()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("editor scan quick publish", () => {
  it("links a saved Skill only when the checked snapshot still matches", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir)
    await writeFile(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: release-helper",
      "description: Release helper.",
      "---",
      "# Release Helper",
    ].join("\n"))
    vi.spyOn(editorScanRoots, "listTrustedSkillRoots").mockResolvedValue([{
      editors: [{ id: "codex", label: "Codex" }],
      scope: "global",
      path: root,
    }])
    const config = createDefaultConfig()
    config.activeRepoUuid = "repo-1"
    config.repositories = [{
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }]
    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(contentHistoryService, "readCurrentDetail").mockResolvedValue({
      attachmentCount: 0,
      attachments: [],
      category: "development",
      content: "# Release Helper",
      createdAt: "2026-07-13T00:00:00.000Z",
      createdBy: "user-1",
      createdByDisplayName: "User",
      deleted: false,
      description: "Release helper.",
      icon: "wrench",
      iconBg: "default",
      id: "skill-1",
      latestHistoryDirname: "20260713010101",
      modifiedAt: "2026-07-13T00:00:00.000Z",
      modifiedBy: "user-1",
      modifiedByDisplayName: "User",
      name: "release-helper",
      title: "Release Helper",
      type: "skill",
    })
    const { auditEvents, security } = createAllowingSecurity()

    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      purpose: "publish",
    }, security)
    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill" || !draft.publishSessionId) return

    await expect(finalizeQuickPublish({
      contentId: "skill-1",
      mode: "new",
      repositoryVersion: "20260713010101",
      sessionId: draft.publishSessionId,
    }, security)).resolves.toMatchObject({ status: "identity-written" })
    await expect(readFile(path.join(skillDir, ".synapse.json"), "utf8")).resolves.toContain('"id": "skill-1"')
    expect(auditEvents.filter((event) => (
      event.metadata?.operation === "read-skill-source-directory"
      && event.outcome === "allowed"
    ))).toHaveLength(2)
  })

  it("keeps a saved resource but skips linking when the local source changed", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir)
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    vi.spyOn(editorScanRoots, "listTrustedSkillRoots").mockResolvedValue([{
      editors: [{ id: "codex", label: "Codex" }],
      scope: "global",
      path: root,
    }])
    const { security } = createAllowingSecurity()
    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      purpose: "publish",
    }, security)
    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill" || !draft.publishSessionId) return
    await writeFile(path.join(skillDir, "SKILL.md"), "# Changed\n")

    await expect(finalizeQuickPublish({
      contentId: "skill-1",
      mode: "new",
      repositoryVersion: "20260713010101",
      sessionId: draft.publishSessionId,
    }, security)).resolves.toMatchObject({ status: "source-changed" })
    await expect(readFile(path.join(skillDir, ".synapse.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("skips linking when only Skill frontmatter changed after the publish check", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir)
    await writeFile(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: release-helper",
      "category: development",
      "---",
      "# Release Helper",
    ].join("\n"))
    vi.spyOn(editorScanRoots, "listTrustedSkillRoots").mockResolvedValue([{
      editors: [{ id: "codex", label: "Codex" }],
      scope: "global",
      path: root,
    }])
    const { security } = createAllowingSecurity()
    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      purpose: "publish",
    }, security)
    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill" || !draft.publishSessionId) return
    await writeFile(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: release-helper",
      "category: operations",
      "---",
      "# Release Helper",
    ].join("\n"))

    await expect(finalizeQuickPublish({
      contentId: "skill-1",
      mode: "new",
      repositoryVersion: "20260713010101",
      sessionId: draft.publishSessionId,
    }, security)).resolves.toMatchObject({ status: "source-changed" })
    await expect(readFile(path.join(skillDir, ".synapse.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("checks read permission before returning scanned item content and attachments", async () => {
    const root = await createTempDir()
    const rulePath = path.join(root, "AGENTS.md")
    const skillDir = path.join(root, "release-helper")
    await writeFile(rulePath, "# Rule\n")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    const { auditEvents, security } = createDenyingReadSecurity()

    await expect(readItemContent(rulePath, security)).rejects.toThrow("denied by deny-read")
    await expect(listSkillFiles(skillDir, security)).rejects.toThrow("denied by deny-read")
    await expect(prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    }, security)).rejects.toThrow("denied by deny-read")

    expect(security.permissionGuard.check).toHaveBeenCalledTimes(3)
    expect(auditEvents).toEqual([
      expect.objectContaining({ action: "fs.read.outside-userdata", outcome: "denied", resource: rulePath }),
      expect.objectContaining({ action: "fs.read.outside-userdata", outcome: "denied", resource: skillDir }),
      expect.objectContaining({ action: "fs.read.outside-userdata", outcome: "denied", resource: skillDir }),
    ])
  })

  it("rejects read APIs outside configured editor scan roots", async () => {
    const projectRoot = await createTempDir()
    const rogueRoot = await createTempDir()
    const rogueRulePath = path.join(rogueRoot, "AGENTS.md")
    const rogueSkillDir = path.join(rogueRoot, "release-helper")
    await mkdir(rogueSkillDir, { recursive: true })
    await writeFile(rogueRulePath, "# Rogue Rule\n")
    await writeFile(path.join(rogueSkillDir, "SKILL.md"), "# Rogue Skill\n")
    const { auditEvents, security } = createAllowingSecurity()
    mockEditorScanProject(projectRoot)

    await expect(readItemContent(rogueRulePath, security)).rejects.toThrow("目标不在当前编辑器扫描范围内。")
    await expect(listSkillFiles(rogueSkillDir, security)).rejects.toThrow("目标不在当前编辑器扫描范围内。")
    await expect(prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: rogueSkillDir,
      itemName: "release-helper",
      metadata: {},
    }, security)).rejects.toThrow("目标不在当前编辑器扫描范围内。")

    expect(auditEvents).toEqual([
      expect.objectContaining({ action: "fs.read.outside-userdata", outcome: "failed", resource: rogueRulePath }),
      expect.objectContaining({ action: "fs.read.outside-userdata", outcome: "failed", resource: rogueSkillDir }),
      expect.objectContaining({ action: "fs.read.outside-userdata", outcome: "failed", resource: rogueSkillDir }),
    ])
  })

  it("merges Codex global skill directories and keeps the primary copy for duplicate names", async () => {
    const root = await createTempDir()
    const primaryDir = path.join(root, ".agents", "skills")
    const compatDir = path.join(root, ".codex", "skills")
    await mkdir(path.join(primaryDir, "reviewer"), { recursive: true })
    await mkdir(path.join(compatDir, "reviewer"), { recursive: true })
    await mkdir(path.join(compatDir, "legacy"), { recursive: true })
    await writeFile(path.join(primaryDir, "reviewer", "SKILL.md"), "# Primary Reviewer\n")
    await writeFile(path.join(compatDir, "reviewer", "SKILL.md"), "# Legacy Reviewer\n")
    await writeFile(path.join(compatDir, "legacy", "SKILL.md"), "# Legacy\n")

    const result = await scanSkillDirectories([primaryDir, compatDir])

    expect(result.skills.map((skill) => skill.name)).toEqual(["reviewer", "legacy"])
    expect(result.skills.find((skill) => skill.name === "reviewer")?.path).toBe(path.join(primaryDir, "reviewer"))
    expect(result.skills.find((skill) => skill.name === "reviewer")?.trash).toEqual({
      mode: "path",
    })
    expect(result.duplicateSkillNames).toEqual(["reviewer"])
  })

  it("can preserve duplicate Skill candidates for installation status checks", async () => {
    const root = await createTempDir()
    const primaryDir = path.join(root, ".agents", "skills")
    const compatDir = path.join(root, ".codex", "skills")
    await mkdir(path.join(primaryDir, "reviewer"), { recursive: true })
    await mkdir(path.join(compatDir, "reviewer"), { recursive: true })
    await writeFile(path.join(primaryDir, "reviewer", "SKILL.md"), "# Primary Reviewer\n")
    await writeFile(path.join(compatDir, "reviewer", "SKILL.md"), "# Compat Reviewer\n")

    const result = await scanSkillDirectories(
      [primaryDir, compatDir],
      undefined,
      { preserveDuplicateNames: true },
    )

    expect(result.skills.map((skill) => skill.path)).toEqual([
      path.join(primaryDir, "reviewer"),
      path.join(compatDir, "reviewer"),
    ])
    expect(result.duplicateSkillNames).toEqual(["reviewer"])
  })

  it("keeps global scans non-fatal when an editor detection directory is inaccessible", async () => {
    const root = await createTempDir()
    const blockedHome = path.join(root, "blocked-home")
    await mkdir(blockedHome, { recursive: true })
    await chmod(blockedHome, 0o000)
    vi.spyOn(os, "homedir").mockReturnValue(blockedHome)
    mockEditorScanProject(path.join(root, "missing-project"))

    try {
      await expect(scanAll()).resolves.toMatchObject({
        global: expect.arrayContaining([
          expect.objectContaining({
            status: "not-detected",
          }),
        ]),
      })
    } finally {
      await chmod(blockedHome, 0o700)
    }
  })

  it("scans only the requested global editor", async () => {
    const root = await createTempDir()
    vi.spyOn(os, "homedir").mockReturnValue(root)
    await mkdir(path.join(root, ".agents", "skills", "reviewer"), { recursive: true })
    await writeFile(path.join(root, ".agents", "skills", "reviewer", "SKILL.md"), "# Reviewer\n")

    const result = await scanGlobalEditorById("codex")

    expect(result).toMatchObject({
      editorId: "codex",
      skills: [expect.objectContaining({ name: "reviewer" })],
    })
    await expect(scanGlobalEditorById("missing-editor")).resolves.toBeNull()
  })

  it("stops before scanning when the request is already cancelled", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(scanAll(controller.signal)).rejects.toBeInstanceOf(EditorScanCancelledError)
  })

  it("stops an in-progress Skill directory scan after cancellation", async () => {
    const root = await createTempDir()
    await mkdir(path.join(root, "reviewer"), { recursive: true })
    await writeFile(path.join(root, "reviewer", "SKILL.md"), "# Reviewer\n")
    const controller = new AbortController()

    const result = scanSkillDirectories([root], controller.signal)
    controller.abort()

    await expect(result).rejects.toBeInstanceOf(EditorScanCancelledError)
  })

  it("reads installed skill repository version from .synapse.json", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "reviewer")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Reviewer\n")
    await writeFile(path.join(skillDir, ".synapse.json"), JSON.stringify({
      id: "skill-1",
      repositoryVersion: "20260521010101",
    }))

    const result = await scanSkillDirectories([root])

    expect(result.skills).toContainEqual(expect.objectContaining({
      name: "reviewer",
      synapseContentId: "skill-1",
      repositoryVersion: "20260521010101",
    }))
  })

  it("reads installed skill source fingerprint from .synapse.json", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "reviewer")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Reviewer\n")
    await writeFile(path.join(skillDir, ".synapse.json"), JSON.stringify({
      id: "skill-1",
      sourceFingerprint: "sha256:current",
    }))

    const result = await scanSkillDirectories([root])

    expect(result.skills).toContainEqual(expect.objectContaining({
      name: "reviewer",
      synapseContentId: "skill-1",
      sourceFingerprint: "sha256:current",
    }))
  })

  it.skipIf(process.platform === "win32")("does not trust a symlinked resource identity during Skill scan", async () => {
    const root = await createTempDir()
    const outside = await createTempDir()
    const skillDir = path.join(root, "reviewer")
    const externalIdentity = path.join(outside, "identity.json")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Reviewer\n")
    await writeFile(externalIdentity, JSON.stringify({ id: "wrong-skill" }))
    await symlink(externalIdentity, path.join(skillDir, ".synapse.json"))

    const result = await scanSkillDirectories([root])

    expect(result.skills).toContainEqual(expect.objectContaining({
      name: "reviewer",
      source: "external",
      synapseContentId: null,
    }))
  })

  it.skipIf(process.platform === "win32")("rejects a symlinked resource identity during Skill publish preparation", async () => {
    const root = await createTempDir()
    const outside = await createTempDir()
    const skillDir = path.join(root, "reviewer")
    const externalIdentity = path.join(outside, "identity.json")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Reviewer\n")
    await writeFile(externalIdentity, JSON.stringify({ id: "wrong-skill" }))
    await symlink(externalIdentity, path.join(skillDir, ".synapse.json"))

    await expect(prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "reviewer",
      metadata: {},
      purpose: "publish",
    })).rejects.toThrow("本地 Skill 关联文件不能是符号链接")
  })

  it("bounds skill attachment listing by file count and depth", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "large-skill")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Large Skill\n")

    await Promise.all(Array.from({ length: EDITOR_SCAN_SKILL_FILE_LIST_LIMITS.maxFiles + 10 }, async (_, index) => {
      await writeFile(path.join(skillDir, `attachment-${String(index).padStart(3, "0")}.txt`), "data")
    }))

    let deepDir = skillDir
    for (let depth = 0; depth <= EDITOR_SCAN_SKILL_FILE_LIST_LIMITS.maxDepth + 1; depth++) {
      deepDir = path.join(deepDir, `nested-${depth}`)
      await mkdir(deepDir)
    }
    await writeFile(path.join(deepDir, "too-deep.txt"), "data")

    const files = await listSkillFiles(skillDir)

    expect(files).toHaveLength(EDITOR_SCAN_SKILL_FILE_LIST_LIMITS.maxFiles)
    expect(files.some((file) => file.name.includes("too-deep.txt"))).toBe(false)
  })

  it.skipIf(process.platform === "win32")("reports unreadable skill roots instead of returning an empty scan", async () => {
    const root = await createTempDir()
    const skillsPath = path.join(root, "skills")
    await mkdir(skillsPath, { recursive: true })
    await chmod(skillsPath, 0o000)

    try {
      const result = await scanSkillDirectories([skillsPath])

      expect(result.skills).toEqual([])
      expect(result.skillScanError).toBe("Skill 目录读取失败")
    } finally {
      await chmod(skillsPath, 0o700)
    }
  })

  it("creates a skill draft with nested binary attachments from the scan scope", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(path.join(skillDir, "bin"), { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: release-helper\n---\n# Release Helper\n")
    await writeFile(path.join(skillDir, ".synapse.json"), "{\"id\":\"skill-1\"}")
    await writeFile(path.join(skillDir, ".secret"), "hidden")
    await writeFile(path.join(skillDir, "notes.txt"), "notes")
    await writeFile(path.join(skillDir, "bin", "tool.dat"), Uint8Array.from([0, 255, 42]))

    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })

    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill") return

    expect(draft.content).toContain("# Release Helper")
    expect(draft.files.map((file) => file.originalName)).toEqual([
      "bin/tool.dat",
      "notes.txt",
    ])
    expect(Array.from(draft.files[0]?.bytes ?? [])).toEqual([0, 255, 42])
    expect(draft.files.some((file) => file.originalName.includes(".synapse.json"))).toBe(false)
    expect(draft.files.some((file) => file.originalName.includes(".secret"))).toBe(false)
  })

  it("runs manual quick-publish fixtures through scan and import payload builders", async () => {
    const root = await createTempDir()
    const rulesPath = path.join(root, "AGENTS.md")
    const skillsPath = path.join(root, ".agents", "skills")
    const normalSkillDir = path.join(skillsPath, "normal-import-skill")
    const unknownSkillDir = path.join(skillsPath, "unknown-category-skill")
    const partialSkillDir = path.join(skillsPath, "partial-frontmatter-skill")

    await mkdir(path.join(normalSkillDir, "assets"), { recursive: true })
    await mkdir(unknownSkillDir, { recursive: true })
    await mkdir(partialSkillDir, { recursive: true })
    await writeFile(
      rulesPath,
      [
        "<!-- synapse-rule:unknown-category-rule:begin -->",
        "---",
        "name: unknown-category-rule",
        "category: category-that-does-not-exist",
        "---",
        "",
        "# Unknown Category Rule",
        "",
        "Use this rule to verify the unknown category notice.",
        "<!-- synapse-rule:unknown-category-rule:end -->",
        "<!-- synapse-rule:partial-frontmatter-rule:begin -->",
        "---",
        "name: partial-frontmatter-rule",
        "tags:",
        "  - manual-test",
        "---",
        "",
        "# Partial Frontmatter Rule",
        "",
        "Use this rule to verify the partial frontmatter notice.",
        "<!-- synapse-rule:partial-frontmatter-rule:end -->",
      ].join("\n"),
    )
    await writeFile(
      path.join(normalSkillDir, "SKILL.md"),
      [
        "---",
        "name: normal-import-skill",
        "title: Normal Import Skill",
        "description: Normal skill import case.",
        "category: automation",
        "---",
        "",
        "# Normal Import Skill",
        "",
        "Use this skill to verify the import flow and attachment transfer.",
      ].join("\n"),
    )
    await writeFile(path.join(normalSkillDir, "assets", "template.txt"), "attachment")
    await writeFile(
      path.join(unknownSkillDir, "SKILL.md"),
      [
        "---",
        "name: unknown-category-skill",
        "category: category-that-does-not-exist",
        "---",
        "",
        "# Unknown Category Skill",
      ].join("\n"),
    )
    await writeFile(
      path.join(partialSkillDir, "SKILL.md"),
      [
        "---",
        "name: partial-frontmatter-skill",
        "tags:",
        "  - manual-test",
        "---",
        "",
        "# Partial Frontmatter Skill",
      ].join("\n"),
    )

    const rules = await scanCodexRules(rulesPath)
    const unknownRule = rules.find((rule) => rule.name === "unknown-category-rule")
    const partialRule = rules.find((rule) => rule.name === "partial-frontmatter-rule")

    expect(buildRuleQuickPublishPayload({
      itemType: "rule",
      itemPath: rulesPath,
      itemName: unknownRule?.name ?? "",
      content: unknownRule?.content ?? "",
      metadata: unknownRule?.metadata ?? {},
    }).notices).toEqual([
      { id: "unknown-category", message: "未识别分类，已留空。" },
    ])
    expect(buildRuleQuickPublishPayload({
      itemType: "rule",
      itemPath: rulesPath,
      itemName: partialRule?.name ?? "",
      content: partialRule?.content ?? "",
      metadata: partialRule?.metadata ?? {},
    }).notices).toEqual([
      { id: "frontmatter-partial", message: "元数据未完全识别，请检查已填内容。" },
    ])

    const skillScan = await scanSkillDirectories([skillsPath])
    expect(skillScan.skills.map((skill) => skill.name).sort()).toEqual([
      "normal-import-skill",
      "partial-frontmatter-skill",
      "unknown-category-skill",
    ])

    const normalSkillDraft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: normalSkillDir,
      itemName: "normal-import-skill",
      metadata: {},
    })
    expect(normalSkillDraft.itemType).toBe("skill")
    if (normalSkillDraft.itemType !== "skill") return
    const normalSkillResult = buildSkillQuickPublishPayload(normalSkillDraft)
    expect(normalSkillResult.notices).toEqual([])
    expect(normalSkillResult.payload.files.map((file) => file.originalName)).toEqual(["assets/template.txt"])

    const unknownSkillDraft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: unknownSkillDir,
      itemName: "unknown-category-skill",
      metadata: {},
    })
    expect(unknownSkillDraft.itemType).toBe("skill")
    if (unknownSkillDraft.itemType !== "skill") return
    expect(buildSkillQuickPublishPayload(unknownSkillDraft).notices).toEqual([
      { id: "unknown-category", message: "未识别分类，已留空。" },
    ])

    const partialSkillDraft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: partialSkillDir,
      itemName: "partial-frontmatter-skill",
      metadata: {},
    })
    expect(partialSkillDraft.itemType).toBe("skill")
    if (partialSkillDraft.itemType !== "skill") return
    expect(buildSkillQuickPublishPayload(partialSkillDraft).notices).toEqual([
      { id: "frontmatter-partial", message: "元数据未完全识别，请检查已填内容。" },
    ])
  })

  it("uses skill frontmatter description as the list preview", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "pagespy-log-reader")
    const description = "Read, decode, and summarize PageSpy/o-spy frontend log JSON exports. Use this skill whenever the user mentions PageSpy, o-spy, pagespy.huolala.cn, page-spy-web, rrweb-event, frontend log JSON, web session replay logs, or asks AI to understand a PageSpy exported .json file. This skill helps decode zlib-compressed entries, separate console/network/storage/system/meta/rrweb events, identify user actions, API failures, sensitive tokens, and produce a concise debugging summary."
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: pagespy-log-reader",
        `description: ${description}`,
        "---",
        "",
        "# PageSpy Log Reader",
        "",
        "## Purpose",
      ].join("\n"),
    )

    const result = await scanSkillDirectories([root])

    expect(result.skills[0]?.preview).toBe(description)
  })

  it("bounds Skill preview reads to a fixed file prefix", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "large-preview")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: large-preview",
      `padding: ${"x".repeat(EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxPreviewBytes)}`,
      "description: This description is beyond the preview limit.",
      "---",
      "# Large Preview",
    ].join("\n"))

    const result = await scanSkillDirectories([root])

    expect(result.skills[0]?.preview).not.toContain("beyond the preview limit")
    expect((result.skills[0]?.preview ?? "").length)
      .toBeLessThanOrEqual(EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxPreviewChars)
  })

  it("reports a preview handle close failure without dropping the scanned Skill", async () => {
    const root = await createTempDir()
    const skillDirectory = path.join(root, "reviewer")
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(path.join(skillDirectory, "SKILL.md"), "# Reviewer\n")
    const preview = Buffer.from("# Reviewer\n")
    fsMocks.open.mockResolvedValueOnce({
      close: vi.fn().mockRejectedValue(new Error("close failed with local detail")),
      read: vi.fn(async (buffer: Buffer) => {
        preview.copy(buffer)
        return { buffer, bytesRead: preview.byteLength }
      }),
    })

    await expect(scanSkillDirectories([root])).resolves.toMatchObject({
      skills: [expect.objectContaining({ name: "reviewer", preview: "# Reviewer" })],
    })
    expect(serviceLogger.warn).toHaveBeenCalledWith("Failed to close Skill preview file handle.", {
      errorName: "Error",
      fileName: "SKILL.md",
    })
    expect(JSON.stringify(serviceLogger.warn.mock.calls)).not.toContain("local detail")
  })

  it("caps the number of Skill directories scanned per root", async () => {
    const root = await createTempDir()
    await Promise.all(Array.from(
      { length: EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxSkillsPerRoot + 1 },
      async (_, index) => {
        const skillDir = path.join(root, `skill-${String(index).padStart(3, "0")}`)
        await mkdir(skillDir, { recursive: true })
        await writeFile(path.join(skillDir, "SKILL.md"), `# Skill ${index}\n`)
      },
    ))

    const result = await scanSkillDirectories([root])

    expect(result.skills).toHaveLength(EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxSkillsPerRoot)
    expect(result.skillScanError).toContain("Skill 数量超过扫描上限")
  })

  it("uses ruleContent when preparing a rule draft", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(filePath, "# Whole File\n\nThis should not be published.")

    const draft = await prepareQuickPublishDraft({
      itemType: "rule",
      itemPath: filePath,
      itemName: "release-rule",
      ruleContent: "# Release Rule\n\nPublish this block.",
      metadata: { name: "release-rule" },
    })

    expect(draft).toEqual({
      itemType: "rule",
      itemPath: filePath,
      itemName: "release-rule",
      content: "# Release Rule\n\nPublish this block.",
      metadata: { name: "release-rule" },
    })
  })

  it("rejects oversized skill attachments before reading them into the draft", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    await writeFile(path.join(skillDir, "large.bin"), new Uint8Array((10 * 1024 * 1024) + 1))

    await expect(prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })).rejects.toThrow("超过 10MB")
  })

  it("allows skill attachment names without filename-based blocking", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    await writeFile(path.join(skillDir, "id_rsa"), "private key")

    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })

    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill") return
    expect(draft.files.map((file) => file.originalName)).toEqual(["id_rsa"])
  })

  it("skips symlinked files when preparing a skill draft", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    const outsideFilePath = path.join(root, "secret.txt")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    await writeFile(path.join(skillDir, "notes.txt"), "notes")
    await writeFile(outsideFilePath, "secret")
    await symlink(outsideFilePath, path.join(skillDir, "linked-secret.txt"))

    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })

    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill") return
    expect(draft.files.map((file) => file.originalName)).toEqual(["notes.txt"])
  })

  it("rejects symlinked skill main files when preparing a skill draft", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    const outsideFilePath = path.join(root, "secret.md")
    await mkdir(skillDir, { recursive: true })
    await writeFile(outsideFilePath, "# Secret\n")
    await symlink(outsideFilePath, path.join(skillDir, "SKILL.md"))

    await expect(prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })).rejects.toThrow("Skill 主文件不能是符号链接")
  })

  it("keeps the exact content for each Codex rule segment", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(
      filePath,
      [
        "<!-- synapse-rule:first:begin -->",
        "# First",
        "",
        "Only first.",
        "<!-- synapse-rule:first:end -->",
        "<!-- synapse-rule:second:begin -->",
        "# Second",
        "",
        "Only second.",
        "<!-- synapse-rule:second:end -->",
      ].join("\n"),
    )

    const items = await scanCodexRules(filePath)

    expect(items.find((item) => item.name === "first")?.content).toBe("# First\n\nOnly first.")
    expect(items.find((item) => item.name === "second")?.content).toBe("# Second\n\nOnly second.")
    expect(items.find((item) => item.name === "first")?.trash).toEqual({
      mode: "rule-section",
      ruleId: "first",
    })
    expect(items.find((item) => item.name === "second")?.trash).toEqual({
      mode: "rule-section",
      ruleId: "second",
    })
  })

  it("marks shared-file handwritten Codex rules as unsupported for trash", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(
      filePath,
      [
        "# Handwritten Rule",
        "",
        "Keep this section because it has no Synapse marker boundary.",
      ].join("\n"),
    )

    const items = await scanCodexRules(filePath)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: "Handwritten Rule",
      trash: {
        mode: "unsupported",
        disabledReason: "当前 Rule 没有明确边界，请在 Finder 中处理。",
      },
    })
  })

  it("scans Codex rule segments for builtin rules with file-name-safe IDs", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(
      filePath,
      [
        "<!-- synapse-rule:builtin__rule__database-shortcut:begin -->",
        "Use sss.",
        "<!-- synapse-rule:builtin__rule__database-shortcut:end -->",
      ].join("\n"),
    )

    const items = await scanCodexRules(filePath)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: "builtin__rule__database-shortcut",
      source: "synapse",
      synapseContentId: "builtin__rule__database-shortcut",
      content: "Use sss.",
    })
  })

  it("rejects when Codex rule content cannot be read", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await mkdir(filePath)

    await expect(scanCodexRules(filePath)).rejects.toThrow()
  })

  it("recognizes Cursor rules installed from Synapse by file name", async () => {
    const root = await createTempDir()
    const contentId = "abc123"
    await writeFile(
      path.join(root, `synapse_${contentId}.mdc`),
      "---\ndescription: Project rule\n---\n# Rule\n",
    )

    const items = await scanCursorRules(root)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: "synapse",
      synapseContentId: contentId,
    })
  })

  it("uses rule frontmatter description as the list preview", async () => {
    const root = await createTempDir()
    await writeFile(
      path.join(root, "project.mdc"),
      "---\ndescription: Project rule summary\n---\n# Rule\n\nKeep this in the detail body.",
    )

    const items = await scanCursorRules(root)

    expect(items[0]?.preview).toBe("Project rule summary")
  })

  it("marks standalone Cursor rule files as path-trashable", async () => {
    const root = await createTempDir()
    const rulePath = path.join(root, "project.mdc")
    await writeFile(rulePath, "---\ndescription: Project rule\n---\n# Rule\n")

    const items = await scanCursorRules(root)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      path: rulePath,
      trash: { mode: "path" },
    })
  })

  it.skipIf(process.platform === "win32")("omits Cursor rule files that cannot be read", async () => {
    const root = await createTempDir()
    const rulePath = path.join(root, "project.mdc")
    await writeFile(rulePath, "# Rule\n")
    await chmod(rulePath, 0o000)

    await expect(scanCursorRules(root)).resolves.toEqual([])
  })
})

describe("editor scan trash", () => {
  it("moves a standalone rule file to the system trash", async () => {
    const projectRoot = await createTempDir()
    const rulePath = path.join(projectRoot, ".cursor", "rules", "project.mdc")
    await mkdir(path.dirname(rulePath), { recursive: true })
    await writeFile(rulePath, "# Rule\n")
    trashItem.mockResolvedValue(undefined)
    const { security } = createAllowingSecurity()
    mockEditorScanProject(projectRoot)

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "project.mdc",
      itemPath: rulePath,
      editorId: "cursor",
      scope: "project",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    }, security)).resolves.toMatchObject({
      trashed: true,
      mode: "path",
      path: rulePath,
    })

    expect(trashItem).toHaveBeenCalledWith(rulePath)
  })

  it("removes only the target Synapse rule section from a shared file", async () => {
    const projectRoot = await createTempDir()
    const filePath = path.join(projectRoot, "AGENTS.md")
    await writeFile(
      filePath,
      [
        "# Handwritten",
        "",
        "Keep this.",
        "",
        "<!-- synapse-rule:first:begin -->",
        "# First",
        "<!-- synapse-rule:first:end -->",
        "",
        "<!-- synapse-rule:second:begin -->",
        "# Second",
        "<!-- synapse-rule:second:end -->",
      ].join("\n"),
    )
    const { security } = createAllowingSecurity()
    mockEditorScanProject(projectRoot)

    await trashScanItem({
      itemType: "rule",
      itemName: "first",
      itemPath: filePath,
      editorId: "codex",
      scope: "project",
      source: "synapse",
      trash: { mode: "rule-section", ruleId: "first" },
      synapseContentId: "first",
    }, security)

    const nextContent = await readFile(filePath, "utf8")
    expect(nextContent).not.toContain("synapse-rule:first")
    expect(nextContent).toContain("# Handwritten")
    expect(nextContent).toContain("synapse-rule:second:begin")
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("rejects unsupported shared-file handwritten rules", async () => {
    const projectRoot = await createTempDir()
    const filePath = path.join(projectRoot, "AGENTS.md")
    await writeFile(filePath, "# Handwritten\n")
    const { security } = createAllowingSecurity()
    mockEditorScanProject(projectRoot)

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "Handwritten",
      itemPath: filePath,
      editorId: "codex",
      scope: "project",
      source: "external",
      trash: {
        mode: "unsupported",
        disabledReason: "当前 Rule 没有明确边界，请在 Finder 中处理。",
      },
      synapseContentId: null,
    }, security)).rejects.toThrow("当前 Rule 没有明确边界，请在 Finder 中处理。")

    expect(trashItem).not.toHaveBeenCalled()
  })

  it("rejects path trash outside configured editor scan roots", async () => {
    const projectRoot = await createTempDir()
    const rogueRoot = await createTempDir()
    const rulePath = path.join(rogueRoot, "project.mdc")
    await writeFile(rulePath, "# Rule\n")
    trashItem.mockResolvedValue(undefined)
    const { security } = createAllowingSecurity()
    mockEditorScanProject(projectRoot)

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "project.mdc",
      itemPath: rulePath,
      editorId: "cursor",
      scope: "project",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    }, security)).rejects.toThrow("目标不在当前编辑器扫描范围内。")

    expect(trashItem).not.toHaveBeenCalled()
  })

  it("rejects rule-section trash outside configured editor scan roots", async () => {
    const projectRoot = await createTempDir()
    const rogueRoot = await createTempDir()
    const filePath = path.join(rogueRoot, "AGENTS.md")
    const originalContent = [
      "# Handwritten",
      "",
      "<!-- synapse-rule:first:begin -->",
      "# First",
      "<!-- synapse-rule:first:end -->",
    ].join("\n")
    await writeFile(filePath, originalContent)
    const { security } = createAllowingSecurity()
    mockEditorScanProject(projectRoot)

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "first",
      itemPath: filePath,
      editorId: "codex",
      scope: "project",
      source: "synapse",
      trash: { mode: "rule-section", ruleId: "first" },
      synapseContentId: "first",
    }, security)).rejects.toThrow("目标不在当前编辑器扫描范围内。")

    expect(await readFile(filePath, "utf8")).toBe(originalContent)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("does not trash when permission is denied", async () => {
    const root = await createTempDir()
    const rulePath = path.join(root, "project.md")
    await writeFile(rulePath, "# Rule\n")
    const auditEvents: Array<{ outcome: string; resource: string }> = []
    const auditSink: AuditSink = {
      record: vi.fn((event) => { auditEvents.push(event) }),
      list: vi.fn(() => []),
      clearForTests: vi.fn(),
    }
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(() => () => {}),
      check: vi.fn(async () => ({ allowed: false as const, reason: "denied" })),
    }
    const security = {
      actor: { kind: "user" as const },
      auditSink,
      permissionGuard,
    }

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "project.md",
      itemPath: rulePath,
      editorId: "claude-code",
      scope: "project",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    }, security)).rejects.toThrow("没有写入该位置的权限。")

    expect(trashItem).not.toHaveBeenCalled()
    expect(auditEvents.at(-1)).toMatchObject({
      outcome: "denied",
      resource: rulePath,
    })
  })
})
