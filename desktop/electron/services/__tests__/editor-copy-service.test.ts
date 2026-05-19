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
