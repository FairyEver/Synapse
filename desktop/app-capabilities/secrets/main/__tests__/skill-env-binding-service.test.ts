import { chmod, link, mkdir, mkdtemp, open, readFile, realpath, rename, symlink, writeFile } from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import type { TrustedSkillRoot } from "../../../../electron/services/editor-scan-roots"
import { createSkillEnvBindingService } from "../skill-env-binding-service"

const tempRoots: string[] = []

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("SkillEnvBindingService", () => {
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
      { skillName: "current", status: "up_to_date" },
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
    }, "new", harness.security)).rejects.toThrow("扫描会话已过期")
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
    }, "new", harness.security)).rejects.toThrow("扫描项目无效")
    await expect(harness.service.enqueue({
      name: "OTHER",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items[0].id],
    }, "new", harness.security)).rejects.toThrow("密钥名称不匹配")
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
    }, "new-secret", harness.security)

    expect(result.items.map(({ skillName, status }) => ({ skillName, status }))).toEqual([
      { skillName: "first", status: "conflict" },
      { skillName: "second", status: "updated" },
    ])
    expect(await readFile(path.join(first, ".env"), "utf8")).toContain("changed-after-scan")
    expect(await readFile(path.join(second, ".env"), "utf8")).toBe('TOKEN="new-secret"\n')
    expect(JSON.stringify(result)).not.toContain("new-secret")
    expect(JSON.stringify(harness.auditEvents)).not.toContain("new-secret")
  })

  it("revalidates duplicate keys and symlink changes before writes", async () => {
    const root = await createRoot()
    const duplicate = await createSkill(root, "duplicate", "TOKEN=old\n")
    const linked = await createSkill(root, "linked", "TOKEN=old\n")
    const harness = createHarness([trustedRoot(root)])
    const scan = await harness.service.scan("TOKEN", "new", harness.security)
    const byName = new Map(scan.items.map((item) => [item.skillName, item]))
    await writeFile(path.join(duplicate, ".env"), "TOKEN=old\ntoken=other\n")
    const linkedEnv = path.join(linked, ".env")
    const { rm } = await import("node:fs/promises")
    await rm(linkedEnv)
    await symlink(path.join(duplicate, ".env"), linkedEnv)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("duplicate")!.id, byName.get("linked")!.id],
    }, "new", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "duplicate", status: "conflict" }),
      expect.objectContaining({ skillName: "linked", status: "failed" }),
    ])
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
    }, "new", harness.security)

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
    }, "new", harness.security)
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
    }, "new", harness.security)
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
    }, "new", harness.security)
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
    }, "new", harness.security)

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
    }, "new", harness.security)

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
    const harness = createHarness([trustedRoot(root)], () => 100, async (filePath, flags) => {
      const handle = await open(filePath, flags)
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
    })
    const scan = await harness.service.scan("TOKEN", "new-value", harness.security)

    const result = await harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [scan.items.find((item) => item.skillName === "demo")!.id],
    }, "new-value", harness.security)

    expect(result.items).toEqual([
      expect.objectContaining({ skillName: "demo", status: "updated" }),
    ])
    expect(shortWriteCalls).toBeGreaterThan(1)
    expect(await readFile(path.join(skill, ".env"), "utf8")).toBe('TOKEN="new-value"\nSECOND=keep\n')
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
    }, "new", harness.security)
    while (writeCalls === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    const second = harness.service.enqueue({
      name: "TOKEN",
      scanSessionId: scan.scanSessionId,
      itemIds: [byName.get("second")!],
    }, "new", harness.security)
    await Promise.resolve()
    expect(writeCalls).toBe(1)
    releaseFirst()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.items).toEqual([
      expect.objectContaining({ skillName: "first", status: "failed" }),
    ])
    expect(secondResult.items).toEqual([
      expect.objectContaining({ skillName: "second", status: "updated" }),
    ])
    expect(await readFile(path.join(root, "second", ".env"), "utf8")).toBe('TOKEN="new"\n')
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
    }, "new", harness.security)
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
  const service = createSkillEnvBindingService({
    listRoots: async () => roots,
    createId: () => `id-${nextId++}`,
    now,
    openFile,
    beforeBindingOpen,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  })
  return {
    service,
    permissionRequests,
    auditEvents,
    permissionGuard,
    security: { actor: { kind: "user" as const }, permissionGuard, auditSink },
  }
}
