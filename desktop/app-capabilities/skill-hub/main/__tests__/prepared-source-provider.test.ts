import { describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { SkillHubDetail } from "@synapse/shared/skill-hub-contracts"
import { encodeHubSnapshot } from "../package-worker"
import { HubPreparedSourceProvider } from "../prepared-source-provider"
import { SkillHubDesktopError } from "../error"
import type { HubAccountOperation } from "../cloud-client"
import type { SkillHubCaller } from "../access"

function fixture(attachments: { path: string; bytes: Uint8Array }[] = []) {
  const lifetime = new AbortController()
  let authenticated = true
  const op: HubAccountOperation = { scope: { accountId: "account-1", authRevision: 1 }, signal: lifetime.signal }
  const assertInstallAccount = vi.fn((request: HubAccountOperation) => request.signal.throwIfAborted())
  const raw = "---\nname: package-name\ndescription: Package description\n---\nUse the package."
  const encoded = encodeHubSnapshot({
    format: "directory",
    files: [{ path: "SKILL.md", bytes: Buffer.from(raw) }, ...attachments],
    excludedPaths: [],
  })
  const person = { id: "account-1", displayName: "Member" }
  const skill: SkillHubDetail = {
    id: "skill_1", team: { id: "team_1", name: "Team" }, package: encoded.package,
    displayName: "商店名称", displayDescription: "商店介绍", iconUrl: null, revision: 1, files: encoded.manifest,
    currentVersion: { id: "version_1", number: 1, contentFingerprint: encoded.contentFingerprint, archiveSha256: "a".repeat(64) },
    createdBy: person, maintainer: { ...person, isActiveMember: true }, publishedAt: "2026-11-04T00:00:00.000Z",
    permissions: { canEditMetadata: true, canPublishVersion: true, canDelete: true },
  }
  const readLatest = vi.fn(async () => ({ skill, archive: Buffer.from(encoded.bytes) }))
  const get = vi.fn(async () => skill)
  const provider = new HubPreparedSourceProvider({
    async run<T>(_caller: SkillHubCaller, _operation: string, work: (op: HubAccountOperation) => Promise<T>) {
      if (!authenticated) throw new SkillHubDesktopError("HUB_ACCOUNT_REQUIRED", "登录后使用")
      return work(op)
    },
    readLatest, assertInstallAccount, get,
  }, async (input) => encodeHubSnapshot(input))
  const caller: SkillHubCaller = { actor: { kind: "user" }, clientId: "window" }
  return { provider, caller, get, readLatest, raw, skill, lifetime, logout: () => { authenticated = false } }
}

describe("Skill Hub prepared installer source", () => {
  it("copies nested attachments into a fresh installation directory", async () => {
    const files = [
      { path: "agents/openai.yaml", bytes: Buffer.from("interface: test\n") },
      { path: "scripts/lib/tool.js", bytes: Buffer.from("export {}\n") },
    ]
    const f = fixture(files)
    const staging = await mkdtemp(path.join(os.tmpdir(), "synapse-hub-attachments-"))
    try {
      const source = await f.provider.prepare(f.skill.id, f.caller)
      await f.provider.beginPreparedInstall(source.preparedSourceId!, source.sourceIdentity)
      for (const file of files) {
        const target = path.join(staging, file.path)
        await f.provider.copyPreparedSkillAttachment(source.preparedSourceId!, source.sourceIdentity, file.path, target)
        await expect(readFile(target)).resolves.toEqual(file.bytes)
      }
    } finally {
      f.lifetime.abort()
      await rm(staging, { recursive: true, force: true })
    }
  })

  it("reads only a signed-in account and uses package fields", async () => {
    const f = fixture()
    const source = await f.provider.prepare(f.skill.id, f.caller)
    expect(source).toMatchObject({ name: "package-name", description: "Package description", title: "商店名称" })
    expect(await f.provider.readPreparedSkill(source.preparedSourceId!, source.sourceIdentity)).toMatchObject({ content: f.raw })
    f.logout()
    await expect(f.provider.prepare(f.skill.id, f.caller)).rejects.toMatchObject({ code: "HUB_ACCOUNT_REQUIRED" })
    expect(f.readLatest).toHaveBeenCalledTimes(1)
  })

  it("rechecks membership and version, and drops the source on account switch", async () => {
    const f = fixture()
    const source = await f.provider.prepare(f.skill.id, f.caller)
    f.get.mockRejectedValueOnce(new SkillHubDesktopError("HUB_NOT_AVAILABLE", "not a member"))
    await expect(f.provider.beginPreparedInstall(source.preparedSourceId!, source.sourceIdentity)).rejects.toMatchObject({ code: "HUB_NOT_AVAILABLE" })
    f.get.mockResolvedValueOnce({ ...f.skill, currentVersion: { ...f.skill.currentVersion, id: "version_2" } })
    await expect(f.provider.beginPreparedInstall(source.preparedSourceId!, source.sourceIdentity)).rejects.toMatchObject({ code: "HUB_LATEST_CHANGED" })
    f.lifetime.abort(new SkillHubDesktopError("HUB_ACCOUNT_CHANGED", "switched"))
    await expect(f.provider.readPreparedSkill(source.preparedSourceId!, source.sourceIdentity)).rejects.toMatchObject({ code: "HUB_PREPARE_UNAVAILABLE" })
  })
})
