import { constants } from "node:fs"
import { chmod, link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import type { TrustedSkillRoot } from "../../../../electron/services/editor-scan-roots"
import { SKILL_RUNTIME_ENV_MAX_BYTES } from "../../../../electron/services/skill-env/file-policy"
import {
  createSkillEnvBindingService,
  removeAtomicTempFile,
  sameIdentity,
} from "../skill-env-binding-service"

const tempRoots: string[] = []

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("SkillEnvBindingService", () => {
  it("reports a missing default atomic temp file instead of treating it as removed", async () => {
    const root = await createRoot()
    const tempPath = path.join(root, ".synapse-env-missing.tmp")

    await expect(removeAtomicTempFile(tempPath)).rejects.toMatchObject({ code: "ENOENT" })
    await writeFile(tempPath, "staged")
    await expect(removeAtomicTempFile(tempPath)).resolves.toBeUndefined()
    await expect(stat(tempPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("fails closed when stable file identity is unavailable", () => {
    const unavailable = {
      dev: 0n,
      ino: 0n,
      size: 10n,
      mtimeMs: 20n,
      ctimeMs: 30n,
      birthtimeMs: 40n,
    }

    expect(sameIdentity(unavailable, unavailable)).toBe(false)
  })

  it("compares file identities above Number.MAX_SAFE_INTEGER without precision loss", () => {
    const base = BigInt(Number.MAX_SAFE_INTEGER) + 1n

    expect(sameIdentity(
      { dev: base, ino: base + 2n },
      { dev: base, ino: base + 2n },
    )).toBe(true)
    expect(sameIdentity(
      { dev: base, ino: base + 2n },
      { dev: base, ino: base + 3n },
    )).toBe(false)
  })

  it("scans safe metadata and classifies update state without exposing values", async () => {
    const root = await createRoot()
    await createSkill(root, "needs", "TOKEN=old-secret\n")
    await createSkill(root, "current", "token=new-secret\n")
    await createSkill(root, "invalid", "TOKEN='unterminated\n")
    const readOnly = await createSkill(root, "readonly", "TOKEN=old-secret\n")
    await chmod(path.join(readOnly, ".env"), 0o444)
    const linked = await createSkill(root, "linked", "OTHER=value\n")
    await symlink(path.join(root, "needs", ".env"), path.join(linked, ".env.link"))
    await writeFile(path.join(linked, ".env"), "TOKEN=placeholder\n")
    const linkedEnv = path.join(linked, ".env")
    const { rm } = await import("node:fs/promises")
    await rm(linkedEnv)
    await symlink(path.join(root, "needs", ".env"), linkedEnv)

    const harness = createHarness([trustedRoot(root)])
    const result = await harness.service.scan("TOKEN", "new-secret", harness.security)

    expect(result.items.map(({ skillName, status }) => ({ skillName, status }))).toEqual([
      { skillName: "invalid", status: "invalid" },
      { skillName: "linked", status: "unsafe_link" },
      { skillName: "needs", status: "needs_update" },
      { skillName: "readonly", status: "unwritable" },
    ])
    expect(result.items[0]).toMatchObject({
      editors: [{ id: "codex", label: "Codex" }, { id: "claude-code", label: "Claude Code" }],
      scope: "global",
    })
    const publicJson = JSON.stringify(result)
    expect(publicJson).not.toContain("old-secret")
    expect(publicJson).not.toContain("new-secret")
    expect(JSON.stringify(harness.auditEvents)).not.toContain("old-secret")
    expect(JSON.stringify(harness.auditEvents)).not.toContain("new-secret")
  })

  it("does not recurse below direct child Skill directories", async () => {
    const root = await createRoot()
    await createSkill(path.join(root, "group"), "nested", "TOKEN=old\n")

    const harness = createHarness([trustedRoot(root)])
    const result = await harness.service.scan("TOKEN", "new", harness.security)

    expect(result.items).toEqual([])
  })

  it("fails closed when a trusted root is replaced with a symlink", async () => {
    const realRoot = await createRoot()
    await createSkill(realRoot, "demo", "TOKEN=old\n")
    const parent = await createRoot()
    const linkedRoot = path.join(parent, "skills")
    await symlink(realRoot, linkedRoot)

    const harness = createHarness([trustedRoot(linkedRoot)])
    const result = await harness.service.scan("TOKEN", "new", harness.security)

    expect(result.items).toEqual([])
  })

  it("fails closed when a Skill parent is replaced with a symlink", async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const realSkill = await createSkill(outside, "real", "TOKEN=old\n")
    await symlink(realSkill, path.join(root, "demo"))

    const harness = createHarness([trustedRoot(root)])
    const result = await harness.service.scan("TOKEN", "new", harness.security)

    expect(result.items).toEqual([])
  })

  it("discards a candidate when the root changes after its precheck", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    const replacement = await createRoot()
    await createSkill(replacement, "demo", "TOKEN=old\n")
    let swapped = false
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      async (phase) => {
        if (phase !== "scan" || swapped) return
        swapped = true
        const oldRoot = `${root}-old`
        await rename(root, oldRoot)
        tempRoots.push(oldRoot)
        await rename(replacement, root)
      },
    )

    const result = await harness.service.scan("TOKEN", "new", harness.security)

    expect(swapped).toBe(true)
    expect(result.items).toEqual([])
  })

  it("expires a scan session at exactly 300000 milliseconds", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    let now = 10
    const harness = createHarness([trustedRoot(root)], () => now)
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    now += 300_000

    await expect(harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)).rejects.toThrow("扫描会话已过期")
  })

  it("rejects a forged item id and a different secret name", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    await expect(harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: ["forged"],
    }, async () => "new", harness.security)).rejects.toThrow("扫描项目无效")
    await expect(harness.service.enqueue({
      name: "OTHER",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)).rejects.toThrow("密钥名称不匹配")
  })

  it("reports a hash conflict but continues updating later selected items", async () => {
    const root = await createRoot()
    const first = await createSkill(root, "first", "TOKEN=old-first\n")
    const second = await createSkill(root, "second", "TOKEN=old-second\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new-secret", harness.security)
    const byName = new Map(scan.items.map((item) => [item.skillName, item]))
    await writeFile(path.join(first, ".env"), "TOKEN=changed-after-scan\n")

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("first")!.id, byName.get("second")!.id],
    }, async () => "new-secret", harness.security)

    expect(result.items.map(({ skillName, status }) => ({ skillName, status }))).toEqual([
      { skillName: "first", status: "conflict" },
      { skillName: "second", status: "updated" },
    ])
    expect(await readFile(path.join(first, ".env"), "utf8")).toContain("changed-after-scan")
    expect(await readFile(path.join(second, ".env"), "utf8")).toBe('TOKEN="new-secret"\n')
    expect(JSON.stringify(result)).not.toContain("new-secret")
    expect(JSON.stringify(harness.auditEvents)).not.toContain("new-secret")
  })

  it("updates only the exact key and rejects symlink changes before writes", async () => {
    const root = await createRoot()
    const duplicate = await createSkill(root, "duplicate", "TOKEN=old\ntoken=other\n")
    const linked = await createSkill(root, "linked", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    const byName = new Map(scan.items.map((item) => [item.skillName, item]))
    const linkedEnv = path.join(linked, ".env")
    const { rm } = await import("node:fs/promises")
    await rm(linkedEnv)
    await symlink(path.join(duplicate, ".env"), linkedEnv)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("duplicate")!.id, byName.get("linked")!.id],
    }, async () => "new", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "duplicate", status: "updated" }),
      expect.objectContaining({ skillName: "linked", status: "failed" }),
    ])
    expect(await readFile(path.join(duplicate, ".env"), "utf8"))
      .toBe('TOKEN="new"\ntoken=other\n')
  })

  it("does not write through a Skill parent swapped after scanning", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const outside = await createRoot()
    const replacement = await createSkill(outside, "replacement", "TOKEN=outside\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    await rename(skill, path.join(root, "demo-old"))
    await symlink(replacement, skill)
    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "failed" }),
    ])
    expect(await readFile(path.join(replacement, ".env"), "utf8")).toBe("TOKEN=outside\n")
  })

  it("conflicts when the root is replaced with identical content", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const replacement = await createRoot()
    await createSkill(replacement, "demo", "TOKEN=old\n")
    const oldRoot = `${root}-old`
    await rename(root, oldRoot)
    tempRoots.push(oldRoot)
    await rename(replacement, root)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
  })

  it("conflicts when a Skill directory is replaced with identical content", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const replacement = path.join(root, "replacement-skill")
    await mkdir(replacement)
    await writeFile(path.join(replacement, "SKILL.md"), "# demo\n")
    await writeFile(path.join(replacement, ".env"), "TOKEN=old\n")
    await rename(skill, path.join(root, "demo-old"))
    await rename(replacement, skill)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
  })

  it("conflicts when the env file is replaced with identical content", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const envPath = path.join(skill, ".env")
    await rename(envPath, path.join(skill, ".env-old"))
    await writeFile(envPath, "TOKEN=old\n")

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
  })

  it("rejects a file that becomes unwritable after scanning", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    await chmod(path.join(skill, ".env"), 0o444)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "failed" }),
    ])
    expect(await readFile(path.join(skill, ".env"), "utf8")).toBe("TOKEN=old\n")
  })

  it("checks read roots and write files through PermissionGuard", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    const envRealPath = await realpath(path.join(root, "demo", ".env"))
    expect(harness.permissionRequests).toEqual([
      expect.objectContaining({ action: "fs.read.outside-userdata", resource: root }),
      expect.objectContaining({ action: "fs.read.outside-userdata", resource: root }),
      expect.objectContaining({ action: "fs.write", resource: envRealPath }),
    ])
  })

  it("completes a short-write sequence before reporting updated", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old-value\nSECOND=keep\n")
    let shortWriteCalls = 0
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      createAtomicFileOps({
        open: async (filePath, flags, mode) => {
          const handle = await open(filePath, flags, mode)
          const originalWrite = handle.write.bind(handle)
          return new Proxy(handle, {
            get(target, property, receiver) {
              if (property === "write") {
                return async (data: Buffer, offset: number, length: number, position: number) => {
                  if (length > 1) {
                    shortWriteCalls += 1
                    return originalWrite(data, offset, Math.max(1, Math.floor(length / 2)), position)
                  }
                  return originalWrite(data, offset, length, position)
                }
              }
              return Reflect.get(target, property, receiver)
            },
          }) as FileHandle
        },
      }),
    )
    const scan = await harness.service.scan("TOKEN", "new-value", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items.find((item) => item.skillName === "demo")!.id],
    }, async () => "new-value", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "updated" }),
    ])
    expect(shortWriteCalls).toBeGreaterThan(1)
    expect(await readFile(path.join(skill, ".env"), "utf8")).toBe('TOKEN="new-value"\nSECOND=keep\n')
  })

  it("treats CRLF multiline secret values as up to date after updating", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const secretValue = "first\r\nsecond"
    const scan = await harness.service.scan("TOKEN", secretValue, harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => secretValue, harness.security)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "updated" }),
    ])

    const rescanned = await harness.service.scan("TOKEN", secretValue, harness.security)
    expect(rescanned.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "up_to_date" }),
    ])
  })

  it("shows ordinary scan I/O failures as unwritable items", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)], () => 100, async () => {
      const error = new Error("simulated read failure") as NodeJS.ErrnoException
      error.code = "EIO"
      throw error
    })

    const result = await harness.service.scan("TOKEN", "new", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "unwritable" }),
    ])
  })

  it("serializes concurrent enqueue calls and continues after the first call fails", async () => {
    const root = await createRoot()
    await createSkill(root, "first", "TOKEN=first\n")
    await createSkill(root, "second", "TOKEN=second\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    const byName = new Map(scan.items.map((item) => [item.skillName, item.id]))
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let writeCalls = 0
    harness.security.permissionGuard.check = vi.fn(async (request) => {
      harness.permissionRequests.push(request)
      if (request.action === "fs.write") {
        writeCalls += 1
        if (writeCalls === 1) {
          await firstGate
          return { allowed: false as const, policyId: "queue-test" }
        }
      }
      return { allowed: true as const }
    })

    const first = harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("first")!],
    }, async () => "new", harness.security)
    while (writeCalls === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    let secondValue = "queued-value"
    const second = harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("second")!],
    }, async () => secondValue, harness.security)
    await Promise.resolve()
    expect(writeCalls).toBe(1)
    secondValue = "latest-value"
    releaseFirst()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.items).toEqual([
      expect.objectContaining({ skillName: "first", status: "failed" }),
    ])
    expect(secondResult.items).toEqual([
      expect.objectContaining({ skillName: "second", status: "updated" }),
    ])
    expect(await readFile(path.join(root, "second", ".env"), "utf8")).toBe('TOKEN="latest-value"\n')
  })

  it("does not truncate when the Skill parent changes during permission check", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    let releasePermission!: () => void
    const permissionGate = new Promise<void>((resolve) => { releasePermission = resolve })
    harness.security.permissionGuard.check = vi.fn(async (request) => {
      harness.permissionRequests.push(request)
      if (request.action === "fs.write") {
        await permissionGate
      }
      return { allowed: true as const }
    })

    const queued = harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)
    while (!harness.permissionRequests.some(({ action }) => action === "fs.write")) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const oldSkill = path.join(root, "demo-old")
    await rename(skill, oldSkill)
    await mkdir(skill)
    await writeFile(path.join(skill, "SKILL.md"), "# replacement\n")
    await link(path.join(oldSkill, ".env"), path.join(skill, ".env"))
    releasePermission()

    const result = await queued
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
    expect(await readFile(path.join(skill, ".env"), "utf8")).toBe("TOKEN=old\n")
    expect(await readFile(path.join(oldSkill, ".env"), "utf8")).toBe("TOKEN=old\n")
  })

  it("does not truncate when the opened env content changes during permission check", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    let releasePermission!: () => void
    const permissionGate = new Promise<void>((resolve) => { releasePermission = resolve })
    harness.security.permissionGuard.check = vi.fn(async (request) => {
      harness.permissionRequests.push(request)
      if (request.action === "fs.write") {
        await permissionGate
      }
      return { allowed: true as const }
    })

    const queued = harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)
    while (!harness.permissionRequests.some(({ action }) => action === "fs.write")) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await writeFile(envPath, "TOKEN=changed-during-permission\n")
    releasePermission()

    const result = await queued
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
    expect(await readFile(envPath, "utf8")).toBe("TOKEN=changed-during-permission\n")
  })

  it("conflicts when the env path changes during the post-permission reread", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    const oldEnvPath = path.join(skill, ".env-old")
    let swapped = false
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      const handle = await open(filePath, flags)
      const originalRead = handle.read.bind(handle)
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "read") {
            return async (buffer: Buffer, offset: number, length: number, position: number) => {
              const result = await originalRead(buffer, offset, length, position)
              if (!swapped) {
                swapped = true
                await rename(envPath, oldEnvPath)
                await writeFile(envPath, "TOKEN=old\n")
              }
              return result
            }
          }
          return Reflect.get(target, property, receiver)
        },
      }) as FileHandle
    })
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(swapped).toBe(true)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
    expect(await readFile(envPath, "utf8")).toBe("TOKEN=old\n")
  })

  it.each([
    ["equal-length", "TOKEN=alt\n"],
    ["different-length", "TOKEN=changed-after-reread\n"],
  ])("conflicts when content changes during post-read identity checks (%s)", async (_case, replacement) => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    let openCount = 0
    let queueStatCalls = 0
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      const handle = await open(filePath, flags)
      openCount += 1
      if (openCount !== 2) return handle
      const originalStat = handle.stat.bind(handle)
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "stat") {
            return async (options?: { bigint?: boolean }) => {
              queueStatCalls += 1
              if (queueStatCalls === 3) {
                await writeFile(envPath, replacement)
              }
              return originalStat(options as never)
            }
          }
          return Reflect.get(target, property, receiver)
        },
      }) as FileHandle
    })
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(queueStatCalls).toBeGreaterThanOrEqual(3)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
    expect(await readFile(envPath, "utf8")).toBe(replacement)
  })

  it.each([
    ["grows", "TOKEN=old\nEXTRA=x\n"],
    ["shrinks", "TOKEN=\n"],
  ])("uses a bounded final snapshot when the env file %s during reading", async (_case, replacement) => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    let openCount = 0
    let queueSnapshot = 0
    let finalSnapshotReads = 0
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      const handle = await open(filePath, flags)
      openCount += 1
      if (openCount !== 2) return handle
      const originalRead = handle.read.bind(handle)
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "read") {
            return async (buffer: Buffer, offset: number, length: number, position: number) => {
              if (position === 0) queueSnapshot += 1
              if (queueSnapshot !== 3) {
                return originalRead(buffer, offset, length, position)
              }
              finalSnapshotReads += 1
              const requestedLength = replacement.length < "TOKEN=old\n".length && position === 0
                ? Math.max(1, Math.floor(length / 2))
                : length
              const result = await originalRead(buffer, offset, requestedLength, position)
              if (finalSnapshotReads === 1) {
                await writeFile(envPath, replacement)
              }
              return result
            }
          }
          return Reflect.get(target, property, receiver)
        },
      }) as FileHandle
    })
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(finalSnapshotReads).toBeGreaterThan(0)
    expect(finalSnapshotReads).toBeLessThanOrEqual(Buffer.byteLength("TOKEN=old\n") + 1)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "conflict" }),
    ])
    expect(await readFile(envPath, "utf8")).toBe(replacement)
  })

  it("rejects an oversized env file before reading it into memory", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", `TOKEN=old\n#${"x".repeat(1024 * 1024)}\n`)
    let contentReadCalls = 0
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      const handle = await open(filePath, flags)
      const originalReadFile = handle.readFile.bind(handle)
      const originalRead = handle.read.bind(handle)
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "readFile") {
            return async (options?: Parameters<FileHandle["readFile"]>[0]) => {
              contentReadCalls += 1
              return originalReadFile(options as never)
            }
          }
          if (property === "read") {
            return async (buffer: Buffer, offset: number, length: number, position: number) => {
              contentReadCalls += 1
              return originalRead(buffer, offset, length, position)
            }
          }
          return Reflect.get(target, property, receiver)
        },
      }) as FileHandle
    })

    const result = await harness.service.scan("TOKEN", "new", harness.security)

    expect(contentReadCalls).toBe(0)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "unwritable" }),
    ])
  })

  it.each([
    ["ASCII", "x".repeat(64)],
    ["multibyte", "密".repeat(20)],
  ])("fails a final %s UTF-8 output over 1 MiB before permission or temp staging and continues", async (_caseName, value) => {
    const root = await createRoot()
    const firstPrefix = "TOKEN=old\n#"
    const firstSuffix = "\n"
    const firstTargetBytes = Number(SKILL_RUNTIME_ENV_MAX_BYTES) - 32
    const firstContent = `${firstPrefix}${"a".repeat(
      firstTargetBytes - Buffer.byteLength(firstPrefix) - Buffer.byteLength(firstSuffix),
    )}${firstSuffix}`
    const first = await createSkill(root, "first", firstContent)
    const second = await createSkill(root, "second", "TOKEN=old\n")
    let stagedOpenCalls = 0
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      createAtomicFileOps({
        open: async (filePath, flags, mode) => {
          stagedOpenCalls += 1
          return open(filePath, flags, mode)
        },
      }),
    )
    const scan = await harness.service.scan("TOKEN", value, harness.security)
    const byName = new Map(scan.items.map((item) => [item.skillName, item.id]))

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("first")!, byName.get("second")!],
    }, async () => value, harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({
        skillName: "first",
        status: "failed",
        message: "Skill .env 不能超过 1 MiB。",
      }),
      expect.objectContaining({ skillName: "second", status: "updated" }),
    ])
    expect(stagedOpenCalls).toBe(1)
    expect(harness.permissionRequests.filter(({ action }) => action === "fs.write"))
      .toHaveLength(1)
    expect(await readFile(path.join(first, ".env"), "utf8")).toBe(firstContent)
    expect(await readFile(path.join(second, ".env"), "utf8"))
      .toBe(`TOKEN=${JSON.stringify(value)}\n`)
    expect(await listSkillEnvTemps(first)).toEqual([])
    expect(JSON.stringify(result)).not.toContain(value)
    expect(JSON.stringify(harness.auditEvents)).not.toContain(value)
  })

  it.each([
    ["grows", "TOKEN=old-first\nEXTRA=x\n"],
    ["shrinks", "TOKEN=\n"],
  ])("reports a conflict when the env file %s during the queue open snapshot", async (_case, replacement) => {
    const root = await createRoot()
    const first = await createSkill(root, "first", "TOKEN=old-first\n")
    const second = await createSkill(root, "second", "TOKEN=old-second\n")
    const firstEnvPath = path.join(first, ".env")
    let attackQueueOpen = false
    let mutated = false
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      const handle = await open(filePath, flags)
      if (!attackQueueOpen || filePath !== firstEnvPath) return handle
      const originalRead = handle.read.bind(handle)
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "read") {
            return async (buffer: Buffer, offset: number, length: number, position: number) => {
              const requestedLength = replacement.length < "TOKEN=old-first\n".length && !mutated
                ? Math.max(1, Math.floor(length / 2))
                : length
              const result = await originalRead(buffer, offset, requestedLength, position)
              if (!mutated) {
                mutated = true
                await writeFile(firstEnvPath, replacement)
              }
              return result
            }
          }
          return Reflect.get(target, property, receiver)
        },
      }) as FileHandle
    })
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    const byName = new Map(scan.items.map((item) => [item.skillName, item.id]))
    attackQueueOpen = true

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("first")!, byName.get("second")!],
    }, async () => "new", harness.security)

    expect(mutated).toBe(true)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "first", status: "conflict" }),
      expect.objectContaining({ skillName: "second", status: "updated" }),
    ])
    expect(await readFile(firstEnvPath, "utf8")).toBe(replacement)
    expect(await readFile(path.join(second, ".env"), "utf8")).toBe('TOKEN="new"\n')
  })

  it("keeps the original env bytes when staging writes fail", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\nSECOND=keep\n")
    const envPath = path.join(skill, ".env")
    const originalBytes = await readFile(envPath)
    let writeCalls = 0
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      createAtomicFileOps({
        open: async (filePath, flags, mode) => {
          const handle = await open(filePath, flags, mode)
          const originalWrite = handle.write.bind(handle)
          return new Proxy(handle, {
            get(target, property, receiver) {
              if (property === "write") {
                return async (data: Buffer, offset: number, length: number, position: number) => {
                  writeCalls += 1
                  if (writeCalls > 1) throw new Error("simulated staging write failure")
                  return originalWrite(data, offset, Math.max(1, Math.floor(length / 2)), position)
                }
              }
              return Reflect.get(target, property, receiver)
            },
          }) as FileHandle
        },
      }),
    )
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(writeCalls).toBeGreaterThan(1)
    expect(result.items).toEqual([expect.objectContaining({ status: "failed" })])
    expect(await readFile(envPath)).toEqual(originalBytes)
    expect(await listSkillEnvTemps(skill)).toEqual([])
  })

  it("keeps the original env bytes when atomic rename fails", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\nSECOND=keep\n")
    const second = await createSkill(root, "second", "TOKEN=old-second\n")
    const envPath = path.join(skill, ".env")
    const originalBytes = await readFile(envPath)
    let renameCalls = 0
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      createAtomicFileOps({
        rename: async (sourcePath, targetPath) => {
          renameCalls += 1
          if (renameCalls === 1) throw new Error("simulated atomic rename failure")
          await rename(sourcePath, targetPath)
        },
      }),
    )
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    const byName = new Map(scan.items.map((item) => [item.skillName, item.id]))

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("demo")!, byName.get("second")!],
    }, async () => "new", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "failed" }),
      expect.objectContaining({ skillName: "second", status: "updated" }),
    ])
    expect(await readFile(envPath)).toEqual(originalBytes)
    expect(await readFile(path.join(second, ".env"), "utf8")).toBe('TOKEN="new"\n')
    expect(await listSkillEnvTemps(skill)).toEqual([])
    expect(await listSkillEnvTemps(second)).toEqual([])
  })

  it("preserves an external final conflict and removes the staged file", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    let queueStatCalls = 0
    let stagedOpenCalls = 0
    const atomicFileOps = createAtomicFileOps({
      open: async (filePath, flags, mode) => {
        stagedOpenCalls += 1
        return open(filePath, flags, mode)
      },
    })
    let attackQueue = false
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      async (filePath, flags) => {
        const handle = await open(filePath, flags)
        if (!attackQueue) return handle
        const originalStat = handle.stat.bind(handle)
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === "stat") {
              return async (options?: { bigint?: boolean }) => {
                queueStatCalls += 1
                if (queueStatCalls === 2) await writeFile(envPath, "TOKEN=external\n")
                return originalStat(options as never)
              }
            }
            return Reflect.get(target, property, receiver)
          },
        }) as FileHandle
      },
      undefined,
      atomicFileOps,
    )
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    attackQueue = true

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(stagedOpenCalls).toBe(1)
    expect(result.items).toEqual([expect.objectContaining({ status: "conflict" })])
    expect(await readFile(envPath, "utf8")).toBe("TOKEN=external\n")
    expect(await listSkillEnvTemps(skill)).toEqual([])
  })

  it("restricts env and staged permission bits after success", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    await chmod(envPath, 0o640)
    let stagedOpenCalls = 0
    let stagedModeBeforeRename: number | undefined
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      createAtomicFileOps({
        open: async (filePath, flags, mode) => {
          stagedOpenCalls += 1
          return open(filePath, flags, mode)
        },
        rename: async (sourcePath, targetPath) => {
          stagedModeBeforeRename = (await stat(sourcePath)).mode & 0o7777
          await rename(sourcePath, targetPath)
        },
      }),
    )
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(stagedOpenCalls).toBe(1)
    expect(result.items).toEqual([expect.objectContaining({ status: "updated" })])
    expect(stagedModeBeforeRename).toBe(0o600)
    expect((await stat(envPath)).mode & 0o7777).toBe(0o600)
    expect(await listSkillEnvTemps(skill)).toEqual([])
  })

  it("conflicts when env permission bits change during permission wait", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    await chmod(envPath, 0o640)
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    let releasePermission!: () => void
    const permissionGate = new Promise<void>((resolve) => { releasePermission = resolve })
    harness.security.permissionGuard.check = vi.fn(async (request) => {
      harness.permissionRequests.push(request)
      if (request.action === "fs.write") await permissionGate
      return { allowed: true as const }
    })

    const queued = harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)
    while (!harness.permissionRequests.some(({ action }) => action === "fs.write")) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await chmod(envPath, 0o600)
    releasePermission()

    const result = await queued
    expect(result.items).toEqual([expect.objectContaining({ status: "conflict" })])
    expect(await readFile(envPath, "utf8")).toBe("TOKEN=old\n")
    expect((await stat(envPath)).mode & 0o7777).toBe(0o600)
    expect(await listSkillEnvTemps(skill)).toEqual([])
  })

  it("conflicts when env permission bits change during post-read validation", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    await chmod(envPath, 0o640)
    let attackQueue = false
    let queueStatCalls = 0
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      const handle = await open(filePath, flags)
      if (!attackQueue) return handle
      const originalStat = handle.stat.bind(handle)
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "stat") {
            return async (options?: { bigint?: boolean }) => {
              queueStatCalls += 1
              if (queueStatCalls === 3) await chmod(envPath, 0o600)
              return originalStat(options as never)
            }
          }
          return Reflect.get(target, property, receiver)
        },
      }) as FileHandle
    })
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    attackQueue = true

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(queueStatCalls).toBeGreaterThanOrEqual(3)
    expect(result.items).toEqual([expect.objectContaining({ status: "conflict" })])
    expect(await readFile(envPath, "utf8")).toBe("TOKEN=old\n")
    expect((await stat(envPath)).mode & 0o7777).toBe(0o600)
    expect(await listSkillEnvTemps(skill)).toEqual([])
  })

  it("fails closed on Windows without staging or modifying selected env files", async () => {
    const root = await createRoot()
    const first = await createSkill(root, "first", "TOKEN=old-first\n")
    const second = await createSkill(root, "second", "TOKEN=old-second\n")
    let stagedOpenCalls = 0
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      createAtomicFileOps({
        open: async (filePath, flags, mode) => {
          stagedOpenCalls += 1
          return open(filePath, flags, mode)
        },
      }),
      "win32",
    )
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: scan.items.map(({ id }) => id),
    }, async () => "new", harness.security)

    expect(stagedOpenCalls).toBe(0)
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "first", status: "failed", message: "当前 Windows 环境不支持安全原子更新。" }),
      expect.objectContaining({ skillName: "second", status: "failed", message: "当前 Windows 环境不支持安全原子更新。" }),
    ])
    expect(await readFile(path.join(first, ".env"), "utf8")).toBe("TOKEN=old-first\n")
    expect(await readFile(path.join(second, ".env"), "utf8")).toBe("TOKEN=old-second\n")
    expect(await listSkillEnvTemps(first)).toEqual([])
    expect(await listSkillEnvTemps(second)).toEqual([])
  })

  it("zeroes a staged secret through its handle when the Skill parent moves before rename fails", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const movedSkill = path.join(root, "demo-old")
    const envPath = path.join(skill, ".env")
    let stagedHandle: FileHandle | undefined
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      createAtomicFileOps({
        open: async (filePath, flags, mode) => {
          stagedHandle = await open(filePath, flags, mode)
          return stagedHandle
        },
        rename: async () => {
          await rename(skill, movedSkill)
          await mkdir(skill)
          await writeFile(path.join(skill, "SKILL.md"), "# replacement\n")
          await writeFile(envPath, "TOKEN=external\n")
          throw new Error("simulated rename failure after parent move")
        },
      }),
    )
    const scan = await harness.service.scan("TOKEN", "new", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(result.items).toEqual([expect.objectContaining({ status: "failed" })])
    const leftovers = await listSkillEnvTemps(movedSkill)
    expect(leftovers).toHaveLength(1)
    expect((await stat(path.join(movedSkill, leftovers[0]))).size).toBe(0)
    expect(await readFile(envPath, "utf8")).toBe("TOKEN=external\n")
    expect(stagedHandle).toBeDefined()
  })

  it.each(["chmod", "sync", "close", "remove"] as const)(
    "sanitizes a failed staged file when temp %s fails and continues the queue",
    async (failurePoint) => {
      const root = await createRoot()
      const first = await createSkill(root, "first", "TOKEN=old-first\n")
      const second = await createSkill(root, "second", "TOKEN=old-second\n")
      const firstEnvPath = path.join(first, ".env")
      const firstRealPath = await realpath(first)
      const firstEnvRealPath = await realpath(firstEnvPath)
      let firstTempPath: string | undefined
      let firstHandle: FileHandle | undefined
      let closeOriginalHandle: (() => Promise<void>) | undefined
      let cleanupPhase = false
      let stageSyncCalls = 0
      let truncateCalls = 0
      const atomicFileOps = createAtomicFileOps({
        open: async (filePath, flags, mode) => {
          const handle = await open(filePath, flags, mode)
          if (path.dirname(filePath) !== firstRealPath) return handle
          firstTempPath = filePath
          firstHandle = handle
          const originalTruncate = handle.truncate.bind(handle)
          const originalChmod = handle.chmod.bind(handle)
          const originalSync = handle.sync.bind(handle)
          const originalClose = handle.close.bind(handle)
          closeOriginalHandle = originalClose
          return new Proxy(handle, {
            get(target, property, receiver) {
              if (property === "truncate") {
                return async (length?: number) => {
                  truncateCalls += 1
                  return originalTruncate(length)
                }
              }
              if (property === "chmod") {
                return async (modeValue: number) => {
                  if (failurePoint === "chmod") {
                    cleanupPhase = true
                    throw new Error("simulated temp chmod failure")
                  }
                  return originalChmod(modeValue)
                }
              }
              if (property === "sync") {
                return async () => {
                  stageSyncCalls += 1
                  if (failurePoint === "sync" && stageSyncCalls === 1) {
                    cleanupPhase = true
                    throw new Error("simulated temp sync failure")
                  }
                  return originalSync()
                }
              }
              if (property === "close") {
                return async () => {
                  if (failurePoint === "close" && cleanupPhase) {
                    throw new Error("simulated temp close failure")
                  }
                  return originalClose()
                }
              }
              return Reflect.get(target, property, receiver)
            },
          }) as FileHandle
        },
        rename: async (sourcePath, targetPath) => {
          if (targetPath === firstEnvRealPath && (failurePoint === "close" || failurePoint === "remove")) {
            cleanupPhase = true
            throw new Error("simulated rename failure for cleanup")
          }
          await rename(sourcePath, targetPath)
        },
        remove: async (filePath) => {
          if (filePath === firstTempPath && failurePoint === "remove") {
            throw new Error("simulated temp remove failure")
          }
          await rm(filePath, { force: true })
        },
      })
      const harness = createHarness(
        [trustedRoot(root)],
        () => 100,
        undefined,
        undefined,
        atomicFileOps,
      )
      const scan = await harness.service.scan("TOKEN", "new", harness.security)
      const byName = new Map(scan.items.map((item) => [item.skillName, item.id]))

      const result = await harness.service.enqueue({
        name: "TOKEN",
        scanSessionId: scan.scanSessionId,
        itemIds: [byName.get("first")!, byName.get("second")!],
      }, async () => "new", harness.security)

      expect(result.items).toEqual([
        expect.objectContaining({ skillName: "first", status: "failed" }),
        expect.objectContaining({ skillName: "second", status: "updated" }),
      ])
      expect(truncateCalls).toBeGreaterThan(0)
      expect(await readFile(firstEnvPath, "utf8")).toBe("TOKEN=old-first\n")
      expect(await readFile(path.join(second, ".env"), "utf8")).toBe('TOKEN="new"\n')
      if (failurePoint === "close") {
        expect(firstHandle).toBeDefined()
        expect((await firstHandle!.stat()).size).toBe(0)
        await closeOriginalHandle?.()
      }
      if (failurePoint === "remove") {
        expect(firstTempPath).toBeDefined()
        expect((await stat(firstTempPath!)).size).toBe(0)
        await rm(firstTempPath!, { force: true })
      }
    },
  )

  it.each([
    ["truncate and sync", true],
    ["sync and remove", false],
  ] as const)("records a failed safety cleanup when temp %s fail", async (_case, truncateFails) => {
    const root = await createRoot()
    const first = await createSkill(root, "first", "TOKEN=old-first\n")
    const second = await createSkill(root, "second", "TOKEN=old-second\n")
    const firstEnvPath = path.join(first, ".env")
    const firstRealPath = await realpath(first)
    const firstEnvRealPath = await realpath(firstEnvPath)
    let firstTempPath: string | undefined
    let syncCalls = 0
    const atomicFileOps = createAtomicFileOps({
      open: async (filePath, flags, mode) => {
        const handle = await open(filePath, flags, mode)
        if (path.dirname(filePath) !== firstRealPath) return handle
        firstTempPath = filePath
        const originalTruncate = handle.truncate.bind(handle)
        const originalSync = handle.sync.bind(handle)
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === "truncate") {
              return async () => {
                if (truncateFails) throw new Error("simulated truncate failure")
                return originalTruncate(0)
              }
            }
            if (property === "sync") {
              return async () => {
                syncCalls += 1
                if (syncCalls > 1) throw new Error("simulated cleanup sync failure")
                return originalSync()
              }
            }
            return Reflect.get(target, property, receiver)
          },
        }) as FileHandle
      },
      rename: async (_sourcePath, targetPath) => {
        if (targetPath === firstEnvRealPath) throw new Error("simulated rename failure")
        throw new Error("unexpected second rename")
      },
      remove: async (filePath) => {
        if (filePath === firstTempPath) throw new Error("simulated remove failure")
        await rm(filePath, { force: true })
      },
    })
    const harness = createHarness(
      [trustedRoot(root)],
      () => 100,
      undefined,
      undefined,
      atomicFileOps,
    )
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    const firstItem = scan.items.find(({ skillName }) => skillName === "first")!

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [firstItem.id],
    }, async () => "new", harness.security)

    expect(result.items).toEqual([expect.objectContaining({ status: "failed" })])
    const audit = harness.auditEvents.find((event) => event.resource === firstEnvPath && event.action === "fs.write")
    expect(audit?.metadata).toMatchObject({
      tempTruncateFailed: truncateFails,
      tempSyncFailed: true,
      tempSecretSanitized: false,
    })
    expect(firstTempPath).toBeDefined()
    await rm(firstTempPath!, { force: true })
    expect(await readFile(path.join(second, ".env"), "utf8")).toBe("TOKEN=old-second\n")
  })

  it("opens source env handles with O_NONBLOCK for scan and queue", async () => {
    const root = await createRoot()
    await createSkill(root, "demo", "TOKEN=old\n")
    const sourceOpenFlags: number[] = []
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      sourceOpenFlags.push(flags)
      return open(filePath, flags)
    })
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, async () => "new", harness.security)

    expect(sourceOpenFlags).toHaveLength(2)
    if (constants.O_NONBLOCK !== 0) {
      expect(sourceOpenFlags.every((flags) => (flags & constants.O_NONBLOCK) === constants.O_NONBLOCK))
        .toBe(true)
    }
  })

  it("rejects a non-file swapped in between lstat and nonblocking open", async () => {
    const root = await createRoot()
    const skill = await createSkill(root, "demo", "TOKEN=old\n")
    const envPath = path.join(skill, ".env")
    let capturedFlags = 0
    let swapped = false
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      capturedFlags = flags
      if (!swapped) {
        swapped = true
        await rename(envPath, path.join(skill, ".env-old"))
        await mkdir(envPath)
      }
      return open(filePath, flags)
    })

    const result = await harness.service.scan("TOKEN", "new", harness.security)

    expect(swapped).toBe(true)
    if (constants.O_NONBLOCK !== 0) {
      expect(capturedFlags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
    }
    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "unsafe_link" }),
    ])
  })

  it.each(["up_to_date", "invalid"] as const)(
    "rejects a queue request containing a %s scan item before any write",
    async (blockedStatus) => {
      const root = await createRoot()
      const needs = await createSkill(root, "needs", "TOKEN=old\n")
      await createSkill(
        root,
        "blocked",
        blockedStatus === "up_to_date" ? "TOKEN=new\n" : "TOKEN='unterminated\n",
      )
      const harness = createHarness([trustedRoot(root)])
      const scan = await harness.service.scan("TOKEN", "new", harness.security)
      const blocked = scan.items.find((item) => item.status === blockedStatus)!
      const needsUpdate = scan.items.find((item) => item.status === "needs_update")!

      await expect(harness.service.enqueue({
        name: "TOKEN",
        scanSessionId: scan.scanSessionId,
        itemIds: [blocked.id, needsUpdate.id],
      }, async () => "new", harness.security)).rejects.toThrow("仅可队列更新需要更新的项目")

      expect(await readFile(path.join(needs, ".env"), "utf8")).toBe("TOKEN=old\n")
      expect(harness.permissionRequests.filter(({ action }) => action === "fs.write")).toEqual([])
    },
  )
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-env-bindings-"))
  tempRoots.push(root)
  return root
}

async function createSkill(root: string, name: string, env: string): Promise<string> {
  const skillDir = path.join(root, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(path.join(skillDir, "SKILL.md"), `# ${name}\n`)
  await writeFile(path.join(skillDir, ".env"), env)
  return skillDir
}

function trustedRoot(root: string): TrustedSkillRoot {
  return {
    editors: [
      { id: "codex", label: "Codex" },
      { id: "claude-code", label: "Claude Code" },
    ],
    scope: "global",
    path: root,
  }
}

function createHarness(
  roots: TrustedSkillRoot[],
  now: () => number = () => 100,
  openFile?: (filePath: string, flags: number) => Promise<FileHandle>,
  beforeBindingOpen?: (phase: "scan" | "queue") => Promise<void>,
  atomicFileOps?: AtomicFileOps,
  platform?: NodeJS.Platform,
) {
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const permissionRequests: Parameters<PermissionGuard["check"]>[0][] = []
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(() => () => {}),
    check: vi.fn(async (request) => {
      permissionRequests.push(request)
      return { allowed: true as const }
    }),
  }
  const auditSink: AuditSink = {
    record: vi.fn((event) => { auditEvents.push(event) }),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  let nextId = 1
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const deps = {
    listRoots: async () => roots,
    createId: () => `id-${nextId++}`,
    now,
    openFile,
    beforeBindingOpen,
    atomicFileOps,
    platform,
    logger,
  }
  const service = createSkillEnvBindingService(deps)
  return {
    service,
    permissionRequests,
    auditEvents,
    logger,
    permissionGuard,
    security: { actor: { kind: "user" as const }, permissionGuard, auditSink },
  }
}

type AtomicFileOps = {
  open(filePath: string, flags: number, mode: number): Promise<FileHandle>
  rename(sourcePath: string, targetPath: string): Promise<void>
  remove(filePath: string): Promise<void>
}

function createAtomicFileOps(overrides: Partial<AtomicFileOps> = {}): AtomicFileOps {
  return {
    open: (filePath, flags, mode) => open(filePath, flags, mode),
    rename,
    remove: (filePath) => rm(filePath, { force: true }),
    ...overrides,
  }
}

async function listSkillEnvTemps(skillPath: string): Promise<string[]> {
  return (await readdir(skillPath)).filter((name) => name.startsWith(".synapse-env-") && name.endsWith(".tmp"))
}
