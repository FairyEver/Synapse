import { randomUUID } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/synapse-content-skill-source-test-app",
    getPath: (which: string) => `/tmp/synapse-content-skill-source-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import { ContentCapabilityError } from "../content-capability-errors"
import { readSkillDraftFromDirectory } from "../content-skill-source-service"

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
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
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

  it("rejects sensitive attachment names", async () => {
    const root = await createTempRoot()
    await writeText(path.join(root, "SKILL.md"), "# Demo Skill")
    await writeText(path.join(root, "secrets", "id_rsa"), "secret")

    await expect(readSkillDraftFromDirectory(root)).rejects.toThrow(ContentCapabilityError)
  })

  it("rejects unreadable attachments instead of returning an incomplete draft", async () => {
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
