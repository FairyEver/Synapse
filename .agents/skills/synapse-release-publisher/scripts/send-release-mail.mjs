#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { parseEnv } from "node:util"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(scriptPath), "../../../..")
const productionEnvFile = path.join(repoRoot, "server/.env.server")
const updateUrl = "https://synapse.d2.pub/desktop/update"
const sectionTitles = ["新增功能", "功能优化", "问题修复", "技术调整"]

function normalizeVersion(value) {
  const version = String(value ?? "").trim()
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) throw new Error("版本号无效。")
  return version.startsWith("v") ? version : `v${version}`
}

function plainText(value) {
  return String(value ?? "")
    .replace(/\[([^\]]+)]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, "$1")
    .replace(/<https?:\/\/[^>\s]+>/gi, "")
    .replace(/https?:\/\/[^\s<>)\]]+/gi, "")
    .replace(/[ \t]+([,.;!?，。；！？])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim()
}

export function parseReleaseNotes(markdown) {
  const sections = new Map(sectionTitles.map((title) => [title, []]))
  let activeSection = null
  let activeEntry = null
  for (const line of String(markdown ?? "").split(/\r?\n/u)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/u)
    if (heading) {
      activeSection = sections.has(heading[1]) ? heading[1] : null
      activeEntry = null
      continue
    }
    if (!activeSection) continue
    const bullet = line.match(/^\s*-\s+(.+?)\s*$/u)
    if (bullet) {
      const text = plainText(bullet[1])
      activeEntry = text ? { section: activeSection, text } : null
      if (activeEntry) sections.get(activeSection).push(activeEntry)
    } else if (activeEntry && line.trim()) {
      const continued = plainText(line.trim())
      if (continued) activeEntry.text += ` ${continued}`
    }
  }
  return sectionTitles.flatMap((title) => sections.get(title))
}

export function buildReleaseMail(version, markdown) {
  const tag = normalizeVersion(version)
  const entries = parseReleaseNotes(markdown)
  if (!entries.length) throw new Error("待发布说明没有有效条目，发版已停止。")
  const subject = `Synapse ${tag} 更新`
  const lines = []
  let previousSection = null
  for (const entry of entries) {
    if (entry.section !== previousSection) {
      if (lines.length) lines.push("")
      lines.push(entry.section)
      previousSection = entry.section
    }
    lines.push(`- ${entry.text}`)
  }
  lines.push("", `更新地址：${updateUrl}`)
  const body = lines.join("\n")
  if (subject.length > 120 || body.length > 100_000) throw new Error("发版站内信超过长度限制，发版已停止。")
  return { requestId: `release:${tag}`, subject, body }
}

export function parseArgs(args = process.argv.slice(2)) {
  const options = { mode: "", version: "", notesFile: "" }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--check" || arg === "--send") {
      if (options.mode) throw new Error("只能选择一种运行模式。")
      options.mode = arg.slice(2)
    } else if (arg === "--version" || arg === "--notes-file") {
      const value = args[++index]
      if (!value) throw new Error(`缺少 ${arg} 的值。`)
      if (arg === "--version") options.version = value
      else options.notesFile = path.resolve(value)
    } else {
      throw new Error(`不支持的参数：${arg}`)
    }
  }
  if (!options.mode || !options.version || !options.notesFile) throw new Error("需要 --check 或 --send、--version 和 --notes-file。")
  options.version = normalizeVersion(options.version)
  return options
}

export function readProductionConfig(file = productionEnvFile) {
  const env = parseEnv(fs.readFileSync(file, "utf8"))
  if (!env.APP_PUBLIC_URL || !env.ADMIN_ACCESS_SECRET) throw new Error("生产环境缺少 APP_PUBLIC_URL 或 ADMIN_ACCESS_SECRET。")
  const baseUrl = new URL(env.APP_PUBLIC_URL)
  if (baseUrl.protocol !== "https:") throw new Error("生产应用地址必须使用 HTTPS。")
  return { baseUrl, accessSecret: env.ADMIN_ACCESS_SECRET }
}

async function request(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, redirect: "manual", cache: "no-store" })
  if (!response.ok) throw new Error(`管理员 API 返回 HTTP ${response.status}。`)
  return response
}

export async function withAdminSession(config, callback, fetchImpl = fetch) {
  const origin = config.baseUrl.origin
  const sessionUrl = new URL("/api/admin/session", config.baseUrl)
  const login = await request(fetchImpl, sessionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ accessSecret: config.accessSecret }),
  })
  const cookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).find((item) => item.startsWith("synapse_admin_session="))
  if (!cookie) throw new Error("管理员会话未返回 Cookie。")
  try {
    return await callback({
      origin,
      cookie,
      baseUrl: config.baseUrl,
      fetchImpl,
    })
  } finally {
    await request(fetchImpl, sessionUrl, { method: "DELETE", headers: { Origin: origin, Cookie: cookie } })
  }
}

export async function checkAudience(session) {
  const url = new URL("/api/admin/mail/broadcasts/audience", session.baseUrl)
  const response = await request(session.fetchImpl, url, { headers: { Cookie: session.cookie } })
  const data = await response.json()
  if (!Number.isSafeInteger(data.activeUsers) || data.activeUsers < 1) throw new Error("当前没有可投递的活跃用户。")
  return data.activeUsers
}

export async function sendMail(session, mail) {
  const url = new URL("/api/admin/mail/broadcasts", session.baseUrl)
  const response = await request(session.fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: session.origin, Cookie: session.cookie },
    body: JSON.stringify(mail),
  })
  const data = await response.json()
  if (!data.messageId || !Number.isSafeInteger(data.recipientCount)) throw new Error("发版站内信响应无效。")
  return data
}

async function main() {
  const options = parseArgs()
  const markdown = fs.readFileSync(options.notesFile, "utf8")
  const mail = buildReleaseMail(options.version, markdown)
  const config = readProductionConfig()
  const result = await withAdminSession(config, async (session) => {
    const activeUsers = await checkAudience(session)
    if (options.mode === "check") {
      process.stdout.write(`目标：${config.baseUrl.origin}\n活跃用户：${activeUsers}\n主题：${mail.subject}\n\n${mail.body}\n`)
      return null
    }
    return sendMail(session, mail)
  })
  if (result) process.stdout.write(`站内信已入库：${result.messageId}，收件人 ${result.recipientCount} 人。\n`)
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "发版站内信失败。"}\n`)
    process.exitCode = 1
  })
}
