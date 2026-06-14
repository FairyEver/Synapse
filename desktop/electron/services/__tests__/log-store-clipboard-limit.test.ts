import { afterAll, describe, expect, it, vi } from "vitest"
import os from "node:os"
import path from "node:path"
import { LOG_CLIPBOARD_MAX_BYTES } from "../../../config"
import { assertLogClipboardReadSize, logStore } from "../log-store"

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => path.join(os.tmpdir(), "synapse-app")),
    getPath: vi.fn(() => path.join(os.tmpdir(), "synapse-log-store-test")),
  },
}))

afterAll(async () => {
  await logStore.dispose()
})

describe("assertLogClipboardReadSize", () => {
  it("allows clipboard reads up to the configured limit", () => {
    expect(() => assertLogClipboardReadSize(LOG_CLIPBOARD_MAX_BYTES)).not.toThrow()
  })

  it("rejects clipboard reads over the configured limit", () => {
    expect(() => assertLogClipboardReadSize(LOG_CLIPBOARD_MAX_BYTES + 1)).toThrow("复制上限")
  })
})
