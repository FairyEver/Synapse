import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"
import { recoverOwnedRebase } from "../git-rebase-guard"

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-rebase-guard-"))
  roots.push(root)
  await execFileAsync("git", ["init", "-q", root])
  return root
}

async function writeRebaseState(root: string, origHead: string, onto: string): Promise<void> {
  const statePath = path.join(root, ".git", "rebase-merge")
  await mkdir(statePath)
  await writeFile(path.join(statePath, "orig-head"), `${origHead}\n`, "utf8")
  await writeFile(path.join(statePath, "onto"), `${onto}\n`, "utf8")
}

function createStateRun(root: string, abortError?: Error) {
  return vi.fn(async (args: readonly string[]) => {
    if (args[0] === "rebase") {
      if (abortError) throw abortError
      return { stdout: "" }
    }
    const result = await execFileAsync("git", ["-C", root, ...args])
    return { stdout: result.stdout }
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("Git rebase ownership guard", () => {
  it("does not abort a rebase whose metadata belongs to another operation", async () => {
    const root = await createRepository()
    await writeRebaseState(root, "external-head", "external-onto")
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "rebase") throw new Error("must not abort external rebase")
      const result = await execFileAsync("git", ["-C", root, ...args])
      return { stdout: result.stdout }
    })

    await expect(recoverOwnedRebase({
      error: new Error("CONFLICT (content): merge conflict"),
      expectedOnto: "synapse-onto",
      expectedOrigHead: "synapse-head",
      localPath: root,
      run,
    })).resolves.toBe("not-owned")
    expect(run).not.toHaveBeenCalledWith(["rebase", "--abort"])
  })

  it("aborts a recoverable rebase only when orig-head and onto match", async () => {
    const root = await createRepository()
    await writeRebaseState(root, "synapse-head", "synapse-onto")
    const run = createStateRun(root)

    await expect(recoverOwnedRebase({
      error: new Error("CONFLICT (content): merge conflict"),
      expectedOnto: "synapse-onto",
      expectedOrigHead: "synapse-head",
      localPath: root,
      run,
    })).resolves.toBe("aborted")
    expect(run).toHaveBeenCalledWith(["rebase", "--abort"])
  })

  it.each([
    ["timeout", Object.assign(new Error("同步仓库失败"), { timedOut: true })],
    ["cancellation", Object.assign(new Error("同步仓库失败"), { signal: "SIGTERM" })],
  ])("aborts an owned rebase after a structured %s failure", async (_label, error) => {
    const root = await createRepository()
    await writeRebaseState(root, "synapse-head", "synapse-onto")
    const run = createStateRun(root)

    await expect(recoverOwnedRebase({
      error,
      expectedOnto: "synapse-onto",
      expectedOrigHead: "synapse-head",
      localPath: root,
      run,
    })).resolves.toBe("aborted")
    expect(run).toHaveBeenCalledWith(["rebase", "--abort"])
  })

  it("does not abort an external rebase that appeared after the ownership check", async () => {
    const root = await createRepository()
    await writeRebaseState(root, "synapse-head", "synapse-onto")
    const run = createStateRun(root)

    await expect(recoverOwnedRebase({
      error: new Error("It seems that there is already a rebase-merge directory"),
      expectedOnto: "synapse-onto",
      expectedOrigHead: "synapse-head",
      localPath: root,
      run,
    })).resolves.toBe("not-recoverable")
    expect(run).not.toHaveBeenCalledWith(["rebase", "--abort"])
  })

  it("preserves the rebase state when abort fails and reports both failures", async () => {
    const root = await createRepository()
    await writeRebaseState(root, "synapse-head", "synapse-onto")
    const syncError = new Error("CONFLICT (content): merge conflict")
    const abortError = new Error("abort failed")
    const run = createStateRun(root, abortError)

    await expect(recoverOwnedRebase({
      error: syncError,
      expectedOnto: "synapse-onto",
      expectedOrigHead: "synapse-head",
      localPath: root,
      run,
    })).rejects.toMatchObject({
      name: "AggregateError",
      message: expect.stringContaining("无法中止 Synapse 启动的 rebase"),
      errors: [syncError, abortError],
    })
  })
})
