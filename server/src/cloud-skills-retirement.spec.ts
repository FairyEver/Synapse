import { spawnSync } from "node:child_process"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
const { retireCloudSkills } = require("../scripts/retire-cloud-skills.cjs")
const env = Object.fromEntries(["SECRET_ID", "SECRET_KEY", "BUCKET", "REGION"].map((key) => [`SKILL_REPOSITORY_COS_${key}`, `fixture-${key}`]))

function fixture(pages: string[][] = []) {
  const db = { query: vi.fn(async (sql: string) => {
    if (sql.includes("to_regclass")) return { rows: [{ present: "SkillRepository" }] }
    if (sql.includes("current_database")) return { rows: [{ name: "synapse_preflight_fixture" }] }
    return { rows: [{ required: true }] }
  }) }
  const storage = {
    getBucketVersioning: vi.fn((_input, done) => done(null, { VersioningConfiguration: {} })),
    listObjectVersions: vi.fn((_input, done) => done(null, { Versions: [], DeleteMarkers: [] })),
    getBucket: vi.fn((_input, done) => done(null, { Contents: (pages.shift() ?? []).map(Key => ({ Key })) })),
    deleteMultipleObject: vi.fn((_input, done) => done(null, {})),
  }
  const createStorage = vi.fn(() => storage)
  return { db, storage, createStorage }
}

describe("cloud Skill retirement during deployment", () => {
  it("drains all pages including unreferenced files and exports before clearing database references", async () => {
    const f = fixture([["skill-repositories/repo/files/file", "skill-repositories/repo/exports/pkg.zip"], ["skill-repositories/orphan"]])
    await expect(retireCloudSkills({ ...f, env })).resolves.toEqual({ skipped: false, deleted: 3 })
    expect(f.storage.getBucket).toHaveBeenCalledTimes(3)
    expect(f.storage.getBucket).toHaveBeenCalledWith(expect.objectContaining({ Prefix: "skill-repositories/", MaxKeys: 1000 }), expect.any(Function))
    expect(f.db.query).toHaveBeenLastCalledWith("COMMIT")
    expect(f.storage.getBucket.mock.invocationCallOrder.at(-1)).toBeLessThan(f.db.query.mock.invocationCallOrder[2]!)
  })
  it("retains metadata when COS listing fails", async () => {
    const f = fixture()
    f.storage.getBucket.mockImplementation((_input, done) => done(new Error("COS unavailable")))
    await expect(retireCloudSkills({ ...f, env })).rejects.toThrow("COS unavailable")
    expect(f.db.query).not.toHaveBeenCalledWith("BEGIN")
  })
  it("retains metadata on a partial object deletion failure so a later deployment can retry", async () => {
    const f = fixture([["skill-repositories/repo/files/file"]])
    f.storage.deleteMultipleObject.mockImplementation((_input, done) => done(null, { Error: [{ Code: "AccessDenied" }] }))
    await expect(retireCloudSkills({ ...f, env })).rejects.toThrow("metadata was retained")
    expect(f.db.query).not.toHaveBeenCalledWith("BEGIN")
    f.storage.deleteMultipleObject.mockImplementation((_input, done) => done(null, {}))
    await expect(retireCloudSkills({ ...f, env })).resolves.toMatchObject({ skipped: false })
  })
  it("refuses to delete outside the retired prefix or in a shared bucket", async () => {
    const f = fixture([["drive/files/unrelated"]])
    await expect(retireCloudSkills({ ...f, env })).rejects.toThrow("outside")
    expect(f.storage.deleteMultipleObject).not.toHaveBeenCalled()
    await expect(retireCloudSkills({ ...fixture(), env: { ...env, DRIVE_COS_BUCKET: env.SKILL_REPOSITORY_COS_BUCKET } })).rejects.toThrow("shared")
  })
  it("refuses to initialize the old COS client if its bucket is the Skill Hub bucket", async () => {
    const f = fixture()
    await expect(retireCloudSkills({ ...f, env: { ...env, SKILL_HUB_COS_BUCKET: env.SKILL_REPOSITORY_COS_BUCKET } }))
      .rejects.toThrow("shared storage bucket")
    expect(f.createStorage).not.toHaveBeenCalled()
    expect(f.storage.deleteMultipleObject).not.toHaveBeenCalled()
  })
  it("requires legacy storage credentials before dropping referenced data", async () => {
    const f = fixture()
    await expect(retireCloudSkills({ ...f, env: {} })).rejects.toThrow("configuration")
    expect(f.createStorage).not.toHaveBeenCalled()
  })
  it("skips safely after retirement and on a fresh database", async () => {
    const f = fixture()
    f.db.query.mockResolvedValue({ rows: [{ present: null }] } as never)
    await expect(retireCloudSkills({ ...f, env: {} })).resolves.toEqual({ skipped: true, deleted: 0 })
    expect(f.createStorage).not.toHaveBeenCalled()
  })
  it("rehearses only on the restored deployment database without accessing COS", async () => {
    const f = fixture()
    await expect(retireCloudSkills({ ...f, env, rehearsal: true })).resolves.toMatchObject({ rehearsal: true, deleted: 0 })
    expect(f.createStorage).not.toHaveBeenCalled()
    expect(f.db.query).toHaveBeenLastCalledWith("COMMIT")
    const invalid = fixture()
    invalid.db.query.mockImplementation(async (sql) => ({ rows: [sql.includes("to_regclass") ? { present: "SkillRepository" } : { name: "synapse" }] }) as never)
    await expect(retireCloudSkills({ ...invalid, env, rehearsal: true })).rejects.toThrow("preflight database")
    expect(invalid.db.query).not.toHaveBeenCalledWith("BEGIN")
  })
  it("removes old object versions and delete markers as well as current bytes", async () => {
    const f = fixture()
    f.storage.getBucketVersioning.mockImplementation((_input, done) => done(null, { VersioningConfiguration: { Status: "Enabled" } }))
    f.storage.listObjectVersions.mockImplementationOnce((_input, done) => done(null, {
      Versions: [{ Key: "skill-repositories/repo/file", VersionId: "v1" }],
      DeleteMarkers: [{ Key: "skill-repositories/repo/file", VersionId: "marker" }],
    }))
    await expect(retireCloudSkills({ ...f, env })).resolves.toMatchObject({ deleted: 2 })
    expect(f.storage.getBucket).not.toHaveBeenCalled()
    expect(f.storage.deleteMultipleObject).toHaveBeenCalledWith(expect.objectContaining({ Objects: [
      { Key: "skill-repositories/repo/file", VersionId: "v1" },
      { Key: "skill-repositories/repo/file", VersionId: "marker" },
    ] }), expect.any(Function))
  })
  it("refuses an ordinary script invocation before connecting to any database", () => {
    const result = spawnSync(process.execPath, [path.resolve("scripts/retire-cloud-skills.cjs")], { encoding: "utf8", env: { PATH: process.env.PATH } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("migration must not proceed")
    expect(result.stdout).toBe("")
  })
  it("rolls back metadata changes when database cleanup fails", async () => {
    const f = fixture()
    f.db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("UPDATE")) throw new Error("database failure")
      return { rows: [{ present: "SkillRepository", required: true }] }
    })
    await expect(retireCloudSkills({ ...f, env })).rejects.toThrow("database failure")
    expect(f.db.query).toHaveBeenLastCalledWith("ROLLBACK")
  })
})
