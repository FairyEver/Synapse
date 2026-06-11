import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
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

const authenticatedState = {
  status: "authenticated" as const,
  connectivity: "online" as const,
  profile: {
    user: {
      id: "user-1",
      email: "user@example.test",
      displayName: null,
      status: "active" as const,
    },
    teams: [],
    syncedAt: "2026-06-10T00:00:00.000Z",
  },
}

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

  it("uploads a local Skill directory as strict base64 draft files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-store-skill-"))
    await mkdir(path.join(dir, "assets"))
    await writeFile(path.join(dir, "SKILL.md"), [
      "---",
      "title: Review Skill",
      "description: Review code changes.",
      "---",
      "# Fallback title",
      "",
      "Body",
    ].join("\n"))
    await writeFile(path.join(dir, "assets", "guide.txt"), "hello")
    const skillContentBase64 = Buffer.from(await readFile(path.join(dir, "SKILL.md"))).toString("base64")
    const createContentStoreSkillDraft = vi.fn(async (input) => ({
      id: "draft-1",
      itemId: "item-1",
      baseVersionId: null,
      revision: 2,
      title: input.title,
      description: input.description,
      body: null,
      files: [],
      updatedAt: "2026-06-10T00:00:00.000Z",
    }))
    const service = new ContentStoreUploadService({
      accountService: { getState: () => authenticatedState, createContentStoreSkillDraft },
      publicAppUrl: "https://synapse.example.test/",
    })

    await expect(service.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: dir,
      itemName: "fallback-skill",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/Users/example/project",
    })).resolves.toEqual({
      draftId: "draft-1",
      itemId: "item-1",
      revision: 2,
      consoleEditUrl: "https://synapse.example.test/console/my-content/item-1/edit",
      dashboardEditUrl: "https://synapse.example.test/console/my-content/item-1/edit",
    })

    expect(createContentStoreSkillDraft).toHaveBeenCalledWith({
      type: "skill",
      title: "Review Skill",
      description: "Review code changes.",
      localSourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      files: [
        {
          path: "SKILL.md",
          contentBase64: skillContentBase64,
          mimeType: "text/markdown",
        },
        {
          path: "assets/guide.txt",
          contentBase64: Buffer.from("hello").toString("base64"),
          mimeType: null,
        },
      ],
    })
  })

  it("requires root SKILL.md even when another markdown file can be read", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-store-readme-"))
    await writeFile(path.join(dir, "README.md"), "# Readme Skill\n")
    const service = new ContentStoreUploadService({
      accountService: { getState: () => authenticatedState, createContentStoreSkillDraft: vi.fn() },
    })

    await expect(service.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: dir,
      itemName: "readme-skill",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("Skill 必须包含根目录 SKILL.md。")
  })

  it("rejects unauthenticated uploads before reading local Skill files", async () => {
    const createContentStoreSkillDraft = vi.fn()
    const service = new ContentStoreUploadService({
      accountService: {
        getState: () => ({ status: "unauthenticated" }),
        createContentStoreSkillDraft,
      },
    })

    await expect(service.uploadSkillDraftToContentStore({
      itemType: "skill",
      itemPath: path.join(os.tmpdir(), "missing-skill"),
      itemName: "missing-skill",
      editorId: "claude-code",
      scope: "global",
    })).rejects.toThrow("账号未登录。")

    expect(createContentStoreSkillDraft).not.toHaveBeenCalled()
  })

  it("builds Console edit URLs from the public app URL", () => {
    expect(buildContentStoreConsoleEditUrl("https://synapse.example.test", "item 1")).toBe(
      "https://synapse.example.test/console/my-content/item%201/edit",
    )
  })
})
