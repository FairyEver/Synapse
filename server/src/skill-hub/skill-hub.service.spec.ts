import { Readable } from "node:stream"
import archiver from "archiver"
import { describe, expect, it, vi } from "vitest"
import { sha256 } from "@synapse/shared/archive-package-node"
import type { SkillHubCreateInput } from "@synapse/shared/skill-hub-contracts"
import type { SkillHubRepository } from "./skill-hub.repository"
import { SkillHubService } from "./skill-hub.service"
import { hubError } from "./skill-hub-error"

const team = { id: "team", name: "团队" }
const now = new Date("2026-11-04T00:00:00Z")
const manifest = [{ path: "SKILL.md", size: 10, sha256: "0".repeat(64) }]
const object = (kind: "archive" | "main") => ({ id: kind, kind, state: "ready", sha256: "0".repeat(64), size: 10 })
const createInput: SkillHubCreateInput = {
  teamId: team.id, packageUploadId: "upload-one", requestId: "initial",
  displayName: "商店名", displayDescription: "商店介绍",
}
function fixture(files?: Record<string, Buffer>) {
  type Skill = {
    id: string; teamId: string; maintainerUserId: string | null; createdById: string | null; deletedAt: Date | null;
    currentVersionId: string | null; revision: number;
  }
  type Version = { id: string; number: number; contentFingerprint: string; archiveObject: ReturnType<typeof object> }
  type Receipt = { actorKey: string; action: string; requestId: string; requestDigest: string; skillId: string; result: unknown }
  let skill: Skill | undefined
  const versions = new Map<string, Version>()
  const receipts = new Map<string, Receipt>()
  const active = new Set(["author", "member"])
  const nicknames = new Map<string, string>()
  const uploads = new Map([
    ["upload-one", ["first-name", "a"]],
    ["upload-two", ["changed-name", "b"]],
    ["upload-same", ["changed-name", "b"]],
  ])
  const receiptKey = ({ actorKey, action, requestId }: Pick<Receipt, "actorKey" | "action" | "requestId">) => [actorKey, action, requestId].join(":")
  const lockActiveTeamMember = vi.fn(async (_tx, teamId: string, userId: string) => {
    if (teamId !== team.id || !active.has(userId)) throw hubError(403, "HUB_TEAM_UNAVAILABLE", "已离队")
    return { id: userId, nickname: nicknames.get(userId) ?? userId }
  })
  function readSkill(select?: { createdBy?: unknown }) {
    if (!skill) return null
    return {
      ...skill,
      currentVersion: versions.get(skill.currentVersionId ?? ""),
      ...(select?.createdBy ? {
        createdBy: skill.createdById ? { nickname: nicknames.get(skill.createdById) ?? skill.createdById } : null,
      } : {}),
    }
  }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "asset" }]),
    $executeRaw: vi.fn(),
    teamMembership: {
      findMany: vi.fn(async ({ where }: { where: { OR: { userId: string }[] } }) => where.OR.filter(({ userId }) => active.has(userId))
        .map(({ userId }) => ({ userId, teamId: team.id }))),
    },
    skillHubUpload: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; actorKey: string; teamId: string } }) => {
        const upload = uploads.get(where.id)
        if (!upload || where.teamId !== team.id || !active.has(where.actorKey)) return null
        const entries = files ? Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) })) : manifest
        return { id: where.id, packageName: upload[0], packageDescription: `包内介绍 ${upload[0]}`, manifest: entries,
          contentFingerprint: "sha256:" + upload[1].repeat(64), objects: [object("archive"), object("main")] }
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    skillHubSkill: {
      findMany: vi.fn(async ({ select }) => {
        const row = readSkill(select)
        return row ? [row] : []
      }),
      create: vi.fn(async ({ data }) => {
        skill = { ...data, id: "asset", team, revision: 1, currentVersionId: null, deletedAt: null } as Skill
        return { id: skill.id }
      }),
      findFirst: vi.fn(async ({ where, select }) => {
        if (!skill || where.id !== skill.id || skill.deletedAt) return null
        if (where.team && !active.has(where.team.members.some.userId)) return null
        if (where.maintainerUserId && where.maintainerUserId !== skill.maintainerUserId) return null
        return readSkill(select)
      }),
      update: vi.fn(async ({ data }) => {
        const current = skill!
        skill = { ...current, ...data, revision: current.revision + (data.revision?.increment ?? 0) }
        return skill
      }),
    },
    skillHubVersion: {
      create: vi.fn(async ({ data }) => {
        const version = { ...data, id: `v${data.number}`, archiveObject: object("archive"), mainObject: object("main") }
        versions.set(version.id, version)
        return { id: version.id }
      }),
    },
    skillHubWriteReceipt: {
      findUnique: vi.fn(async ({ where }) => receipts.get(receiptKey(where.actorKey_action_requestId))),
      create: vi.fn(async ({ data }) => receipts.set(receiptKey(data), data)),
    },
  }
  const repository = { lockActiveTeamMember, prisma: { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } }
  const open = vi.fn()
  const service = new SkillHubService(repository as unknown as SkillHubRepository, { put: vi.fn(), open, head: vi.fn(), remove: vi.fn() })
  return { service, versions, active, nicknames, tx, open, current: () => skill! }
}

it("uses the current creator nickname in the catalog and detail, and preserves attribution if the account is deleted", async () => {
  const { service, nicknames, current } = fixture()
  nicknames.set("author", "原昵称")
  await service.create("author", createInput)
  nicknames.set("author", "李杨")

  await expect(service.list("member", {})).resolves.toMatchObject({
    items: [{ createdBy: { id: "author", displayName: "李杨" } }],
  })
  await expect(service.get("member", "asset")).resolves.toMatchObject({
    createdBy: { id: "author", displayName: "李杨" },
  })

  current().createdById = null
  await expect(service.get("member", "asset")).resolves.toMatchObject({
    createdBy: { id: null, displayName: "原昵称" },
  })
})

it("previews only the requested latest UTF-8 file for current team members", async () => {
  const content = "# 说明\n<script>example()</script>\n"
  const path = "references/说明.md"
  const files = { "SKILL.md": Buffer.from("# skill"), [path]: Buffer.from(content),
    "empty.txt": Buffer.alloc(0), "binary.dat": Buffer.from([0, 1, 2]), "large.txt": Buffer.alloc(1024 * 1024 + 1, "a") }
  const archive = archiver("zip")
  const chunks: Buffer[] = []
  archive.on("data", (chunk: Buffer) => chunks.push(chunk))
  const ended = new Promise<void>((resolve, reject) => archive.once("end", resolve).once("error", reject))
  for (const [name, bytes] of Object.entries(files)) archive.append(bytes, { name })
  await Promise.all([ended, archive.finalize()])
  const bytes = Buffer.concat(chunks)

  const { service, tx, active, open } = fixture(files)
  await service.create("author", createInput)
  const row = await tx.skillHubSkill.findFirst({ where: { id: "asset" } })
  Object.assign(row!.currentVersion!.archiveObject, { storageKey: "archive", size: bytes.length, sha256: sha256(bytes) })
  open.mockImplementation(async () => ({ size: bytes.length, stream: Readable.from([bytes]) }))

  await expect(service.openFile("outsider", "asset", { expectedVersionId: "v1", path }))
    .rejects.toMatchObject({ response: { code: "HUB_NOT_AVAILABLE" } })
  await expect(service.openFile("member", "asset", { expectedVersionId: "v0", path }))
    .rejects.toMatchObject({ response: { code: "HUB_LATEST_CHANGED" } })
  await expect(service.openFile("member", "asset", { expectedVersionId: "v1", path: "../SKILL.md" }))
    .rejects.toMatchObject({ response: { code: "HUB_NOT_AVAILABLE" } })
  await expect(service.openFile("member", "asset", { expectedVersionId: "v1", path: "large.txt" }))
    .rejects.toMatchObject({ response: { code: "HUB_PREVIEW_TOO_LARGE" } })
  expect(open).not.toHaveBeenCalled()
  await expect(service.openFile("member", "asset", { expectedVersionId: "v1", path })).resolves.toEqual({ versionId: "v1", content })
  const rendered = await service.openFileMarkdown("member", "asset", { expectedVersionId: "v1", path })
  expect(rendered).toMatchObject({ versionId: "v1", html: expect.stringContaining("<h1>说明</h1>") })
  expect(rendered).not.toHaveProperty("content")
  await expect(service.openFile("member", "asset", { expectedVersionId: "v1", path: "empty.txt" })).resolves.toEqual({ versionId: "v1", content: "" })
  await expect(service.openFile("member", "asset", { expectedVersionId: "v1", path: "binary.dat" }))
    .rejects.toMatchObject({ response: { code: "HUB_PREVIEW_NOT_TEXT" } })
  open.mockResolvedValueOnce({ size: bytes.length, stream: Readable.from([Buffer.alloc(bytes.length)]) })
  await expect(service.openFile("member", "asset", { expectedVersionId: "v1", path }))
    .rejects.toMatchObject({ response: { code: "HUB_STORAGE_UNAVAILABLE" } })
  active.delete("member")
  await expect(service.openFile("member", "asset", { expectedVersionId: "v1", path }))
    .rejects.toMatchObject({ response: { code: "HUB_NOT_AVAILABLE" } })
})

describe("Skill Hub writes", () => {
  it("creates v1 and publishes a complete renamed package without overwriting store metadata", async () => {
    const { service, versions } = fixture()
    await expect(service.create("author", createInput)).resolves.toMatchObject({
      outcome: "created", skill: { displayName: "商店名", currentVersion: { id: "v1", number: 1 }, package: { name: "first-name" } },
    })
    const publish = { expectedVersionId: "v1", packageUploadId: "upload-two", requestId: "second" }
    await expect(service.publish("author", "asset", publish)).resolves.toMatchObject({
      outcome: "published", skill: { displayName: "商店名", revision: 2, currentVersion: { id: "v2", number: 2 }, package: { name: "changed-name" } },
    })
    const same = { ...publish, packageUploadId: "upload-same", requestId: "same" }
    await expect(service.publish("author", "asset", same)).rejects.toMatchObject({ response: { code: "HUB_VERSION_CONFLICT" } })
    await expect(service.publish("author", "asset", { ...same, expectedVersionId: "v2" })).resolves.toMatchObject({
      outcome: "unchanged", skill: { revision: 2, currentVersion: { id: "v2" } },
    })
    expect(versions.size).toBe(2)
    await expect(service.openLatest("member", "asset", "v1")).rejects.toMatchObject({ response: { code: "HUB_LATEST_CHANGED" } })
  })

  it("replays committed work without reusing the upload and hides receipt details after team access is lost", async () => {
    const { service, tx, active } = fixture()
    await service.create("author", createInput)
    await expect(service.create("author", createInput)).resolves.toMatchObject({
      replayed: true, receipt: { status: "committed", result: { skillId: "asset", outcome: "created", versionId: "v1" } },
    })
    expect(tx.skillHubUpload.findFirst).toHaveBeenCalledTimes(1)
    await expect(service.create("author", { ...createInput, displayName: "different" })).rejects.toMatchObject({
      response: { code: "HUB_REQUEST_CONFLICT" },
    })
    active.delete("author")
    await expect(service.get("member", "asset")).resolves.toMatchObject({
      createdBy: { id: "author" }, maintainer: { isActiveMember: false }, permissions: { canEditMetadata: false },
    })
    await expect(service.publish("author", "asset", { packageUploadId: "upload-two", expectedVersionId: "v1", requestId: "left" }))
      .rejects.toMatchObject({ response: { code: "HUB_NOT_AVAILABLE" } })
    const query = { action: "app.skill_hub.skill.create", requestId: "initial" } as const
    await expect(service.getReceipt("author", query)).resolves.toEqual({ ...query, status: "committed", resultAccessible: false })
    await expect(service.getReceipt("member", query)).resolves.toEqual({ ...query, status: "not_found", resultAccessible: false })
  })

  it("blocks writes by a prior maintainer and keeps original creator after handoff and soft deletion", async () => {
    const { service, current } = fixture()
    await service.create("author", createInput)
    current().maintainerUserId = "member"
    await expect(service.update("author", "asset", { expectedRevision: 1, requestId: "old", displayName: "不允许" }))
      .rejects.toMatchObject({ response: { code: "HUB_NOT_AVAILABLE" } })
    await expect(service.update("member", "asset", { expectedRevision: 2, requestId: "stale", displayName: "冲突" }))
      .rejects.toMatchObject({ response: { code: "HUB_REVISION_CONFLICT" } })
    await expect(service.softDelete("member", "asset", { expectedRevision: 1, requestId: "delete" })).resolves.toMatchObject({
      id: "asset", revision: 2, outcome: "deleted",
    })
    expect(current()).toMatchObject({ currentVersionId: "v1", createdById: "author", maintainerUserId: "member" })
    await expect(service.get("member", "asset")).rejects.toMatchObject({ response: { code: "HUB_NOT_AVAILABLE" } })
    // Simulate the independent administrator restoring the same asset.
    current().deletedAt = null
    await expect(service.softDelete("member", "asset", { expectedRevision: 1, requestId: "delete" })).resolves.toMatchObject({
      replayed: true, receipt: { result: { outcome: "deleted", revision: 2 } },
    })
    expect(current().deletedAt).toBeNull()
    expect(current().currentVersionId).toBe("v1")
  })
})
