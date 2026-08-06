#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const MAX_CONTENT_BYTES = 4096
const UPDATE_URL = "https://synapse.d2.pub/desktop/update"
const UPDATE_LINK = `[一键更新](${UPDATE_URL})`
const SECTION_TITLES = ["新增功能", "功能优化", "问题修复", "技术调整"]
const scriptPath = fileURLToPath(import.meta.url)
const scriptDirectory = path.dirname(scriptPath)
const skillDirectory = path.dirname(scriptDirectory)
const envFile = path.join(skillDirectory, ".env")
const notificationHelper = path.join(
  os.homedir(),
  ".agents/skills/wecom-notification/scripts/wecom-notification.mjs",
)

function contentBytes(content) {
  return Buffer.byteLength(content, "utf8")
}

function normalizeVersion(version) {
  const value = String(version ?? "").trim()
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error("版本号格式无效，应为 vX.Y.Z 或 X.Y.Z。")
  }
  return value.startsWith("v") ? value : `v${value}`
}

export function sanitizeReleaseNoteText(value) {
  return String(value ?? "")
    .replace(
      /\[([^\]]+)]\(\s*https?:\/\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi,
      "$1",
    )
    .replace(/<https?:\/\/[^>\s]+>/gi, "")
    .replace(/https?:\/\/[^\s<>)\]]+/gi, "")
    .replace(/[ \t]+([,.;!?，。；！？])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function parseReleaseNotes(markdown) {
  const sections = new Map(SECTION_TITLES.map(title => [title, []]))
  let activeSection = null
  let activeEntry = null

  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (heading) {
      activeSection = SECTION_TITLES.includes(heading[1]) ? heading[1] : null
      activeEntry = null
      continue
    }

    if (!activeSection) continue

    const bullet = line.match(/^\s*-\s+(.+?)\s*$/)
    if (bullet) {
      const text = sanitizeReleaseNoteText(bullet[1])
      if (!text) {
        activeEntry = null
        continue
      }
      activeEntry = { section: activeSection, text, continued: false }
      sections.get(activeSection).push(activeEntry)
      continue
    }

    if (activeEntry && line.trim()) {
      const continuation = sanitizeReleaseNoteText(line.trim())
      if (continuation) activeEntry.text = `${activeEntry.text} ${continuation}`
    }
  }

  return SECTION_TITLES.flatMap(title => sections.get(title))
}

function renderEntries(entries) {
  const lines = []
  let previousSection = null

  for (const entry of entries) {
    if (entry.section !== previousSection) {
      if (lines.length > 0) lines.push("")
      lines.push(`### ${entry.section}`, "")
      previousSection = entry.section
    }
    const continuation = entry.continued ? "（续）" : ""
    lines.push(`- ${continuation}${entry.text}`)
  }

  return lines.join("\n")
}

function renderMessage({ version, entries, index, total, includeUpdateLink }) {
  const parts = [`## Synapse ${version} 更新内容（${index}/${total}）`]
  if (entries.length > 0) parts.push(renderEntries(entries))
  else parts.push("本次未记录更新内容。")
  if (includeUpdateLink) parts.push(UPDATE_LINK)
  return parts.join("\n\n")
}

function fitsReservedMessage(version, entries, totalHint) {
  return contentBytes(renderMessage({
    version,
    entries,
    index: totalHint,
    total: totalHint,
    includeUpdateLink: true,
  })) <= MAX_CONTENT_BYTES
}

function splitOversizedEntry(entry, version, totalHint) {
  const characters = [...entry.text]
  let low = 1
  let high = characters.length
  let fittedLength = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = { ...entry, text: characters.slice(0, middle).join("") }
    if (fitsReservedMessage(version, [candidate], totalHint)) {
      fittedLength = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  if (fittedLength === 0) {
    throw new Error("版本标题或更新内容过长，无法生成企业微信通知。")
  }

  const first = { ...entry, text: characters.slice(0, fittedLength).join("") }
  const remainderText = characters.slice(fittedLength).join("")
  const remainder = remainderText
    ? { ...entry, text: remainderText, continued: true }
    : null
  return [first, remainder]
}

function packEntries(entries, version, totalHint) {
  const queue = entries.map(entry => ({ ...entry }))
  const chunks = []
  let current = []

  while (queue.length > 0) {
    const entry = queue[0]
    if (fitsReservedMessage(version, [...current, entry], totalHint)) {
      current.push(entry)
      queue.shift()
      continue
    }

    if (current.length > 0) {
      chunks.push(current)
      current = []
      continue
    }

    const [first, remainder] = splitOversizedEntry(entry, version, totalHint)
    chunks.push([first])
    queue.shift()
    if (remainder) queue.unshift(remainder)
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}

export function buildNotificationMessages({ version, markdown }) {
  const normalizedVersion = normalizeVersion(version)
  const entries = parseReleaseNotes(markdown)

  if (entries.length === 0) {
    const message = renderMessage({
      version: normalizedVersion,
      entries: [],
      index: 1,
      total: 1,
      includeUpdateLink: true,
    })
    if (contentBytes(message) > MAX_CONTENT_BYTES) {
      throw new Error("版本标题过长，无法生成企业微信通知。")
    }
    return [message]
  }

  let totalHint = 1
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const chunks = packEntries(entries, normalizedVersion, totalHint)
    if (chunks.length !== totalHint) {
      totalHint = chunks.length
      continue
    }

    return chunks.map((chunk, index) => {
      const message = renderMessage({
        version: normalizedVersion,
        entries: chunk,
        index: index + 1,
        total: chunks.length,
        includeUpdateLink: index === chunks.length - 1,
      })
      if (contentBytes(message) > MAX_CONTENT_BYTES) {
        throw new Error(`第 ${index + 1}/${chunks.length} 条企业微信通知超过 4096 字节。`)
      }
      return message
    })
  }

  throw new Error("企业微信通知分片未能稳定生成。")
}

export function parseArgs(args = process.argv.slice(2)) {
  const options = { mode: "send", version: "", notesFile: "" }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--check") {
      if (options.mode !== "send") throw new Error("--check 与 --dry-run 不能同时使用。")
      options.mode = "check"
    } else if (arg === "--dry-run") {
      if (options.mode !== "send") throw new Error("--check 与 --dry-run 不能同时使用。")
      options.mode = "dry-run"
    } else if (arg === "--version") {
      options.version = args[index + 1] ?? ""
      index += 1
    } else if (arg === "--notes-file") {
      options.notesFile = args[index + 1] ?? ""
      index += 1
    } else {
      throw new Error(`不支持的参数：${arg}`)
    }
  }

  if (!options.version) throw new Error("缺少必需参数：--version。")
  if (!options.notesFile) throw new Error("缺少必需参数：--notes-file。")
  options.version = normalizeVersion(options.version)
  options.notesFile = path.resolve(options.notesFile)
  return options
}

function readReleaseNotes(notesFile) {
  if (!fs.existsSync(notesFile) || !fs.statSync(notesFile).isFile()) {
    throw new Error(`发版说明文件不存在：${notesFile}`)
  }
  return fs.readFileSync(notesFile, "utf8")
}

function readConfiguredWebhook() {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
  const webhook = process.env.SYNAPSE_RELEASE_WECOM_WEBHOOK_URL?.trim()
  if (!webhook) {
    throw new Error("缺少必需配置：SYNAPSE_RELEASE_WECOM_WEBHOOK_URL。")
  }
  return webhook
}

function runNotificationHelper(content, { mode, webhook }) {
  if (!fs.existsSync(notificationHelper)) {
    throw new Error("未找到 wecom-notification helper。")
  }

  const args = [notificationHelper, "markdown", "--content", content]
  if (mode !== "dry-run") args.push("--webhook-stdin")
  if (mode !== "send") args.push("--dry-run")

  const child = spawn(process.execPath, args, {
    stdio: ["pipe", "inherit", "inherit"],
  })

  child.stdin.end(webhook ?? undefined)

  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`企业微信通知进程被信号 ${signal} 终止。`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

export async function deliverNotificationMessages(
  messages,
  { mode, webhook, runner = runNotificationHelper },
) {
  for (let index = 0; index < messages.length; index += 1) {
    const exitCode = await runner(messages[index], { mode, webhook })
    if (exitCode !== 0) {
      throw new Error(
        `企业微信发版通知发送失败：第 ${index + 1}/${messages.length} 条未成功，已停止后续发送。`,
      )
    }
  }
}

async function main() {
  const options = parseArgs()
  const markdown = readReleaseNotes(options.notesFile)
  const messages = buildNotificationMessages({
    version: options.version,
    markdown,
  })
  const webhook = options.mode === "dry-run" ? null : readConfiguredWebhook()
  await deliverNotificationMessages(messages, { mode: options.mode, webhook })
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptPath)) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : "企业微信发版通知失败。")
    process.exitCode = 1
  }
}
