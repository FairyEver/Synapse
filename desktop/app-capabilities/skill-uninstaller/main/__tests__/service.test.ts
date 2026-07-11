import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../../electron/services/log-store", () => ({
  createMainLogger: () => ({ warn: vi.fn() }),
}))

import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import { SkillUninstallerService, type SkillUninstallerSecurity } from "../service"

type SecurityHarness = {
  auditRecord: ReturnType<typeof vi.fn>
  permissionCheck: ReturnType<typeof vi.fn>
  security: SkillUninstallerSecurity
}

function createSecurity(allowed = true): SecurityHarness {
  const permissionCheck = vi.fn().mockResolvedValue(
    allowed ? { allowed: true } : { allowed: false, reason: "denied" },
  )
  const auditRecord = vi.fn()
  return {
    auditRecord,
    permissionCheck,
    security: {
      actor: { kind: "user", id: "test-user" },
      permissionGuard: {
        check: permissionCheck,
        registerPolicy: vi.fn(),
      } as unknown as PermissionGuard,
      auditSink: {
        record: auditRecord,
        list: vi.fn(() => []),
        clearForTests: vi.fn(),
      } as unknown as AuditSink,
    },
  }
}

async function createSkill(parent: string, name: string, frontmatterName = name): Promise<string> {
  const skillPath = path.join(parent, name)
  await mkdir(skillPath, { recursive: true })
  await writeFile(path.join(skillPath, "SKILL.md"), `---\nname: ${frontmatterName}\n---\n`)
  return skillPath
}

describe("SkillUninstallerService", () => {
  let tempRoot = ""

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-uninstaller-"))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it("scans external Skills below a permitted custom root", async () => {
    const targetPath = await createSkill(tempRoot, "jenkins")
    const { security, permissionCheck, auditRecord } = createSecurity()
    const service = new SkillUninstallerService({ trashItem: vi.fn() })

    const result = await service.scan({ name: "jenkins", searchRootPath: tempRoot }, security)

    expect(result.candidates).toEqual([expect.objectContaining({
      path: await realpath(targetPath),
      source: "external",
    })])
    expect(permissionCheck).toHaveBeenCalledTimes(1)
    expect(permissionCheck).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: tempRoot,
    }))
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
    }))
  })

  it("denies a custom-root scan before reading it", async () => {
    await createSkill(tempRoot, "jenkins")
    const { security, auditRecord } = createSecurity(false)
    const service = new SkillUninstallerService({ trashItem: vi.fn() })

    await expect(service.scan({
      name: "jenkins",
      searchRootPath: tempRoot,
    }, security)).rejects.toThrow("搜索目录不存在或无法读取。")
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "denied",
    }))
  })

  it("skips a target substituted outside its scan root", async () => {
    const scanRoot = path.join(tempRoot, "scan")
    const outsideRoot = path.join(tempRoot, "outside")
    await mkdir(scanRoot)
    await mkdir(outsideRoot)
    const outsidePath = await createSkill(outsideRoot, "jenkins")
    const trashItem = vi.fn()
    const { security } = createSecurity()
    const service = new SkillUninstallerService({ trashItem })

    const result = await service.uninstall([
      { query: { name: "jenkins", searchRootPath: scanRoot }, path: outsidePath },
    ], security)

    expect(result.results[0]).toEqual({
      path: outsidePath,
      status: "skipped",
      error: "目标不在本次扫描范围内，已跳过。",
    })
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("trashes a valid target below the POSIX filesystem root", async () => {
    const targetPath = await createSkill(tempRoot, "jenkins")
    const trashItem = vi.fn().mockResolvedValue(undefined)
    const { security } = createSecurity()
    const service = new SkillUninstallerService({ trashItem })

    const result = await service.uninstall([
      {
        query: { name: "jenkins", searchRootPath: path.parse(targetPath).root },
        path: targetPath,
      },
    ], security)

    expect(result.results[0]).toMatchObject({ status: "trashed" })
    expect(trashItem).toHaveBeenCalledWith(targetPath)
  })

  it("skips a target that changes name after scanning", async () => {
    const targetPath = await createSkill(tempRoot, "target", "jenkins")
    await writeFile(path.join(targetPath, "SKILL.md"), "---\nname: changed\n---\n")
    const trashItem = vi.fn()
    const { security } = createSecurity()
    const service = new SkillUninstallerService({ trashItem })

    const result = await service.uninstall([
      { query: { name: "jenkins", searchRootPath: tempRoot }, path: targetPath },
    ], security)

    expect(result.results[0]).toMatchObject({
      status: "skipped",
      error: "目标已发生变化，已跳过。",
    })
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("trashes external Skills sequentially and keeps later targets after one failure", async () => {
    const firstPath = await createSkill(tempRoot, "first")
    const secondPath = await createSkill(tempRoot, "second")
    const order: string[] = []
    const service = new SkillUninstallerService({
      trashItem: async (targetPath) => {
        order.push(targetPath)
        if (targetPath.endsWith("first")) throw new Error("denied")
      },
    })
    const { security, auditRecord } = createSecurity()

    const result = await service.uninstall([
      { query: { name: "first", searchRootPath: tempRoot }, path: firstPath },
      { query: { name: "second", searchRootPath: tempRoot }, path: secondPath },
    ], security)

    expect(order).toEqual([firstPath, secondPath])
    expect(result.results.map((item) => item.status)).toEqual(["failed", "trashed"])
    expect(result.results[0]?.error).toBe("移到废纸篓失败。")
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      metadata: { operation: "skill-uninstall" },
      outcome: "failed",
    }))
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      metadata: { operation: "skill-uninstall" },
      outcome: "allowed",
    }))
  })

  it("returns a stable failure when write permission is denied", async () => {
    const targetPath = await createSkill(tempRoot, "jenkins")
    const trashItem = vi.fn()
    const { security, auditRecord } = createSecurity(false)
    const service = new SkillUninstallerService({ trashItem })

    const result = await service.uninstall([
      { query: { name: "jenkins", searchRootPath: tempRoot }, path: targetPath },
    ], security)

    expect(result.results[0]).toEqual({
      path: targetPath,
      status: "failed",
      error: "没有写入该位置的权限。",
    })
    expect(trashItem).not.toHaveBeenCalled()
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
  })

  it("refreshes Synapse content after trash and ignores refresh failure", async () => {
    const targetPath = await createSkill(tempRoot, "jenkins")
    await writeFile(path.join(targetPath, ".synapse.json"), JSON.stringify({ id: "content-1" }))
    const trashItem = vi.fn().mockResolvedValue(undefined)
    const onTrashedContentId = vi.fn().mockRejectedValue(new Error("refresh failed"))
    const { security } = createSecurity()
    const service = new SkillUninstallerService({ trashItem })

    const result = await service.uninstall([
      { query: { name: "jenkins", searchRootPath: tempRoot }, path: targetPath },
    ], security, { onTrashedContentId })

    expect(result.results[0]).toMatchObject({ status: "trashed" })
    expect(onTrashedContentId).toHaveBeenCalledWith("content-1")
  })
})
