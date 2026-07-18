import { mkdir, mkdtemp, readFile, symlink, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
import { CONTENT_SKILL_IDENTITY_MAX_BYTES } from "../../../config"
import {
  ContentSkillIdentityChangedError,
  readContentSkillIdentityRaw,
  writeContentSkillIdentity,
} from "../content-skill-local-identity"

const actor: ActorIdentity = { kind: "user", id: "user-1" }

describe("content skill local identity", () => {
  it("writes the resource identity atomically after permission and concurrency checks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-"))
    const target = path.join(root, ".synapse.json")
    const auditSink = auditSinkStub()
    const permissionGuard = permissionGuardStub(true)

    await writeContentSkillIdentity(root, {
      id: "skill-1",
      repositoryVersion: "20260713010101",
      sourceFingerprint: "sha256:source",
    }, null, { actor, auditSink, permissionGuard })

    await expect(readContentSkillIdentityRaw(root)).resolves.toBe(await readFile(target, "utf8"))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: target,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "allowed" }))
  })

  it("does not overwrite an identity changed after preflight", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-race-"))
    const target = path.join(root, ".synapse.json")
    const original = JSON.stringify({ id: "old" })
    await writeFile(target, original, "utf8")
    await writeFile(target, JSON.stringify({ id: "changed" }), "utf8")

    await expect(writeContentSkillIdentity(root, {
      id: "skill-1",
      repositoryVersion: "20260713010101",
      sourceFingerprint: "sha256:source",
    }, original)).rejects.toBeInstanceOf(ContentSkillIdentityChangedError)
    await expect(readFile(target, "utf8")).resolves.toContain("changed")
  })

  it("requires read permission for the final identity concurrency check", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-read-denied-"))
    const target = path.join(root, ".synapse.json")
    const original = JSON.stringify({ id: "old" })
    const auditSink = auditSinkStub()
    const permissionGuard: PermissionGuard = {
      check: vi.fn(async request => request.action === "fs.write"
        ? { allowed: true as const }
        : { allowed: false as const, reason: "identity read denied" }),
      registerPolicy: vi.fn(),
    }
    await writeFile(target, original, "utf8")

    await expect(writeContentSkillIdentity(root, {
      id: "skill-1",
      repositoryVersion: "20260713010101",
      sourceFingerprint: "sha256:source",
    }, original, { actor, auditSink, permissionGuard })).rejects.toThrow("identity read denied")

    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "fs.write",
      resource: target,
    }))
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: target,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "denied",
      resource: target,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "failed",
      resource: target,
    }))
    await expect(readFile(target, "utf8")).resolves.toBe(original)
  })

  it.skipIf(process.platform === "win32")("rejects a symlinked resource identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-link-"))
    const outside = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-outside-"))
    const externalIdentity = path.join(outside, "identity.json")
    await writeFile(externalIdentity, JSON.stringify({ id: "wrong-skill" }), "utf8")
    await symlink(externalIdentity, path.join(root, ".synapse.json"))

    await expect(readContentSkillIdentityRaw(root)).rejects.toThrow("本地 Skill 关联文件不能是符号链接。")
  })

  it("rejects a non-file resource identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-directory-"))
    await mkdir(path.join(root, ".synapse.json"))

    await expect(readContentSkillIdentityRaw(root)).rejects.toThrow("本地 Skill 关联必须是普通文件。")
  })

  it("checks permission and audits a verified resource identity read", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-read-"))
    const target = path.join(root, ".synapse.json")
    const auditSink = auditSinkStub()
    const permissionGuard = permissionGuardStub(true)
    await writeFile(target, JSON.stringify({ id: "skill-1" }), "utf8")

    await expect(readContentSkillIdentityRaw(root, { actor, auditSink, permissionGuard }))
      .resolves.toContain("skill-1")
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: target,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: target,
    }))
  })

  it("rejects oversized resource identities before permission or full-file reads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-large-"))
    const target = path.join(root, ".synapse.json")
    const auditSink = auditSinkStub()
    const permissionGuard = permissionGuardStub(true)
    await writeFile(target, "", "utf8")
    await truncate(target, CONTENT_SKILL_IDENTITY_MAX_BYTES + 1)

    await expect(readContentSkillIdentityRaw(root, { actor, auditSink, permissionGuard }))
      .rejects.toThrow("本地 Skill 关联文件不能超过 64 KiB。")
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      metadata: expect.objectContaining({
        maxBytes: CONTENT_SKILL_IDENTITY_MAX_BYTES,
        reason: "identity-too-large",
      }),
      outcome: "failed",
      resource: target,
    }))
  })

  it("fails safely when the identity target is not replaceable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-skill-id-target-"))
    await mkdir(path.join(root, ".synapse.json"))
    await expect(writeContentSkillIdentity(root, {
      id: "skill-1",
      repositoryVersion: "20260713010101",
      sourceFingerprint: "sha256:source",
    }, null)).rejects.toThrow()
  })
})

function permissionGuardStub(allowed: boolean): PermissionGuard {
  return {
    check: vi.fn(async () => allowed
      ? { allowed: true as const }
      : { allowed: false as const, reason: "denied" }),
    registerPolicy: vi.fn(),
  }
}

function auditSinkStub(): AuditSink {
  return {
    clearForTests: vi.fn(),
    list: vi.fn(() => []),
    record: vi.fn(),
  }
}
