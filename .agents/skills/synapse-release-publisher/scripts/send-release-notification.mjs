#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const CONTENT = "[一键更新](https://synapse.d2.pub/desktop/update)"
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const skillDirectory = path.dirname(scriptDirectory)
const envFile = path.join(skillDirectory, ".env")
const notificationHelper = path.join(
  os.homedir(),
  ".agents/skills/wecom-notification/scripts/wecom-notification.mjs",
)

function parseArgs() {
  const args = process.argv.slice(2)
  if (args.length === 0) return { mode: "send" }
  if (args.length === 1 && args[0] === "--dry-run") return { mode: "dry-run" }
  if (args.length === 1 && args[0] === "--check") return { mode: "check" }
  throw new Error("仅支持 --check 或 --dry-run。")
}

function readConfiguredWebhook() {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
  const webhook = process.env.SYNAPSE_RELEASE_WECOM_WEBHOOK_URL?.trim()
  if (!webhook) {
    throw new Error("缺少必需配置：SYNAPSE_RELEASE_WECOM_WEBHOOK_URL。")
  }
  return webhook
}

function runNotificationHelper({ mode }) {
  if (!fs.existsSync(notificationHelper)) {
    throw new Error("未找到 wecom-notification helper。")
  }

  const webhook = mode === "dry-run" ? null : readConfiguredWebhook()
  const args = [notificationHelper, "markdown", "--content", CONTENT]
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

try {
  const exitCode = await runNotificationHelper(parseArgs())
  process.exitCode = exitCode
} catch (error) {
  console.error(error instanceof Error ? error.message : "企业微信发版通知失败。")
  process.exitCode = 1
}
