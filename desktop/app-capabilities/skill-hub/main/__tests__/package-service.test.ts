import { describe, expect, it, vi } from "vitest"
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectHubSkillPackage } from "@synapse/shared/skill-hub-package-node"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import type { HubPreparedRecord } from "../../../../electron/runtime/data-repo/schemas/skill-hub"
import { encodeHubSnapshot } from "../package-worker"
import { HubPackageService, selectHubUploadTeam } from "../package-service"

describe("Skill Hub preparation target", () => {
  it("does not treat a one-row page as a single-team account", async () => {
    const teams = vi.fn().mockResolvedValue({ items: [{ id: "a", name: "一队" }], nextCursor: "later", selectionState: "multiple", defaultTeamId: null })
    await expect(selectHubUploadTeam(teams)).rejects.toMatchObject({ code: "HUB_TEAM_REQUIRED" })
    expect(teams).toHaveBeenCalledOnce()
  })
})

it("uses an immutable local snapshot and excludes runtime files without opening them", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hub-snapshot-")))
  const source = join(root, "source")
  const { mkdir } = await import("node:fs/promises")
  await mkdir(source)
  const records = new Map<string, HubPreparedRecord>()
  const repo = {
    upsert: vi.fn(async (record: HubPreparedRecord) => { records.set(record.id, record) }),
    get: vi.fn(async (id: string) => records.get(id) ?? null),
    remove: vi.fn(async (id: string) => { records.delete(id) }),
  }
  const service = new HubPackageService({
    records: repo as never, assets: new ManagedAssetStore(join(root, "assets")),
    encode: async (input) => encodeHubSnapshot(input),
    guard: { check: vi.fn().mockResolvedValue({ allowed: true }), registerPolicy: vi.fn() },
    audit: { record: vi.fn(), list: vi.fn(), clearForTests: vi.fn() }, report: vi.fn(),
  })
  const account = { scope: { accountId: "actor", authRevision: 1 }, signal: new AbortController().signal }
  const context = { account, caller: { actor: { kind: "user" as const }, clientId: "local" } }
  try {
    const main = join(source, "SKILL.md")
    const original = "---\nname: demo\ndescription: Demo\n---\nOld source"
    await writeFile(main, original)
    await symlink(join(root, "missing-secret"), join(source, ".env"))
    await writeFile(join(source, ".env.example"), "KEY=\n")
    const first = await service.prepare(source, { id: "team", name: "团队" }, context)
    await writeFile(main, original.replace("Old", "New"))
    const saved = await service.readPrepared(first.preparedSourceId, context)
    expect(inspectHubSkillPackage({ format: "zip", bytes: saved.bytes }).main.toString()).toBe(original)
    expect(first.manifest.map((item) => item.path)).toEqual([".env.example", "SKILL.md"])
    expect(first.summary.excludedPaths).toContain(".env")
    const second = await service.prepare(source, { id: "team", name: "团队" }, context)
    expect(second.contentFingerprint).not.toBe(first.contentFingerprint)
    await expect(service.readPrepared(first.preparedSourceId, {
      ...context, account: { ...account, scope: { ...account.scope, authRevision: 2 } },
    })).rejects.toMatchObject({ code: "HUB_SOURCE_EXPIRED" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
