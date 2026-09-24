import { describe, expect, it } from "vitest"
import { alignDriveUtf8Start, createDriveTextChunk, decodeDriveReadCursor } from "./drive-file-chunk"
import { applyDriveFilePatch, DriveFilePatchError } from "./drive-file-patch"

describe("Drive Agent file chunks", () => {
  it("reconstructs a 46 KiB Markdown exactly without HTML and within the serialized MCP budget", () => {
    const text = ("# 标题 😀\r\n\\\"quoted\\\"\n" + "x".repeat(91) + "\n").repeat(400)
    const bytes = Buffer.from(text)
    expect(bytes.length).toBeGreaterThan(46 * 1024)
    let offset = 0
    const parts: Buffer[] = []
    while (offset < bytes.length) {
      const raw = bytes.subarray(offset, Math.min(bytes.length, offset + 8196))
      const chunk = createDriveTextChunk({ itemId: "file-1", versionId: "version-1", leaseId: "lease_12345678", source: raw, sourceStartByte: offset, totalBytes: bytes.length, mode: "beginning" })
      expect(chunk.startByte).toBe(offset)
      expect(chunk.text).not.toContain("<h1")
      expect(Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(chunk, null, 2) }] }))).toBeLessThanOrEqual(16 * 1024)
      parts.push(Buffer.from(chunk.text))
      offset = chunk.endByte
      if (chunk.nextCursor) expect(decodeDriveReadCursor(chunk.nextCursor).offset).toBe(offset)
      else expect(offset).toBe(bytes.length)
    }
    expect(Buffer.concat(parts)).toEqual(bytes)
  })

  it("keeps a tail block at EOF and an around block over its anchor", () => {
    const bytes = Buffer.from("甲".repeat(4000))
    const tailStart = 4000
    const tailRaw = bytes.subarray(tailStart)
    const aligned = alignDriveUtf8Start(tailRaw)
    const tail = createDriveTextChunk({ itemId: "file-1", versionId: "v1", leaseId: "lease_12345678", source: tailRaw.subarray(aligned), sourceStartByte: tailStart + aligned, totalBytes: bytes.length, mode: "tail" })
    expect(tail.endOfFile).toBe(true)
    expect(tail.endByte).toBe(bytes.length)
    const anchorByte = 6000
    const aroundStart = anchorByte - 256
    const aroundRaw = bytes.subarray(aroundStart, aroundStart + 8196)
    const aroundAligned = alignDriveUtf8Start(aroundRaw)
    const around = createDriveTextChunk({ itemId: "file-1", versionId: "v1", leaseId: "lease_12345678", source: aroundRaw.subarray(aroundAligned), sourceStartByte: aroundStart + aroundAligned, totalBytes: bytes.length, mode: "around", anchorByte })
    expect(around.startByte).toBeLessThanOrEqual(anchorByte)
    expect(around.endByte).toBeGreaterThanOrEqual(anchorByte)
  })

  it("shrinks heavily escaped source without losing a continuation", () => {
    const bytes = Buffer.from("\u0000\\\"".repeat(5000))
    const chunk = createDriveTextChunk({ itemId: "file-1", versionId: "v1", leaseId: "lease_12345678", source: bytes.subarray(0, 8196), sourceStartByte: 0, totalBytes: bytes.length, mode: "beginning" })
    expect(chunk.endByte).toBeGreaterThan(0)
    expect(chunk.nextCursor).not.toBeNull()
    expect(Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ ok: true, data: chunk }, null, 2) }] }))).toBeLessThanOrEqual(16 * 1024)
  })
})

describe("Drive Agent file patch", () => {
  it("applies located changes and append on one baseline with final byte ranges", () => {
    const result = applyDriveFilePatch("# 甲\n中间\n结尾", [
      { type: "insert_after", target: { exact: "# 甲" }, text: "\n😀" },
      { type: "replace_exact", target: { exact: "中间" }, text: "新的" },
      { type: "append", text: "\n尾声" },
    ])
    expect(result.text).toBe("# 甲\n😀\n新的\n结尾\n尾声")
    for (const applied of result.applied) {
      const bytes = Buffer.from(result.text)
      expect(bytes.subarray(applied.startByte, applied.endByte).toString()).toBe(["\n😀", "新的", "\n尾声"][applied.operationIndex])
    }
  })

  it("inserts before a unique anchor and reports a zero-width deletion range", () => {
    const result = applyDriveFilePatch("开头\n保留\n删除\n结尾", [
      { type: "insert_before", target: { exact: "保留" }, text: "新增\n" },
      { type: "replace_exact", target: { exact: "删除\n" }, text: "" },
    ])
    expect(result.text).toBe("开头\n新增\n保留\n结尾")
    expect(result.applied[1]?.startByte).toBe(result.applied[1]?.endByte)
    expect(Buffer.from(result.text).subarray(result.applied[0]!.startByte, result.applied[0]!.endByte).toString()).toBe("新增\n")
  })

  it("rejects ambiguous, missing, overlapping, and broad replacements", () => {
    const code = (fn: () => unknown) => {
      try { fn() } catch (error) { return (error as DriveFilePatchError).code }
      return null
    }
    expect(code(() => applyDriveFilePatch("same same", [{ type: "replace_exact", target: { exact: "same" }, text: "x" }]))).toBe("DRIVE_FILE_PATCH_TARGET_AMBIGUOUS")
    expect(code(() => applyDriveFilePatch("same", [{ type: "replace_exact", target: { exact: "gone" }, text: "x" }]))).toBe("DRIVE_FILE_PATCH_TARGET_NOT_FOUND")
    expect(code(() => applyDriveFilePatch("abcdef", [
      { type: "replace_exact", target: { exact: "abc" }, text: "x" },
      { type: "replace_exact", target: { exact: "bc" }, text: "y" },
    ]))).toBe("DRIVE_FILE_PATCH_OVERLAP")
    expect(code(() => applyDriveFilePatch("a".repeat(45 * 1024), [
      { type: "replace_exact", target: { exact: "a".repeat(15 * 1024), prefix: "" }, text: "" },
    ]))).toBe("DRIVE_FILE_PATCH_TARGET_AMBIGUOUS")
    const base = "A".repeat(15000) + "B".repeat(15000) + "C".repeat(15000)
    expect(code(() => applyDriveFilePatch(base, [
      { type: "replace_exact", target: { exact: "A".repeat(15000) }, text: "" },
      { type: "replace_exact", target: { exact: "B".repeat(15000) }, text: "" },
      { type: "replace_exact", target: { exact: "C".repeat(15000) }, text: "short" },
    ]))).toBe("DRIVE_FILE_PATCH_TOO_BROAD")
    expect(code(() => applyDriveFilePatch("a".repeat(17000), [{ type: "replace_exact", target: { exact: "a".repeat(17000) }, text: "" }]))).toBe("DRIVE_FILE_PATCH_TOO_BROAD")
  })
})
