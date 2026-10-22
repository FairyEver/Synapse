import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createWecomCliClient } from "../wecom-cli-client"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), "synapse-wecom-cli-"))
  roots.push(value)
  return value
}

function result(stdout: string, exitCode = 0) {
  return {
    exitCode,
    signal: null,
    stdout,
    stderr: "",
    timedOut: false,
    durationMs: 1,
  }
}

describe("WeCom CLI client", () => {
  it("normalizes search results and sends reply metadata without exposing raw IDs to the UI", async () => {
    const workRoot = await root()
    const run = vi.fn(async (request: { args: readonly string[] }) => {
      if (request.args[0] === "mail" && request.args[1] === "search") {
        return result(JSON.stringify({
          has_more: false,
          next_cursor: "",
          mails: [{
            mail_id: "mail-1",
            subject: "周报",
            send_time: "2026-10-22 09:00:00",
            sender: { name: "甲", email: "a@example.com" },
            receivers: [{ name: "乙", email: "b@example.com" }],
            is_read: false,
            folder_name: "收件箱",
          }],
        }))
      }
      return result("{}")
    })
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run, start: vi.fn() } as never,
    })

    await expect(client.search("owner-a", { query: "周报", limit: 20 })).resolves.toEqual({
      items: [{
        mailId: "mail-1",
        subject: "周报",
        sendTime: "2026-10-22 09:00:00",
        sender: { name: "甲", email: "a@example.com" },
        receivers: [{ name: "乙", email: "b@example.com" }],
        isRead: false,
        folderName: "收件箱",
      }],
      nextCursor: null,
      hasMore: false,
    })
    const request = run.mock.calls[0]![0] as { args: readonly string[]; cwd: string; env: Record<string, string> }
    expect(request.args[0]).toBe("mail")
    expect(request.args[1]).toBe("search")
    expect(JSON.parse(request.args.at(-1)!)).toMatchObject({ folder_names: ["收件箱"], keywords: ["周报"], limit: 20 })
    expect(request.cwd).toContain(path.join("owners"))
    expect(request.env.WECOM_CLI_CONFIG_DIR).toBe(path.join(request.cwd, "config"))
  })

  it("writes a Markdown body file, supports replies, and removes the temporary body after send", async () => {
    const workRoot = await root()
    let capturedBodyPath = ""
    const run = vi.fn(async (request: { args: readonly string[] }) => {
      const body = JSON.parse(request.args.at(-1)!) as { file_path: string }
      capturedBodyPath = body.file_path
      expect(await readFile(body.file_path, "utf8")).toBe("回复正文")
      return result("{}")
    })
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run, start: vi.fn() } as never,
    })

    await expect(client.send("owner-a", {
      to: ["a@example.com"],
      subject: "回复：周报",
      body: "回复正文",
      replyToMailId: "mail-1",
      replyAll: false,
    })).resolves.toEqual({ ok: true })
    const body = JSON.parse((run.mock.calls[0]![0] as { args: readonly string[] }).args.at(-1)!) as Record<string, unknown>
    expect(body).toMatchObject({
      to: { emails: ["a@example.com"] },
      content_type: "markdown",
      reply: { last_mail_id: "mail-1", reply_all: false },
    })
    await expect(readFile(capturedBodyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("returns a data URL after the QR file appears", async () => {
    const workRoot = await root()
    const png = Buffer.from("89504e470d0a1a0a", "hex")
    const start = vi.fn(async (request: { args: readonly string[] }) => {
      const qrIndex = request.args.indexOf("--output-qrcode")
      await writeFile(request.args[qrIndex + 1]!, png)
      return {
        wait: vi.fn(async () => result("")),
        close: vi.fn(async () => result("")),
        writeStdin: vi.fn(),
        endStdin: vi.fn(),
        alive: vi.fn(() => true),
      }
    })
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run: vi.fn(), start } as never,
    })

    await expect(client.startAuth("owner-a")).resolves.toMatchObject({
      qrCodeDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    })
  })

  it("surfaces the official mail read permission error and help URL", async () => {
    const workRoot = await root()
    const helpUrl = "https://work.weixin.qq.com/ai/aiHelper/authorizationList?type=7"
    const permissionError = JSON.stringify({
      errcode: 851008,
      errmsg: "partial no authorization",
      help_message: `当前机器人未被授权「搜索与获取邮件内容」能力，需向管理员申请使用。\\n[点击这里](${helpUrl})`,
    })
    const run = vi.fn(async (request: { readonly args: readonly string[] }) => {
      if (request.args[0] === "auth") return result("authorized")
      if (request.args[0] === "identity") return result("{}")
      return result(permissionError, 1)
    })
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run, start: vi.fn() } as never,
    })

    await expect(client.validate("owner-a")).resolves.toEqual({
      warningMessage: "当前机器人未被授权「搜索与获取邮件内容」能力，需向管理员申请使用。",
      helpUrl,
    })
    await expect(client.search("owner-a", {})).rejects.toMatchObject({
      code: "permission_denied",
      message: "当前机器人未被授权「搜索与获取邮件内容」能力，需向管理员申请使用。",
      helpUrl,
    })
  })
})
