import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { ActorIdentity, AuditSink, PermissionGuard, PermissionRequest } from "../../runtime/security"
import { findSkillDirectoryByContentId } from "../editor-adapters/skill-identity"
import {
  ensureSkillRepositoryIdentityWriteAllowed,
  readSkillRepositoryIdentity,
  writeSkillRepositoryIdentity,
} from "../skill-repository-local-identity"

const actor: ActorIdentity = { kind: "user", id: "user-1", display: "liyang" }
const identity = {
  id: "repo-1",
  kind: "cloud-skill-repository" as const,
  owner: "liyang",
  name: "demo-skill",
}

describe("ensureSkillRepositoryIdentityWriteAllowed", () => {
  it("checks write permission for the local identity file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-preflight-"))
    const permissionRequests: PermissionRequest[] = []
    const permissionGuard = permissionGuardReturning({ allowed: true }, permissionRequests)
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const auditSink = auditSinkRecording(auditEvents)

    await ensureSkillRepositoryIdentityWriteAllowed(dir, { actor, auditSink, permissionGuard })

    expect(permissionRequests).toEqual([
      {
        action: "fs.write",
        actor,
        resource: path.join(dir, ".synapse.json"),
        context: {
          operation: "skill-repository.identity.write.preflight",
        },
      },
    ])
    expect(auditEvents).toEqual([])
  })

  it("records denied audit during preflight and does not write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-preflight-denied-"))
    const permissionGuard = permissionGuardReturning({ allowed: false, reason: "denied by policy", policyId: "policy-1" })
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const auditSink = auditSinkRecording(auditEvents)

    await expect(ensureSkillRepositoryIdentityWriteAllowed(dir, { actor, auditSink, permissionGuard }))
      .rejects.toThrow("denied by policy")

    await expect(readFile(path.join(dir, ".synapse.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    expect(auditEvents).toEqual([
      {
        action: "fs.write",
        actor,
        resource: path.join(dir, ".synapse.json"),
        outcome: "denied",
        metadata: {
          operation: "skill-repository.identity.write.preflight",
          reason: "denied by policy",
          policyId: "policy-1",
        },
      },
    ])
  })
})

describe("writeSkillRepositoryIdentity", () => {
  it("checks write permission, writes .synapse.json atomically, and records allowed audit", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-id-"))
    const permissionRequests: PermissionRequest[] = []
    const permissionGuard = permissionGuardReturning({ allowed: true }, permissionRequests)
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const auditSink = auditSinkRecording(auditEvents)

    await writeSkillRepositoryIdentity(dir, identity, { actor, auditSink, permissionGuard })

    const targetPath = path.join(dir, ".synapse.json")
    await expect(stat(targetPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(readFile(targetPath, "utf8")).resolves.toBe(`${JSON.stringify(identity, null, 2)}\n`)
    expect(permissionRequests).toEqual([
      {
        action: "fs.write",
        actor,
        resource: targetPath,
        context: {
          operation: "skill-repository.identity.write",
          repositoryId: "repo-1",
          repositoryName: "demo-skill",
        },
      },
    ])
    expect(auditEvents).toEqual([
      {
        action: "fs.write",
        actor,
        resource: targetPath,
        outcome: "allowed",
        metadata: {
          operation: "skill-repository.identity.write",
          repositoryId: "repo-1",
          repositoryName: "demo-skill",
        },
      },
    ])
  })

  it("records denied audit and does not write the identity file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-id-denied-"))
    const targetPath = path.join(dir, ".synapse.json")
    const permissionGuard = permissionGuardReturning({ allowed: false, reason: "denied by policy", policyId: "policy-1" })
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const auditSink = auditSinkRecording(auditEvents)

    await expect(writeSkillRepositoryIdentity(dir, identity, { actor, auditSink, permissionGuard }))
      .rejects.toThrow("denied by policy")

    await expect(readFile(targetPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    expect(auditEvents).toEqual([
      {
        action: "fs.write",
        actor,
        resource: targetPath,
        outcome: "denied",
        metadata: {
          operation: "skill-repository.identity.write",
          repositoryId: "repo-1",
          repositoryName: "demo-skill",
          reason: "denied by policy",
          policyId: "policy-1",
        },
      },
    ])
  })

  it("records failed audit when the atomic write fails after permission", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-id-failed-"))
    const filePath = path.join(dir, "not-a-directory")
    await writeFile(filePath, "occupied", "utf8")
    const permissionGuard = permissionGuardReturning({ allowed: true })
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const auditSink = auditSinkRecording(auditEvents)

    await expect(writeSkillRepositoryIdentity(filePath, identity, { actor, auditSink, permissionGuard }))
      .rejects.toThrow()

    expect(auditEvents.at(-1)).toEqual({
      action: "fs.write",
      actor,
      resource: path.join(filePath, ".synapse.json"),
      outcome: "failed",
      metadata: {
        operation: "skill-repository.identity.write",
        repositoryId: "repo-1",
        repositoryName: "demo-skill",
      },
    })
  })

  it("removes the temporary file when rename fails after writing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-id-cleanup-"))
    await mkdir(path.join(dir, ".synapse.json"))
    const permissionGuard = permissionGuardReturning({ allowed: true })
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const auditSink = auditSinkRecording(auditEvents)

    await expect(writeSkillRepositoryIdentity(dir, identity, { actor, auditSink, permissionGuard }))
      .rejects.toThrow()

    const entries = await readdir(dir)
    expect(entries.filter((entry) => entry.startsWith(".synapse.json.") && entry.endsWith(".tmp"))).toEqual([])
    expect(auditEvents.at(-1)?.outcome).toBe("failed")
  })
})

describe("readSkillRepositoryIdentity", () => {
  it("reads valid cloud Skill Repository identity", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-read-"))
    await writeFile(path.join(dir, ".synapse.json"), JSON.stringify(identity), "utf8")

    await expect(readSkillRepositoryIdentity(dir)).resolves.toEqual(identity)
  })

  it("returns null for missing, malformed, legacy, and invalid-name identity files", async () => {
    const missingDir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-read-missing-"))
    const malformedDir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-read-malformed-"))
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-read-legacy-"))
    const invalidNameDir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-read-invalid-"))

    await writeFile(path.join(malformedDir, ".synapse.json"), "{ not json", "utf8")
    await writeFile(path.join(legacyDir, ".synapse.json"), JSON.stringify({ id: "legacy-content-id", name: "demo-skill" }), "utf8")
    await writeFile(path.join(invalidNameDir, ".synapse.json"), JSON.stringify({
      ...identity,
      name: "demo.skill",
    }), "utf8")

    await expect(readSkillRepositoryIdentity(missingDir)).resolves.toBeNull()
    await expect(readSkillRepositoryIdentity(malformedDir)).resolves.toBeNull()
    await expect(readSkillRepositoryIdentity(legacyDir)).resolves.toBeNull()
    await expect(readSkillRepositoryIdentity(invalidNameDir)).resolves.toBeNull()
  })

  it("keeps the legacy skill id reader compatible with cloud identity files", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-repo-legacy-reader-"))
    const skillDir = path.join(parentDir, "demo-skill")
    await mkdir(skillDir)
    await writeSkillRepositoryIdentity(skillDir, identity)

    await expect(findSkillDirectoryByContentId(parentDir, "repo-1")).resolves.toBe(skillDir)
  })
})

function permissionGuardReturning(
  result: Awaited<ReturnType<PermissionGuard["check"]>>,
  requests: PermissionRequest[] = [],
): PermissionGuard {
  return {
    registerPolicy: vi.fn(),
    check: vi.fn(async (request) => {
      requests.push(request)
      return result
    }),
  }
}

function auditSinkRecording(events: Parameters<AuditSink["record"]>[0][]): AuditSink {
  return {
    record: (event) => events.push(event),
    list: () => [],
    clearForTests: vi.fn(),
  }
}
