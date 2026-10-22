import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createWecomCliClient } from "../cli-client"

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
  it("runs the CLI in the owner-scoped working and config directories", async () => {
    const workRoot = await root()
    const run = vi.fn(async () => result('{"ok":true}'))
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run, start: vi.fn() } as never,
    })

    await expect(client.run("owner-a", ["mail", "search", "--json", "{}"], {
      metadata: { operation: "mail.list" },
    })).resolves.toBe('{"ok":true}')
    const request = run.mock.calls[0]![0] as { args: readonly string[]; cwd: string; env: Record<string, string> }
    expect(request.args).toEqual(["mail", "search", "--json", "{}"])
    expect(request.cwd).toContain(path.join("owners"))
    expect(request.env.WECOM_CLI_CONFIG_DIR).toBe(path.join(request.cwd, "config"))
  })

  it("writes and removes an owner-scoped temporary text file", async () => {
    const workRoot = await root()
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run: vi.fn(), start: vi.fn() } as never,
    })
    let capturedPath = ""

    await client.withTemporaryText("owner-a", "mail-body", "回复正文", async (filePath) => {
      capturedPath = filePath
      await expect(readFile(filePath, "utf8")).resolves.toBe("回复正文")
      await expect(client.readGeneratedText("owner-a", filePath)).resolves.toBe("回复正文")
    })

    await expect(readFile(capturedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
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

  it("validates only bot authorization and identity, not mail permissions", async () => {
    const workRoot = await root()
    const run = vi.fn(async (request: { readonly args: readonly string[] }) => {
      if (request.args[0] === "auth") return result("authorized")
      return result("{}")
    })
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run, start: vi.fn() } as never,
    })

    await expect(client.validate("owner-a")).resolves.toBeUndefined()
    expect(run.mock.calls.map(([request]) => request.args.slice(0, 2))).toEqual([
      ["auth", "show"],
      ["identity", "whoami"],
    ])
  })

  it("surfaces the official mail read permission error without raw hint text", async () => {
    const workRoot = await root()
    const helpUrl = "https://work.weixin.qq.com/ai/aiHelper/authorizationList?type=7"
    const permissionError = JSON.stringify({
      errcode: 851008,
      errmsg: "partial no authorization, hint: [secret], from ip: 127.0.0.1",
      help_message: `当前机器人未被授权「搜索与获取邮件内容」能力，需向管理员申请使用。\\n[点击这里](${helpUrl})`,
    })
    const client = createWecomCliClient({
      binaryPath: "/fake/wecom-cli",
      rootDir: workRoot,
      processRunner: { run: vi.fn(async () => result(permissionError, 1)), start: vi.fn() } as never,
    })

    await expect(client.run("owner-a", ["mail", "search", "--json", "{}"])).rejects.toMatchObject({
      code: "permission_denied",
      message: "当前机器人未被授权「搜索与获取邮件内容」能力，需向管理员申请使用。",
      options: {
        errcode: 851008,
        helpUrl,
        permission: "搜索与获取邮件内容",
      },
    })
  })
})
