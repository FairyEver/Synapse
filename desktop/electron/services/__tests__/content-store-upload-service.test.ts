import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const serviceLogger = vi.hoisted(() => {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
})

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-content-store-upload-${name}`),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher: Buffer) => cipher.toString("utf8"),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => serviceLogger,
}))

import {
  buildContentStoreConsoleEditUrl,
  ContentStoreUploadService,
  createLocalSourceFingerprint,
} from "../content-store-upload-service"

describe("ContentStoreUploadService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("computes stable hashed fingerprints without exposing absolute paths", () => {
    const input = {
      editorId: "claude-code" as const,
      scope: "project" as const,
      projectPath: "/Users/example/project",
      sourceDirectoryPath: "/Users/example/project/.claude/skills/review",
    }

    const first = createLocalSourceFingerprint(input)
    const second = createLocalSourceFingerprint({
      ...input,
      projectPath: "/Users/example/project/",
      sourceDirectoryPath: "/Users/example/project/.claude/skills/review/",
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
    expect(first).not.toContain("/Users/example")
  })

  it("folds Windows case-equivalent paths in local source fingerprints", () => {
    const input = {
      editorId: "claude-code" as const,
      scope: "project" as const,
      projectPath: "C:\\Work\\Repo",
      sourceDirectoryPath: "C:\\Work\\Repo\\.claude\\skills\\review",
      platform: "win32" as const,
    }

    const first = createLocalSourceFingerprint(input)
    const second = createLocalSourceFingerprint({
      ...input,
      projectPath: "c:\\work\\repo\\",
      sourceDirectoryPath: "c:\\work\\repo\\.claude\\skills\\REVIEW\\",
    })

    expect(second).toBe(first)
  })

  it("delegates scanned Skill uploads to the Skill Repository uploader", async () => {
    const importLocal = vi.fn(async () => localImportResult())
    const service = new ContentStoreUploadService({
      uploader: { importLocal },
    })
    const security = {
      actor: { kind: "user" as const },
      auditSink: { record: vi.fn(), list: vi.fn(), clearForTests: vi.fn() },
      permissionGuard: { check: vi.fn(), registerPolicy: vi.fn() },
    }

    await expect(service.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "fallback-skill",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/Users/example/project",
    }, security)).resolves.toEqual({
      draftId: "repo-1",
      itemId: "repo-1",
      revision: 1,
      consoleEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      dashboardEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
    })

    expect(importLocal).toHaveBeenCalledWith({
      sourceDirectoryPath: "/tmp/skills/review",
      name: "fallback-skill",
      openInBrowser: false,
    }, security)
  })

  it("returns the uploader management URL even when identity writing reports a warning", async () => {
    const importLocal = vi.fn(async () => localImportResult({
      identityWritten: false,
      identityWriteError: "disk full",
    }))
    const service = new ContentStoreUploadService({
      uploader: { importLocal },
    })

    await expect(service.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).resolves.toMatchObject({
      itemId: "repo-1",
      consoleEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      dashboardEditUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
    })
  })

  it("uses the repository id returned by the uploader for repeated uploads", async () => {
    const importLocal = vi.fn(async () => localImportResult({ repositoryId: "repo-local" }))
    const service = new ContentStoreUploadService({
      uploader: { importLocal },
    })

    await expect(service.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
    })).resolves.toMatchObject({
      draftId: "repo-local",
      itemId: "repo-local",
    })
  })

  it("propagates uploader failures", async () => {
    const importLocal = vi.fn(async () => {
      throw new Error("账号未登录。")
    })
    const service = new ContentStoreUploadService({
      uploader: { importLocal },
    })

    await expect(service.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: path.join(os.tmpdir(), "missing-skill"),
      itemName: "missing-skill",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("账号未登录。")
  })

  it("builds Synapse edit URLs from the public app URL", () => {
    expect(buildContentStoreConsoleEditUrl("https://synapse.example.test", "item 1")).toBe(
      "https://synapse.example.test/console/skill-repositories/item%201",
    )
  })
})

function localImportResult(overrides: Partial<{
  readonly repositoryId: string
  readonly name: string
  readonly owner: string | null
  readonly managementUrl: string
  readonly identityWritten: boolean
  readonly identityWriteError: string
}> = {}) {
  return {
    repositoryId: "repo-1",
    name: "review-skill",
    owner: "liyang",
    managementUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
    identityWritten: true,
    ...overrides,
  }
}
