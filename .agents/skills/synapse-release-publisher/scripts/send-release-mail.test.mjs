import assert from "node:assert/strict"
import test from "node:test"
import {
  buildReleaseMail,
  checkAudience,
  parseArgs,
  parseReleaseNotes,
  sendMail,
  withAdminSession,
} from "./send-release-mail.mjs"

const notes = `# Pending Release Notes

## 新增功能

- 新增[同步能力](https://example.com/source)

## 功能优化

## 问题修复

- 修复启动问题 https://example.com/issue
`

test("builds one plain-text mail with a stable version request id", () => {
  assert.deepEqual(parseReleaseNotes(notes).map((entry) => entry.section), ["新增功能", "问题修复"])
  const mail = buildReleaseMail("v1.2.3", notes)
  assert.equal(mail.requestId, "release:v1.2.3")
  assert.equal(mail.subject, "Synapse v1.2.3 更新内容")
  assert.match(mail.body, /^新增功能\n- 新增同步能力\n\n问题修复\n- 修复启动问题/u)
  assert.match(mail.body, /更新地址：https:\/\/synapse\.d2\.pub\/desktop\/update$/u)
  assert.doesNotMatch(mail.body, /example\.com/u)
  assert.deepEqual(buildReleaseMail("v1.2.3", notes), mail)
})

test("blocks empty or oversized release notes before any network access", () => {
  assert.throws(() => buildReleaseMail("v1.2.3", "## 新增功能\n"), /没有有效条目/u)
  assert.throws(() => buildReleaseMail("v1.2.3", `## 新增功能\n\n- ${"中".repeat(100_001)}`), /超过长度限制/u)
  assert.throws(() => parseArgs(["--send", "--check", "--version", "v1.2.3", "--notes-file", "notes.md"]), /只能选择一种/u)
})

test("uses an ephemeral admin cookie for audience and send, then logs out", async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init })
    if (requests.length === 1) return new Response("{}", { status: 201, headers: { "set-cookie": "synapse_admin_session=temporary-token; HttpOnly; Path=/api/admin" } })
    if (requests.length === 2) return Response.json({ activeUsers: 2 })
    if (requests.length === 3) return Response.json({ messageId: "mail-1", recipientCount: 2 }, { status: 201 })
    return Response.json({ ok: true })
  }
  const config = { baseUrl: new URL("https://synapse.example"), accessSecret: "private-admin-secret" }
  const mail = buildReleaseMail("v1.2.3", notes)
  const result = await withAdminSession(config, async (session) => {
    assert.equal(await checkAudience(session), 2)
    return sendMail(session, mail)
  }, fetchImpl)
  assert.deepEqual(result, { messageId: "mail-1", recipientCount: 2 })
  assert.deepEqual(requests.map((item) => [new URL(item.url).pathname, item.init.method ?? "GET"]), [
    ["/api/admin/session", "POST"],
    ["/api/admin/mail/broadcasts/audience", "GET"],
    ["/api/admin/mail/broadcasts", "POST"],
    ["/api/admin/session", "DELETE"],
  ])
  assert.equal(JSON.parse(requests[0].init.body).accessSecret, "private-admin-secret")
  assert.equal(requests[2].init.headers.Cookie, "synapse_admin_session=temporary-token")
  assert.equal(requests[2].init.headers.Origin, "https://synapse.example")
  assert.ok(requests.every((item) => !item.url.includes("private-admin-secret") && !item.url.includes("temporary-token")))
})

test("stops preflight when the production broadcast endpoint is unavailable and revokes the session", async () => {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ path: new URL(url).pathname, method: init.method ?? "GET" })
    if (requests.length === 1) return new Response("{}", { status: 201, headers: { "set-cookie": "synapse_admin_session=temporary-token; HttpOnly; Path=/api/admin" } })
    if (requests.length === 2) return new Response("not found", { status: 404 })
    return Response.json({ ok: true })
  }
  const config = { baseUrl: new URL("https://synapse.example"), accessSecret: "private-admin-secret" }
  await assert.rejects(withAdminSession(config, checkAudience, fetchImpl), /HTTP 404/u)
  assert.deepEqual(requests, [
    { path: "/api/admin/session", method: "POST" },
    { path: "/api/admin/mail/broadcasts/audience", method: "GET" },
    { path: "/api/admin/session", method: "DELETE" },
  ])
})
