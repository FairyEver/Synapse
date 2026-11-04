import "reflect-metadata"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { crc32, deflateSync } from "node:zlib"
import { Test } from "@nestjs/testing"
import type { NestExpressApplication } from "@nestjs/platform-express"
import type { Prisma, PrismaClient } from "@prisma/client"
import cookieParser from "cookie-parser"
import type { NextFunction, Request, Response } from "express"
import { LoggerModule, PinoLogger } from "nestjs-pino"
import supertest from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  skillHubAdminRowSchema, skillHubDetailSchema, skillHubReceiptSchema, skillHubTeamPageSchema,
  skillHubUploadResultSchema, skillHubWriteResultSchema,
  type SkillHubDetail, type SkillHubUploadInput,
} from "@synapse/shared/skill-hub-contracts"
import type { McpToolCallResult } from "../../desktop/database/shared/mcp-rpc"
import type { AccountRequestScope } from "../../desktop/electron/services/account-service"
import { withTeamResourceLock } from "../src/team/team-resource-lock"
import type { SkillHubBackupService as Backup } from "../src/skill-hub/skill-hub-backup.service"
import type { SkillHubMaintenanceService as Maintenance } from "../src/skill-hub/skill-hub-maintenance.service"
import { requireSkillHubE2eDatabase } from "./run-skill-hub-e2e.mjs"

const built = createRequire(import.meta.url)
const origin = "http://127.0.0.1:19700"
const hub = "/api/skill-hub"
const admin = "/api/admin/skill-hub/skills"
const packageText = (name: string, body: string) => Buffer.from(`---\nname: ${name}\ndescription: A real package.\n---\n${body}\n`)
const route = (id: string) => `${hub}/skills/${id}`

function solidPng(red: number) {
  const chunk = (type: string, bytes: Buffer) => {
    const label = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([label, bytes])))
    return Buffer.concat([length, label, bytes, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 2
  const scan = Buffer.alloc(256 * 769)
  for (let row = 0; row < 256; row++) for (let pixel = 0; pixel < 256; pixel++) scan[row * 769 + 1 + pixel * 3] = red
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(scan)), chunk("IEND", Buffer.alloc(0))])
}

describe("Skill Hub with real authenticated HTTP, PostgreSQL, worker and local object bytes", () => {
  let app: NestExpressApplication, db: PrismaClient, http: ReturnType<typeof supertest>
  let ownerAuth: string, peerAuth: string, adminAuth: string, peerCookie: string, peerSession: string
  let backup: Backup, gc: Maintenance, scratch: string
  const marker = randomUUID().slice(0, 8)
  const owner = `hub_owner_${marker}`, peer = `hub_peer_${marker}`, departing = `hub_departing_${marker}`
  const team = `hub_a_${marker}`, other = `hub_b_${marker}`, empty = `hub_empty_${marker}`
  const password = randomUUID()
  const bearer = (auth: string) => ({ Authorization: `Bearer ${auth}` })
  const adminHeaders = () => ({ Cookie: adminAuth, Origin: origin })

  beforeAll(async () => {
    const expected = requireSkillHubE2eDatabase(process.env.SKILL_HUB_E2E_DATABASE_URL)
    scratch = process.env.SYNAPSE_SKILL_HUB_LOCAL_ROOT ?? ""
    if (process.env.DATABASE_URL !== expected || process.env.NODE_ENV !== "test" || !scratch) {
      throw new Error("Run this suite through the isolated Skill Hub E2E runner")
    }
    const { SkillHubModule } = built("../dist/skill-hub/skill-hub.module.js")
    const { TeamModule } = built("../dist/team/team.module.js")
    const { UserAuthModule } = built("../dist/auth/user-auth.module.js")
    const { DashboardAuthController } = built("../dist/dashboard/dashboard-auth.controller.js")
    const { PrismaService } = built("../dist/prisma/prisma.service.js")
    const { SkillHubBackupService } = built("../dist/skill-hub/skill-hub-backup.service.js")
    const { SkillHubMaintenanceService } = built("../dist/skill-hub/skill-hub-maintenance.service.js")
    const { AllExceptionsFilter } = built("../dist/common/all-exceptions.filter.js")
    const { registerHttpBodyParsers } = built("../dist/common/http-body-parser.js")
    const { hashPassword } = built("../dist/auth/password.js")
    const fixture = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: { level: "silent" } }), SkillHubModule, TeamModule, UserAuthModule],
      controllers: [DashboardAuthController],
    }).compile()
    app = fixture.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false })
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.headers["x-fixture-drop-reply"] === "yes") response.end = (() => { response.destroy(); return response }) as typeof response.end
      next()
    })
    registerHttpBodyParsers(app)
    app.use(cookieParser())
    app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)))
    await app.listen(0, "127.0.0.1")
    http = supertest(app.getHttpServer())
    db = app.get(PrismaService)
    backup = app.get(SkillHubBackupService)
    gc = app.get(SkillHubMaintenanceService)
    const passwordHash = await hashPassword(password)
    await db.user.createMany({ data: [owner, peer, departing].map((id) => ({ id, handle: id, email: `${id}@example.test`, nickname: id, passwordHash })) })
    await db.team.createMany({ data: [team, other, empty].map((id) => ({ id, name: id })) })
    await db.teamMembership.createMany({ data: [
      { teamId: team, userId: owner }, { teamId: other, userId: owner }, { teamId: team, userId: peer },
      { teamId: team, userId: departing },
    ] })
    const login = async (id: string) => (await http.post("/api/auth/login").send({ email: `${id}@example.test`, password }).expect(201)).body.accessToken as string
    ownerAuth = await login(owner)
    peerAuth = await login(peer)
    const web = await http.post("/api/console/login").send({ email: `${peer}@example.test`, password }).expect(201)
    expect(web.body.userId).toBe(peer)
    peerSession = web.body.sessionId
    peerCookie = ((web.headers["set-cookie"] as unknown as string[]).find((cookie) => cookie.startsWith("synapse_user_session=")) ?? "").split(";")[0]
    const platform = await http.post("/api/admin/session").set("Origin", origin)
      .send({ accessSecret: process.env.ADMIN_ACCESS_SECRET }).expect(201)
    adminAuth = ((platform.headers["set-cookie"] as unknown as string[]).find((cookie) => cookie.startsWith("synapse_admin_session=")) ?? "").split(";")[0]
    expect(ownerAuth && peerAuth && peerCookie && adminAuth).toBeTruthy()
  }, 30_000)

  afterAll(async () => { await app?.close() })

  async function upload(bytes: Buffer, auth: string = ownerAuth, target = team, purpose: "package" | "icon" = "package") {
    const input: SkillHubUploadInput = purpose === "icon"
      ? { purpose, teamId: target, requestId: randomUUID() }
      : { purpose, format: "markdown", teamId: target, requestId: randomUUID() }
    const response = await http.post(`${hub}/uploads`).query(input).set(bearer(auth))
      .set("Content-Type", "application/octet-stream").send(bytes).expect(201)
    return skillHubUploadResultSchema.parse(response.body).uploadId
  }

  async function create(body: string, auth = ownerAuth, icon?: Buffer) {
    const packageUploadId = await upload(packageText("first-name", body), auth)
    const iconUploadId = icon ? await upload(icon, auth, team, "icon") : undefined
    const input = { teamId: team, packageUploadId, iconUploadId, requestId: randomUUID(), displayName: "中文商店名称", displayDescription: "中文介绍" }
    const result = await http.post(`${hub}/skills`).set(bearer(auth)).send(input).expect(201)
    return skillHubWriteResultSchema.parse(result.body).skill
  }

  function publish(skill: SkillHubDetail, uploadId: string, auth = ownerAuth) {
    return http.post(`${route(skill.id)}/versions`).set(bearer(auth)).send({
      expectedVersionId: skill.currentVersion.id, packageUploadId: uploadId, requestId: randomUUID(),
    })
  }

  async function waitForLock(table: "Team" | "User") {
    for (let attempt = 0; attempt < 100; attempt++) {
      const query = `%FROM "${table}"%FOR UPDATE%`
      const rows = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE ${query}) AS waiting`
      if (rows[0]?.waiting) return
      await delay(25)
    }
    throw new Error(`The concurrent Skill Hub write did not reach its ${table} lock`)
  }

  it("walks account, one-item multi-team paging, publication, dropped response, receipt and latest-only reads", async () => {
    await http.get("/api/auth/me").set(bearer(ownerAuth)).expect(200)
    const first = skillHubTeamPageSchema.parse((await http.get(`${hub}/teams`).query({ limit: 1 }).set(bearer(ownerAuth)).expect(200)).body)
    expect(first).toMatchObject({ items: [{ id: team }], selectionState: "multiple", defaultTeamId: null })
    expect(first.nextCursor).toBeTruthy()
    const second = skillHubTeamPageSchema.parse((await http.get(`${hub}/teams`).query({ limit: 1, cursor: first.nextCursor }).set(bearer(ownerAuth)).expect(200)).body)
    expect(second).toMatchObject({ items: [{ id: other }], selectionState: "multiple", defaultTeamId: null, nextCursor: null })
    await http.get(`${hub}/teams`).query({ userId: owner }).set(bearer(peerAuth)).expect(400)
    const single = skillHubTeamPageSchema.parse((await http.get(`${hub}/teams`).set(bearer(peerAuth)).expect(200)).body)
    expect(single).toMatchObject({ selectionState: "single", defaultTeamId: team })
    await http.get(`${hub}/teams`).set({ Cookie: peerCookie, "X-Skill-Hub-Session": "other-session" }).expect(401)
    await http.get(`${hub}/teams`).set({ Cookie: peerCookie, "X-Skill-Hub-Session": peerSession }).expect(200)

    const source = packageText("package-name", "Read and use the original package")
    await http.post(`${hub}/uploads`).query({ teamId: team, purpose: "package", format: "zip", requestId: randomUUID() })
      .set(bearer(ownerAuth)).set("Content-Type", "application/octet-stream").send(source).expect(400)
    const uploadId = await upload(source)
    const input = { teamId: team, packageUploadId: uploadId, requestId: randomUUID(), displayName: "商店名", displayDescription: "商店介绍" }
    await expect(http.post(`${hub}/skills`).set(bearer(ownerAuth)).set("x-fixture-drop-reply", "yes").send(input)).rejects.toThrow()
    const query = { action: "app.skill_hub.skill.create" }
    const receipt = skillHubReceiptSchema.parse((await http.get(`${hub}/receipts/${input.requestId}`).set(bearer(ownerAuth)).query(query).expect(200)).body)
    expect(receipt).toMatchObject({ status: "committed", result: { teamId: team, versionNumber: 1, outcome: "created" } })
    expect((await http.get(`${hub}/receipts/${input.requestId}`).set(bearer(peerAuth)).query(query).expect(200)).body.status).toBe("not_found")
    const replay = await http.post(`${hub}/skills`).set(bearer(ownerAuth)).send(input).expect(201)
    expect(replay.body).toMatchObject({ replayed: true, receipt: { result: { skillId: receipt.result!.skillId } } })
    expect(await db.skillHubWriteReceipt.count({ where: { requestId: input.requestId } })).toBe(1)
    const id = receipt.result!.skillId
    const detail = skillHubDetailSchema.parse((await http.get(route(id)).set(bearer(peerAuth)).expect(200)).body)
    expect(detail).toMatchObject({ displayName: "商店名", package: { name: "package-name", description: "A real package." } })
    await http.get(route(id)).set(adminHeaders()).expect(401)
    await http.patch(route(id)).set("Cookie", peerCookie).set("Origin", "https://foreign.example.test").send({}).expect(403)

    const renamed = await upload(packageText("next-name", "Latest complete package"))
    const v2 = skillHubWriteResultSchema.parse((await publish(detail, renamed).expect(201)).body).skill
    expect(v2).toMatchObject({ currentVersion: { number: 2 }, displayName: "商店名", package: { name: "next-name" } })
    await http.get(`${route(id)}/package`).set(bearer(peerAuth)).query({ expectedVersionId: detail.currentVersion.id }).expect(409)
    const latest = await http.get(`${route(id)}/package`).set(bearer(peerAuth)).expect(200)
    expect(latest.headers["x-skill-hub-version-id"]).toBe(v2.currentVersion.id)
    const unchangedId = await upload(packageText("next-name", "Latest complete package"))
    const unchanged = await publish(v2, unchangedId).expect(201)
    expect(unchanged.body.outcome).toBe("unchanged")
    expect(await db.skillHubVersion.count({ where: { skillId: id } })).toBe(2)
  }, 30_000)

  it("serializes two concurrent updates from v1", async () => {
    const skill = await create("Concurrency")
    const a = await upload(packageText("candidate-a", "A"))
    const b = await upload(packageText("candidate-b", "B"))
    const outcomes = await Promise.allSettled([publish(skill, a), publish(skill, b)])
    expect(outcomes.flatMap((r) => r.status === "fulfilled" ? [r.value.status] : []).sort()).toEqual([201, 409])
    expect(await db.skillHubVersion.count({ where: { skillId: skill.id } })).toBe(2)
  }, 30_000)

  async function race(skill: SkillHubDetail, uploadId: string, lock: "Team" | "User", mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, expected = 403) {
    let pending: Promise<supertest.Response> | undefined
    try {
      await db.$transaction(async (tx) => {
        if (lock === "Team") await withTeamResourceLock(tx, team)
        else await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner} FOR UPDATE`
        pending = publish(skill, uploadId).then((response) => response)
        await waitForLock(lock)
        await mutate(tx)
      }, { timeout: 10_000 })
    } finally {
      if (pending) await pending.catch(() => undefined)
    }
    expect((await pending)?.status).toBe(expected)
    expect(await db.skillHubVersion.count({ where: { skillId: skill.id } })).toBe(1)
  }

  it("serializes publication against leaving, disabling and changing the maintainer", async () => {
    const skill = await create("Races")
    const removedPackage = await upload(packageText("candidate", "not visible"))
    await race(skill, removedPackage, "Team", (tx) => tx.teamMembership.delete({ where: { teamId_userId: { teamId: team, userId: owner } } }))
    await db.teamMembership.create({ data: { teamId: team, userId: owner } })
    const disabledPackage = await upload(packageText("candidate", "not active"))
    await race(skill, disabledPackage, "User", (tx) => tx.user.update({ where: { id: owner }, data: { status: "disabled" } }))
    await db.user.update({ where: { id: owner }, data: { status: "active" } })
    const replacedPackage = await upload(packageText("candidate", "not maintainer"))
    await race(skill, replacedPackage, "Team", (tx) => tx.skillHubSkill.update({ where: { id: skill.id },
      data: { maintainerUserId: peer, maintainerName: peer, revision: { increment: 1 } } }), 404)
    const active = skillHubDetailSchema.parse((await http.get(route(skill.id)).set(bearer(peerAuth)).expect(200)).body)
    expect(active).toMatchObject({ createdBy: { id: owner }, maintainer: { id: peer }, permissions: { canPublishVersion: true } })
  }, 30_000)

  it("preserves bytes and contribution across handoff, creator deletion, team protection and restore", async () => {
    const auth = (await http.post("/api/auth/login").send({ email: `${departing}@example.test`, password }).expect(201)).body.accessToken as string
    const icon = solidPng(42)
    const skill = await create("Keep the contribution", auth, icon)
    const input = { maintainerUserId: peer, expectedRevision: skill.revision, requestId: randomUUID() }
    const handoff = skillHubAdminRowSchema.parse((await http.post(`${admin}/${skill.id}/maintainer`).set(adminHeaders()).send(input).expect(201)).body)
    expect(handoff).toMatchObject({ maintainer: { id: peer }, createdBy: { id: departing } })
    await http.patch(route(skill.id)).set(bearer(auth)).send({ expectedRevision: handoff.revision, requestId: randomUUID(), displayName: "forbidden" }).expect(404)
    await db.$transaction([
      db.userSession.deleteMany({ where: { userId: departing } }),
      db.user.delete({ where: { id: departing } }),
    ])
    await http.delete(route(skill.id)).set(bearer(peerAuth)).send({ expectedRevision: handoff.revision, requestId: randomUUID() }).expect(200)
    await http.get(route(skill.id)).set(bearer(ownerAuth)).expect(404)
    const adminList = await http.get(admin).set(adminHeaders()).query({ teamId: team, deleted: true }).expect(200)
    expect(adminList.body.items).toContainEqual(expect.objectContaining({ id: skill.id, deletedAt: expect.any(String) }))
    expect(adminList.body.items.find((item: { id: string }) => item.id === skill.id)).not.toHaveProperty("files")
    const row = await db.skillHubSkill.findUniqueOrThrow({ where: { id: skill.id }, include: { iconObject: true, currentVersion: { include: { archiveObject: true } } } })
    expect(row).toMatchObject({ createdById: null, createdByName: departing, maintainerUserId: peer, deletedAt: expect.any(Date) })
    await expect(db.team.delete({ where: { id: team } })).rejects.toMatchObject({ code: "P2003" })
    await http.delete(`/api/admin/teams/${team}`).set(adminHeaders()).expect(409)
    await http.delete(`/api/admin/teams/${empty}`).set(adminHeaders()).expect(200)
    const pkgPath = join(scratch, row.currentVersion!.archiveObject.storageKey)
    const bytes = await readFile(pkgPath)
    expect(await readFile(join(scratch, row.iconObject!.storageKey))).toEqual(icon)
    const restore = { requestId: randomUUID(), expectedRevision: row.revision }
    await rename(pkgPath, pkgPath + ".fixture-held")
    try {
      const failed = await http.post(`${admin}/${skill.id}/restore`).set(adminHeaders()).send(restore).expect(409)
      expect(failed.body.code).toBe("HUB_RESTORE_INCOMPLETE")
      expect((await db.skillHubSkill.findUniqueOrThrow({ where: { id: skill.id } })).deletedAt).not.toBeNull()
    } finally { await rename(pkgPath + ".fixture-held", pkgPath) }
    await http.post(`${admin}/${skill.id}/restore`).set(adminHeaders()).send(restore).expect(201)
    await http.get(route(skill.id)).set(bearer(ownerAuth)).expect(200)
    expect(await readFile(pkgPath)).toEqual(bytes)
    expect(await db.skillHubVersion.count({ where: { skillId: skill.id } })).toBe(1)
  }, 30_000)

  it("discovers and invokes all ten Hub tools with the built desktop router, real HTTP and a temporary local directory", async () => {
    const desktop = "../../desktop/dist-electron"
    const hubMain = `${desktop}/app-capabilities/skill-hub/main`
    const { SkillHubCloudClient } = built(`${hubMain}/cloud-client.js`) as typeof import("../../desktop/app-capabilities/skill-hub/main/cloud-client")
    const { DesktopSkillHubService } = built(`${hubMain}/service.js`) as typeof import("../../desktop/app-capabilities/skill-hub/main/service")
    const { HubPackageService } = built(`${hubMain}/package-service.js`) as typeof import("../../desktop/app-capabilities/skill-hub/main/package-service")
    const { createSkillHubCapabilityDispatcher } = built(`${hubMain}/dispatcher.js`) as typeof import("../../desktop/app-capabilities/skill-hub/main/dispatcher")
    const { createSynapseToolRouterSurface } = built(`${desktop}/electron/services/agent-runtime/synapse-tool-router.js`) as typeof import("../../desktop/electron/services/agent-runtime/synapse-tool-router")
    const { getMcpToolCapability } = built(`${desktop}/synapse-capabilities/shared/registry.js`) as typeof import("../../desktop/synapse-capabilities/shared/registry")
    const { createFileBackedDataRepository } = built(`${desktop}/electron/runtime/data-repo/index.js`) as typeof import("../../desktop/electron/runtime/data-repo")
    const { ManagedAssetStore } = built(`${desktop}/electron/runtime/data-repo/assets.js`) as typeof import("../../desktop/electron/runtime/data-repo/assets")
    const { createPermissionGuard, InMemoryAuditSink, userInitiatedAllowPolicy } = built(`${desktop}/electron/runtime/security/index.js`) as typeof import("../../desktop/electron/runtime/security")
    const { skillHubPreparedSourcesSchema } = built(`${desktop}/electron/runtime/data-repo/schemas/skill-hub.js`) as typeof import("../../desktop/electron/runtime/data-repo/schemas/skill-hub")
    const base = await app.getUrl()
    const repository = createFileBackedDataRepository({ rootDir: join(scratch, "mcp-repository"),
      safeStorage: { isEncryptionAvailable: () => false, encryptString() { throw new Error("No secrets in fixture") },
        decryptString() { throw new Error("No secrets in fixture") } },
    })
    const guard = createPermissionGuard()
    guard.registerPolicy(userInitiatedAllowPolicy)
    const audit = new InMemoryAuditSink()
    const scope = { accountId: owner, authRevision: 1 }
    const cloud = new SkillHubCloudClient({
      captureAccountRequestScope: () => scope,
      onBeforeIdentityChange: () => () => undefined,
      async fetchAuthenticated(path: string, init?: RequestInit, _message?: string, expectedScope?: AccountRequestScope) {
        expect(expectedScope).toEqual(scope)
        const headers = new Headers(init?.headers)
        headers.set("Authorization", `Bearer ${ownerAuth}`)
        const response = await fetch(`${base}/api${path}`, { ...init, headers })
        if (!response.ok) {
          const result = await response.json() as { message: string; code?: string }
          throw Object.assign(new Error(result.message), { code: result.code, status: response.status })
        }
        return response
      },
    })
    const packages = new HubPackageService({
      guard, audit, assets: new ManagedAssetStore(join(scratch, "mcp-assets")), records: repository.namespace(skillHubPreparedSourcesSchema.name),
      report(code) { throw new Error(code) },
    })
    const service = new DesktopSkillHubService({ cloud, guard, audit, packages, repository })
    const dispatcher = createSkillHubCapabilityDispatcher({ service })
    const router = createSynapseToolRouterSurface((name, input) => {
      const capability = getMcpToolCapability(name)
      if (!capability) throw new Error("Unregistered capability")
      return dispatcher.dispatch(capability.id, input, { source: "mcp-http", clientId: "fixture" })
    })
    const parse = (output: McpToolCallResult) => {
      const first = output.content[0]
      if (first.type !== "text") throw new Error("Expected MCP text")
      return JSON.parse(first.text)
    }
    async function invoke(name: string, args: Record<string, unknown>) {
      const output = await router.callTool("invoke", { toolName: name, arguments: args })
      expect(output.isError, output.content[0]?.text).toBeUndefined()
      const data = parse(output)
      expect(data.externalData).toBe(true)
      return data.value
    }

    const source = join(scratch, "mcp-source")
    await mkdir(source)
    const main = join(source, "SKILL.md")
    await writeFile(main, packageText("mcp-original", "Prepare a real directory"))
    await writeFile(join(source, ".env"), "TOKEN=synthetic-never-upload")
    await writeFile(join(source, "readme.md"), "# Retained attachment")
    try {
      await http.get("/api/auth/me").set(bearer(ownerAuth)).expect(200)
      expect(router.listTools().map((tool) => tool.name).sort()).toEqual(["invoke", "search"])
      const search = parse(await router.callTool("search", { domain: "skill_hub", limit: 20 }))
      expect(search.tools).toHaveLength(10)
      const first = await invoke("app_skill_hub_team_list", { limit: 1 })
      expect(first).toMatchObject({ selectionState: "multiple", items: [{ id: team }], defaultTeamId: null })
      const noTeam = await router.callTool("invoke", { toolName: "app_skill_hub_package_prepare", arguments: { sourcePath: source } })
      expect(noTeam.isError).toBe(true)
      expect(parse(noTeam).code).toBe("HUB_TEAM_REQUIRED")
      const prepared = await invoke("app_skill_hub_package_prepare", { sourcePath: source, teamId: team })
      expect(prepared.manifest.map((file: { path: string }) => file.path)).toEqual(["SKILL.md", "readme.md"])
      const requestId = randomUUID()
      const createInput = { teamId: team, preparedSourceId: prepared.preparedSourceId, requestId,
        displayName: "MCP 测试", displayDescription: "通过真实 HTTP 发布的合成包" }
      const { SKILL_HUB_STORAGE } = built("../dist/skill-hub/skill-hub-storage.js")
      const storage = app.get<typeof import("../src/skill-hub/skill-hub-storage").SkillHubStoragePort>(SKILL_HUB_STORAGE)
      const put = storage.put.bind(storage)
      const outage = vi.spyOn(storage, "put").mockImplementationOnce(async (key, bytes, type) => {
        await put(key, bytes, type)
        throw new Error("Temporary test storage failure after writing bytes")
      })
      try {
        const interrupted = await router.callTool("invoke", { toolName: "app_skill_hub_skill_create", arguments: createInput })
        expect(interrupted.isError).toBe(true)
        expect(parse(interrupted).code).toBe("HUB_STORAGE_UNAVAILABLE")
      } finally { outage.mockRestore() }
      const retired = await db.skillHubUpload.findFirstOrThrow({ where: { actorKey: owner, state: "cleanup", packageName: "mcp-original" }, include: { objects: true } })
      expect(retired.objects).toHaveLength(2)
      const retainedPath = join(scratch, retired.objects.find((object) => object.kind === "archive")!.storageKey)
      await gc.pruneUnboundUploads(new Date())
      expect((await readFile(retainedPath)).length).toBeGreaterThan(0)
      const created = await invoke("app_skill_hub_skill_create", createInput)
      const id = created.skill.id as string
      expect(await invoke("app_skill_hub_receipt_get", { action: "app.skill_hub.skill.create", requestId }))
        .toMatchObject({ status: "committed", result: { skillId: id, teamId: team, versionNumber: 1 } })
      expect((await invoke("app_skill_hub_skill_list", { teamId: team, query: "MCP 测试" })).items)
        .toContainEqual(expect.objectContaining({ id }))
      const resolved = await invoke("app_skill_hub_skill_get", { skillId: id })
      expect(resolved.package.name).toBe("mcp-original")
      await writeFile(main, packageText("mcp-renamed", "Changed full package"))
      const next = await invoke("app_skill_hub_package_prepare", { sourcePath: source, teamId: team })
      const published = await invoke("app_skill_hub_version_create", { skillId: id, preparedSourceId: next.preparedSourceId,
        expectedVersionId: resolved.currentVersion.id, requestId: randomUUID() })
      expect(published.skill).toMatchObject({ currentVersion: { number: 2 }, package: { name: "mcp-renamed" } })
      const destinationDirectory = join(scratch, "mcp-downloaded")
      await invoke("app_skill_hub_package_download", { skillId: id, destinationDirectory })
      expect(await readFile(join(destinationDirectory, "SKILL.md"))).toEqual(packageText("mcp-renamed", "Changed full package"))
      const updated = await invoke("app_skill_hub_skill_update", { skillId: id, displayName: "新商店名称", expectedRevision: published.skill.revision, requestId: randomUUID() })
      expect(updated.skill).toMatchObject({ displayName: "新商店名称", package: { name: "mcp-renamed" }, currentVersion: { number: 2 } })
      expect(await invoke("app_skill_hub_skill_delete", { skillId: id, expectedRevision: updated.skill.revision, requestId: randomUUID() }))
        .toMatchObject({ id, outcome: "deleted" })
      expect((await router.callTool("invoke", { toolName: "app_skill_repository_skill_list" })).isError).toBe(true)
    } finally { service.dispose() }
  }, 45_000)

  it("keeps the pre-replacement icon in a byte backup while real GC is fenced", async () => {
    const icon = solidPng(74)
    const skill = await create("Backup fence", ownerAuth, icon)
    const before = await db.skillHubSkill.findUniqueOrThrow({ where: { id: skill.id }, include: { iconObject: true } })
    const iconUploadId = await upload(solidPng(95), ownerAuth, team, "icon")
    const backupDir = join(scratch, "backup-fixture")
    await mkdir(backupDir)
    await backup.withObjectRetention(async (signal) => {
      await http.patch(route(skill.id)).set(bearer(ownerAuth)).send({
        expectedRevision: skill.revision, requestId: randomUUID(), iconUploadId,
      }).expect(200)
      const retained = await gc.pruneUnboundUploads(new Date())
      expect(retained.processed).toBe(0)
      const result = await backup.exportObjects(backupDir, signal)
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as { objects: { key: string; path: string }[] }
      const archived = manifest.objects.find((entry) => entry.key === before.iconObject!.storageKey)
      expect(archived).toBeDefined()
      expect(await readFile(join(backupDir, archived!.path))).toEqual(icon)
    })
    await gc.pruneUnboundUploads(new Date())
    await expect(readFile(join(scratch, before.iconObject!.storageKey))).rejects.toMatchObject({ code: "ENOENT" })
  }, 30_000)
})
