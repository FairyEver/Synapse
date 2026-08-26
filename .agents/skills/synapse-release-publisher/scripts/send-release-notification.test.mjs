import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  buildNotificationMessages,
  configuredWebhooksFromEnv,
  deliverNotificationMessages,
  parseArgs,
  parseReleaseNotes,
} from "./send-release-notification.mjs"

const scriptPath = fileURLToPath(new URL("./send-release-notification.mjs", import.meta.url))
const updateLink = "[一键更新](https://synapse.d2.pub/desktop/update)"

test("renders version, non-empty sections, sanitized notes, and one update link", () => {
  const markdown = `# Pending Release Notes

## 新增功能

- 新增[同步能力](https://github.com/FairyEver/Synapse/issues/1)

## 功能优化

## 问题修复

- 修复启动问题 https://github.com/FairyEver/Synapse/pull/2
- 更新[使用文档](https://example.com/docs)

## 技术调整
`

  const entries = parseReleaseNotes(markdown)
  assert.deepEqual(entries.map(entry => [entry.section, entry.text]), [
    ["新增功能", "新增同步能力"],
    ["问题修复", "修复启动问题"],
    ["问题修复", "更新使用文档"],
  ])

  const messages = buildNotificationMessages({ version: "0.2.400", markdown })
  assert.equal(messages.length, 1)
  assert.match(messages[0], /^## Synapse v0\.2\.400 更新内容（1\/1）/)
  assert.match(messages[0], /### 新增功能/)
  assert.doesNotMatch(messages[0], /### 功能优化/)
  assert.match(messages[0], /### 问题修复/)
  assert.equal(messages[0].split(updateLink).length - 1, 1)
  assert.doesNotMatch(messages[0], /github\.com|example\.com|https?:\/\/(?!synapse\.d2\.pub)/i)
})

test("splits oversized multilingual entries without exceeding the byte limit", () => {
  const content = "中文更新 content ".repeat(700)
  const markdown = `## 新增功能\n\n- ${content}`
  const messages = buildNotificationMessages({ version: "v0.2.401", markdown })

  assert.ok(messages.length > 1)
  for (let index = 0; index < messages.length; index += 1) {
    assert.ok(Buffer.byteLength(messages[index], "utf8") <= 4096)
    assert.match(messages[index], new RegExp(`更新内容（${index + 1}\\/${messages.length}）`))
  }

  const restored = messages
    .flatMap(message => message.split("\n"))
    .filter(line => line.startsWith("- "))
    .map(line => line.slice(2).replace(/^（续）/, ""))
    .join("")
  assert.equal(restored, content.trim())
  assert.equal(messages.join("\n").split(updateLink).length - 1, 1)
  assert.doesNotMatch(messages.slice(0, -1).join("\n"), /一键更新/)
})

test("renders an explicit empty-notes state", () => {
  const messages = buildNotificationMessages({
    version: "v0.2.402",
    markdown: "# Pending Release Notes\n\n## 新增功能\n\n## 功能优化\n",
  })

  assert.deepEqual(messages, [
    `## Synapse v0.2.402 更新内容（1/1）\n\n本次未记录更新内容。\n\n${updateLink}`,
  ])
})

test("requires version and notes file arguments", () => {
  assert.throws(() => parseArgs([]), /--version/)
  assert.throws(() => parseArgs(["--version", "v0.2.403"]), /--notes-file/)
  assert.throws(
    () => parseArgs(["--check", "--dry-run", "--version", "v0.2.403", "--notes-file", "notes.md"]),
    /不能同时使用/,
  )
})

test("requires two distinct configured robots", () => {
  assert.deepEqual(configuredWebhooksFromEnv({
    SYNAPSE_RELEASE_WECOM_WEBHOOK_URL: " primary ",
    SYNAPSE_RELEASE_WECOM_SECONDARY_WEBHOOK_URL: " secondary ",
  }), ["primary", "secondary"])
  assert.throws(
    () => configuredWebhooksFromEnv({
      SYNAPSE_RELEASE_WECOM_WEBHOOK_URL: "primary",
    }),
    /SYNAPSE_RELEASE_WECOM_SECONDARY_WEBHOOK_URL/,
  )
  assert.throws(
    () => configuredWebhooksFromEnv({
      SYNAPSE_RELEASE_WECOM_WEBHOOK_URL: "same",
      SYNAPSE_RELEASE_WECOM_SECONDARY_WEBHOOK_URL: "same",
    }),
    /必须不同/,
  )
})

test("missing notes file fails before notification delivery", async () => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "release-notes-missing-"))
  const missingFile = path.join(testRoot, "missing.md")

  try {
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--dry-run",
      "--version",
      "v0.2.404",
      "--notes-file",
      missingFile,
    ], { encoding: "utf8" })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /发版说明文件不存在/)
    assert.equal(result.stdout, "")
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
})

test("dry-run and check modes are passed to the notification runner", async () => {
  const calls = []
  const runner = async (content, options) => {
    calls.push({ content, ...options })
    return 0
  }

  await deliverNotificationMessages(["第一条"], {
    mode: "dry-run",
    webhooks: [null],
    runner,
  })
  await deliverNotificationMessages(["第二条"], {
    mode: "check",
    webhooks: ["test-webhook-1", "test-webhook-2"],
    runner,
  })

  assert.deepEqual(calls, [
    { content: "第一条", mode: "dry-run", webhook: null },
    { content: "第二条", mode: "check", webhook: "test-webhook-1" },
    { content: "第二条", mode: "check", webhook: "test-webhook-2" },
  ])
})

test("delivers every chunk to both robots in destination order", async () => {
  const delivered = []
  const runner = async (content, { webhook }) => {
    delivered.push([webhook, content])
    return 0
  }

  await deliverNotificationMessages(["第一条", "第二条"], {
    mode: "send",
    webhooks: ["test-webhook-1", "test-webhook-2"],
    runner,
  })

  assert.deepEqual(delivered, [
    ["test-webhook-1", "第一条"],
    ["test-webhook-1", "第二条"],
    ["test-webhook-2", "第一条"],
    ["test-webhook-2", "第二条"],
  ])
})

test("stops after the first failed robot and notification chunk", async () => {
  const delivered = []
  const runner = async (content, { webhook }) => {
    delivered.push([webhook, content])
    return webhook === "test-webhook-2" && content === "第二条" ? 3 : 0
  }

  await assert.rejects(
    deliverNotificationMessages(["第一条", "第二条", "第三条"], {
      mode: "send",
      webhooks: ["test-webhook-1", "test-webhook-2"],
      runner,
    }),
    /第 2\/2 个机器人的第 2\/3 条未成功/,
  )
  assert.deepEqual(delivered, [
    ["test-webhook-1", "第一条"],
    ["test-webhook-1", "第二条"],
    ["test-webhook-1", "第三条"],
    ["test-webhook-2", "第一条"],
    ["test-webhook-2", "第二条"],
  ])
})

test("stops before the next robot when a chunk fails", async () => {
  const delivered = []
  const runner = async (content, { webhook }) => {
    delivered.push([webhook, content])
    return content === "第二条" ? 3 : 0
  }

  await assert.rejects(
    deliverNotificationMessages(["第一条", "第二条", "第三条"], {
      mode: "send",
      webhooks: ["test-webhook-1", "test-webhook-2"],
      runner,
    }),
    /第 1\/2 个机器人的第 2\/3 条未成功/,
  )
  assert.deepEqual(delivered, [
    ["test-webhook-1", "第一条"],
    ["test-webhook-1", "第二条"],
  ])
})

test("dry-run CLI does not require webhook configuration", async () => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "release-notification-dry-run-"))
  const notesFile = path.join(testRoot, "notes.md")
  const helperDirectory = path.join(
    testRoot,
    ".agents/skills/wecom-notification/scripts",
  )
  const helperPath = path.join(helperDirectory, "wecom-notification.mjs")
  await mkdir(helperDirectory, { recursive: true })
  await writeFile(notesFile, "## 功能优化\n\n- 展示更新内容\n", "utf8")
  await writeFile(helperPath, `
const args = process.argv.slice(2)
const contentIndex = args.indexOf("--content")
if (!args.includes("--dry-run") || contentIndex < 0) process.exit(2)
console.log(JSON.stringify({ dryRun: true, content: args[contentIndex + 1] }))
`, "utf8")

  try {
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--dry-run",
      "--version",
      "v0.2.405",
      "--notes-file",
      notesFile,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: testRoot,
        SYNAPSE_RELEASE_WECOM_WEBHOOK_URL: "",
        SYNAPSE_RELEASE_WECOM_SECONDARY_WEBHOOK_URL: "",
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /"dryRun":true/)
    assert.match(result.stdout, /Synapse v0\.2\.405 更新内容/)
    assert.doesNotMatch(result.stdout + result.stderr, /qyapi\.weixin\.qq\.com|key=/i)
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
})
