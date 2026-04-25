import { describe, expect, it } from "vitest"
import {
  createSessionAttachmentManifest,
  normalizeWeComAesKey,
} from "../../electron/services/session-attachment-service"

describe("session attachment service", () => {
  it("normalizes CC attachment metadata and appends file refs to prompts", () => {
    const manifest = createSessionAttachmentManifest("review this", [
      {
        kind: "image",
        name: "../photo.png",
        bytes: Uint8Array.from([0x89, 0x50, 0x4E, 0x47]),
      },
      {
        kind: "file",
        name: "report.pdf",
        bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
      },
      {
        kind: "audio",
        format: "silk",
        bytes: Uint8Array.from([1, 2, 3]),
      },
    ])

    expect(manifest.issues).toEqual([])
    expect(manifest.records).toMatchObject([
      {
        kind: "image",
        name: "photo.png",
        mimeType: "image/png",
        size: 4,
        hasInlineData: true,
        localRef: ".cc-connect/attachments/photo.png",
        sendEnabled: true,
      },
      {
        kind: "file",
        name: "report.pdf",
        mimeType: "application/pdf",
        size: 4,
        localRef: ".cc-connect/attachments/report.pdf",
      },
      {
        kind: "audio",
        name: "voice_3.silk",
        mimeType: "audio/silk",
        size: 3,
      },
    ])
    expect(manifest.records[0]?.sha256).toHaveLength(64)
    expect(manifest.prompt).toContain(".cc-connect/attachments/report.pdf")
  })

  it("rejects duplicate names and oversized media without writing files", () => {
    const manifest = createSessionAttachmentManifest("", [
      { kind: "file", name: "same.txt", size: 1 },
      { kind: "file", name: "same.txt", size: 1 },
      { kind: "image", name: "huge.png", size: 21 << 20 },
    ], {
      attachmentSend: "off",
    })

    expect(manifest.records).toHaveLength(1)
    expect(manifest.records[0]?.sendEnabled).toBe(false)
    expect(manifest.issues).toEqual([
      "duplicate attachment name: same.txt",
      "attachment huge.png exceeds 20971520 bytes",
    ])
  })

  it("normalizes WeCom websocket AES keys like the CC media parser", () => {
    const key = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1))
    const urlSafe = Buffer.from(key).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const hex = Buffer.from(key).toString("hex")

    expect(Buffer.from(normalizeWeComAesKey(urlSafe) ?? []).equals(Buffer.from(key))).toBe(true)
    expect(Buffer.from(normalizeWeComAesKey(hex) ?? []).equals(Buffer.from(key))).toBe(true)
    expect(normalizeWeComAesKey("bad")).toBeNull()
  })
})
