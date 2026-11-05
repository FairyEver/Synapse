import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { prepareClaudeCodePromptSubmission } from "../claude-code-prompt-submission"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function setup(prompt = "--中文\n\"review\" $()") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-prompt-test-"))
  directories.push(directory)
  const controller = new AbortController()
  const receipt = await prepareClaudeCodePromptSubmission({ directory, nodePath: process.execPath, prompt, signal: controller.signal })
  async function submit(text: string) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(directory, "prompt-submitted.cjs")], {
        env: { ...process.env, ...receipt.environment }, stdio: ["pipe", "pipe", "pipe"],
      })
      child.once("error", reject)
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Hook exited ${code}`)))
      child.stdin.end(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: text }))
    })
  }
  return { directory, controller, receipt, submit, prompt }
}

describe("Claude Code initial prompt submission receipt", () => {
  it("confirms only the matching prompt without retaining prompt contents", async () => {
    const h = await setup()
    try {
      await h.submit("different")
      expect(await readdir(h.directory)).toEqual(["prompt-submitted.cjs"])
      await h.submit(h.prompt)
      await h.receipt.wait()
      const text = await readFile(path.join(h.directory, "prompt-submitted.json"), "utf8")
      expect(JSON.parse(text)).toEqual({ token: expect.any(String), event: "UserPromptSubmit" })
      expect(text).not.toContain("review")
      expect(await readFile(path.join(h.directory, "prompt-submitted.cjs"), "utf8")).not.toContain(h.prompt)
      await h.submit("continue")
      expect(await readFile(path.join(h.directory, "prompt-submitted.json"), "utf8")).toBe(text)
    } finally { h.receipt.dispose() }
  })

  it("settles cancellation without waiting for a prompt or deleting live Hook files", async () => {
    const h = await setup()
    const waiting = h.receipt.wait()
    h.controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" })
    h.receipt.dispose()
    expect(await readdir(h.directory)).toContain("prompt-submitted.cjs")
    await h.submit("continue")
  })

  it("fails an exited CLI instead of reporting submission success", async () => {
    const h = await setup()
    const waiting = h.receipt.wait()
    h.receipt.ended()
    await expect(waiting).rejects.toThrow("Claude Code 已退出")
    h.receipt.dispose()
  })

  it("honours an already-written receipt when the CLI exits before the next polling tick", async () => {
    const h = await setup()
    try {
      await h.submit(h.prompt)
      h.receipt.ended()
      await expect(h.receipt.wait()).resolves.toBeUndefined()
    } finally { h.receipt.dispose() }
  })
})
