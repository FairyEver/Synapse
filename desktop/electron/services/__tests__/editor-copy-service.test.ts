import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-editor-copy-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    getAppPath: () => "/tmp/synapse-editor-copy-test-app",
    isPackaged: false,
  },
}))

const logStoreMock = vi.hoisted(() => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => logStoreMock.logger,
}))

import { EditorCopyService } from "../editor-copy-service"
import type { SynapseEditorCopySource } from "../../../src/types/editor-copy"
import { createDefaultConfig } from "../../../src/lib/config"
import { configStore } from "../config-store"
import {
  createPermissionGuard,
  InMemoryAuditSink,
} from "../../runtime/security"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-copy-"))
  tempRoots.push(root)
  return root
}

function createRuleSource(filePath: string): SynapseEditorCopySource {
  return {
    editorId: "claude-code",
    itemName: "review-rule.md",
    itemPath: filePath,
    itemType: "rule",
    scope: "project",
  }
}

function createSkillSource(directoryPath: string): SynapseEditorCopySource {
  return {
    editorId: "claude-code",
    itemName: "review-skill",
    itemPath: directoryPath,
    itemType: "skill",
    scope: "project",
    synapseContentId: "skill-review",
  }
}

function mockConfiguredProjects(paths: string[]): void {
  const config = createDefaultConfig()
  config.global.projects = paths.map((projectPath, index) => ({
    id: `project-${index + 1}`,
    name: `Project ${index + 1}`,
    path: projectPath,
  }))
  vi.spyOn(configStore, "load").mockResolvedValue(config)
}

describe("EditorCopyService", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    logStoreMock.logger.info.mockClear()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("resolves Cursor project rule targets from the source rule name and reports existing targets", async () => {
    const root = await createTempRoot()
    const sourcePath = path.join(root, "source", "review-rule.md")
    const projectPath = path.join(root, "project")
    const targetPath = path.join(projectPath, ".cursor", "rules", "review-rule.mdc")
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(sourcePath, "Review carefully.", "utf8")
    await writeFile(targetPath, "Existing rule.", "utf8")
    mockConfiguredProjects([projectPath])

    const service = new EditorCopyService()
    const target = await service.resolveTarget({
      source: createRuleSource(sourcePath),
      targetEditorId: "cursor",
      targetProjectPath: projectPath,
      targetScope: "project",
    })

    expect(target).toMatchObject({
      editorId: "cursor",
      scope: "project",
      status: "ready",
      targetExists: true,
      targetKind: "file",
      targetPath,
    })
  })

  it("rejects scanned rule names that are reserved Windows filenames", async () => {
    const root = await createTempRoot()
    const sourcePath = path.join(root, "source", "CON.md")
    const projectPath = path.join(root, "project")
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await mkdir(projectPath, { recursive: true })
    await writeFile(sourcePath, "Reserved rule.", "utf8")
    mockConfiguredProjects([projectPath])

    const service = new EditorCopyService()

    await expect(service.resolveTarget({
      source: {
        ...createRuleSource(sourcePath),
        itemName: "CON.md",
      },
      targetEditorId: "cursor",
      targetProjectPath: projectPath,
      targetScope: "project",
    })).rejects.toThrow("Windows 系统保留字")
  })

  it("rejects copy targets that resolve to the same path as the source", async () => {
    const root = await createTempRoot()
    const sourcePath = path.join(root, "project", "AGENTS.md")
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, "Project rule.", "utf8")
    mockConfiguredProjects([path.dirname(sourcePath)])

    const service = new EditorCopyService()
    const target = await service.resolveTarget({
      source: {
        ...createRuleSource(sourcePath),
        editorId: "codex",
        itemName: "AGENTS.md",
      },
      targetEditorId: "codex",
      targetProjectPath: path.dirname(sourcePath),
      targetScope: "project",
    })

    expect(target).toMatchObject({
      message: "目标位置与源位置相同",
      status: "unavailable",
      targetKind: null,
      targetPath: null,
    })
  })

  it("requires overwrite confirmation before replacing an existing target", async () => {
    const root = await createTempRoot()
    const sourcePath = path.join(root, "source", "review-rule.md")
    const projectPath = path.join(root, "project")
    const targetPath = path.join(projectPath, ".cursor", "rules", "review-rule.mdc")
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(sourcePath, "Review carefully.", "utf8")
    await writeFile(targetPath, "Existing rule.", "utf8")
    mockConfiguredProjects([projectPath])

    const service = new EditorCopyService()

    await expect(service.copy({
      source: createRuleSource(sourcePath),
      targetEditorId: "cursor",
      targetProjectPath: projectPath,
      targetScope: "project",
    })).rejects.toThrow("目标位置已有内容。")

    await service.copy({
      overwriteConfirmed: true,
      source: createRuleSource(sourcePath),
      targetEditorId: "cursor",
      targetProjectPath: projectPath,
      targetScope: "project",
    })

    await expect(readFile(targetPath, "utf8")).resolves.toContain("Review carefully.")
    const copyLog = logStoreMock.logger.info.mock.calls.find(([message]) =>
      message === "Copied scan item to editor target.")
    expect(copyLog).toEqual([
      "Copied scan item to editor target.",
      expect.objectContaining({
        sourceName: "review-rule.md",
        targetName: "review-rule.mdc",
      }),
    ])
    expect(JSON.stringify(copyLog)).not.toContain(sourcePath)
    expect(JSON.stringify(copyLog)).not.toContain(targetPath)
  })

  it("clones the complete Skill instance including runtime env while excluding VCS metadata", async () => {
    const root = await createTempRoot()
    const sourceProjectPath = path.join(root, "source-project")
    const targetProjectPath = path.join(root, "target-project")
    const sourcePath = path.join(sourceProjectPath, ".claude", "skills", "review-skill")
    const targetPath = path.join(targetProjectPath, ".agents", "skills", "review-skill")
    await mkdir(path.join(sourcePath, ".git"), { recursive: true })
    await mkdir(path.join(sourcePath, "scripts"), { recursive: true })
    await mkdir(targetProjectPath, { recursive: true })
    await writeFile(path.join(sourcePath, "SKILL.md"), "# Review Skill\n", "utf8")
    await writeFile(path.join(sourcePath, ".env"), "TOKEN=source-secret\n", "utf8")
    await writeFile(path.join(sourcePath, ".hidden-config"), "enabled\n", "utf8")
    await writeFile(path.join(sourcePath, "scripts", "run.sh"), "exit 0\n", "utf8")
    await writeFile(path.join(sourcePath, ".git", "config"), "private git metadata\n", "utf8")
    await writeFile(path.join(sourcePath, ".synapse.json"), JSON.stringify({ id: "skill-review" }), "utf8")
    mockConfiguredProjects([sourceProjectPath, targetProjectPath])

    const auditSink = new InMemoryAuditSink()
    const service = new EditorCopyService()
    const result = await service.copy({
      source: createSkillSource(sourcePath),
      targetEditorId: "codex",
      targetProjectPath,
      targetScope: "project",
    }, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard: createPermissionGuard(),
    })

    expect(result).toMatchObject({
      contentType: "skill",
      overwritten: false,
      targetPath,
    })
    await expect(readFile(path.join(targetPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=source-secret\n")
    await expect(readFile(path.join(targetPath, ".hidden-config"), "utf8"))
      .resolves.toBe("enabled\n")
    await expect(readFile(path.join(targetPath, "scripts", "run.sh"), "utf8"))
      .resolves.toBe("exit 0\n")
    await expect(readFile(path.join(targetPath, ".git", "config"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
    expect(auditSink.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "allowed",
        resource: sourcePath,
      }),
      expect.objectContaining({
        action: "fs.write",
        outcome: "allowed",
        resource: targetPath,
      }),
    ]))
  })

  it("requires confirmation and replaces an existing same-Skill instance with the source runtime env", async () => {
    const root = await createTempRoot()
    const sourceProjectPath = path.join(root, "source-project")
    const targetProjectPath = path.join(root, "target-project")
    const sourcePath = path.join(sourceProjectPath, ".claude", "skills", "review-skill")
    const targetPath = path.join(targetProjectPath, ".agents", "skills", "review-skill")
    await mkdir(sourcePath, { recursive: true })
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(sourcePath, "SKILL.md"), "# Source Skill\n", "utf8")
    await writeFile(path.join(sourcePath, ".env"), "TOKEN=source-secret\n", "utf8")
    await writeFile(path.join(sourcePath, ".synapse.json"), JSON.stringify({ id: "skill-review" }), "utf8")
    await writeFile(path.join(targetPath, "SKILL.md"), "# Target Skill\n", "utf8")
    await writeFile(path.join(targetPath, ".env"), "TOKEN=target-secret\n", "utf8")
    await writeFile(path.join(targetPath, "target-only.txt"), "remove me\n", "utf8")
    await writeFile(path.join(targetPath, ".synapse.json"), JSON.stringify({ id: "skill-review" }), "utf8")
    mockConfiguredProjects([sourceProjectPath, targetProjectPath])

    const service = new EditorCopyService()
    const request = {
      source: createSkillSource(sourcePath),
      targetEditorId: "codex" as const,
      targetProjectPath,
      targetScope: "project" as const,
    }

    await expect(service.copy(request)).rejects.toThrow("目标位置已有内容")
    await expect(service.copy({ ...request, overwriteConfirmed: true })).resolves.toMatchObject({
      overwritten: true,
      targetPath,
    })
    await expect(readFile(path.join(targetPath, "SKILL.md"), "utf8"))
      .resolves.toBe("# Source Skill\n")
    await expect(readFile(path.join(targetPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=source-secret\n")
    await expect(readFile(path.join(targetPath, "target-only.txt"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("records an allowed fs.write audit after copying to an editor target", async () => {
    const root = await createTempRoot()
    const sourceProjectPath = path.join(root, "source-project")
    const targetProjectPath = path.join(root, "target-project")
    const sourcePath = path.join(sourceProjectPath, ".cursor", "rules", "review-rule.mdc")
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await mkdir(targetProjectPath, { recursive: true })
    await writeFile(sourcePath, "Review carefully.", "utf8")
    mockConfiguredProjects([sourceProjectPath, targetProjectPath])

    const auditSink = new InMemoryAuditSink()
    const service = new EditorCopyService()
    const result = await service.copy({
      source: createRuleSource(sourcePath),
      targetEditorId: "cursor",
      targetProjectPath: targetProjectPath,
      targetScope: "project",
    }, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard: createPermissionGuard(),
    })

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        actor: { kind: "user" },
        outcome: "allowed",
        resource: sourcePath,
      }),
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        outcome: "allowed",
        resource: result.targetPath,
      }),
    ])
  })

  it("rejects project copy targets whose project path is not configured", async () => {
    const configuredRoot = await createTempRoot()
    const rogueRoot = await createTempRoot()
    mockConfiguredProjects([configuredRoot])

    const service = new EditorCopyService()

    await expect(service.resolveTarget({
      source: createRuleSource(path.join(configuredRoot, ".cursor", "rules", "review-rule.mdc")),
      targetEditorId: "cursor",
      targetProjectPath: rogueRoot,
      targetScope: "project",
    })).rejects.toThrow("项目路径不在已配置项目中。")
  })

  it("checks source read permission before copying to an editor target", async () => {
    const root = await createTempRoot()
    const sourceProjectPath = path.join(root, "source-project")
    const targetProjectPath = path.join(root, "target-project")
    const sourcePath = path.join(sourceProjectPath, ".cursor", "rules", "review-rule.mdc")
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await mkdir(targetProjectPath, { recursive: true })
    await writeFile(sourcePath, "Review carefully.", "utf8")
    mockConfiguredProjects([sourceProjectPath, targetProjectPath])

    const auditSink = new InMemoryAuditSink()
    const permissionGuard = createPermissionGuard()
    permissionGuard.registerPolicy({
      decide: (request) => request.action === "fs.read.outside-userdata"
        ? "deny"
        : "defer-to-next",
      id: "deny-source-read",
    })
    const service = new EditorCopyService()

    await expect(service.copy({
      source: createRuleSource(sourcePath),
      targetEditorId: "cursor",
      targetProjectPath,
      targetScope: "project",
    }, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard,
    })).rejects.toThrow("denied by deny-source-read")

    expect(auditSink.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "denied",
        resource: sourcePath,
      }),
    ]))
  })
})
