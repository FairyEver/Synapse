const fsMockState = vi.hoisted(() => ({
  failReadPath: null as string | null,
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()

  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      const [target] = args
      if (fsMockState.failReadPath && String(target) === fsMockState.failReadPath) {
        throw new Error("readFile should not be called for oversized path attachments")
      }
      return actual.readFile(...args)
    }),
  }
})

import { mkdir, mkdtemp, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AttachmentPolicyError,
  prepareSideChannelAttachments,
} from "../attachment-policy"

describe("side-channel attachment policy", () => {
  afterEach(() => {
    fsMockState.failReadPath = null
  })

  it("sanitizes missing path attachment failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "synapse-side-channel-"))
    const workspace = path.join(root, "workspace")
    const missing = path.join(workspace, "missing-secret-output.txt")
    await mkdir(workspace)

    await expect(prepareSideChannelAttachments({
      files: [{ path: missing, mimeType: "text/plain" }],
      workspacePath: workspace,
    })).rejects.toMatchObject({
      code: "attachment_not_found",
      message: "attachment path was not found",
    })

    await expect(prepareSideChannelAttachments({
      files: [{ path: missing, mimeType: "text/plain" }],
      workspacePath: workspace,
    })).rejects.not.toThrow(missing)
  })

  it("uses attachment policy errors for unreadable path attachments", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "synapse-side-channel-"))
    const workspace = path.join(root, "workspace")
    const missing = path.join(workspace, "missing-output.txt")
    await mkdir(workspace)

    await expect(prepareSideChannelAttachments({
      files: [{ path: missing, mimeType: "text/plain" }],
      workspacePath: workspace,
    })).rejects.toBeInstanceOf(AttachmentPolicyError)
  })

  it("rejects oversized path attachments before reading file contents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "synapse-side-channel-"))
    const workspace = path.join(root, "workspace")
    const large = path.join(workspace, "large.txt")
    await mkdir(workspace)
    await writeFile(large, "")
    await truncate(large, 10 * 1024 * 1024 + 1)
    fsMockState.failReadPath = large

    await expect(prepareSideChannelAttachments({
      files: [{ path: large, mimeType: "text/plain" }],
      workspacePath: workspace,
    })).rejects.toMatchObject({ code: "attachment_too_large" })
  })
})
