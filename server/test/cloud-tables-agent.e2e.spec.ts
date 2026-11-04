import "reflect-metadata"
import type { INestApplication } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { createApiKeySecret, hashApiKeySecret } from "../src/api-keys/api-key-token"
import { createTestApp } from "../src/test/test-app"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"

const exec = promisify(execFile)
const scopes = ["tables.manage", "tables.records.read", "tables.records.create", "tables.records.update", "tables.records.delete"]

describe("cloud tables document-only Agent simulation", () => {
  let app: INestApplication, prisma: PrismaClient, base: string, foreignId: string, foreignTrashId: string, foreignSnapshot: unknown
  const originalDocumentUrl = process.env.DOCUMENT_PUBLIC_URL
  const alice = `ct-agent-a-${randomUUID()}`, bob = `ct-agent-b-${randomUUID()}`
  const aliceSecret = createApiKeySecret(), bobSecret = createApiKeySecret(), collaboratorSecret = createApiKeySecret()
  const audit: { path: string; cookie: boolean; authorization: boolean }[] = []
  let monitoring = false
  async function bobCall(method: string, suffix: string, body?: unknown) {
    const response = await fetch(`${base}/api/open/v1/tables${suffix}`, { method, headers: { Authorization: `Bearer ${bobSecret}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    expect(response.status).toBe(method === "POST" ? 201 : 200)
    return response.json()
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = requireLoopbackE2eDatabase(process.env.CLOUD_TABLE_E2E_DATABASE_URL, "CLOUD_TABLE_E2E_DATABASE_URL")
    prisma = new PrismaClient()
    for (const id of [alice, bob]) await prisma.user.create({ data: { id, email: `${id}@example.test`, handle: id, nickname: "Agent验收", passwordHash: "test-only-no-login" } })
    for (const [userId, secret] of [[alice, aliceSecret], [bob, bobSecret]]) await prisma.userApiKey.create({ data: { userId, name: "用户预先提供的管理密钥", keyHash: hashApiKeySecret(secret), keyPrefix: secret.slice(0, 15), scopes, tableAccessMode: "all_owned" } })
    app = await createTestApp(); await app.listen(0, "127.0.0.1"); base = await app.getUrl()
    process.env.DOCUMENT_PUBLIC_URL = `${base}/document`
    // 预先模拟另一位用户已有的共享表；其表和授权不属于被测Agent的建表流程。
    const foreign = await bobCall("POST", "", { name: "Bob的表", fields: [{ key: "name", name: "姓名", type: "text" }] })
    foreignId = foreign.id
    await bobCall("POST", `/${foreignId}/records`, { values: { name: "Bob的原始数据" } })
    const trash = await bobCall("POST", `/${foreignId}/records`, { values: { name: "Bob的回收数据" } })
    foreignTrashId = trash.id
    await bobCall("DELETE", `/${foreignId}/records/${foreignTrashId}`, { version: trash.version })
    await bobCall("PATCH", `/${foreignId}/permissions`, { version: foreign.schemaVersion, anonymous: {}, members: [{ userId: alice, permissions: { read: "all", create: "all", update: "own", delete: "own" } }] })
    await prisma.userApiKey.create({ data: { userId: alice, name: "用户预先提供的协作表密钥", keyHash: hashApiKeySecret(collaboratorSecret), keyPrefix: collaboratorSecret.slice(0, 15), scopes, tableAccessMode: "selected", tableIds: [foreignId] } })
    foreignSnapshot = { table: await bobCall("GET", `/${foreignId}`), records: await bobCall("POST", `/${foreignId}/records/query`, {}), trash: await bobCall("GET", `/${foreignId}/records/trash`) }
    app.getHttpServer().on("request", (req: { url: string; headers: Record<string, string | undefined> }) => { if (monitoring) audit.push({ path: req.url, cookie: Boolean(req.headers.cookie), authorization: Boolean(req.headers.authorization) }) })
  }, 30000)
  afterAll(async () => {
    if (originalDocumentUrl === undefined) delete process.env.DOCUMENT_PUBLIC_URL
    else process.env.DOCUMENT_PUBLIC_URL = originalDocumentUrl
    await app?.close()
    if (prisma) {
      await prisma.cloudTable.deleteMany({ where: { ownerId: { in: [alice, bob] } } })
      await prisma.cloudTableOperationLog.deleteMany({ where: { ownerId: { in: [alice, bob] } } })
      await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } }); await prisma.$disconnect()
    }
  })
  it("completes every documented operation using only supplied own keys and cannot manage another owner's table", async () => {
    monitoring = true
    const evidencePath = path.resolve("../.superpowers/cloud-tables/agent-blackbox/result.json")
    await mkdir(path.dirname(evidencePath), { recursive: true })
    let result
    try {
      // 子进程不继承数据库、账号登录凭据或应用服务实例，只有用户交付的API输入。
      result = await exec(process.execPath, [path.resolve("test/fixtures/cloud-tables-agent-client.mjs")], { env: { SY_API_BASE_URL: base, SY_API_DOCUMENT_PATH: path.resolve("../document/open-api/api/cloud-tables.md"), SY_API_KEY: aliceSecret, SY_COLLAB_API_KEY: collaboratorSecret, SY_OTHER_HANDLE: bob, SY_FOREIGN_TABLE_ID: foreignId, SY_FOREIGN_TRASH_ID: foreignTrashId }, timeout: 60000, maxBuffer: 1024 * 1024 })
    } catch (error) {
      await writeFile(evidencePath, error instanceof Error && "stderr" in error ? String(error.stderr) : String(error))
      throw new Error(`Document-only Agent failed; sanitized evidence: ${evidencePath}`)
    } finally { monitoring = false }
    const report = JSON.parse(result.stdout)
    expect(report.passed).toBe(true)
    expect(report.successfulOperations).toHaveLength(23)
    expect(report.managementRejections).toBe(9)
    const tableRequests = audit.filter(r => r.path !== "/api/open/openapi.json")
    expect(audit.length - tableRequests.length).toBe(1)
    expect(tableRequests.length).toBe(report.trace.length)
    expect(tableRequests.every(r => r.path.startsWith("/api/open/v1/tables"))).toBe(true)
    expect(audit.some(r => r.cookie)).toBe(false)
    expect(tableRequests.filter(r => !r.authorization)).toHaveLength(4)
    // Agent结束后再由表主独立观察，只读确认越权尝试没有改变表、ACL或业务数据。
    expect({ table: await bobCall("GET", `/${foreignId}`), records: await bobCall("POST", `/${foreignId}/records/query`, {}), trash: await bobCall("GET", `/${foreignId}/records/trash`) }).toEqual(foreignSnapshot)
    await writeFile(evidencePath, JSON.stringify({ ...report, consoleRequests: 0, cookieRequests: 0, foreignOwnerReadbackUnchanged: true }, null, 2))
    process.stdout.write(`Document-only Agent evidence: ${JSON.stringify({ successfulOperations: report.successfulOperations.length, apiRequests: report.trace.length, managementRejections: report.managementRejections, consoleRequests: 0, cookieRequests: 0, foreignOwnerReadbackUnchanged: true, evidencePath })}\n`)
  }, 60000)
})
