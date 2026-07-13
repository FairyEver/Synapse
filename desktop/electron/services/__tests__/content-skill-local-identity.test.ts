import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
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
