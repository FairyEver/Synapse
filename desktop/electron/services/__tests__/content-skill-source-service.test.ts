import { randomUUID } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/synapse-content-skill-source-test-app",
    getPath: (which: string) => `/tmp/synapse-content-skill-source-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => logger,
}))

import { ContentCapabilityError } from "../content-capability-errors"
import {
  CONTENT_SKILL_SOURCE_MAX_DEPTH,
  CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT,
} from "../content-skill-attachment-constraints"
import { readSkillDraftFromDirectory, resolveSkillMainFile } from "../content-skill-source-service"

const tempRoots: string[] = []
const itCanCreateBackslashFile = path.sep === "/" ? it : it.skip

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `synapse-skill-source-${randomUUID()}-`))
  tempRoots.push(root)
  return root
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, "utf8")
}

describe("content skill source service", () => {
  beforeEach(() => {
    logger.warn.mockClear()
    logger.info.mockClear()
    logger.error.mockClear()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("redacts source directory read failure logs", async () => {
    const missingPath = path.join(os.tmpdir(), "synapse-token=sk-secret-source", "private-skill")

    await expect(resolveSkillMainFile(missingPath)).resolves.toBeNull()

    const serializedLogs = JSON.stringify(logger.warn.mock.calls)
    expect(serializedLogs).toContain("sourcePathLength")
    expect(serializedLogs).toContain("[path]")
    expect(serializedLogs).not.toContain(missingPath)
    expect(serializedLogs).not.toContain("sk-secret")
    expect(serializedLogs).not.toContain("dirPath")
  })

  it.skipIf(process.platform === "win32")("redacts attachment directory traversal failure logs", async () => {
    const root = await createTempRoot()
    const blockedDir = path.join(root, "refs-token=sk-secret")
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    await mkdir(blockedDir)
    await chmod(blockedDir, 0)

    try {
      await expect(readSkillDraftFromDirectory(root)).rejects.toThrow("无法读取 Skill 附件目录")
    } finally {
      await chmod(blockedDir, 0o700)
    }

    const serializedLogs = JSON.stringify(logger.warn.mock.calls)
    expect(serializedLogs).toContain("relativePathHash")
    expect(serializedLogs).toContain("relativePathLength")
    expect(serializedLogs).not.toContain(root)
    expect(serializedLogs).not.toContain(blockedDir)
    expect(serializedLogs).not.toContain("refs-token=sk-secret")
    expect(serializedLogs).not.toContain("sk-secret")
    expect(serializedLogs).not.toContain("dirPath")
  })

  it("reads a skill directory with metadata and normalized attachments", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), [
      "---",
      "title: Demo Skill",
      "category: development",
      "---",
      "# Demo Skill",
      "",
      "Use this skill.",
    ].join("\n"))
    await writeText(path.join(root, ".synapse.json"), "{\"id\":\"skill\"}")
    await writeText(path.join(root, ".hidden.md"), "hidden")
    await writeText(path.join(root, "references", "guide.md"), "hello")

    const draft = await readSkillDraftFromDirectory(root)

    expect(draft.mainFilePath).toBe(path.join(root, "SKILL.md"))
    expect(draft.metadata).toMatchObject({
      title: "Demo Skill",
      category: "development",
    })
    expect(draft.files).toHaveLength(1)
    expect(draft.files[0]?.originalName).toBe("references/guide.md")
    expect(Buffer.from(draft.files[0]?.bytes ?? []).toString("utf8")).toBe("hello")
  })

  it.each([".ENV", ".EnV"])(
    "rejects a root runtime %s before hidden-file filtering",
    async (runtimeEnvName) => {
      const root = await createTempRoot()
      await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
      await writeText(path.join(root, runtimeEnvName), "TOKEN=secret\n")

      await expect(readSkillDraftFromDirectory(root))
        .rejects.toThrow("Skill 源目录不能包含 .env，请只提交 .env.example。")
    },
  )

  it.skipIf(process.platform === "win32")("publishes without reading runtime env files and reports excluded entries", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    const blockedEnvDirectory = path.join(root, ".env")
    await writeText(path.join(blockedEnvDirectory, "secret.txt"), "SHOULD_NOT_BE_READ=runtime-only")
    await chmod(blockedEnvDirectory, 0)
    await writeText(path.join(root, ".env.local"), "SHOULD_NOT_BE_READ=runtime-local")
    await writeText(path.join(root, "nested", ".env"), "SHOULD_NOT_BE_READ=nested")
    await writeText(path.join(root, ".env.example"), "API_TOKEN=${API_TOKEN}\n")
    await writeText(path.join(root, ".synapse.json"), JSON.stringify({ id: "content-id" }))
    await writeText(path.join(root, ".synapse.repository.json"), JSON.stringify({ id: "cloud-id" }))
    await writeText(path.join(root, ".hidden", "ignored.md"), "hidden")
    await writeText(path.join(root, "references", "guide.md"), "guide")
    await symlink(path.join(root, "references", "guide.md"), path.join(root, "guide-link.md"))

    const draft = await (async () => {
      try {
        return await readSkillDraftFromDirectory(root, undefined, { mode: "publish" })
      } finally {
        await chmod(blockedEnvDirectory, 0o700)
      }
    })()

    expect(draft.files.map((file) => file.originalName)).toEqual([".env.example", "references/guide.md"])
    expect(draft.sourceImportSummary).toMatchObject({
      controlFilesExcluded: [".synapse.json", ".synapse.repository.json"],
      fileCount: 3,
      hiddenEntryCount: 1,
      runtimeEnvExcluded: true,
      symlinkCount: 1,
    })
    expect(JSON.stringify(draft)).not.toContain("SHOULD_NOT_BE_READ")
  })

  it("blocks high-confidence publish secrets without exposing their value", async () => {
    const root = await createTempRoot()
    const secretValue = "synthetic-webhook-key-12345678901234567890"
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    await writeText(
      path.join(root, ".env.example"),
      `WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${secretValue}\n`,
    )

    const result = readSkillDraftFromDirectory(root, undefined, { mode: "publish" })
    await expect(result).rejects.toThrow("sensitive-url")
    await expect(result).rejects.not.toThrow(secretValue)
  })

  it("allows documented placeholder forms during publish scanning", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), [
      "# Demo Skill",
      "Authorization: Bearer ${API_TOKEN}",
      "https://example.test/callback?token=<placeholder>",
    ].join("\n"))
    await writeText(path.join(root, ".env.example"), "API_TOKEN=replace-me\nPASSWORD=changeme\n")

    await expect(readSkillDraftFromDirectory(root, undefined, { mode: "publish" })).resolves.toMatchObject({
      sourceImportSummary: { fileCount: 2 },
    })
  })

  it("rejects sensitive attachment names", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    await writeText(path.join(root, "secrets", "id_rsa"), "secret")

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow(ContentCapabilityError)
  })

  it("rejects oversized skill main files before reading draft content", async () => {
    const root = await createTempRoot()
    const mainFilePath = path.join(root, "SKILL.md")
    await writeText(mainFilePath, "# Demo Skill")
    await truncate(mainFilePath, 10 * 1024 * 1024 + 1)

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow("Skill 主文件超过 10MB。")
  })

  it("rejects source directories that exceed the attachment directory count budget", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    for (let index = 0; index <= CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT; index += 1) {
      await mkdir(path.join(root, `empty-${index}`))
    }

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow(`Skill 附件目录数量超过 ${CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT} 个。`)
  })

  it("rejects source directories that exceed the attachment directory depth budget", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    let current = root
    for (let depth = 0; depth <= CONTENT_SKILL_SOURCE_MAX_DEPTH; depth += 1) {
      current = path.join(current, `level-${depth}`)
      await mkdir(current)
    }

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow(`Skill 附件目录深度超过 ${CONTENT_SKILL_SOURCE_MAX_DEPTH} 层。`)
  })

  it.skipIf(process.platform === "win32")("rejects unreadable attachments instead of returning an incomplete draft", async () => {
    const root = await createTempRoot()
    const attachmentPath = path.join(root, "references", "guide.md")
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    await writeText(attachmentPath, "guide")
    await chmod(attachmentPath, 0)

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow("无法读取 Skill 附件：references/guide.md")
  })

  it("rejects a symlinked skill main file", async () => {
    const root = await createTempRoot()
    const outside = await createTempRoot()
    await writeText(path.join(outside, "secret.md"), "# Outside Secret")
    await symlink(path.join(outside, "secret.md"), path.join(root, "SKILL.md"))

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow("Skill 主文件不能是符号链接")
  })

  itCanCreateBackslashFile("rejects duplicate paths after normalization", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    await writeText(path.join(root, "refs", "a.md"), "a")
    await writeText(path.join(root, "refs\\a.md"), "b")

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow(ContentCapabilityError)
  })

  it("checks read permission when security dependencies are provided", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({
        allowed: false,
        reason: "denied",
        policyId: "policy",
      }),
      registerPolicy: vi.fn(() => () => {}),
    }

    await expect(readSkillDraftFromDirectory(root, {
      actor: { kind: "agent", id: "mcp-client" },
      auditSink,
      permissionGuard,
    })).rejects.toThrow("denied")
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: root,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "denied",
      resource: root,
    }))
  })
})
