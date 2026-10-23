import { describe, expect, it } from "vitest"
import type { Clipboard } from "electron"
import { readClipboardPng, readClipboardRawFormat } from "../native-reader"

function source(values: Record<string, Blob>): Pick<Clipboard, "read"> {
  return { read: async () => [{ types: Object.keys(values), getType: async (type: string) => values[type] } as Electron.ClipboardItem] }
}

describe("Electron 44 clipboard reader", () => {
  it("reads PNG Blob bytes and ignores non-image content", async () => {
    expect(await readClipboardPng(source({ "image/png": new Blob(["png"]) }))).toEqual(Buffer.from("png"))
    expect(await readClipboardPng(source({ "text/plain": new Blob(["text"]) }))).toEqual(Buffer.alloc(0))
  })
  it("recognizes native concealed formats via their raw OS MIME names", async () => {
    const reader = source({ 'electron application/osclipboard;format="org.nspasteboard.ConcealedType"': new Blob(["1"]) })
    expect(await readClipboardRawFormat(reader, "org.nspasteboard.ConcealedType")).toEqual(Buffer.from("1"))
    expect(await readClipboardRawFormat(reader, "application/x-nspasteboard-concealed-type")).toEqual(Buffer.alloc(0))
  })
  it("propagates native read failures so concealed detection can fail closed", async () => {
    const reader = { read: async () => { throw new Error("native unavailable") } }
    await expect(readClipboardRawFormat(reader, "org.nspasteboard.ConcealedType")).rejects.toThrow("native unavailable")
  })
})
