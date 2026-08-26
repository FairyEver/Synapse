#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEBHOOK_HOSTNAME = "qyapi.weixin.qq.com"
const WEBHOOK_PATHNAME = "/cgi-bin/webhook/send"
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const skillDirectory = path.dirname(scriptDirectory)
const envFile = path.join(skillDirectory, ".env")
const PRIMARY_ENV_KEY = "SYNAPSE_RELEASE_WECOM_WEBHOOK_URL"
const SECONDARY_ENV_KEY = "SYNAPSE_RELEASE_WECOM_SECONDARY_WEBHOOK_URL"

function parseTarget(args = process.argv.slice(2)) {
  if (args.length === 0) return PRIMARY_ENV_KEY
  if (args.length === 1 && args[0] === "--secondary") return SECONDARY_ENV_KEY
  throw new Error("仅支持可选参数：--secondary。")
}

function readWebhookFromStdin() {
  const value = fs.readFileSync(0, "utf8").trim()
  let webhook

  try {
    webhook = new URL(value)
  } catch {
    throw new Error("企业微信机器人 Webhook 格式无效。")
  }

  if (
    webhook.protocol !== "https:" ||
    webhook.hostname !== WEBHOOK_HOSTNAME ||
    webhook.pathname !== WEBHOOK_PATHNAME ||
    webhook.username ||
    webhook.password ||
    !webhook.searchParams.get("key")?.trim()
  ) {
    throw new Error("企业微信机器人 Webhook 格式无效。")
  }

  return webhook.toString()
}

function writeWebhook(envKey, webhook) {
  const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : ""
  const retainedLines = existing
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith(`${envKey}=`))
  const content = [...retainedLines, `${envKey}=${webhook}`, ""].join("\n")

  fs.writeFileSync(envFile, content, { encoding: "utf8", mode: 0o600 })
  fs.chmodSync(envFile, 0o600)
}

try {
  const envKey = parseTarget()
  const webhook = readWebhookFromStdin()
  writeWebhook(envKey, webhook)
  console.log("企业微信发版通知目标已配置。")
} catch (error) {
  console.error(error instanceof Error ? error.message : "企业微信发版通知目标配置失败。")
  process.exit(1)
}
