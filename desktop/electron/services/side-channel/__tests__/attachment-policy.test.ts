import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  AttachmentPolicyError,
  prepareSideChannelAttachments,
} from "../attachment-policy"

describe("side-channel attachment policy", () => {
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
})
