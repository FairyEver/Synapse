import type { Clipboard } from "electron"

export async function readClipboardPng(clipboard: Pick<Clipboard, "read">): Promise<Buffer> {
  const items = await clipboard.read()
  for (const item of items) {
    if (item.types.includes("image/png")) {
      return Buffer.from(await (await item.getType("image/png")).arrayBuffer())
    }
  }
  return Buffer.alloc(0)
}

// Electron 44 会将原始 OS 格式枚举为 osclipboard MIME；不使用旧 has(UTI)。
export async function readClipboardRawFormat(clipboard: Pick<Clipboard, "read">, format: string): Promise<Buffer> {
  const mime = `electron application/osclipboard;format="${format}"`
  const items = await clipboard.read()
  for (const item of items) {
    if (item.types.includes(mime)) {
      const blob = await item.getType(mime)
      if (!(blob instanceof Blob)) throw new Error("Invalid raw clipboard payload")
      return Buffer.from(await blob.arrayBuffer())
    }
  }
  return Buffer.alloc(0)
}
