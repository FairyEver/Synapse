import path from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-attachments-pool-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import {
  attachmentsPoolService,
  normalizeAttachmentSha256,
} from "../attachments-pool-service"

describe("attachmentsPoolService", () => {
  it("normalizes valid attachment sha256 digests", () => {
    expect(normalizeAttachmentSha256("AB".repeat(32))).toBe("ab".repeat(32))
  })

  it("rejects invalid attachment sha256 before resolving paths", () => {
    expect(() => attachmentsPoolService.resolveAttachmentPath("/repo", "../../outside.txt")).toThrow("附件摘要无效。")
    expect(() => attachmentsPoolService.resolveAttachmentPath("/repo", "not-a-digest")).toThrow("附件摘要无效。")
  })

  it("resolves valid attachment paths inside the blob pool", () => {
    const sha256 = "ab".repeat(32)

    expect(attachmentsPoolService.resolveAttachmentPath("/repo", sha256)).toBe(
      path.join("/repo", "system", "blobs", "ab", "ab", sha256),
    )
  })
})
